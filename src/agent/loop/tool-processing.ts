import { executeToolsParallel, getParallelizableCount, classifyToolCalls, type ToolCall } from "../parallel-executor.js";
import { checkPermission } from "../../permissions/index.js";
import { hookExecutor } from "../../hooks/executor.js";
import { isPlanMode, isToolAllowedInPlanMode } from "../tools/plan-mode.js";
import { getToolContext, trackToolCall, addToolResult } from "../context.js";
import { shouldCacheTool, getToolCache, invalidateOnWrite, invalidateOnBash } from "../cache/index.js";
import { executeTool, getTool } from "../tools/registry.js";
import { getTelemetry } from "../../utils/telemetry.js";
import { debug } from "../../utils/debug.js";
import type { AgentContext } from "../context.js";
import { getPrefetcher } from "../prefetcher.js";

export interface ToolProcessingOptions {
	onToolCall?: (name: string, args: unknown) => void;
	onToolResult?: (name: string, result: unknown) => void;
	onProgress?: (progress: number, label: string) => void;
}

function checkFirewallPolicy(toolName: string, args: any): { allowed: boolean; reason?: string } {
	const argsStr = JSON.stringify(args || {}).toLowerCase();
	
	if (/(rm\s+-r.*f\s*\/[\s"']|rm\s+-r.*f\s*$)/.test(argsStr)) {
		return { allowed: false, reason: "Dangerous command detected: 'rm -rf /' variant." };
	}
	
	if (/\.git\b/.test(argsStr)) {
		return { allowed: false, reason: "Modifying or accessing .git directory is prohibited." };
	}

	return { allowed: true };
}

export async function processToolCalls(
	ctx: AgentContext,
	toolCallsTyped: ToolCall[],
	options: ToolProcessingOptions,
	signal?: AbortSignal
): Promise<number> {
	const { onToolCall, onToolResult, onProgress } = options;
	let processedCount = 0;
	
	const contextForTools = getToolContext(ctx, signal);
	const classified = classifyToolCalls(toolCallsTyped);
	const parallelCount = getParallelizableCount(toolCallsTyped);
	
	if (toolCallsTyped.length > 1) {
		debug.log("agent", `Executing \${parallelCount} tools in parallel`);

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
					reason: `Permission denied: \${permission.reason}`,
				});
				continue;
			}

			allowedCalls.push(tc);
		}

		for (const { tc, reason } of blockedCalls) {
			processedCount++;
			trackToolCall(ctx, tc.function.name);
			onToolCall?.(tc.function.name, {});
			onToolResult?.(tc.function.name, { error: reason });
			addToolResult(
				ctx,
				tc.id,
				tc.function.name,
				JSON.stringify({ error: reason }),
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
				onToolCall?.(tc.function.name, args);
				onProgress?.(50, `Executing \${tc.function.name}...`);
			}

			const toolStartTime = Date.now();
			const results = await executeToolsParallel(allowedCalls, {
				ctx,
				toolContext: contextForTools,
				onToolResult: (name, result) => {
					onToolResult?.(name, result);
					const duration = Date.now() - toolStartTime;
					onProgress?.(70, `Executed \${name} in \${(duration / 1000).toFixed(2)}s`);
				},
				addToolResult: (c, id, name, resultStr) => {
					addToolResult(c, id, name, resultStr);
				},
				signal,
			}, signal);

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

				await hookExecutor.executeHook("PostToolUse", {
					toolName: tc.function.name,
					args,
					result,
					filePath: typeof filePath === "string" ? filePath : undefined,
					cwd: ctx.cwd,
					env: process.env as Record<string, string>,
				});
			}
		}
	} else {
		const cache = getToolCache();
		const telemetry = getTelemetry();
		for (const tc of toolCallsTyped) {
			if (signal?.aborted) {
				const errorMsg = "Execution aborted by user";
				onToolResult?.(tc.function.name, { error: errorMsg });
				addToolResult(
					ctx,
					tc.id,
					tc.function.name,
					JSON.stringify({ error: errorMsg }),
				);
				processedCount++;
				continue;
			}
			processedCount++;
			trackToolCall(ctx, tc.function.name);

			let args: unknown;
			try {
				args = JSON.parse(tc.function.arguments);
			} catch {
				args = {};
			}

			onToolCall?.(tc.function.name, args);
			onProgress?.(50, `Executing \${tc.function.name}...`);
			debug.log("agent", `Tool call: \${tc.function.name}`, args);

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

			const policyCheck = checkFirewallPolicy(tc.function.name, args);
			if (!policyCheck.allowed) {
				const errorMsg = `Policy Violation: ${policyCheck.reason}`;
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
				debug.log("agent", `Hook blocked: \${tc.function.name}`);
				onToolResult?.(tc.function.name, {
					error: preHookResult.error ?? "Blocked by hook",
				});
				addToolResult(
					ctx,
					tc.id,
					tc.function.name,
					JSON.stringify({
						error: preHookResult.error ?? "Blocked by hook",
					}),
				);
				continue;
			}

			const permission = await checkPermission(
				{ toolName: tc.function.name, args },
				ctx.config.permissions,
			);

			if (!permission.allowed) {
				debug.log("agent", `Permission denied for \${tc.function.name}`);
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
				let result: any;

				if (shouldCacheTool(getTool(tc.function.name), tc.function.name, args)) {
					const cached = cache.get(tc.function.name, args);
					if (cached) {
						result = cached;
						telemetry.recordToolExecution(tc.function.name, 0, true, true);
						debug.log("agent", `Cache hit for ${tc.function.name}`);
					}
				}

				if (!result) {
					const prefetchedPromise = getPrefetcher().getPrefetched(tc.function.name, args);
					if (prefetchedPromise) {
						debug.log("agent", `Awaiting active prefetch for ${tc.function.name}`);
						const prefetchedResult = await prefetchedPromise;
						if (prefetchedResult) {
							result = prefetchedResult;
						}
					}
				}

				if (!result) {
					result = await executeTool(
						tc.function.name,
						args,
						contextForTools,
					);
					const durationMs = Date.now() - startTime;
					telemetry.recordToolExecution(
						tc.function.name,
						durationMs,
						result.success,
						false,
					);

					if (shouldCacheTool(getTool(tc.function.name), tc.function.name, args) && result.success) {
						cache.set(tc.function.name, args, result);
					}
				}

				let resultStr = result.success
					? String(result.output)
					: `Error: ${result.error}`;
				if (resultStr.length > 50000) {
					resultStr = resultStr.slice(0, 50000) + "\n... (truncated due to excessive size)";
				}

				await hookExecutor.executeHook("PostToolUse", {
					toolName: tc.function.name,
					args,
					result,
					filePath: typeof filePath === "string" ? filePath : undefined,
					cwd: ctx.cwd,
					env: process.env as Record<string, string>,
				});

				invalidateOnWrite(getTool(tc.function.name), tc.function.name, args);

				if (tc.function.name === "bash") {
					const command = (args as any)?.command;
					if (typeof command === "string") {
						invalidateOnBash(command);
					}
				}

				const duration = Date.now() - startTime;
				onProgress?.(70, `Executed \${tc.function.name} in \${(duration / 1000).toFixed(2)}s`);
				onToolResult?.(tc.function.name, result);
				addToolResult(ctx, tc.id, tc.function.name, resultStr);

				debug.log(
					"agent",
					`Tool result: \${result.success ? "success" : "failed"}`,
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
				debug.log("agent", `Tool error: \${errorMsg}`);
			}
		}
	}
	
	return processedCount;
}
