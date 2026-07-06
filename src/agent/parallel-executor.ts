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

const MODEL_TOOL_RESULT_MAX_CHARS = 20000;

function truncateToolResultForModel(result: string): string {
	if (result.length <= MODEL_TOOL_RESULT_MAX_CHARS) {
		return result;
	}
	return `${result.slice(0, MODEL_TOOL_RESULT_MAX_CHARS)}\n... (truncated due to excessive size)`;
}

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
		result: string,
	) => void;
	ctx: AgentContext;
	toolContext: Parameters<typeof executeTool>[2];
	signal?: AbortSignal;
	selfHealer?: any;
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
	selfHealer?: any,
): Promise<ToolResult> {
	const toolName = tc.function.name;
	let args: unknown;

	try {
		args = JSON.parse(tc.function.arguments);
	} catch {
		return {
			success: false,
			output: `Failed to parse arguments for ${toolName}`,
		};
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

	if (result && !result.success && selfHealer) {
		result = await selfHealer.wrapToolFailure(toolName, args, result);
	}
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
		maxConcurrency = 5,
		onToolCall,
		onToolResult,
		addToolResult,
		ctx,
		toolContext,
		signal: optionsSignal,
		selfHealer,
	} = options;

	const activeSignal = signal ?? optionsSignal;
	const cache = getToolCache();
	const telemetry = getTelemetry();
	const mutex = new AsyncMutex();
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

	for (const batch of batches) {
		if (activeSignal?.aborted) {
			for (let i = 0; i < toolCalls.length; i++) {
				if (!results[i]) {
					results[i] = {
						success: false,
						output: "",
						error: "Execution aborted by user",
					};
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
							results[i] = {
								success: false,
								output: "",
								error: "Execution aborted by user",
							};
						}
					}
					return results;
				}

				const chunkResults = await Promise.all(
					chunk.map(async (tc) => {
						try {
							if (activeSignal?.aborted) {
								return {
									success: false,
									output: "",
									error: "Execution aborted by user",
								};
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
								let resultStr =
									typeof result.output === "string"
										? result.output
										: JSON.stringify(result.output ?? "");
								resultStr = truncateToolResultForModel(resultStr);
								addToolResult(ctx, tc.id, tc.function.name, resultStr);
							});

							onToolResult?.(tc.id, tc.function.name, result);
							return result;
						} catch (error) {
							const result = {
								success: false,
								output: "",
								error: `Parallel execution failed: ${error instanceof Error ? error.message : String(error)}`,
							};
							onToolResult?.(tc.id, tc.function.name, result);
							return result;
						}
					}),
				);

				for (let i = 0; i < chunk.length; i++) {
					const globalIndex = toolCalls.indexOf(chunk[i]);
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

			if (batch.toolCalls.length > 1 && sequentialEstimate > parallelDuration) {
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

				let resultStr =
					typeof result.output === "string"
						? result.output
						: JSON.stringify(result.output ?? "");
				resultStr = truncateToolResultForModel(resultStr);
				addToolResult(ctx, tc.id, tc.function.name, resultStr);

				onToolResult?.(tc.id, tc.function.name, result);

				const globalIndex = toolCalls.indexOf(tc);
				if (globalIndex >= 0) {
					results[globalIndex] = result;
				}
			} catch (error) {
				const result = {
					success: false,
					output: "",
					error: `Execution failed: ${error instanceof Error ? error.message : String(error)}`,
				};
				onToolResult?.(tc.id, tc.function.name, result);
				const globalIndex = toolCalls.indexOf(tc);
				if (globalIndex >= 0) {
					results[globalIndex] = result;
				}
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
