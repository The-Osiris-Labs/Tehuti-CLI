import * as fs from "node:fs";
import * as path from "node:path";
import type { ToolResult } from "../tools/registry.js";
import { LRUCache, type CacheEntry, type CacheStats } from "./lru-cache.js";

export class ToolCache {
	private cache: LRUCache<ToolResult>;
	private fileMtimes = new Map<string, number>();

	constructor() {
		this.cache = new LRUCache<ToolResult>({
			maxSize: 50 * 1024 * 1024,
			defaultTtl: 5 * 60 * 1000,
			maxEntries: 1000,
		});
	}

	private getFileMtime(filePath: string): number | null {
		try {
			const stat = fs.statSync(filePath);
			return stat.mtimeMs;
		} catch {
			return null;
		}
	}

	private isFileStale(filePath: string, cachedMtime: number): boolean {
		const currentMtime = this.getFileMtime(filePath);
		if (currentMtime === null) return true;
		return currentMtime > cachedMtime;
	}

	get(toolName: string, args: unknown): ToolResult | null {
		const result = this.cache.get(toolName, args);
		if (!result) return null;

		if (this.isFileBasedTool(toolName) && args && typeof args === "object") {
			const fileArgs = args as Record<string, unknown>;
			const filePath = fileArgs.file_path || fileArgs.path || fileArgs.dir_path;
			if (typeof filePath === "string") {
				const cachedMtime = this.fileMtimes.get(filePath);
				if (cachedMtime && this.isFileStale(filePath, cachedMtime)) {
					this.cache.delete(toolName, args);
					return null;
				}
			}
		}

		return result;
	}

	set(toolName: string, args: unknown, result: ToolResult, options?: { mtime?: number; ttl?: number }): void {
		if (!result.success) return;

		const opts = options || {};

		if (this.isFileBasedTool(toolName) && args && typeof args === "object") {
			const fileArgs = args as Record<string, unknown>;
			const filePath = fileArgs.file_path || fileArgs.path || fileArgs.dir_path;
			if (typeof filePath === "string") {
				const mtime = opts.mtime ?? this.getFileMtime(filePath);
				if (mtime !== null) {
					opts.mtime = mtime;
					this.fileMtimes.set(filePath, mtime);
				}
			}
		}

		if (this.isWebTool(toolName) && !opts.ttl) {
			opts.ttl = 60 * 1000;
		}

		this.cache.set(toolName, args, result, opts);
	}

	has(toolName: string, args: unknown): boolean {
		return this.cache.has(toolName, args);
	}

	delete(toolName: string, args: unknown): boolean {
		return this.cache.delete(toolName, args);
	}

	invalidateFile(filePath: string): number {
		let deleted = 0;

		deleted += this.cache.deleteByPattern(`"file_path":"${filePath}"`);
		deleted += this.cache.deleteByPattern(`"path":"${filePath}"`);
		deleted += this.cache.deleteByPattern(`"${filePath}"`);

		const dirPath = path.dirname(filePath);
		deleted += this.cache.deleteByPattern(`"dir_path":"${dirPath}"`);
		deleted += this.cache.deleteByPattern(`"path":"${dirPath}"`);

		this.fileMtimes.delete(filePath);

		return deleted;
	}

	invalidateDirectory(dirPath: string): number {
		let deleted = 0;

		deleted += this.cache.deleteByPattern(`"dir_path":"${dirPath}"`);
		deleted += this.cache.deleteByPattern(`"path":"${dirPath}"`);
		deleted += this.cache.deleteByPrefix(`glob:`);
		deleted += this.cache.deleteByPrefix(`list_dir:`);

		return deleted;
	}

	invalidatePattern(pattern: string): number {
		return this.cache.deleteByPattern(pattern);
	}

	clear(): void {
		this.cache.clear();
		this.fileMtimes.clear();
	}

	getStats(): CacheStats {
		return this.cache.getStats();
	}

	getHitRate(): number {
		return this.cache.getHitRate();
	}

	getEntries(): CacheEntry<ToolResult>[] {
		return this.cache.getEntries();
	}

	private isFileBasedTool(toolName: string): boolean {
		const fileTools = [
			"read",
			"read_file",
			"read_image",
			"read_pdf",
			"file_info",
			"list_dir",
			"list_directory",
		];
		return fileTools.includes(toolName);
	}

	private isWebTool(toolName: string): boolean {
		const webTools = ["web_fetch", "webfetch", "web_search", "code_search"];
		return webTools.includes(toolName);
	}
}

let globalToolCache: ToolCache | null = null;

export function getToolCache(): ToolCache {
	if (!globalToolCache) {
		globalToolCache = new ToolCache();
	}
	return globalToolCache;
}

export function resetToolCache(): void {
	if (globalToolCache) {
		globalToolCache.clear();
	}
	globalToolCache = null;
}
