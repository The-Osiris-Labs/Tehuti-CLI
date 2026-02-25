import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ToolCache, getToolCache } from "./tool-cache.js";
import type { CacheEntry } from "./lru-cache.js";
import type { ToolResult } from "../tools/registry.js";

const CACHE_DIR = path.join(os.homedir(), ".tehuti", "cache");
const CACHE_FILE = path.join(CACHE_DIR, "tool-cache.json");

interface SerializedCacheEntry {
	key: string;
	result: ToolResult;
	timestamp: number;
	mtime?: number;
	ttl?: number;
}

interface SerializedCache {
	version: number;
	entries: SerializedCacheEntry[];
	savedAt: number;
}

const CACHE_VERSION = 1;
const MAX_CACHE_AGE = 24 * 60 * 60 * 1000;

function ensureCacheDir(): void {
	if (!fs.existsSync(CACHE_DIR)) {
		fs.mkdirSync(CACHE_DIR, { recursive: true });
	}
}

export function saveCacheToDisk(): void {
	const cache = getToolCache();
	const stats = cache.getStats();

	if (stats.entryCount === 0) {
		return;
	}

	ensureCacheDir();

	const entries = cache.getEntries();
	const serialized: SerializedCache = {
		version: CACHE_VERSION,
		entries: entries.map((entry) => ({
			key: entry.key,
			result: entry.result as ToolResult,
			timestamp: entry.timestamp,
			mtime: entry.mtime,
			ttl: entry.ttl,
		})),
		savedAt: Date.now(),
	};

	try {
		fs.writeFileSync(CACHE_FILE, JSON.stringify(serialized), "utf-8");
	} catch {
	}
}

export function loadCacheFromDisk(): void {
	if (!fs.existsSync(CACHE_FILE)) {
		return;
	}

	try {
		const content = fs.readFileSync(CACHE_FILE, "utf-8");
		const serialized: SerializedCache = JSON.parse(content);

		if (serialized.version !== CACHE_VERSION) {
			return;
		}

		const cacheAge = Date.now() - serialized.savedAt;
		if (cacheAge > MAX_CACHE_AGE) {
			return;
		}

		const cache = getToolCache();
		let loaded = 0;

		for (const entry of serialized.entries) {
			const entryAge = Date.now() - entry.timestamp;
			const ttl = entry.ttl || 5 * 60 * 1000;
			if (entryAge > ttl) {
				continue;
			}

			if (entry.result.success) {
				const colonIdx = entry.key.indexOf(":");
				const toolName = entry.key.slice(0, colonIdx);
				const argsStr = entry.key.slice(colonIdx + 1);

				try {
					const args = JSON.parse(argsStr);
					cache.set(toolName, args, entry.result, {
						mtime: entry.mtime,
						ttl: entry.ttl,
					});
					loaded++;
				} catch {
				}
			}
		}
	} catch {
	}
}

export function clearCacheFromDisk(): void {
	if (fs.existsSync(CACHE_FILE)) {
		try {
			fs.rmSync(CACHE_FILE, { force: true });
		} catch {
		}
	}
}

export function getCacheStats(): { diskSize: number; diskEntries: number } {
	if (!fs.existsSync(CACHE_FILE)) {
		return { diskSize: 0, diskEntries: 0 };
	}

	try {
		const content = fs.readFileSync(CACHE_FILE, "utf-8");
		const serialized: SerializedCache = JSON.parse(content);
		const stat = fs.statSync(CACHE_FILE);
		return {
			diskSize: stat.size,
			diskEntries: serialized.entries.length,
		};
	} catch {
		return { diskSize: 0, diskEntries: 0 };
	}
}
