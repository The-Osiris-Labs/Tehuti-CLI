import * as path from "node:path";
import type { ToolContext } from "./tools/registry.js";
import { executeTool } from "./tools/registry.js";
import { getToolCache } from "./cache/index.js";

export interface PrefetchRule {
	currentTool: string;
	nextTools: Array<{
		tool: string;
		argMapper: (args: unknown, ctx: ToolContext) => unknown | null;
		condition?: (args: unknown) => boolean;
		priority?: "high" | "medium" | "low";
	}>;
}

const PREFETCH_RULES: PrefetchRule[] = [
	{
		currentTool: "read",
		nextTools: [
			{
				tool: "file_info",
				argMapper: (args: unknown) => {
					if (!args || typeof args !== "object") return null;
					const record = args as Record<string, unknown>;
					return { file_path: record.file_path };
				},
				priority: "medium",
			},
			{
				tool: "list_dir",
				argMapper: (args: unknown, ctx: ToolContext) => {
					if (!args || typeof args !== "object") return null;
					const record = args as Record<string, unknown>;
					const filePath = record.file_path;
					if (typeof filePath !== "string") return null;
					return { dir_path: path.dirname(filePath) };
				},
				priority: "low",
			},
			{
				tool: "grep",
				argMapper: (args: unknown, ctx: ToolContext) => {
					if (!args || typeof args !== "object") return null;
					const record = args as Record<string, unknown>;
					const filePath = record.file_path;
					if (typeof filePath !== "string") return null;
					const ext = path.extname(filePath).slice(1);
					if (!ext) return null;
					return { pattern: "import|require|from", path: path.dirname(filePath), include: `*.${ext}` };
				},
				condition: (args: unknown) => {
					if (!args || typeof args !== "object") return false;
					const record = args as Record<string, unknown>;
					const filePath = record.file_path;
					if (typeof filePath !== "string") return false;
					const ext = path.extname(filePath).slice(1);
					return ["ts", "tsx", "js", "jsx", "py", "go", "rs"].includes(ext);
				},
				priority: "low",
			},
		],
	},
	{
		currentTool: "glob",
		nextTools: [
			{
				tool: "read",
				argMapper: (args: unknown, ctx: ToolContext, results?: unknown) => {
					return null;
				},
				condition: () => false,
			},
		],
	},
	{
		currentTool: "list_dir",
		nextTools: [
			{
				tool: "glob",
				argMapper: (args: unknown, ctx: ToolContext) => {
					if (!args || typeof args !== "object") return null;
					const record = args as Record<string, unknown>;
					const dirPath = record.dir_path || record.path;
					if (typeof dirPath !== "string") return null;
					return { pattern: "**/*.ts", path: dirPath };
				},
				priority: "low",
			},
			{
				tool: "glob",
				argMapper: (args: unknown, ctx: ToolContext) => {
					if (!args || typeof args !== "object") return null;
					const record = args as Record<string, unknown>;
					const dirPath = record.dir_path || record.path;
					if (typeof dirPath !== "string") return null;
					return { pattern: "**/*.json", path: dirPath };
				},
				priority: "low",
			},
		],
	},
	{
		currentTool: "git_status",
		nextTools: [
			{
				tool: "git_diff",
				argMapper: () => ({}),
				priority: "high",
			},
			{
				tool: "git_log",
				argMapper: () => ({ n: 5 }),
				priority: "medium",
			},
		],
	},
	{
		currentTool: "git_diff",
		nextTools: [
			{
				tool: "read",
				argMapper: (args: unknown, ctx: ToolContext) => {
					return null;
				},
				condition: () => false,
			},
		],
	},
	{
		currentTool: "grep",
		nextTools: [
			{
				tool: "read",
				argMapper: (args: unknown, ctx: ToolContext) => {
					return null;
				},
				condition: () => false,
			},
		],
	},
	{
		currentTool: "edit_file",
		nextTools: [
			{
				tool: "read",
				argMapper: (args: unknown, ctx: ToolContext) => {
					if (!args || typeof args !== "object") return null;
					const record = args as Record<string, unknown>;
					return { file_path: record.file_path };
				},
				priority: "high",
			},
		],
	},
	{
		currentTool: "write_file",
		nextTools: [
			{
				tool: "read",
				argMapper: (args: unknown, ctx: ToolContext) => {
					if (!args || typeof args !== "object") return null;
					const record = args as Record<string, unknown>;
					return { file_path: record.file_path };
				},
				priority: "high",
			},
		],
	},
];

const PREFETCHABLE_TOOLS = new Set([
	"read",
	"read_file",
	"file_info",
	"list_dir",
	"list_directory",
	"glob",
	"git_status",
	"git_diff",
	"git_log",
	"grep",
	"grep_search",
]);

const MAX_PREFETCH_QUEUE = 10;

export class Prefetcher {
	private pending = new Map<string, Promise<unknown>>();
	private rules: PrefetchRule[];
	private enabled: boolean = true;
	private recentPatterns: Array<{ tool: string; args: unknown; timestamp: number }> = [];
	private readonly maxRecentPatterns = 50;

	constructor(rules: PrefetchRule[] = PREFETCH_RULES) {
		this.rules = rules;
	}

	setEnabled(enabled: boolean): void {
		this.enabled = enabled;
		if (!enabled) {
			this.pending.clear();
		}
	}

	private buildKey(tool: string, args: unknown): string {
		return `${tool}:${JSON.stringify(args)}`;
	}

	recordPattern(toolName: string, args: unknown): void {
		this.recentPatterns.push({
			tool: toolName,
			args,
			timestamp: Date.now(),
		});

		if (this.recentPatterns.length > this.maxRecentPatterns) {
			this.recentPatterns.shift();
		}
	}

	predictFromHistory(): Array<{ tool: string; args: unknown }> {
		const predictions: Array<{ tool: string; args: unknown; score: number }> = [];
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
				const [tool, argsStr] = key.split(":");
				try {
					const args = JSON.parse(argsStr);
					const score = count * 10;
					predictions.push({ tool, args, score });
				} catch {}
			}
		}

		return predictions
			.sort((a, b) => b.score - a.score)
			.slice(0, 5)
			.map(({ tool, args }) => ({ tool, args }));
	}

	predict(toolName: string, args: unknown, ctx: ToolContext): void {
		if (!this.enabled) return;

		this.recordPattern(toolName, args);

		if (this.pending.size >= MAX_PREFETCH_QUEUE) {
			return;
		}

		const rule = this.rules.find((r) => r.currentTool === toolName);
		if (!rule) return;

		const cache = getToolCache();

		for (const nextTool of rule.nextTools) {
			if (this.pending.size >= MAX_PREFETCH_QUEUE) break;

			if (nextTool.condition && !nextTool.condition(args)) {
				continue;
			}

			const predictedArgs = nextTool.argMapper(args, ctx);
			if (!predictedArgs) continue;

			const key = this.buildKey(nextTool.tool, predictedArgs);

			if (cache.has(nextTool.tool, predictedArgs)) {
				continue;
			}

			if (!this.pending.has(key) && PREFETCHABLE_TOOLS.has(nextTool.tool)) {
				const prefetchPromise = executeTool(nextTool.tool, predictedArgs, ctx)
					.then((result) => result)
					.catch(() => null);

				this.pending.set(key, prefetchPromise);
			}
		}

		const historyPredictions = this.predictFromHistory();
		for (const pred of historyPredictions) {
			if (this.pending.size >= MAX_PREFETCH_QUEUE) break;

			const key = this.buildKey(pred.tool, pred.args);
			if (!this.pending.has(key) && !cache.has(pred.tool, pred.args)) {
				if (PREFETCHABLE_TOOLS.has(pred.tool)) {
					const prefetchPromise = executeTool(pred.tool, pred.args, ctx)
						.then((result) => result)
						.catch(() => null);

					this.pending.set(key, prefetchPromise);
				}
			}
		}
	}

	getPrefetched(toolName: string, args: unknown): Promise<unknown> | null {
		const key = this.buildKey(toolName, args);
		const pending = this.pending.get(key);

		if (pending) {
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
