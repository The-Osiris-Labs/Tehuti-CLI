import type { ContentBlock } from "../api/base-client.js";
import { logger } from "../utils/logger.js";
import { AsyncMutex } from "../utils/mutex.js";
import { getTelemetry } from "../utils/telemetry.js";
import {
	getToolCache,
	invalidateOnBash,
	invalidateOnWrite,
	shouldCacheTool,
} from "./cache/index.js";
import type { AgentContext } from "./context.js";
import { getPrefetcher } from "./prefetcher.js";
import type { ToolResult } from "./tools/registry.js";
import { executeTool, getTool } from "./tools/registry.js";
import {
	applySelfHealingSafely,
	formatToolResultForLLM,
	makeToolErrorResult,
	type ToolFailureHealer,
} from "./tools/result-utils.js";

export interface ToolCall {
	id: string;
	function: {
		name: string;
		arguments: string;
	};
}

export interface ParallelExecutionOptions {
	maxConcurrency?: number;
	onToolCall?: (name: string, args: unknown) => void;
	onToolResult?: (id: string, name: string, result: ToolResult) => void;
	addToolResult: (
		ctx: AgentContext,
		toolCallId: string,
		toolName: string,
		result: string | ContentBlock[],
	) => void;
	ctx: AgentContext;
	toolContext: Parameters<typeof executeTool>[2];
	signal?: AbortSignal;
	selfHealer?: ToolFailureHealer;
}

export interface ClassifiedToolCalls {
	parallel: ToolCall[];
	sequential: ToolCall[];
	interactive: ToolCall[];
}

export function classifyToolCalls(toolCalls: ToolCall[]): ClassifiedToolCalls {
	const parallel: ToolCall[] = [];
	const sequential: ToolCall[] = [];
	const interactive: ToolCall[] = [];

	for (const tc of toolCalls) {
		const tool = getTool(tc.function.name);
		const intent = tool?.intent || "destructive"; // Default to destructive for safety

		if (intent === "interactive") {
			interactive.push(tc);
		} else if (intent === "read-only") {
			parallel.push(tc);
		} else {
			sequential.push(tc);
		}
	}

	return { parallel, sequential, interactive };
}

export function canRunInParallel(toolCalls: ToolCall[]): boolean {
	const intents = toolCalls.map((tc) => getTool(tc.function.name)?.intent);
	if (intents.includes("destructive")) return false;
	if (intents.includes("interactive")) return false;
	return true;
}

async function executeToolCall(
	tc: ToolCall,
	_ctx: AgentContext,
	toolContext: Parameters<typeof executeTool>[2],
	cache: ReturnType<typeof getToolCache>,
	telemetry: ReturnType<typeof getTelemetry>,
	selfHealer?: ToolFailureHealer,
): Promise<ToolResult> {
	const toolName = tc.function.name;
	let args: unknown;

	try {
		args = JSON.parse(tc.function.arguments);
	} catch (error) {
		const message = `Failed to parse arguments for ${toolName}`;
		telemetry.recordToolExecution(toolName, 0, false, false);
		logger.error(
			`Argument parsing failed for tool ${toolName} (${tc.id}):`,
			error,
		);
		return makeToolErrorResult(message, message);
	}

	if (shouldCacheTool(getTool(toolName), toolName, args)) {
		const cached = cache.get(toolName, args);
		if (cached) {
			telemetry.recordToolExecution(toolName, 0, true, true);
			return cached;
		}
	}

	const prefetchedPromise = getPrefetcher().getPrefetched(toolName, args);
	if (prefetchedPromise) {
		const prefetchedResult = await prefetchedPromise;
		if (prefetchedResult) {
			return prefetchedResult as ToolResult;
		}
	}

	const startTime = Date.now();
	let result = await executeTool(toolName, args, toolContext);
	result = await applySelfHealingSafely(toolName, args, result, selfHealer);
	const durationMs = Date.now() - startTime;

	telemetry.recordToolExecution(toolName, durationMs, result.success, false);

	if (shouldCacheTool(getTool(toolName), toolName, args) && result.success) {
		cache.set(toolName, args, result);
	}

	const toolDef = getTool(toolName);
	if (toolDef?.intent === "destructive") {
		invalidateOnWrite(toolDef, toolName, args);
	}

	if (toolName === "bash") {
		const command =
			args && typeof args === "object"
				? (args as Record<string, unknown>).command
				: undefined;
		if (typeof command === "string") {
			invalidateOnBash(command);
		}
	}

	return result;
}

export async function executeToolsParallel(
	toolCalls: ToolCall[],
	options: ParallelExecutionOptions,
	signal?: AbortSignal,
): Promise<ToolResult[]> {
	const {
		maxConcurrency: maxConcurrencyOption,
		onToolCall,
		onToolResult,
		addToolResult,
		ctx,
		toolContext,
		signal: optionsSignal,
		selfHealer,
	} = options;
	const maxConcurrency = maxConcurrencyOption ?? ctx.config?.performance?.maxParallelTools ?? 5;

	const activeSignal = signal ?? optionsSignal;
	const cache = getToolCache();
	const telemetry = getTelemetry();
	const mutex = new AsyncMutex();
	const toolCallIndexMap = new Map(toolCalls.map((tc, i) => [tc.id, i]));
	const results: ToolResult[] = new Array(toolCalls.length);

	for (const tc of toolCalls) {
		try {
			onToolCall?.(tc.function.name, JSON.parse(tc.function.arguments));
		} catch (e) {
			onToolCall?.(tc.function.name, {
				__parseError: String(e),
				__rawArguments: tc.function.arguments,
			});
		}
	}

	interface Batch {
		type: "parallel" | "sequential";
		toolCalls: ToolCall[];
	}

	const batches: Batch[] = [];
	let currentParallelBatch: ToolCall[] = [];

	for (const tc of toolCalls) {
		const toolName = tc.function.name;
		const isSafe = getTool(toolName)?.intent === "read-only";

		if (isSafe) {
			currentParallelBatch.push(tc);
		} else {
			if (currentParallelBatch.length > 0) {
				batches.push({ type: "parallel", toolCalls: currentParallelBatch });
				currentParallelBatch = [];
			}
			batches.push({ type: "sequential", toolCalls: [tc] });
		}
	}
	if (currentParallelBatch.length > 0) {
		batches.push({ type: "parallel", toolCalls: currentParallelBatch });
	}

	try {
		for (const batch of batches) {
			if (activeSignal?.aborted) {
				for (let i = 0; i < toolCalls.length; i++) {
					if (!results[i]) {
						const tc = toolCalls[i];
						const result: ToolResult = {
							success: false,
							output: "",
							error: "Execution aborted by user",
						};
						results[i] = result;
						telemetry.recordToolExecution(tc.function.name, 0, false, false);
						logger.warn(
							`Tool execution aborted for ${tc.function.name} (${tc.id})`,
						);
						addToolResult(ctx, tc.id, tc.function.name, formatToolResultForLLM(result));
						onToolResult?.(tc.id, tc.function.name, result);
					}
				}
				return results;
			}

			if (batch.type === "parallel") {
				const parallelStartTime = Date.now();
				const parallelChunks: ToolCall[][] = [];

				for (let i = 0; i < batch.toolCalls.length; i += maxConcurrency) {
					parallelChunks.push(batch.toolCalls.slice(i, i + maxConcurrency));
				}

				for (const chunk of parallelChunks) {
					if (activeSignal?.aborted) {
						for (let i = 0; i < toolCalls.length; i++) {
							if (!results[i]) {
								const tc = toolCalls[i];
								const result: ToolResult = {
									success: false,
									output: "",
									error: "Execution aborted by user",
								};
								results[i] = result;
								telemetry.recordToolExecution(
									tc.function.name,
									0,
									false,
									false,
								);
								logger.warn(
									`Tool execution aborted for ${tc.function.name} (${tc.id})`,
								);
								addToolResult(ctx, tc.id, tc.function.name, formatToolResultForLLM(result));
								onToolResult?.(tc.id, tc.function.name, result);
							}
						}
						return results;
					}

					const chunkResults = await Promise.all(
						chunk.map(async (tc) => {
							try {
								if (activeSignal?.aborted) {
									const result: ToolResult = {
										success: false,
										output: "",
										error: "Execution aborted by user",
									};
									telemetry.recordToolExecution(
										tc.function.name,
										0,
										false,
										false,
									);
									logger.warn(
										`Tool execution aborted for ${tc.function.name} (${tc.id})`,
									);
									await mutex.runExclusive(async () => {
										addToolResult(ctx, tc.id, tc.function.name, formatToolResultForLLM(result));
									});
									onToolResult?.(tc.id, tc.function.name, result);
									return result;
								}

								const result = await executeToolCall(
									tc,
									ctx,
									toolContext,
									cache,
									telemetry,
									selfHealer,
								);

								await mutex.runExclusive(async () => {
									addToolResult(ctx, tc.id, tc.function.name, formatToolResultForLLM(result));
								});

								onToolResult?.(tc.id, tc.function.name, result);
								return result;
							} catch (error) {
								const result: ToolResult = {
									success: false,
									output: "",
									error: `Parallel execution failed: ${error instanceof Error ? error.message : String(error)}`,
								};
								telemetry.recordToolExecution(
									tc.function.name,
									0,
									false,
									false,
								);
								logger.error(
									`Parallel execution exception for tool ${tc.function.name} (${tc.id}):`,
									error,
								);
								await mutex.runExclusive(async () => {
									addToolResult(ctx, tc.id, tc.function.name, formatToolResultForLLM(result));
								});
								onToolResult?.(tc.id, tc.function.name, result);
								return result;
							}
						}),
					);

					for (let i = 0; i < chunk.length; i++) {
						const globalIndex = toolCallIndexMap.get(chunk[i].id) ?? -1;
						if (globalIndex >= 0) {
							results[globalIndex] = chunkResults[i];
						}
					}
				}

				const parallelEndTime = Date.now();
				const parallelDuration = parallelEndTime - parallelStartTime;

				let sequentialEstimate = 0;
				for (const tc of batch.toolCalls) {
					const toolStats = telemetry.getToolStats().get(tc.function.name);
					if (toolStats) {
						sequentialEstimate += toolStats.avgMs;
					}
				}

				if (
					batch.toolCalls.length > 1 &&
					sequentialEstimate > parallelDuration
				) {
					telemetry.recordParallelExecution(
						batch.toolCalls.length,
						parallelDuration,
						sequentialEstimate,
					);
				}
			} else {
				const tc = batch.toolCalls[0];
				try {
					const result = await executeToolCall(
						tc,
						ctx,
						toolContext,
						cache,
						telemetry,
						selfHealer,
					);

					addToolResult(ctx, tc.id, tc.function.name, formatToolResultForLLM(result));

					onToolResult?.(tc.id, tc.function.name, result);

					const globalIndex = toolCallIndexMap.get(tc.id) ?? -1;
					if (globalIndex >= 0) {
						results[globalIndex] = result;
					}
				} catch (error) {
					const result: ToolResult = {
						success: false,
						output: "",
						error: `Execution failed: ${error instanceof Error ? error.message : String(error)}`,
					};
					telemetry.recordToolExecution(tc.function.name, 0, false, false);
					logger.error(
						`Sequential execution exception for tool ${tc.function.name} (${tc.id}):`,
						error,
					);
					addToolResult(ctx, tc.id, tc.function.name, formatToolResultForLLM(result));
					onToolResult?.(tc.id, tc.function.name, result);
					const globalIndex = toolCallIndexMap.get(tc.id) ?? -1;
					if (globalIndex >= 0) {
						results[globalIndex] = result;
					}
				}
			}
		}
	} catch (batchError) {
		logger.error("Unexpected error during batch tool execution:", batchError);
	} finally {
		for (let i = 0; i < toolCalls.length; i++) {
			if (!results[i]) {
				const tc = toolCalls[i];
				const result: ToolResult = {
					success: false,
					output: "",
					error: "Execution aborted or incomplete",
				};
				results[i] = result;
				telemetry.recordToolExecution(tc.function.name, 0, false, false);
				logger.error(
					`Orphaned tool call resolved with fallback error for ${tc.function.name} (${tc.id})`,
				);
				addToolResult(ctx, tc.id, tc.function.name, formatToolResultForLLM(result));
				onToolResult?.(tc.id, tc.function.name, result);
			}
		}
	}

	return results;
}

export function getParallelizableCount(toolCalls: ToolCall[]): number {
	return toolCalls.filter(
		(tc) => getTool(tc.function.name)?.intent === "read-only",
	).length;
}

export function getSequentialCount(toolCalls: ToolCall[]): number {
	return toolCalls.filter((tc) => {
		const intent = getTool(tc.function.name)?.intent;
		return intent !== "read-only" && intent !== "interactive";
	}).length;
}
