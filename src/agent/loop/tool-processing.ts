import type { ContentBlock } from "../../api/base-client.js";
import { hookExecutor } from "../../hooks/executor.js";
import { checkPermission } from "../../permissions/index.js";
import { debug } from "../../utils/debug.js";
import { getTelemetry } from "../../utils/telemetry.js";
import {
	getToolCache,
	invalidateOnBash,
	invalidateOnWrite,
	shouldCacheTool,
} from "../cache/index.js";
import type { AgentContext } from "../context.js";
import { addToolResult, getToolContext, trackToolCall } from "../context.js";
import {
	executeToolsParallel,
	getParallelizableCount,
	type ToolCall,
} from "../parallel-executor.js";
import { getPrefetcher } from "../prefetcher.js";
import { isPlanMode, isToolAllowedInPlanMode } from "../tools/plan-mode.js";
import { executeTool, getTool, type ToolResult } from "../tools/registry.js";
import {
	applySelfHealingSafely,
	makeToolErrorResult,
	type ToolFailureHealer,
} from "../tools/result-utils.js";

const MODEL_TOOL_RESULT_MAX_CHARS = 250000;

function formatToolResultForLLM(result: unknown): string | ContentBlock[] {
	const record =
		result && typeof result === "object"
			? (result as Record<string, unknown>)
			: undefined;
	const outStr = String(record?.output ?? "");
	const baseResultStr = record?.success
		? outStr
		: `Error: ${String(record?.error ?? "Tool failed")}\nOutput: ${outStr}`;

	let diagnosticsHeader = "";
	if (record?.metadata && typeof record.metadata === "object") {
		const meta = record.metadata as Record<string, unknown>;
		if (typeof meta.base64 === "string" && typeof meta.mimeType === "string") {
			return [
				{
					type: "text",
					text: record?.success
						? outStr
						: `Error: ${String(record?.error ?? "Tool failed")}\nOutput: ${outStr}`,
				},
				{
					type: "image_url",
					image_url: {
						url: `data:${meta.mimeType};base64,${meta.base64}`,
					},
				},
			];
		}

		const entries = Object.entries(meta)
			.filter(
				([k, v]) =>
					v !== undefined && v !== null && k !== "base64" && k !== "mimeType",
			)
			.map(([k, v]) => `${k}: ${String(v)}`);
		if (entries.length > 0) {
			diagnosticsHeader = `[Diagnostics | ${entries.join(" | ")}]\n`;
		}
	}

	const resultStr = `${diagnosticsHeader}${baseResultStr}`;
	if (resultStr.length <= MODEL_TOOL_RESULT_MAX_CHARS) {
		return resultStr;
	}
	return `${resultStr.slice(0, MODEL_TOOL_RESULT_MAX_CHARS)}\n... [Output truncated: showing ${MODEL_TOOL_RESULT_MAX_CHARS.toLocaleString()} of ${resultStr.length.toLocaleString()} total characters]`;
}

export interface ToolProcessingOptions {
	onToolCall?: (id: string, name: string, args: unknown) => void;
	onToolResult?: (id: string, name: string, result: unknown) => void;
	onProgress?: (progress: number, label: string) => void;
	selfHealer?: ToolFailureHealer;
}

function checkFirewallPolicy(
	_toolName: string,
	args: unknown,
): { allowed: boolean; reason?: string } {
	const argsStr = JSON.stringify(args || {}).toLowerCase();

	if (/(rm\s+-[rR].*f\s*\/(?:[\s"'*]|$))/.test(argsStr)) {
		return {
			allowed: false,
			reason: "Dangerous command detected: 'rm -rf /' variant.",
		};
	}

	return { allowed: true };
}

export async function processToolCalls(
	ctx: AgentContext,
	toolCallsTyped: ToolCall[],
	options: ToolProcessingOptions,
	signal?: AbortSignal,
): Promise<number> {
	const { onToolCall, onToolResult, onProgress, selfHealer } = options;
	let processedCount = 0;

	const contextForTools = getToolContext(ctx, signal);
	const parallelCount = getParallelizableCount(toolCallsTyped);

	if (toolCallsTyped.length > 1) {
		debug.log("agent", `Executing ${parallelCount} tools in parallel`);

		const allowedCalls: ToolCall[] = [];
		const blockedCalls: Array<{ tc: ToolCall; reason: string }> = [];

		for (const tc of toolCallsTyped) {
			let args: unknown;
			try {
				args = JSON.parse(tc.function.arguments);
			} catch (err) {
				const errorMsg = `Invalid JSON arguments for tool "${tc.function.name}": ${(err as Error).message}. Please fix the JSON and try again.`;
				blockedCalls.push({
					tc,
					reason: errorMsg,
				});
				continue;
			}

			if (isPlanMode() && !isToolAllowedInPlanMode(tc.function.name)) {
				blockedCalls.push({
					tc,
					reason: `Tool "${tc.function.name}" is not allowed in plan mode.`,
				});
				continue;
			}

			const policyCheck = checkFirewallPolicy(tc.function.name, args);
			if (!policyCheck.allowed) {
				blockedCalls.push({
					tc,
					reason: `Policy Violation: ${policyCheck.reason}`,
				});
				continue;
			}

			const filePath =
				typeof args === "object" && args !== null && "file_path" in args
					? (args as Record<string, unknown>).file_path
					: undefined;

			let preHookResult: { proceed: boolean; error?: string } = {
				proceed: true,
			};
			try {
				preHookResult = await hookExecutor.executeHook("PreToolUse", {
					toolName: tc.function.name,
					args,
					filePath: typeof filePath === "string" ? filePath : undefined,
					cwd: ctx.cwd,
					env: process.env as Record<string, string>,
				});
			} catch (e) {
				preHookResult = {
					proceed: false,
					error: e instanceof Error ? e.message : String(e),
				};
			}

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
			processedCount++;
			trackToolCall(ctx, tc.function.name);
			onToolCall?.(tc.id, tc.function.name, {});
			const result = makeToolErrorResult(reason);
			onToolResult?.(tc.id, tc.function.name, result);
			addToolResult(
				ctx,
				tc.id,
				tc.function.name,
				formatToolResultForLLM(result),
			);
		}

		if (allowedCalls.length > 0) {
			for (const tc of allowedCalls) {
				processedCount++;
				trackToolCall(ctx, tc.function.name);
				let args: unknown;
				try {
					args = JSON.parse(tc.function.arguments);
				} catch {
					args = {};
				}
				onToolCall?.(tc.id, tc.function.name, args);
				onProgress?.(50, `Executing ${tc.function.name}...`);
			}

			const toolStartTime = Date.now();
			const results = await executeToolsParallel(
				allowedCalls,
				{
					ctx,
					toolContext: contextForTools,
					onToolResult: (id, name, result) => {
						onToolResult?.(id, name, result);
						const duration = Date.now() - toolStartTime;
						onProgress?.(
							70,
							`Executed ${name} in ${(duration / 1000).toFixed(2)}s`,
						);
					},
					addToolResult: (c, id, name, resultStr) => {
						addToolResult(c, id, name, resultStr);
					},
					signal,
					selfHealer,
				},
				signal,
			);

			for (let i = 0; i < allowedCalls.length; i++) {
				const tc = allowedCalls[i];
				const result = results[i];
				if (!result) continue;

				let args: unknown;
				try {
					args = JSON.parse(tc.function.arguments);
				} catch {
					args = {};
				}

				const filePath =
					typeof args === "object" && args !== null && "file_path" in args
						? (args as Record<string, unknown>).file_path
						: undefined;

				try {
					await hookExecutor.executeHook("PostToolUse", {
						toolName: tc.function.name,
						args,
						result,
						filePath: typeof filePath === "string" ? filePath : undefined,
						cwd: ctx.cwd,
						env: process.env as Record<string, string>,
					});
				} catch (e) {
					debug.log("agent", "PostToolUse hook failed:", e);
				}
			}
		}
	} else {
		const cache = getToolCache();
		const telemetry = getTelemetry();
		for (const tc of toolCallsTyped) {
			if (signal?.aborted) {
				const errorMsg = "Execution aborted by user";
				const result = makeToolErrorResult(errorMsg);
				onToolResult?.(tc.id, tc.function.name, result);
				addToolResult(
					ctx,
					tc.id,
					tc.function.name,
					formatToolResultForLLM(result),
				);
				processedCount++;
				continue;
			}
			processedCount++;
			trackToolCall(ctx, tc.function.name);

			let args: unknown;
			try {
				args = JSON.parse(tc.function.arguments);
			} catch (err) {
				const errorMsg = `Invalid JSON arguments for tool "${tc.function.name}": ${(err as Error).message}. Please fix the JSON and try again.`;
				const result = makeToolErrorResult(errorMsg);
				onToolResult?.(tc.id, tc.function.name, result);
				addToolResult(
					ctx,
					tc.id,
					tc.function.name,
					formatToolResultForLLM(result),
				);
				continue;
			}

			onToolCall?.(tc.id, tc.function.name, args);
			onProgress?.(50, `Executing ${tc.function.name}...`);
			debug.log("agent", `Tool call: ${tc.function.name}`, args);

			if (isPlanMode() && !isToolAllowedInPlanMode(tc.function.name)) {
				const errorMsg = `Tool "${tc.function.name}" is not allowed in plan mode. Use read-only tools for exploration.`;
				const result = makeToolErrorResult(errorMsg);
				onToolResult?.(tc.id, tc.function.name, result);
				addToolResult(
					ctx,
					tc.id,
					tc.function.name,
					formatToolResultForLLM(result),
				);
				continue;
			}

			const policyCheck = checkFirewallPolicy(tc.function.name, args);
			if (!policyCheck.allowed) {
				const errorMsg = `Policy Violation: ${policyCheck.reason}`;
				const result = makeToolErrorResult(errorMsg);
				onToolResult?.(tc.id, tc.function.name, result);
				addToolResult(
					ctx,
					tc.id,
					tc.function.name,
					formatToolResultForLLM(result),
				);
				continue;
			}

			const filePath =
				typeof args === "object" && args !== null && "file_path" in args
					? (args as Record<string, unknown>).file_path
					: undefined;

			let preHookResult: { proceed: boolean; error?: string } = {
				proceed: true,
			};
			try {
				preHookResult = await hookExecutor.executeHook("PreToolUse", {
					toolName: tc.function.name,
					args,
					filePath: typeof filePath === "string" ? filePath : undefined,
					cwd: ctx.cwd,
					env: process.env as Record<string, string>,
				});
			} catch (e) {
				preHookResult = {
					proceed: false,
					error: e instanceof Error ? e.message : String(e),
				};
			}

			if (!preHookResult.proceed) {
				debug.log("agent", `Hook blocked: ${tc.function.name}`);
				const result = makeToolErrorResult(
					preHookResult.error ?? "Blocked by hook",
				);
				onToolResult?.(tc.id, tc.function.name, result);
				addToolResult(
					ctx,
					tc.id,
					tc.function.name,
					formatToolResultForLLM(result),
				);
				continue;
			}

			const permission = await checkPermission(
				{ toolName: tc.function.name, args },
				ctx.config.permissions,
			);

			if (!permission.allowed) {
				debug.log("agent", `Permission denied for ${tc.function.name}`);
				const result = makeToolErrorResult("Permission denied", "", {
					reason: permission.reason,
				});
				onToolResult?.(tc.id, tc.function.name, result);
				addToolResult(
					ctx,
					tc.id,
					tc.function.name,
					formatToolResultForLLM(result),
				);
				continue;
			}

			try {
				const startTime = Date.now();
				let result: ToolResult | undefined;

				if (
					shouldCacheTool(getTool(tc.function.name), tc.function.name, args)
				) {
					const cached = cache.get(tc.function.name, args);
					if (cached) {
						result = cached;
						telemetry.recordToolExecution(tc.function.name, 0, true, true);
						debug.log("agent", `Cache hit for ${tc.function.name}`);
					}
				}

				if (!result) {
					const prefetchedPromise = getPrefetcher().getPrefetched(
						tc.function.name,
						args,
					);
					if (prefetchedPromise) {
						debug.log(
							"agent",
							`Awaiting active prefetch for ${tc.function.name}`,
						);
						const prefetchedResult = await prefetchedPromise;
						if (prefetchedResult) {
							result = prefetchedResult as ToolResult;
						}
					}
				}

				if (!result) {
					result = await executeTool(tc.function.name, args, contextForTools);
					result = await applySelfHealingSafely(
						tc.function.name,
						args,
						result,
						selfHealer,
					);
				}

				if (!result) {
					throw new Error(
						`Tool execution for ${tc.function.name} failed to return a result.`,
					);
				}

				const durationMs = Date.now() - startTime;
				telemetry.recordToolExecution(
					tc.function.name,
					durationMs,
					result.success,
					false,
				);

				if (
					shouldCacheTool(getTool(tc.function.name), tc.function.name, args)
				) {
					cache.set(tc.function.name, args, result);
				}

				const resultStr = formatToolResultForLLM(result);

				try {
					await hookExecutor.executeHook("PostToolUse", {
						toolName: tc.function.name,
						args,
						result,
						filePath: typeof filePath === "string" ? filePath : undefined,
						cwd: ctx.cwd,
						env: process.env as Record<string, string>,
					});
				} catch (e) {
					debug.log("agent", "PostToolUse hook failed:", e);
				}

				invalidateOnWrite(getTool(tc.function.name), tc.function.name, args);

				if (tc.function.name === "bash") {
					const command =
						args && typeof args === "object"
							? (args as Record<string, unknown>).command
							: undefined;
					if (typeof command === "string") {
						invalidateOnBash(command);
					}
				}

				const duration = Date.now() - startTime;
				onProgress?.(
					70,
					`Executed ${tc.function.name} in ${(duration / 1000).toFixed(2)}s`,
				);
				onToolResult?.(tc.id, tc.function.name, result);
				addToolResult(ctx, tc.id, tc.function.name, resultStr);

				debug.log(
					"agent",
					`Tool result: ${result.success ? "success" : "failed"}`,
				);
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : String(error);
				const result = makeToolErrorResult(errorMsg);
				onToolResult?.(tc.id, tc.function.name, result);
				addToolResult(
					ctx,
					tc.id,
					tc.function.name,
					formatToolResultForLLM(result),
				);
				debug.log("agent", `Tool error: ${errorMsg}`);
			}
		}
	}

	return processedCount;
}
