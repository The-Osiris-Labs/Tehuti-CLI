import { AsyncMutex } from "../utils/mutex.js";
import { getTelemetry } from "../utils/telemetry.js";
import {
	getToolCache,
	invalidateOnWrite,
	shouldCacheTool,
} from "./cache/index.js";
import type { AgentContext } from "./context.js";
import type { ToolResult } from "./tools/registry.js";
import { executeTool, getTool } from "./tools/registry.js";

export const INTERACTIVE_TOOLS = new Set(["question"]);

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
	onToolResult?: (name: string, result: ToolResult) => void;
	addToolResult: (
		ctx: AgentContext,
		toolCallId: string,
		toolName: string,
		result: string,
	) => void;
	ctx: AgentContext;
	toolContext: Parameters<typeof executeTool>[2];
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
		const toolName = tc.function.name;

		const toolDef = getTool(toolName);

		if (INTERACTIVE_TOOLS.has(toolName)) {
			interactive.push(tc);
		} else if (toolDef?.isReadonly) {
			parallel.push(tc);
		} else {
			sequential.push(tc);
		}
	}

	return { parallel, sequential, interactive };
}

export function canRunInParallel(toolCalls: ToolCall[]): boolean {
	const names = toolCalls.map((tc) => tc.function.name);

	const hasWrites = names.some((n) => {
		const tool = getTool(n);
		return !tool?.isReadonly;
	});
	if (hasWrites) return false;

	const hasInteractive = names.some((n) => INTERACTIVE_TOOLS.has(n));
	if (hasInteractive) return false;

	return true;
}

async function executeToolCall(
	tc: ToolCall,
	ctx: AgentContext,
	toolContext: Parameters<typeof executeTool>[2],
	cache: ReturnType<typeof getToolCache>,
	telemetry: ReturnType<typeof getTelemetry>,
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

	const startTime = Date.now();
	const result = await executeTool(toolName, args, toolContext);
	const durationMs = Date.now() - startTime;

	telemetry.recordToolExecution(toolName, durationMs, result.success, false);

	if (shouldCacheTool(getTool(toolName), toolName, args) && result.success) {
		cache.set(toolName, args, result);
	}

	const toolDef = getTool(toolName);
	if (!toolDef?.isReadonly) {
		invalidateOnWrite(toolDef, toolName, args);
	}

	return result;
}

export async function executeToolsParallel(
	toolCalls: ToolCall[],
	options: ParallelExecutionOptions,
): Promise<ToolResult[]> {
	const {
		maxConcurrency = 5,
		onToolCall,
		onToolResult,
		addToolResult,
		ctx,
		toolContext,
	} = options;

	const cache = getToolCache();
	const telemetry = getTelemetry();
	const mutex = new AsyncMutex();
	const results: ToolResult[] = new Array(toolCalls.length);
	const classified = classifyToolCalls(toolCalls);

	for (const tc of classified.parallel) {
		try {
			onToolCall?.(tc.function.name, JSON.parse(tc.function.arguments));
		} catch (e) {
			onToolCall?.(tc.function.name, { __parseError: String(e), __rawArguments: tc.function.arguments });
		}
	}

	for (const tc of classified.sequential) {
		try {
			onToolCall?.(tc.function.name, JSON.parse(tc.function.arguments));
		} catch (e) {
			onToolCall?.(tc.function.name, { __parseError: String(e), __rawArguments: tc.function.arguments });
		}
	}

	const parallelStartTime = Date.now();
	const parallelChunks: ToolCall[][] = [];

	for (let i = 0; i < classified.parallel.length; i += maxConcurrency) {
		parallelChunks.push(classified.parallel.slice(i, i + maxConcurrency));
	}

	for (const chunk of parallelChunks) {
		const chunkResults = await Promise.all(
			chunk.map(async (tc) => {
				const result = await executeToolCall(
					tc,
					ctx,
					toolContext,
					cache,
					telemetry,
				);

				await mutex.runExclusive(async () => {
					const resultStr =
						typeof result.output === "string"
							? result.output
							: JSON.stringify(result.output);
					addToolResult(ctx, tc.id, tc.function.name, resultStr);
				});

				onToolResult?.(tc.function.name, result);

				return result;
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
	for (const tc of classified.parallel) {
		const toolStats = telemetry.getToolStats().get(tc.function.name);
		if (toolStats) {
			sequentialEstimate += toolStats.avgMs;
		}
	}

	if (classified.parallel.length > 1 && sequentialEstimate > parallelDuration) {
		telemetry.recordParallelExecution(
			classified.parallel.length,
			parallelDuration,
			sequentialEstimate,
		);
	}

	for (const tc of classified.sequential) {
		const result = await executeToolCall(
			tc,
			ctx,
			toolContext,
			cache,
			telemetry,
		);

		const resultStr =
			typeof result.output === "string"
				? result.output
				: JSON.stringify(result.output);
		addToolResult(ctx, tc.id, tc.function.name, resultStr);

		onToolResult?.(tc.function.name, result);

		const globalIndex = toolCalls.indexOf(tc);
		if (globalIndex >= 0) {
			results[globalIndex] = result;
		}
	}

	for (const tc of classified.interactive) {
		const result = await executeToolCall(
			tc,
			ctx,
			toolContext,
			cache,
			telemetry,
		);

		const resultStr =
			typeof result.output === "string"
				? result.output
				: JSON.stringify(result.output);
		addToolResult(ctx, tc.id, tc.function.name, resultStr);

		onToolResult?.(tc.function.name, result);

		const globalIndex = toolCalls.indexOf(tc);
		if (globalIndex >= 0) {
			results[globalIndex] = result;
		}
	}

	return results;
}

export function getParallelizableCount(toolCalls: ToolCall[]): number {
	return toolCalls.filter((tc) => getTool(tc.function.name)?.isReadonly).length;
}

export function getSequentialCount(toolCalls: ToolCall[]): number {
	return toolCalls.filter(
		(tc) =>
			!getTool(tc.function.name)?.isReadonly &&
			!INTERACTIVE_TOOLS.has(tc.function.name),
	).length;
}
