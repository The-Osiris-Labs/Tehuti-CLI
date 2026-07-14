import { randomUUID } from "node:crypto";
import type { StandardTool } from "../../api/base-client.js";
import type { CustomProviderClient, KiloCodeClient } from "../../api/index.js";
import { debug } from "../../utils/debug.js";
import { createLogger } from "../../utils/structured-logger.js";
import {
	costTracker,
	createStreamingState,
	getToolCallsFromState,
	processStreamChunk,
} from "../../api/index.js";
import {
	isReasoningModel,
	resolveModelCapabilities,
} from "../../api/model-capabilities.js";
import type { StandardMessage } from "../../api/base-client.js";
import { StandardAPIClient } from "../../api/standard-client.js";
import { permissionManager } from "../../permissions/rules.js";
import { AgentError, APIError, formatError } from "../../utils/errors.js";
import { getTelemetry } from "../../utils/telemetry.js";
import { metrics } from "../../utils/metrics.js";
import type { AgentContext } from "../context.js";
import {
	addAssistantMessageWithTools,
	addUserMessage,
	buildSystemPrompt,
	estimateTokens,
	getToolContext,
	normalizeToolMessageHistory,
	warnOnContextLimit,
} from "../context.js";
import { wakeupQueue } from "../events.js";
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
const log = createLogger("agent-loop");
/** Maximum number of iterations in the agent loop */
const MAX_ITERATIONS = 150;

/** Timeout per iteration before it is skipped (2 minutes) */
const ITERATION_TIMEOUT_MS = 120_000;

/** Maximum retry attempts for transient API errors */
const MAX_RETRY_ATTEMPTS = 3;
/**
 * Structured error suggestions keyed by Node.js error code or API error pattern.
 * Each entry maps to actionable suggestions shown to the user.
 */
const ERROR_SUGGESTIONS: Record<string, string[]> = {
	ECONNRESET: [
		"Connection was reset by the server — it may be overloaded.",
		"Try again in a few seconds.",
	],
	ETIMEDOUT: [
		"Connection timed out — the server may be slow to respond.",
		"Try a faster model or increase --timeout.",
	],
	ENOTFOUND: [
		"DNS lookup failed — check your internet connection.",
		"Verify the API endpoint is correct.",
	],
	EACCES: [
		"Permission denied — check file permissions.",
		"Run with appropriate privileges if needed.",
	],
	ENOENT: [
		"File not found — verify the path exists.",
		"Check for typos in the file name or directory.",
	],
	EPIPE: [
		"Broken pipe — the remote end closed the connection.",
		"Try again in a few seconds.",
	],
	"429": [
		"Rate limited by the API provider.",
		"Wait a few minutes before retrying.",
		"Try a different model with --model <model-id>.",
	],
	"rate limit": [
		"Rate limited by the API provider.",
		"Wait a few minutes before retrying.",
		"Try a different model with --model <model-id>.",
	],
	context_length_exceeded: [
		"Context too long for this model.",
		"Use /compact to compress the conversation.",
		"Try a model with a larger context window.",
	],
	invalid_api_key: [
		"Invalid API key.",
		'Run "tehuti init" to reconfigure your API key.',
		"Check ~/.tehuti.json or OPENROUTER_API_KEY environment variable.",
	],
	"401": [
		"Authentication failed — invalid or expired API key.",
		'Run "tehuti init" to reconfigure your API key.',
	],
	timeout: [
		"Request timed out.",
		"Try increasing --timeout to a larger value.",
		"Use a faster model with --model <model-id>.",
		"Check your internet connection.",
	],
};

export interface AgentLoopOptions {
	onToken?: (token: string) => void;
	onToolCall?: (id: string, name: string, args: unknown) => void;
	onToolResult?: (id: string, name: string, result: unknown) => void;
	onThinking?: (content: string) => void;
	onProgress?: (progress: number, label: string) => void;
	onCheckpoint?: (event: string, ctx: AgentContext) => void | Promise<void>;
	signal?: AbortSignal;
	/**
	 * Optional advisor review hook. Called after a successful agent turn
	 * with the generated content and context so an advisor model can
	 * review output in the background. Architecture stub — actual review
	 * loop is future work.
	 */
	onAdvisorReview?: (
		content: string,
		ctx: AgentContext,
	) => void | Promise<void>;
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
		onAdvisorReview,
	} = options;

	try {
		// Clear session-scoped permission decisions to prevent cross-session bleed
		// in long-lived processes (daemon mode). Permanent rules are preserved.
		permissionManager.clearSessionDecisions();

		let totalTokensGenerated = 0;

		setParentContext(ctx);

		const telemetry = getTelemetry();
		const prefetcher = getPrefetcher();

		const systemPromptContent = await buildSystemPrompt(ctx, userMessage);

		if (ctx.messages.length === 0) {
			const systemMessage = {
				role: "system",
				content: systemPromptContent,
				timestamp: Date.now(),
				internalId: randomUUID(),
			} as const;
			ctx.messages.push(systemMessage);
			ctx.appendOnlyLog.push(systemMessage);
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
				log.info(`Model routing: ${ctx.config.model} → ${selectedModel}`);
				ctx.config.model = selectedModel;
			}
		}

		// Resolve live model capabilities (contextLength, maxOutputTokens) from provider API.
		// Falls back gracefully to config defaults on any failure.
		const capabilities = await resolveModelCapabilities(
			ctx.config.model,
			ctx.config.provider,
			{ apiKey: ctx.config.apiKey, baseUrl: ctx.config.baseUrl },
		);
		if (capabilities.contextLength) {
			ctx.modelContextLength = capabilities.contextLength;
			log.info(`Model context length: ${capabilities.contextLength} (live)`);
		}
		const maxTokens =
			capabilities.maxOutputTokens ?? ctx.config.maxTokens ?? 32000;

		syncMCPToolRegistry();
		const tools = getToolDefinitions() as StandardTool[];

		let iteration = 0;
		const maxIterations = ctx.config.maxIterations ?? MAX_ITERATIONS;
		let totalContent = "";
		let totalToolCalls = 0;
		const selfHealer = new SelfHealingManager(ctx.cwd, ctx.config);

		while (iteration < maxIterations) {
			metrics.counter('agent.iteration', { model: ctx.config.model });
			log.info(`Starting iteration ${iteration}/${maxIterations}`);

			if (signal?.aborted) {
				return {
					content: totalContent,
					toolCalls: totalToolCalls,
					success: false,
					finishReason: "aborted",
					sessionStats: costTracker.getSessionStats(),
				};
			}

			// Create per-iteration timeout to prevent hung iterations
			// Use manual AbortController + setTimeout to avoid AbortSignal.timeout timer leak
			const iterationController = new AbortController();
			const timer = setTimeout(() => {
				iterationController.abort(new DOMException(`Iteration timeout after ${ITERATION_TIMEOUT_MS / 1000}s`, 'TimeoutError'));
			}, ITERATION_TIMEOUT_MS);
			iterationController.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
			const iterationSignal = iterationController.signal;
			const combinedSignal = signal
				? AbortSignal.any([signal, iterationSignal])
				: iterationSignal;

			try {
				if (ctx.isSleeping) {
					debug.log("agent", "Agent is sleeping, waiting for event...");
					onProgress?.(
						50,
						"Sleeping... waiting for background task or subagent to complete",
					);
					const message = await wakeupQueue.consume(signal);
					ctx.isSleeping = false;
					if (message) {
						const wakeupMessage = {
							role: "system",
							content: message,
							timestamp: Date.now(),
							internalId: randomUUID(),
						} as const;
						ctx.messages.push(wakeupMessage);
						ctx.appendOnlyLog.push(wakeupMessage);
						debug.log("agent", `Agent woke up with message: ${message}`);
					}
					iteration--;
					continue;
				}

				const injectedMessages = ctx.injectionQueue.consumeAll();
				for (const msg of injectedMessages) {
					const injectedMessage = {
						role: "user",
						content: msg,
						timestamp: Date.now(),
						internalId: randomUUID(),
					} as const;
					ctx.messages.push(injectedMessage);
					ctx.appendOnlyLog.push(injectedMessage);
					debug.log("agent", `Injected mid-flight message: ${msg}`);
				}

				const contextCompacted = await manageContextWindow(
					ctx,
					client,
					ctx.modelContextLength,
				);
				if (contextCompacted) {
					await onCheckpoint?.("context_compacted", ctx);
				}

				ctx.messages = normalizeToolMessageHistory(ctx.messages);

				const modelId = ctx.config.model;
				if (debug.isEnabled()) {
					debug.log(
						"agent",
						`Available tools: ${tools.map((t) => t.function.name).join(", ")}`,
					);
				}

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
							combinedSignal,
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

									try {
										JSON.parse(tc.function.arguments);
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
										combinedSignal,
										).catch((err) => {
											debug.log("agent", "Mid-stream tool error:", err);
											return 0;
										});
										midStreamPromises.push(p);
									}
								}
							}

						// Check stream rules against accumulated content
						if (ctx.config.streamRules && ctx.config.streamRules.length > 0) {
							const content = state.content || "";
							// Minimum content length check to avoid firing on short/loud disclaimers
							if (content.length >= 100) {
								// Only check the first 200 characters — refusals happen at the start
								const checkContent = content.length > 200 ? content.substring(0, 200) : content;
								for (const rule of ctx.config.streamRules) {
									if (!rule.enabled) continue;
									try {
										const re = new RegExp(rule.pattern, "i");
										if (re.test(checkContent)) {
											debug.log("agent", `Stream rule triggered: ${rule.pattern}`);
											getTelemetry().recordRuleTrigger(rule.pattern);
											client.abort();
											ctx.injectionQueue.push(`[Stream Rule: ${rule.pattern}] Remediation: ${rule.remediation}`);
											break; // Only trigger one rule per stream
										}
									} catch (e) {
										debug.log("agent", `Invalid stream rule pattern: ${rule.pattern}`);
									}
								}
							}
						}
						} catch (streamError) {
							const estimatedPromptTokens = estimateTokens(ctx.messages);
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
					{
						signal: combinedSignal,
						maxRetries: MAX_RETRY_ATTEMPTS,
						initialDelayMs: 2000,
						onRetry: (attempt, maxRetries, _error) => {
							onProgress?.(
								attempt / maxRetries,
								`Retrying (${attempt}/${maxRetries})...`,
							);
						},
					},
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
					const assistantIndex = newMessages.findIndex((m) => m.role === "assistant");
					const assistantMessage =
						assistantIndex !== -1
							? newMessages.splice(assistantIndex, 1)[0]
							: newMessages.pop();
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
					log.info(`Request cost: ${costBreakdown.totalCost.toFixed(6)}`);
				}

				warnOnContextLimit(ctx);

				if (toolCalls.length === 0) {
					metrics.counter('agent.completion', { model: ctx.config.model });
					log.info("No tool calls, finishing");
					// Non-blocking advisor review hook (fire-and-forget)
					if (onAdvisorReview) {
						Promise.resolve(onAdvisorReview(totalContent, ctx)).catch(() => {
							// Advisor review is best-effort; ignore failures
						});
					}
					clearTimeout(timer);
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
					const toolStart = performance.now();
					const processedCount = await processToolCalls(
						ctx,
						remainingToolCalls,
						{
							onToolCall,
							onToolResult,
							onProgress,
							selfHealer,
						},
						combinedSignal,
					);
					const toolDuration = performance.now() - toolStart;
					for (const tc of remainingToolCalls) {
						metrics.histogram('agent.tool.duration', toolDuration, { tool: tc.function.name });
					}
					totalToolCalls += processedCount;
					await onCheckpoint?.("tools_processed", ctx);
				}

				// Non-blocking advisor review using secondary model
				if (ctx.config.advisorModel?.enabled) {
					reviewWithAdvisor(ctx, totalContent, ctx.messages)
						.then((advice) => {
							if (advice) {
								ctx.injectionQueue.push(`[Advisor Review] ${advice}`);
							}
						})
						.catch((err) =>
							debug.log("agent", `Advisor review failed: ${err}`),
						);
				}
			} catch (error) {
				// Iteration timeout — skip this iteration, don't crash the loop
				if (iterationSignal.aborted) {
					debug.log("agent", `Iteration ${iteration} timed out after 120s, skipping to next iteration`);
					clearTimeout(timer);
					continue;
				}

				if (
					signal?.aborted ||
					(error instanceof Error && error.message.includes("aborted"))
				) {
					clearTimeout(timer);
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
					const msg = error.message || "";
					const errCode = (error as NodeJS.ErrnoException).code;

					// 1. Check Node.js system error code first (most specific)
					if (errCode && errCode in ERROR_SUGGESTIONS) {
						suggestions.push(...ERROR_SUGGESTIONS[errCode]);
					}

					// 2. Check error message against all patterns
					if (suggestions.length === 0) {
						const lowerMsg = msg.toLowerCase();
						for (const [pattern, patternSuggestions] of Object.entries(ERROR_SUGGESTIONS)) {
							if (lowerMsg.includes(pattern.toLowerCase())) {
								suggestions.push(...patternSuggestions);
								break;
							}
						}
					}

					// 3. Fallback for unmatched errors
					if (suggestions.length === 0) {
						if (msg.includes("API") || msg.includes("key")) {
							suggestions.push(
								"Check your API key in ~/.tehuti.json or OPENROUTER_API_KEY environment variable",
							);
							suggestions.push("Run 'tehuti init' to reconfigure your API key");
						} else {
							suggestions.push("Check your internet connection");
							suggestions.push("Try again later");
							suggestions.push("Run with --debug for more details");
						}
					}
					const errorWithContext = new Error(`Agent loop error at iteration ${iteration}: ${error.message}`);
					errorWithContext.stack = error.stack;
					agentError = new AgentError(
						errorWithContext.message,
						iteration === 1 ? "initialization" : "execution",
						suggestions,
					);
					agentError.stack = errorWithContext.stack;
				} else {
					agentError = new AgentError(
						String(error),
						iteration === 1 ? "initialization" : "execution",
						["Run with --debug for more details", "Try again later"],
					);
				}

				log.error(`Agent loop error (phase: ${agentError.phase}): ${formatError(agentError)}`);
				log.debug(`Error stack: ${agentError.stack}`);

				debug.log(
					"agent",
					"Agent error UI duplication prevented:",
					formatError(agentError),
				);

				clearTimeout(timer);
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
		// Post-session personality learning (non-blocking)
		// Determine if learning should run
		const personalityConfig = ctx.config.personality;
		let shouldLearn = personalityConfig?.learningEnabled !== false;
		if (personalityConfig?.autoEnable && !shouldLearn) {
			try {
				const { autoDetectLearning } = await import(
					"../../agent/memory/personality.js"
				);
				shouldLearn = autoDetectLearning(ctx.cwd || process.cwd());
			} catch {
				// If auto-detect fails, keep the original shouldLearn value
			}
		}

		if (shouldLearn) {
			try {
				const { updateProjectProfile, getActualGitDiff } = await import(
					"../../agent/memory/personality.js"
				);
				const cwd = ctx.cwd || process.cwd();
				const commandsRun = ctx.metadata.commandsRun || [];

				try {
					const diff = getActualGitDiff(cwd);
					await updateProjectProfile(cwd, diff, commandsRun);
				} catch (err) {
					debug.log("agent", `Best-effort profile update failed: ${err}`);
				}
			} catch (err) {
				debug.log("agent", `Failed to update project profile: ${err}`);
			}
		}

		resetPrefetcher();
	}
}
const advisorReviewTimestamps: number[] = [];
/** Cumulative advisor review cost estimate across the session */
let advisorCumulativeCost = 0;

/**
 * Fire a best-effort review to the advisor model.
 * Returns advice text if the advisor has concerns, null otherwise.
 */
async function reviewWithAdvisor(
	ctx: AgentContext,
	_assistantContent: string,
	messages: StandardMessage[],
): Promise<string | null> {
	const advisorCfg = ctx.config.advisorModel;
	if (!advisorCfg?.enabled) return null;

	const maxReviews = advisorCfg.maxReviewsPerMinute ?? 3;
	const costLimit = advisorCfg.costLimit ?? 0.50;
	const now = Date.now();
	const windowStart = now - 60_000;

	// Prune timestamps outside the sliding window
	while (advisorReviewTimestamps.length > 0 && advisorReviewTimestamps[0] < windowStart) {
		advisorReviewTimestamps.shift();
	}

	// Rate limit check
	if (advisorReviewTimestamps.length >= maxReviews) {
		debug.log("agent", `Advisor review skipped: rate limit (${maxReviews}/min) reached`);
		return null;
	}

	// Cost limit check
	if (advisorCumulativeCost >= costLimit) {
		debug.log("agent", `Advisor review skipped: cost limit ($${costLimit.toFixed(2)}) exceeded`);
		return null;
	}

	try {
		const advisorConfig = {
			...ctx.config,
			model: advisorCfg.model ?? ctx.config.model,
			provider: advisorCfg.provider ?? ctx.config.provider,
		};

		const advisorClient = StandardAPIClient.getInstance(advisorConfig);

		// Build a review prompt with the last few messages as context
		const reviewMessages: StandardMessage[] = [
			{
				role: "system",
				content:
					advisorCfg.instructions ??
					"Review the primary agent's output for correctness and safety",
			},
			...messages.slice(-8),
		];

		let advice = "";
		const modelOverride = advisorCfg.model ?? ctx.config.model;
		const stream = advisorClient.streamChat(
			reviewMessages,
			undefined,
			modelOverride,
		);
		for await (const chunk of stream) {
			const delta = chunk.choices?.[0]?.delta?.content;
			if (delta) advice += delta;
		}

		// Record this review for rate limiting
		advisorReviewTimestamps.push(now);

		// Estimate cost based on character length (~4 chars per token)
		const inputText = reviewMessages.map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join(" ");
		const estimatedInputTokens = Math.ceil(inputText.length / 4);
		const estimatedOutputTokens = Math.ceil(advice.length / 4);
		const costBreakdown = costTracker.calculateCost(modelOverride, {
			promptTokens: estimatedInputTokens,
			completionTokens: estimatedOutputTokens,
			totalTokens: estimatedInputTokens + estimatedOutputTokens,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		});
		advisorCumulativeCost += costBreakdown.totalCost;

		debug.log(
			"agent",
			`Advisor review cost: ${costTracker.formatCost(costBreakdown.totalCost)} (cumulative: ${costTracker.formatCost(advisorCumulativeCost)})`,
		);

		return advice.trim() || null;
	} catch (err) {
		debug.log("agent", `Advisor review error: ${err}`);
		return null;
	}
}
