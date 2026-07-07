import { randomUUID } from "node:crypto";
import type { StandardTool } from "../../api/base-client.js";
import type { CustomProviderClient, KiloCodeClient } from "../../api/index.js";
import {
	costTracker,
	createStreamingState,
	getToolCallsFromState,
	processStreamChunk,
} from "../../api/index.js";
import { isReasoningModel } from "../../api/model-capabilities.js";
import type { StandardAPIClient } from "../../api/standard-client.js";

import { debug } from "../../utils/debug.js";

import { AgentError, APIError, formatError } from "../../utils/errors.js";
import { getTelemetry } from "../../utils/telemetry.js";
import type { AgentContext } from "../context.js";
import {
	addAssistantMessageWithTools,
	addUserMessage,
	buildSystemPrompt,
	getToolContext,
	normalizeToolMessageHistory,
	warnOnContextLimit,
} from "../context.js";
import { injectionQueue, wakeupQueue } from "../events.js";
import { classifyTask, selectModelForClassification } from "../model-router.js";
import type { ToolCall } from "../parallel-executor.js";
import { getPrefetcher, resetPrefetcher } from "../prefetcher.js";
import { getToolDefinitions } from "../tools/index.js";
import { getTool } from "../tools/registry.js";
import { setParentContext } from "../tools/system.js";
import { manageContextWindow } from "./compression.js";
import { withRetry } from "./retry.js";
import { SelfHealingManager } from "./self-healing.js";
import { processToolCalls } from "./tool-processing.js";

export interface AgentLoopOptions {
	onToken?: (token: string) => void;
	onToolCall?: (id: string, name: string, args: unknown) => void;
	onToolResult?: (id: string, name: string, result: unknown) => void;
	onThinking?: (content: string) => void;
	onProgress?: (progress: number, label: string) => void;
	onCheckpoint?: (event: string, ctx: AgentContext) => void | Promise<void>;
	signal?: AbortSignal;
}

export interface AgentLoopResult {
	content: string;
	toolCalls: number;
	success: boolean;
	finishReason: string | null;
	thinking?: string;
	usage?: {
		promptTokens: number;
		completionTokens: number;
		totalTokens: number;
		cacheReadTokens?: number;
		cacheWriteTokens?: number;
	};
	sessionStats?: {
		totalPromptTokens: number;
		totalCompletionTokens: number;
		totalCacheReadTokens: number;
		totalCacheWriteTokens: number;
		totalCost: number;
		requestCount: number;
	};
	error?: string;
}

export async function runAgentLoop(
	ctx: AgentContext,
	userMessage: string,
	client: StandardAPIClient | KiloCodeClient | CustomProviderClient,
	syncMCPToolRegistry: () => void,
	options: AgentLoopOptions = {},
): Promise<AgentLoopResult> {
	const {
		onToken,
		onToolCall,
		onToolResult,
		onThinking,
		onProgress,
		onCheckpoint,
		signal,
	} = options;

	try {
		let totalTokensGenerated = 0;
		const maxTokens = ctx.config.maxTokens ?? 4096;

		setParentContext(ctx);

		const telemetry = getTelemetry();
		const prefetcher = getPrefetcher();

		const systemPromptContent = await buildSystemPrompt(ctx, userMessage);

		if (ctx.messages.length === 0) {
			ctx.messages.push({
				role: "system",
				content: systemPromptContent,
				timestamp: Date.now(),
				internalId: randomUUID(),
			});
		} else if (ctx.messages[0]?.role === "system") {
			ctx.messages[0].content = systemPromptContent;
		}

		addUserMessage(ctx, userMessage);
		await onCheckpoint?.("user_message_added", ctx);

		let selectedModel = ctx.config.model;
		if (ctx.config.provider !== "custom") {
			const pendingTools = classifyTask(userMessage, ctx);
			selectedModel = selectModelForClassification(
				pendingTools,
				ctx.config.provider,
				{
					modelSelection: ctx.config.modelSelection,
					modelTiers: ctx.config.modelTiers,
					manualModel:
						ctx.config.modelSelection === "manual"
							? ctx.config.model
							: undefined,
				},
			);
			if (selectedModel !== ctx.config.model) {
				debug.log(
					"agent",
					`Model routing: ${ctx.config.model} → ${selectedModel}`,
				);
				ctx.config.model = selectedModel;
			}
		}

		syncMCPToolRegistry();
		const tools = getToolDefinitions() as StandardTool[];

		let iteration = 0;
		const maxIterations = ctx.config.maxIterations;
		let totalContent = "";
		let totalToolCalls = 0;
		const selfHealer = new SelfHealingManager(ctx.cwd);

		while (iteration < maxIterations) {
			iteration++;
			debug.log("agent", `Starting iteration \${iteration}/\${maxIterations}`);

			if (signal?.aborted) {
				return {
					content: totalContent,
					toolCalls: totalToolCalls,
					success: false,
					finishReason: "aborted",
					sessionStats: costTracker.getSessionStats(),
				};
			}

			try {
				if (ctx.isSleeping) {
					debug.log("agent", "Agent is sleeping, waiting for event...");
					onProgress?.(
						50,
						"Sleeping... waiting for background task or subagent to complete",
					);
					const message = await wakeupQueue.consume();
					ctx.isSleeping = false;
					if (message) {
						ctx.messages.push({
							role: "system",
							content: message,
							timestamp: Date.now(),
							internalId: randomUUID(),
						});
						debug.log("agent", `Agent woke up with message: ${message}`);
					}
					iteration--;
					continue;
				}

				const injectedMessages = injectionQueue.consumeAll();
				for (const msg of injectedMessages) {
					ctx.messages.push({
						role: "user",
						content: msg,
						timestamp: Date.now(),
						internalId: randomUUID(),
					});
					debug.log("agent", `Injected mid-flight message: ${msg}`);
				}

				await manageContextWindow(ctx, client);

				ctx.messages = normalizeToolMessageHistory(ctx.messages);

				const modelId = ctx.config.model;
				debug.log(
					"agent",
					`Available tools: ${tools.map((t) => t.function.name).join(", ")}`,
				);

				// Use retry wrapper for API calls
				let state = createStreamingState(modelId);
				let midStreamPromises: Promise<number>[] = [];
				let dispatchedToolIds = new Set<string>();
				const streamStartMessageCount = ctx.messages.length;
				const preRetryTotalContent = totalContent;
				const preRetryTokensGenerated = totalTokensGenerated;

				await withRetry(
					async () => {
						// Await any pending mid-stream promises before retrying to prevent orphaned parallel tools
						if (midStreamPromises.length > 0) {
							await Promise.allSettled(midStreamPromises);
						}

						state = createStreamingState(modelId);
						midStreamPromises = [];
						dispatchedToolIds = new Set<string>();
						totalContent = preRetryTotalContent;
						totalTokensGenerated = preRetryTokensGenerated;
						if (ctx.messages.length > streamStartMessageCount) {
							ctx.messages.length = streamStartMessageCount;
						}

						const stream = client.streamChat(
							ctx.messages,
							tools,
							undefined,
							signal,
						);
						if (isReasoningModel(modelId)) {
							debug.log("agent", `Using reasoning model: ${modelId}`);
						}

						try {
							for await (const chunk of stream) {
								if (signal?.aborted) {
									client.abort();
									throw new AgentError(
										"Execution aborted by user",
										"execution",
									);
								}

								const { hasContent, newContent, hasThinking, newThinking } =
									processStreamChunk(
										state,
										chunk as unknown as Parameters<
											typeof processStreamChunk
										>[1],
										modelId,
									);

								if (hasContent && newContent) {
									onToken?.(newContent);
									totalTokensGenerated++;
									const progress = Math.min(
										Math.round((totalTokensGenerated / maxTokens) * 90),
										90,
									);
									onProgress?.(progress, "Generating response...");
									totalContent += newContent;
								}

								if (hasThinking && newThinking) {
									onThinking?.(newThinking);
								}

								const currentToolCalls = getToolCallsFromState(state);
								for (const tc of currentToolCalls) {
									if (dispatchedToolIds.has(tc.id)) continue;

									let args: unknown;
									try {
										args = JSON.parse(tc.function.arguments);
									} catch {
										continue;
									}

									const toolDef = getTool(tc.function.name);
									if (toolDef?.intent === "read-only") {
										dispatchedToolIds.add(tc.id);
										debug.log(
											"agent",
											`Mid-stream dispatching read-only tool: ${tc.function.name}`,
										);

										const tcTyped: ToolCall = {
											id: tc.id,
											function: {
												name: tc.function.name,
												arguments: tc.function.arguments,
											},
										};

										const p = processToolCalls(
											ctx,
											[tcTyped],
											{ onToolCall, onToolResult, onProgress, selfHealer },
											signal,
										).catch((err) => {
											debug.log("agent", "Mid-stream tool error:", err);
											return 0;
										});
										midStreamPromises.push(p);
									}
								}
							}
						} catch (streamError) {
							const estimatedPromptTokens = Math.floor(
								JSON.stringify(ctx.messages).length / 4,
							);
							const estimatedCompletionTokens = Math.floor(
								(state.content?.length || 0) / 4,
							);

							costTracker.trackRequest(modelId, {
								promptTokens: estimatedPromptTokens,
								completionTokens: estimatedCompletionTokens,
								totalTokens: estimatedPromptTokens + estimatedCompletionTokens,
								cacheReadTokens: 0,
								cacheWriteTokens: 0,
							});

							throw streamError;
						}
					},
					{ signal, maxRetries: 3, initialDelayMs: 2000 },
				);

				const midStreamCounts = await Promise.all(midStreamPromises);
				for (const count of midStreamCounts) {
					totalToolCalls += count;
				}
				if (midStreamCounts.some((count) => count > 0)) {
					await onCheckpoint?.("mid_stream_tools_processed", ctx);
				}

				const toolCalls = getToolCallsFromState(state);

				addAssistantMessageWithTools(
					ctx,
					state.content || "",
					toolCalls.length > 0 ? toolCalls : undefined,
				);

				if (ctx.messages.length > streamStartMessageCount) {
					const newMessages = ctx.messages.splice(streamStartMessageCount);
					const assistantMessage = newMessages.pop();
					if (assistantMessage) {
						ctx.messages.push(assistantMessage);
					}
					ctx.messages.push(...newMessages);
				}
				await onCheckpoint?.("assistant_message_added", ctx);

				if (state.usage) {
					ctx.metadata.tokensUsed += state.usage.totalTokens;
					if (state.usage.cacheReadTokens) {
						ctx.metadata.cacheReadTokens += state.usage.cacheReadTokens;
					}
					if (state.usage.cacheWriteTokens) {
						ctx.metadata.cacheWriteTokens += state.usage.cacheWriteTokens;
					}

					const costBreakdown = costTracker.trackRequest(ctx.config.model, {
						promptTokens: state.usage.promptTokens,
						completionTokens: state.usage.completionTokens,
						totalTokens: state.usage.totalTokens,
						cacheReadTokens: state.usage.cacheReadTokens,
						cacheWriteTokens: state.usage.cacheWriteTokens,
					});
					telemetry.recordModelCost(
						ctx.config.model,
						state.usage.promptTokens,
						state.usage.completionTokens,
						costBreakdown.totalCost,
					);
					debug.log(
						"agent",
						`Request cost: $\${costBreakdown.totalCost.toFixed(6)}`,
					);
				}

				warnOnContextLimit(ctx);

				if (toolCalls.length === 0) {
					debug.log("agent", "No tool calls, finishing");
					return {
						content: totalContent,
						toolCalls: totalToolCalls,
						success: true,
						finishReason: state.finishReason,
						thinking: state.thinking || undefined,
						usage: state.usage,
						sessionStats: costTracker.getSessionStats(),
					};
				}

				const tc = toolCalls[0];
				if (tc) {
					let args: unknown;
					try {
						args = JSON.parse(tc.function.arguments);
					} catch {
						args = {};
					}
					prefetcher.predict(tc.function.name, args, getToolContext(ctx));
				}

				const toolCallsTyped: ToolCall[] = toolCalls.map((tc) => ({
					id: tc.id,
					function: {
						name: tc.function.name,
						arguments: tc.function.arguments,
					},
				}));

				const remainingToolCalls = toolCallsTyped.filter(
					(tc) => !dispatchedToolIds.has(tc.id),
				);

				if (remainingToolCalls.length > 0) {
					const processedCount = await processToolCalls(
						ctx,
						remainingToolCalls,
						{
							onToolCall,
							onToolResult,
							onProgress,
							selfHealer,
						},
						signal,
					);
					totalToolCalls += processedCount;
					await onCheckpoint?.("tools_processed", ctx);
				}
			} catch (error) {
				if (
					signal?.aborted ||
					(error instanceof Error && error.message.includes("aborted"))
				) {
					return {
						content: totalContent,
						toolCalls: totalToolCalls,
						success: false,
						finishReason: "aborted",
						sessionStats: costTracker.getSessionStats(),
					};
				}

				let agentError: any;

				if (error instanceof APIError) {
					agentError = error;
				} else if (error instanceof Error) {
					const suggestions: string[] = [];
					if (error.message.includes("API") || error.message.includes("key")) {
						suggestions.push(
							"Check your API key in ~/.tehuti.json or OPENROUTER_API_KEY environment variable",
						);
						suggestions.push("Run 'tehuti init' to reconfigure your API key");
					} else if (
						error.message.includes("timeout") ||
						error.message.includes("Timeout")
					) {
						suggestions.push("Try increasing --timeout to a larger value");
						suggestions.push("Use a faster model with --model <model-id>");
						suggestions.push("Check your internet connection");
					} else if (
						error.message.includes("rate limit") ||
						error.message.includes("429")
					) {
						suggestions.push("Wait a few minutes before making more requests");
						suggestions.push("Try a different model with --model <model-id>");
					} else if (error.message.includes("context")) {
						suggestions.push("Try a model with larger context window");
						suggestions.push("Simplify your prompt to reduce context length");
						suggestions.push("Use /compact command to compress context");
					} else {
						suggestions.push("Check your internet connection");
						suggestions.push("Try again later");
						suggestions.push("Run with --debug for more details");
					}

					agentError = new AgentError(
						error.message,
						iteration === 1 ? "initialization" : "execution",
						suggestions,
					);
				} else {
					agentError = new AgentError(
						String(error),
						iteration === 1 ? "initialization" : "execution",
						["Run with --debug for more details", "Try again later"],
					);
				}

				debug.log(
					"agent",
					`Agent loop error (phase: \${agentError.phase}):`,
					agentError,
				);
				debug.log("agent", "Error stack:", agentError.stack);

				debug.log(
					"agent",
					"Agent error UI duplication prevented:",
					formatError(agentError),
				);

				return {
					content: totalContent,
					toolCalls: totalToolCalls,
					success: false,
					finishReason: "error",
					sessionStats: costTracker.getSessionStats(),
					error: agentError.message || String(agentError),
				};
			}
		}

		return {
			content: totalContent,
			toolCalls: totalToolCalls,
			success: false,
			finishReason: "max_iterations",
			sessionStats: costTracker.getSessionStats(),
		};
	} finally {
		resetPrefetcher();
	}
}
