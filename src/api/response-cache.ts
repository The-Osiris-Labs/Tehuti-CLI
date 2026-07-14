import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { StandardMessage, StandardResponse } from "./base-client.js";

// Cache directory for API responses
const API_CACHE_DIR = join(process.cwd(), ".tehuti", "api-cache");

// Ensure cache directory exists
function ensureCacheDirectory(): void {
	if (!existsSync(API_CACHE_DIR)) {
		mkdirSync(API_CACHE_DIR, { recursive: true });
	}
}

// Generate cache key from messages and options
function generateCacheKey(
	messages: StandardMessage[],
	options?: { model?: string; temperature?: number; maxTokens?: number },
): string {
	const hash = createHash("sha256");
	const serialized = JSON.stringify({
		messages,
		options: {
			model: options?.model,
			temperature: options?.temperature,
			maxTokens: options?.maxTokens,
		},
	});
	hash.update(serialized);
	return hash.digest("hex").slice(0, 16);
}

// Cache entry interface
interface APIResponseCacheEntry {
	messages: StandardMessage[];
	options?: { model?: string; temperature?: number; maxTokens?: number };
	response: StandardResponse;
	timestamp: number;
	ttl: number;
	lastAccess: number;
}

// Default TTL: 15 minutes (900 seconds)
const DEFAULT_TTL = 900000;

// LRU eviction limits
const MAX_ENTRIES = 1000;
const MAX_BYTES = 50 * 1024 * 1024; // 50MB

// Cache stats for observability
export interface CacheStats {
	hits: number;
	misses: number;
	evictions: number;
	entries: number;
	sizeBytes: number;
}

export class APIResponseCache {
	private static instance: APIResponseCache | null = null;
	private cacheDirectory: string;
	private stats = { hits: 0, misses: 0, evictions: 0 };
	maxEntries: number = MAX_ENTRIES;
	maxBytes: number = MAX_BYTES;

	private constructor() {
		this.cacheDirectory = API_CACHE_DIR;
		ensureCacheDirectory();
	}

	static getInstance(): APIResponseCache {
		if (!APIResponseCache.instance) {
			APIResponseCache.instance = new APIResponseCache();
		}
		return APIResponseCache.instance;
	}

	/** Reset singleton (for testing only). */
	static resetInstance(): void {
		APIResponseCache.instance = null;
	}

	// Get cached response — deletes expired entries instead of just returning null
	async get(
		messages: StandardMessage[],
		options?: {
			model?: string;
			temperature?: number;
			maxTokens?: number;
			ttl?: number;
		},
	): Promise<StandardResponse | null> {
		const cacheKey = generateCacheKey(messages, options);
		const cachePath = join(this.cacheDirectory, `${cacheKey}.json`);

		if (!existsSync(cachePath)) {
			this.stats.misses++;
			return null;
		}

		try {
			const cacheData = JSON.parse(
				await readFile(cachePath, "utf8"),
			) as APIResponseCacheEntry;
			const now = Date.now();
			const ttl = options?.ttl ?? cacheData.ttl ?? DEFAULT_TTL;

			if (now - cacheData.timestamp >= ttl) {
				// Expired — delete from disk
				await this.safeUnlink(cachePath);
				this.stats.misses++;
				return null;
			}

			// Update lastAccess for LRU tracking
			cacheData.lastAccess = now;
			await writeFile(cachePath, JSON.stringify(cacheData));

			this.stats.hits++;
			return cacheData.response;
		} catch (error) {
			// Corrupt entry — clean up
			await this.safeUnlink(cachePath);
			this.stats.misses++;
			return null;
		}
	}

	// Set cached response with LRU eviction
	async set(
		messages: StandardMessage[],
		response: StandardResponse,
		options?: {
			model?: string;
			temperature?: number;
			maxTokens?: number;
			ttl?: number;
		},
	): Promise<void> {
		const cacheKey = generateCacheKey(messages, options);
		const cachePath = join(this.cacheDirectory, `${cacheKey}.json`);
		const now = Date.now();

		const cacheEntry: APIResponseCacheEntry = {
			messages,
			options: {
				model: options?.model,
				temperature: options?.temperature,
				maxTokens: options?.maxTokens,
			},
			response,
			timestamp: now,
			ttl: options?.ttl ?? DEFAULT_TTL,
			lastAccess: now,
		};

		try {
			// Write first, then evict — this ensures the new entry is counted
			// so eviction brings total size/count back within budget
			await writeFile(cachePath, JSON.stringify(cacheEntry));
			await this.evictIfNeeded();
		} catch (error) {
			console.error("Cache write error:", error);
		}
	}

	// Clear cache
	async clear(options?: { olderThan?: number }): Promise<number> {
		if (!existsSync(this.cacheDirectory)) {
			return 0;
		}

		const files = await readdir(this.cacheDirectory);
		let clearedCount = 0;

		for (const file of files) {
			if (file.endsWith(".json")) {
				const filePath = join(this.cacheDirectory, file);
				const fileStat = await stat(filePath);

				if (
					!options?.olderThan ||
					Date.now() - fileStat.mtimeMs > options.olderThan
				) {
					await unlink(filePath);
					clearedCount++;
				}
			}
		}

		return clearedCount;
	}

	// Get cache status
	async getStatus(): Promise<{
		exists: boolean;
		entries: number;
		size: number;
	}> {
		if (!existsSync(this.cacheDirectory)) {
			return {
				exists: false,
				entries: 0,
				size: 0,
			};
		}

		const files = await readdir(this.cacheDirectory);
		const cacheFiles = files.filter((file) => file.endsWith(".json"));

		let totalSize = 0;
		for (const file of cacheFiles) {
			const fileStat = await stat(join(this.cacheDirectory, file));
			totalSize += fileStat.size;
		}

		return {
			exists: true,
			entries: cacheFiles.length,
			size: totalSize,
		};
	}

	/** Get runtime stats (hits, misses, evictions, current size). */
	async getStats(): Promise<CacheStats> {
		const status = await this.getStatus();
		return {
			hits: this.stats.hits,
			misses: this.stats.misses,
			evictions: this.stats.evictions,
			entries: status.entries,
			sizeBytes: status.size,
		};
	}

	/**
	 * Sweep expired entries and enforce LRU/size budget.
	 * Called from daemon GC every 12 hours.
	 */
	async sweep(): Promise<{ expired: number; evicted: number }> {
		if (!existsSync(this.cacheDirectory)) {
			return { expired: 0, evicted: 0 };
		}

		const files = await readdir(this.cacheDirectory);
		const jsonFiles = files.filter((f) => f.endsWith(".json"));
		const now = Date.now();
		let expired = 0;
		let evicted = 0;

		// Phase 1: Remove expired entries
		const validEntries: Array<{
			key: string;
			path: string;
			lastAccess: number;
			size: number;
			expiry: number;
		}> = [];

		for (const file of jsonFiles) {
			const filePath = join(this.cacheDirectory, file);
			try {
				const content = await readFile(filePath, "utf8");
				const entry = JSON.parse(content) as APIResponseCacheEntry;
				const fileStat = await stat(filePath);
				const ttl = entry.ttl ?? DEFAULT_TTL;
				const expiry = entry.timestamp + ttl;

				if (now >= expiry) {
					await this.safeUnlink(filePath);
					expired++;
				} else {
					validEntries.push({
						key: file,
						path: filePath,
						lastAccess: entry.lastAccess ?? fileStat.mtimeMs,
						size: fileStat.size,
						expiry,
					});
				}
			} catch {
				// Corrupt entry — delete it
				await this.safeUnlink(filePath);
				expired++;
			}
		}

		// Phase 2: Enforce entry count limit (LRU)
		if (validEntries.length > this.maxEntries) {
			// Sort ascending by lastAccess (oldest first)
			validEntries.sort((a, b) => a.lastAccess - b.lastAccess);
			const toEvict = validEntries.splice(0, validEntries.length - this.maxEntries);
			for (const entry of toEvict) {
				await this.safeUnlink(entry.path);
				evicted++;
				this.stats.evictions++;
			}
		}

		// Phase 3: Enforce size budget (evict LRU until under budget)
		let totalSize = validEntries.reduce((sum, e) => sum + e.size, 0);
		if (totalSize > this.maxBytes) {
			// Sort ascending by lastAccess for LRU eviction
			validEntries.sort((a, b) => a.lastAccess - b.lastAccess);
			while (totalSize > this.maxBytes && validEntries.length > 0) {
				const victim = validEntries.shift()!;
				await this.safeUnlink(victim.path);
				totalSize -= victim.size;
				evicted++;
				this.stats.evictions++;
			}
		}

		return { expired, evicted };
	}

	// --- Private helpers ---

	private async safeUnlink(filePath: string): Promise<void> {
		try {
			await unlink(filePath);
		} catch {
			// Already gone — ignore
		}
	}

	private async evictIfNeeded(): Promise<void> {
		if (!existsSync(this.cacheDirectory)) return;

		const files = await readdir(this.cacheDirectory);
		const jsonFiles = files.filter((f) => f.endsWith(".json"));

		// Fast path: if at or under both limits, skip
		if (jsonFiles.length <= this.maxEntries) {
			// Also check size
			let totalSize = 0;
			for (const file of jsonFiles) {
				const s = await stat(join(this.cacheDirectory, file));
				totalSize += s.size;
			}
			if (totalSize <= this.maxBytes) return;
		}

		// Load metadata for LRU sorting
		const entries: Array<{
			path: string;
			lastAccess: number;
			size: number;
		}> = [];

		for (const file of jsonFiles) {
			const filePath = join(this.cacheDirectory, file);
			try {
				JSON.parse(await readFile(filePath, "utf8"));
				const fileStat = await stat(filePath);
				entries.push({
					path: filePath,
					lastAccess: fileStat.mtimeMs,
					size: fileStat.size,
				});
			} catch {
				// Corrupt — delete
				await this.safeUnlink(filePath);
				this.stats.evictions++;
			}
		}

		// Evict by count (LRU — oldest lastAccess first)
		// Note: set() writes BEFORE calling evictIfNeeded, so no +1 needed here
		if (entries.length >= this.maxEntries) {
			entries.sort((a, b) => a.lastAccess - b.lastAccess);
			const excess = entries.length - this.maxEntries;
			for (let i = 0; i < excess && i < entries.length; i++) {
				await this.safeUnlink(entries[i].path);
				this.stats.evictions++;
			}
			entries.splice(0, excess);
		}

		// Evict by size (LRU — oldest lastAccess first)
		let totalSize = entries.reduce((sum, e) => sum + e.size, 0);
		if (totalSize >= this.maxBytes) {
			entries.sort((a, b) => a.lastAccess - b.lastAccess);
			while (totalSize >= this.maxBytes && entries.length > 0) {
				const victim = entries.shift()!;
				await this.safeUnlink(victim.path);
				totalSize -= victim.size;
				this.stats.evictions++;
			}
		}
	}
}

/**
 * Sweep the API response cache (expired entries + LRU/size enforcement).
 * Exported for use by daemon GC.
 */
export async function sweepResponseCache(): Promise<{
	expired: number;
	evicted: number;
}> {
	try {
		const cache = APIResponseCache.getInstance();
		return await cache.sweep();
	} catch {
		return { expired: 0, evicted: 0 };
	}
}
