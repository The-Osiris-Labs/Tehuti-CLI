import {
	costTracker,
	createStreamingState,
	getToolCallsFromState,
	OpenRouterClient,
	processStreamChunk,
} from "../api/index.js";
import { isReasoningModel } from "../api/model-capabilities.js";
import type { OpenRouterTool } from "../api/openrouter.js";
import { getToolCache, invalidateOnWrite, loadCacheFromDisk, saveCacheToDisk, shouldCacheTool } from "./cache/index.js";
import {
	addAssistantMessageWithTools,
	addToolResult,
	addUserMessage,
	buildSystemPrompt,
	createAgentContext,
	getToolContext,
	trackToolCall,
	warnOnContextLimit,
} from "./context.js";
import { compressContext, createContextSummarizer, estimateTokens } from "./context-compressor.js";
import { hookExecutor, parseHooksConfig } from "../hooks/executor.js";
import {
	classifyTask,
	MODEL_TIERS,
	selectModelForClassification,
} from "./model-router.js";
import {
	classifyToolCalls,
	type ToolCall,
	executeToolsParallel,
	getParallelizableCount,
} from "./parallel-executor.js";
import { checkPermission } from "../permissions/index.js";
import { getPrefetcher } from "./prefetcher.js";
import { getTelemetry } from "../utils/telemetry.js";
import { backgroundTools } from "./tools/background.js";
import { bashTool } from "./tools/bash.js";
import { allFsTools } from "./tools/fs.js";
import { gitTools } from "./tools/git.js";
import {
	executeTool,
	getToolDefinitions,
	registerTools,
} from "./tools/index.js";
import { mcpPromptTools } from "./tools/mcp-prompts.js";
import {
	isPlanMode,
	isToolAllowedInPlanMode,
	planTools,
	setPlanMode,
} from "./tools/plan-mode.js";
import { searchTools } from "./tools/search.js";
import { setParentContext, systemTools } from "./tools/system.js";
import { webTools } from "./tools/web.js";
import { debug } from "../utils/debug.js";
import { consola } from "../utils/logger.js";
import type { AgentContext } from "./context.js";
import { skillsTools } from "./skills/tools.js";

registerTools([
	...allFsTools,
	...searchTools,
	bashTool,
	...webTools,
	...systemTools,
	...mcpPromptTools,
	...backgroundTools,
	...planTools,
	...gitTools,
	...skillsTools,
]);

loadCacheFromDisk();

export function initializeAgent(): void {
	loadCacheFromDisk();
}

export function shutdownAgent(): void {
	saveCacheToDisk();
}

export function configureHooks(hooksConfig: unknown): void {
	const hooks = parseHooksConfig(hooksConfig);
	hookExecutor.loadConfig(hooks);
}

export { setPlanMode, isPlanMode, isToolAllowedInPlanMode };

export interface AgentLoopOptions {
	onToken?: (token: string) => void;
	onToolCall?: (name: string, args: unknown) => void;
	onToolResult?: (name: string, result: unknown) => void;
	onThinking?: (content: string) => void;
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
}

export async function runAgentLoop(
	ctx: AgentContext,
	userMessage: string,
	options: AgentLoopOptions = {},
): Promise<AgentLoopResult> {
	const { onToken, onToolCall, onToolResult, onThinking, signal } = options;

	setParentContext(ctx);

	const cache = getToolCache();
	const telemetry = getTelemetry();
	const prefetcher = getPrefetcher();

	let client: OpenRouterClient;
	try {
		client = OpenRouterClient.getInstance(ctx.config);
	} catch {
		client = new OpenRouterClient(ctx.config);
	}
	const tools = getToolDefinitions() as OpenRouterTool[];

	if (ctx.messages.length === 0) {
		ctx.messages.push({
			role: "system",
			content: buildSystemPrompt(ctx, userMessage),
		});
	}

	addUserMessage(ctx, userMessage);

	const pendingTools = classifyTask(userMessage, ctx);
	const selectedModel = selectModelForClassification(pendingTools, {
		modelSelection: ctx.config.modelSelection,
		manualModel: ctx.config.model,
	});
	if (selectedModel !== ctx.config.model) {
		debug.log("agent", `Model routing: ${ctx.config.model} → ${selectedModel}`);
		ctx.config.model = selectedModel;
	}

	let iteration = 0;
	const maxIterations = ctx.config.maxIterations;
	let totalContent = "";
	let totalToolCalls = 0;

	while (iteration < maxIterations) {
		iteration++;
		debug.log("agent", `Starting iteration ${iteration}/${maxIterations}`);

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
			const currentTokens = estimateTokens(ctx.messages);
			if (currentTokens > 85000) {
				debug.log("agent", `Context compression triggered (${currentTokens} tokens)`);
				const summarizer = createContextSummarizer(async (prompt: string) => {
					const result = await client.completeChat([
						{ role: "user", content: prompt },
					], []);
					return typeof result.choices[0].message.content === "string"
						? result.choices[0].message.content
						: "";
				});
				ctx.messages = await compressContext(ctx.messages, summarizer, {
					targetTokens: 80000,
				});
			}

			const modelId = ctx.config.model;
			const stream = client.streamChat(ctx.messages, tools, undefined, signal);
			const state = createStreamingState(modelId);

			if (isReasoningModel(modelId)) {
				debug.log("agent", `Using reasoning model: ${modelId}`);
			}

			for await (const chunk of stream) {
				if (signal?.aborted) {
					client.abort();
					break;
				}

				const { hasContent, newContent, hasThinking, newThinking } =
					processStreamChunk(
						state,
						chunk as Parameters<typeof processStreamChunk>[1],
						modelId,
					);

				if (hasContent && newContent) {
					onToken?.(newContent);
					totalContent += newContent;
				}

				if (hasThinking && newThinking) {
					onThinking?.(newThinking);
				}
			}

			const toolCalls = getToolCallsFromState(state);

			addAssistantMessageWithTools(
				ctx,
				state.content || "",
				toolCalls.length > 0 ? toolCalls : undefined,
			);

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
					`Request cost: $${costBreakdown.totalCost.toFixed(6)}`,
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

			const contextForTools = getToolContext(ctx);
			const classified = classifyToolCalls(toolCallsTyped);
			const parallelCount = getParallelizableCount(toolCallsTyped);

			if (parallelCount > 1 && classified.sequential.length === 0) {
				debug.log("agent", `Executing ${parallelCount} tools in parallel`);

				const allowedCalls: ToolCall[] = [];
				const blockedCalls: Array<{ tc: ToolCall; reason: string }> = [];

				for (const tc of toolCallsTyped) {
					let args: unknown;
					try {
						args = JSON.parse(tc.function.arguments);
					} catch {
						args = {};
					}

					if (isPlanMode() && !isToolAllowedInPlanMode(tc.function.name)) {
						blockedCalls.push({
							tc,
							reason: `Tool "${tc.function.name}" is not allowed in plan mode.`,
						});
						continue;
					}

					const filePath =
						typeof args === "object" && args !== null && "file_path" in args
							? (args as Record<string, unknown>).file_path
							: undefined;

					const preHookResult = await hookExecutor.executeHook("PreToolUse", {
						toolName: tc.function.name,
						args,
						filePath: typeof filePath === "string" ? filePath : undefined,
						cwd: ctx.cwd,
						env: process.env as Record<string, string>,
					});

					if (!preHookResult.proceed) {
						blockedCalls.push({
							tc,
							reason: preHookResult.error ?? "Blocked by hook",
						});
						continue;
					}

					const permission = await checkPermission(
						{ toolName: tc.function.name, args },
						ctx.config.permissions,
					);

					if (!permission.allowed) {
						blockedCalls.push({
							tc,
							reason: `Permission denied: ${permission.reason}`,
						});
						continue;
					}

					allowedCalls.push(tc);
				}

				for (const { tc, reason } of blockedCalls) {
					totalToolCalls++;
					trackToolCall(ctx, tc.function.name);
					onToolCall?.(tc.function.name, {});
					onToolResult?.(tc.function.name, { error: reason });
					addToolResult(ctx, tc.id, tc.function.name, JSON.stringify({ error: reason }));
				}

				if (allowedCalls.length > 0) {
					for (const tc of allowedCalls) {
						totalToolCalls++;
						trackToolCall(ctx, tc.function.name);
						let args: unknown;
						try {
							args = JSON.parse(tc.function.arguments);
						} catch {
							args = {};
						}
						onToolCall?.(tc.function.name, args);
					}

					await executeToolsParallel(allowedCalls, {
						ctx,
						toolContext: contextForTools,
						onToolResult: (name, result) => {
							onToolResult?.(name, result);
						},
						addToolResult: (c, id, name, resultStr) => {
							addToolResult(c, id, name, resultStr);
						},
					});
				}
			} else {
				for (const tc of toolCallsTyped) {
					totalToolCalls++;
					trackToolCall(ctx, tc.function.name);

					let args: unknown;
					try {
						args = JSON.parse(tc.function.arguments);
					} catch {
						args = {};
					}

					onToolCall?.(tc.function.name, args);
					debug.log("agent", `Tool call: ${tc.function.name}`, args);

					if (isPlanMode() && !isToolAllowedInPlanMode(tc.function.name)) {
						const errorMsg = `Tool "${tc.function.name}" is not allowed in plan mode. Use read-only tools for exploration.`;
						onToolResult?.(tc.function.name, { error: errorMsg });
						addToolResult(
							ctx,
							tc.id,
							tc.function.name,
							JSON.stringify({ error: errorMsg }),
						);
						continue;
					}

					const filePath =
						typeof args === "object" && args !== null && "file_path" in args
							? (args as Record<string, unknown>).file_path
							: undefined;

					const preHookResult = await hookExecutor.executeHook("PreToolUse", {
						toolName: tc.function.name,
						args,
						filePath: typeof filePath === "string" ? filePath : undefined,
						cwd: ctx.cwd,
						env: process.env as Record<string, string>,
					});

					if (!preHookResult.proceed) {
						debug.log("agent", `Hook blocked: ${tc.function.name}`);
						onToolResult?.(tc.function.name, {
							error: preHookResult.error ?? "Blocked by hook",
						});
						addToolResult(
							ctx,
							tc.id,
							tc.function.name,
							JSON.stringify({ error: preHookResult.error ?? "Blocked by hook" }),
						);
						continue;
					}

					const permission = await checkPermission(
						{ toolName: tc.function.name, args },
						ctx.config.permissions,
					);

					if (!permission.allowed) {
						debug.log("agent", `Permission denied for ${tc.function.name}`);
						onToolResult?.(tc.function.name, {
							error: "Permission denied",
							reason: permission.reason,
						});
						addToolResult(
							ctx,
							tc.id,
							tc.function.name,
							JSON.stringify({
								error: "Permission denied",
								reason: permission.reason,
							}),
						);
						continue;
					}

					try {
						const startTime = Date.now();
						let result;

						if (shouldCacheTool(tc.function.name, args)) {
							const cached = cache.get(tc.function.name, args);
							if (cached) {
								result = cached;
								telemetry.recordToolExecution(tc.function.name, 0, true, true);
								debug.log("agent", `Cache hit for ${tc.function.name}`);
							}
						}

						if (!result) {
							result = await executeTool(
								tc.function.name,
								args,
								contextForTools,
							);
							const durationMs = Date.now() - startTime;
							telemetry.recordToolExecution(tc.function.name, durationMs, result.success, false);

							if (shouldCacheTool(tc.function.name, args) && result.success) {
								cache.set(tc.function.name, args, result);
							}
						}

						const resultStr = result.success
							? result.output
							: `Error: ${result.error}`;

						await hookExecutor.executeHook("PostToolUse", {
							toolName: tc.function.name,
							args,
							result,
							filePath: typeof filePath === "string" ? filePath : undefined,
							cwd: ctx.cwd,
							env: process.env as Record<string, string>,
						});

						invalidateOnWrite(tc.function.name, args);

						onToolResult?.(tc.function.name, result);
						addToolResult(ctx, tc.id, tc.function.name, resultStr);

						debug.log(
							"agent",
							`Tool result: ${result.success ? "success" : "failed"}`,
						);
					} catch (error) {
						const errorMsg =
							error instanceof Error ? error.message : String(error);
						onToolResult?.(tc.function.name, { error: errorMsg });
						addToolResult(
							ctx,
							tc.id,
							tc.function.name,
							JSON.stringify({ error: errorMsg }),
						);
						debug.log("agent", `Tool error: ${errorMsg}`);
					}
				}
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			consola.error(`Agent loop error: ${message}`);

			return {
				content: totalContent,
				toolCalls: totalToolCalls,
				success: false,
				finishReason: "error",
				sessionStats: costTracker.getSessionStats(),
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
}

export async function runOneShot(
	ctx: AgentContext,
	prompt: string,
	options: AgentLoopOptions = {},
): Promise<string> {
	const result = await runAgentLoop(ctx, prompt, options);
	return result.content;
}

export { createAgentContext };
export type { AgentContext };
