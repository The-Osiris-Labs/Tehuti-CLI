import * as path from "node:path";
import { debug } from "../utils/debug.js";
import {
	getToolCache,
	shouldCacheTool,
	stableStringify,
} from "./cache/index.js";
import type { ToolContext } from "./tools/registry.js";
import { executeTool, getTool } from "./tools/registry.js";

/** Minimal shape of performance config accessed through ToolContext.agentContext */
interface PerfConfig {
	prefetchQueueSize?: number;
	prefetchTimeoutMs?: number;
}

/** Safely extract performance config from agent context without circular imports */
function extractPerfConfig(agentContext: unknown): PerfConfig | undefined {
	if (!agentContext || typeof agentContext !== "object") return undefined;
	const ac = agentContext as Record<string, unknown>;
	const config = ac.config;
	if (!config || typeof config !== "object") return undefined;
	const cfg = config as Record<string, unknown>;
	const perf = cfg.performance;
	if (!perf || typeof perf !== "object") return undefined;
	const p = perf as Record<string, unknown>;
	return {
		prefetchQueueSize: typeof p.prefetchQueueSize === "number" ? p.prefetchQueueSize : undefined,
		prefetchTimeoutMs: typeof p.prefetchTimeoutMs === "number" ? p.prefetchTimeoutMs : undefined,
	};
}

export interface PrefetchRule {
	currentTool: string;
	nextTools: Array<{
		tool: string;
		argMapper: (args: unknown, ctx: ToolContext) => unknown | null;
		condition?: (args: unknown) => boolean;
		priority?: "high" | "medium" | "low";
	}>;
}

const EXTRA_PREFETCH_RULES: Record<string, PrefetchRule["nextTools"]> = {
	git_status: [
		{
			tool: "git_diff",
			argMapper: () => ({}),
			priority: "high",
		},
	],
	git_log: [
		{
			tool: "git_status",
			argMapper: () => ({}),
			priority: "medium",
		},
	],
};

const MAX_PREFETCH_QUEUE = 10;
const PREFETCH_TIMEOUT_MS = 5000;
/** Maximum number of recent tool-call patterns to retain for prediction */
const MAX_RECENT_PATTERNS = 50;
export class Prefetcher {
	private pending = new Map<string, Promise<unknown>>();
	private abortControllers = new Map<string, AbortController>();
	private enabled: boolean = true;
	private recentPatterns: Array<{
		tool: string;
		args: unknown;
		timestamp: number;
	}> = [];

	setEnabled(enabled: boolean): void {
		this.enabled = enabled;
		if (!enabled) {
			this.pending.clear();
		}
	}

	private buildKey(tool: string, args: unknown): string {
		return `${tool}:${stableStringify(args)}`;
	}

	private queuePrefetch(
		toolName: string,
		args: unknown,
		ctx: ToolContext,
		key: string,
		timeoutMs: number = PREFETCH_TIMEOUT_MS,
	): void {
		debug.log("prefetch", `Queueing prefetch for ${toolName}`, args);
		const controller = new AbortController();
		this.abortControllers.set(key, controller);

		let timeoutId: NodeJS.Timeout | undefined;
		const timeoutPromise = new Promise<null>((resolve) => {
			timeoutId = setTimeout(() => {
				controller.abort();
				resolve(null);
			}, timeoutMs);
		});

		const prefetchPromise = Promise.race([
			executeTool(toolName, args, { ...ctx, signal: controller.signal }),
			timeoutPromise,
		])
			.then((result) => {
				if (timeoutId) clearTimeout(timeoutId);
				if (controller.signal.aborted) {
					debug.log("prefetch", `Prefetch aborted for ${toolName}`);
					return null;
				}
				if (
					result &&
					(result as any).success &&
					shouldCacheTool(getTool(toolName), toolName, args)
				) {
					debug.log("prefetch", `Caching prefetched result for ${toolName}`);
					getToolCache().set(toolName, args, result);
				} else if (result) {
					debug.log(
						"prefetch",
						`Prefetch completed for ${toolName}, but not cached (success=${(result as any).success})`,
					);
				}
				return result;
			})
			.catch((_err) => {
				if (timeoutId) clearTimeout(timeoutId);
				debug.log("prefetch", `Prefetch failed for ${toolName}: ${_err instanceof Error ? _err.message : String(_err)}`);
				return null;
			});

		const trackedPromise = prefetchPromise.finally(() => {
			if (this.pending.get(key) === trackedPromise) {
				this.pending.delete(key);
			}
			if (this.abortControllers.get(key) === controller) {
				this.abortControllers.delete(key);
			}
		});

		this.pending.set(key, trackedPromise);
	}

	private abortPrefetchIfMatches(
		toolName: string,
		args: unknown,
		ctx: ToolContext,
	): void {
		debug.log("prefetch", `Checking abort conditions for ${toolName}`);
		const tool = getTool(toolName);
		if (!tool) return;

		// Skip read-only tools and safe tools
		if (
			tool.isReadonly !== false &&
			!tool.requiresPermission &&
			tool.category !== "bash"
		)
			return;

		const record = args as Record<string, unknown>;
		const filePath =
			record?.file_path ||
			record?.target_file ||
			record?.path ||
			record?.TargetFile;

		// Specific check for file modifications
		if (typeof filePath === "string" && tool.category !== "bash") {
			const resolvedFilePath = path.resolve(ctx.cwd, filePath);
			for (const [key, controller] of this.abortControllers.entries()) {
				const colonIndex = key.indexOf(":");
				if (colonIndex < 0) continue;
				const prefetchTool = key.slice(0, colonIndex);

				if (
					["read", "file_info", "list_dir", "read_image", "read_pdf"].includes(
						prefetchTool,
					)
				) {
					try {
						const readArgs = JSON.parse(key.slice(colonIndex + 1));
						const readPathVal =
							readArgs.file_path ||
							readArgs.path ||
							readArgs.AbsolutePath ||
							readArgs.directory ||
							readArgs.directoryPath ||
							readArgs.directory_path ||
							readArgs.TargetFile;
						if (typeof readPathVal === "string") {
							const resolvedReadPath = path.resolve(ctx.cwd, readPathVal);
							if (prefetchTool === "list_dir") {
								const relative = path.relative(
									resolvedReadPath,
									resolvedFilePath,
								);
								const isSubPath =
									!relative.startsWith("..") && !path.isAbsolute(relative);
								if (isSubPath) {
									debug.log(
										"prefetch",
										`Aborting list_dir prefetch due to modification in subpath ${resolvedFilePath}`,
									);
									controller.abort();
									this.pending.delete(key);
									this.abortControllers.delete(key);
								}
							} else {
								if (resolvedReadPath === resolvedFilePath) {
									debug.log(
										"prefetch",
										`Aborting read prefetch due to modification in ${resolvedFilePath}`,
									);
									controller.abort();
									this.pending.delete(key);
									this.abortControllers.delete(key);
								}
							}
						}
					} catch {
						debug.log("prefetch", "Failed to parse prefetch key args for abort check");
					}
				}
			}
		} else {
			// For bash/run_command or other broad state changes, abort all file reads just in case
			for (const [key, controller] of this.abortControllers.entries()) {
				const colonIndex = key.indexOf(":");
				if (colonIndex < 0) continue;
				const prefetchTool = key.slice(0, colonIndex);
				if (
					["read", "file_info", "list_dir", "read_image", "read_pdf"].includes(
						prefetchTool,
					)
				) {
					debug.log(
						"prefetch",
						`Aborting read/list prefetch due to broad modification tool: ${toolName}`,
					);
					controller.abort();
					this.pending.delete(key);
					this.abortControllers.delete(key);
				}
			}
		}
	}

	recordPattern(toolName: string, args: unknown): void {
		this.recentPatterns.push({
			tool: toolName,
			args,
			timestamp: Date.now(),
		});

		if (this.recentPatterns.length > MAX_RECENT_PATTERNS) {
			this.recentPatterns.shift();
		}
	}

	predictFromHistory(): Array<{ tool: string; args: unknown }> {
		const predictions: Array<{ tool: string; args: unknown; score: number }> =
			[];
		const now = Date.now();
		const windowMs = 5 * 60 * 1000;

		const recentTools = this.recentPatterns.filter(
			(p) => now - p.timestamp < windowMs,
		);

		const toolCounts = new Map<string, number>();
		for (const p of recentTools) {
			const key = this.buildKey(p.tool, p.args);
			toolCounts.set(key, (toolCounts.get(key) || 0) + 1);
		}

		for (const [key, count] of toolCounts) {
			if (count >= 2) {
				const colonIndex = key.indexOf(":");
				if (colonIndex < 0) continue;

				const tool = key.slice(0, colonIndex);
				const argsStr = key.slice(colonIndex + 1);
				try {
					const args = JSON.parse(argsStr);
					const score = count * 10;
					predictions.push({ tool, args, score });
				} catch {
					debug.log("prefetch", "Failed to parse history args for prediction");
				}
			}
		}

		return predictions
			.sort((a, b) => b.score - a.score)
			.slice(0, 5)
			.map(({ tool, args }) => ({ tool, args }));
	}

	predict(toolName: string, args: unknown, ctx: ToolContext): void {
		if (!this.enabled) return;

		this.abortPrefetchIfMatches(toolName, args, ctx);

		this.recordPattern(toolName, args);

		const perfConfig = extractPerfConfig(ctx.agentContext);
		const maxQueueSize = perfConfig?.prefetchQueueSize ?? MAX_PREFETCH_QUEUE;
		const prefetchTimeout = perfConfig?.prefetchTimeoutMs ?? PREFETCH_TIMEOUT_MS;

		if (this.pending.size >= maxQueueSize) {
			debug.log("prefetch", `Prefetch queue full (size=${this.pending.size})`);
			return;
		}

		const currentToolDef = getTool(toolName);
		const prefetchRules = [
			...(currentToolDef?.prefetchRules || []),
			...(EXTRA_PREFETCH_RULES[toolName] || []),
		];

		const priorityWeights = { high: 3, medium: 2, low: 1 };
		const sortedRules = [...prefetchRules].sort((a, b) => {
			const aWeight = priorityWeights[a.priority || "medium"];
			const bWeight = priorityWeights[b.priority || "medium"];
			return bWeight - aWeight;
		});

		const cache = getToolCache();
		// Key for the current call — never prefetch something we are already executing
		const currentKey = this.buildKey(toolName, args);

		for (const nextTool of sortedRules) {
			if (this.pending.size >= maxQueueSize) break;

			try {
				if (nextTool.condition && !nextTool.condition(args)) {
					continue;
				}

				const predictedArgs = nextTool.argMapper(args, ctx);
				if (!predictedArgs) continue;

				const key = this.buildKey(nextTool.tool, predictedArgs);

				if (cache.has(nextTool.tool, predictedArgs)) {
					continue;
				}

				if (!this.pending.has(key)) {
					const nextToolDef = getTool(nextTool.tool);
					if (
						nextToolDef &&
						nextToolDef.isReadonly !== false &&
						!nextToolDef.requiresPermission
					) {
						this.queuePrefetch(nextTool.tool, predictedArgs, ctx, key, prefetchTimeout);
					}
				}
			} catch (error) {
				debug.log("prefetch", `Prefetch condition/mapper error: ${error instanceof Error ? error.message : String(error)}`);
				// Prevent condition/mapper errors from crashing the loop
			}
		}

		const historyPredictions = this.predictFromHistory();
		for (const pred of historyPredictions) {
			if (this.pending.size >= maxQueueSize) break;

			const key = this.buildKey(pred.tool, pred.args);
			// Skip if already pending, already cached, or is the same call we are currently handling
			if (key === currentKey) continue;
			if (!this.pending.has(key) && !cache.has(pred.tool, pred.args)) {
				const nextToolDef = getTool(pred.tool);
				if (
					nextToolDef &&
					nextToolDef.isReadonly !== false &&
					!nextToolDef.requiresPermission
				) {
					this.queuePrefetch(pred.tool, pred.args, ctx, key, prefetchTimeout);
				}
			}
		}
	}

	getPrefetched(toolName: string, args: unknown): Promise<unknown> | null {
		const key = this.buildKey(toolName, args);
		const pending = this.pending.get(key);

		if (pending) {
			debug.log(
				"prefetch",
				`Cache hit successfully anticipated for ${toolName}`,
			);
			this.pending.delete(key);
			return pending;
		}

		return null;
	}

	hasPrefetched(toolName: string, args: unknown): boolean {
		const key = this.buildKey(toolName, args);
		return this.pending.has(key);
	}

	clear(): void {
		for (const controller of this.abortControllers.values()) {
			controller.abort();
		}
		this.abortControllers.clear();
		this.pending.clear();
		this.recentPatterns = [];
	}

	getPendingCount(): number {
		return this.pending.size;
	}

	getStats(): { pendingCount: number; recentPatternCount: number } {
		return {
			pendingCount: this.pending.size,
			recentPatternCount: this.recentPatterns.length,
		};
	}
}

let globalPrefetcher: Prefetcher | null = null;

export function getPrefetcher(): Prefetcher {
	if (!globalPrefetcher) {
		globalPrefetcher = new Prefetcher();
	}
	return globalPrefetcher;
}

export function resetPrefetcher(): void {
	if (globalPrefetcher) {
		globalPrefetcher.clear();
	}
	globalPrefetcher = null;
}
