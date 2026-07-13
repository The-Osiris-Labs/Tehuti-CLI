/**
 * Cache entry metadata and stored value.
 * 
 * @property key - Unique cache key (tool:args format)
 * @property result - Cached tool execution result
 * @property timestamp - When entry was created (Date.now())
 * @property mtime - File modification time (for file-based invalidation)
 * @property size - Estimated size in bytes (for LRU eviction)
 * @property hitCount - Number of times this entry was accessed
 * @property ttl - Time-to-live in milliseconds (optional, uses default if not set)
 */
export interface CacheEntry<T = unknown> {
	key: string;
	result: T;
	timestamp: number;
	mtime?: number;
	size: number;
	hitCount: number;
	ttl?: number;
}

/**
 * Cache performance statistics.
 * 
 * @property hits - Number of cache hits (value found)
 * @property misses - Number of cache misses (value not found)
 * @property evictions - Number of entries evicted due to size/count limits
 * @property size - Current cache size in bytes
 * @property entryCount - Current number of entries in cache
 */
export interface CacheStats {
	hits: number;
	misses: number;
	evictions: number;
	size: number;
	entryCount: number;
}

/**
 * Cache configuration options.
 * 
 * @property maxSize - Maximum cache size in bytes (default: 50MB)
 * @property defaultTtl - Default time-to-live in milliseconds (default: 5min)
 * @property maxEntries - Maximum number of entries (default: 1000)
 */
export interface CacheConfig {
	maxSize?: number;
	defaultTtl?: number;
	maxEntries?: number;
}

const DEFAULT_CONFIG: Required<CacheConfig> = {
	maxSize: 50 * 1024 * 1024,
	defaultTtl: 5 * 60 * 1000,
	maxEntries: 1000,
};

/**
 * Deterministic JSON serialization with sorted keys.
 * 
 * Ensures consistent stringification regardless of object key order.
 * Critical for cache keys where {a:1,b:2} must equal {b:2,a:1}.
 * 
 * @param val - Value to serialize (any JSON-compatible type)
 * @returns Deterministic JSON string with sorted object keys
 * 
 * @example
 * ```typescript
 * const str = stableStringify({ b: 2, a: 1 });
 * // Always returns: '{"a":1,"b":2}'
 * ```
 */
export function stableStringify(val: unknown): string {
	if (val === null || typeof val !== "object") {
		return JSON.stringify(val);
	}
	if (Array.isArray(val)) {
		return `[${val.map(stableStringify).join(",")}]`;
	}
	const keys = Object.keys(val).sort();
	return (
		"{" +
		keys
			.map(
				(k) =>
					`${JSON.stringify(k)}:${stableStringify((val as Record<string, unknown>)[k])}`,
			)
			.join(",") +
		"}"
	);
}

/**
 * LRU (Least Recently Used) cache with size and entry limits.
 * 
 * Implements a generic cache that evicts entries based on:
 * 1. Least recently accessed (accessOrder array)
 * 2. Size limit (maxSize in bytes, estimated via JSON.stringify)
 * 3. Entry count limit (maxEntries)
 * 4. Time-to-live (TTL per entry)
 * 
 * Used for caching tool execution results to avoid redundant work.
 * Keys are generated as `${tool}:${stableStringify(args)}` for determinism.
 * 
 * @template T - Type of cached values
 * 
 * @example
 * ```typescript
 * const cache = new LRUCache<ToolResult>({
 *   maxSize: 10 * 1024 * 1024,  // 10MB
 *   maxEntries: 500,
 *   defaultTtl: 60000            // 60 seconds
 * });
 * 
 * // Set with custom TTL
 * cache.set('readFile:main.ts', result, 120000);
 * 
 * // Get (updates access order, increments hitCount)
 * const result = cache.get('readFile:main.ts');
 * 
 * // Check stats
 * const stats = cache.getStats();
 * console.log(`Hit rate: ${stats.hits / (stats.hits + stats.misses)}`);
 * ```
 */
export class LRUCache<T = unknown> {
	private cache = new Map<string, CacheEntry<T>>();
	private accessOrder: string[] = [];
	private currentSize = 0;
	private readonly config: Required<CacheConfig>;
	private stats = { hits: 0, misses: 0, evictions: 0 };

	constructor(config: CacheConfig = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

/**
 * Estimates the size of a value in bytes (approximate).
 * 
 * Uses JSON.stringify for objects/arrays, char count for strings.
 * Multiplies by 2 to account for UTF-16 encoding overhead.
 * 
 * @param value - Value to estimate size for
 * @returns Estimated size in bytes
 * @private
 */
	private estimateSize(value: T): number {
		if (typeof value === "string") {
			return value.length * 2;
		}
		if (typeof value === "object" && value !== null) {
			try {
				return JSON.stringify(value).length * 2;
			} catch {
				return 1024;
			}
		}
		return 1024;
	}

	/**
	 * Builds a deterministic cache key from tool name and arguments.
	 * 
	 * @param tool - Tool name (e.g., 'readFile', 'bash')
	 * @param args - Tool arguments (serialized deterministically)
	 * @returns Cache key in format `${tool}:${stableStringify(args)}`
	 * @private
	 */
	private buildKey(tool: string, args: unknown): string {
		const argsStr = typeof args === "string" ? args : stableStringify(args);
		return `${tool}:${argsStr}`;
	}

	private isExpired(entry: CacheEntry<T>): boolean {
		if (entry.ttl) {
			return Date.now() - entry.timestamp > entry.ttl;
		}
		return Date.now() - entry.timestamp > this.config.defaultTtl;
	}

	private evictLRU(): void {
		while (
			(this.currentSize > this.config.maxSize ||
				this.cache.size >= this.config.maxEntries) &&
			this.accessOrder.length > 0
		) {
			const oldestKey = this.accessOrder.shift();
			if (oldestKey) {
				const entry = this.cache.get(oldestKey);
				if (entry) {
					this.currentSize -= entry.size;
					this.cache.delete(oldestKey);
					this.stats.evictions++;
				}
			}
		}
	}

	private touch(key: string): void {
		const index = this.accessOrder.indexOf(key);
		if (index > -1) {
			this.accessOrder.splice(index, 1);
		}
		this.accessOrder.push(key);
	}

	get(tool: string, args: unknown): T | null {
		const key = this.buildKey(tool, args);
		const entry = this.cache.get(key);

		if (!entry) {
			this.stats.misses++;
			return null;
		}

		if (this.isExpired(entry)) {
			this.cache.delete(key);
			this.currentSize -= entry.size;
			const index = this.accessOrder.indexOf(key);
			if (index > -1) {
				this.accessOrder.splice(index, 1);
			}
			this.stats.misses++;
			return null;
		}

		entry.hitCount++;
		this.touch(key);
		this.stats.hits++;
		return entry.result;
	}

	set(
		tool: string,
		args: unknown,
		result: T,
		options?: { mtime?: number; ttl?: number },
	): void {
		const key = this.buildKey(tool, args);
		const size = this.estimateSize(result);

		const existingEntry = this.cache.get(key);
		if (existingEntry) {
			this.currentSize -= existingEntry.size;
		}

		while (
			(this.currentSize + size > this.config.maxSize ||
				this.cache.size >= this.config.maxEntries) &&
			this.accessOrder.length > 0
		) {
			this.evictLRU();
		}

		const entry: CacheEntry<T> = {
			key,
			result,
			timestamp: Date.now(),
			mtime: options?.mtime,
			size,
			hitCount: 0,
			ttl: options?.ttl,
		};

		this.cache.set(key, entry);
		this.currentSize += size;
		this.touch(key);
	}

	has(tool: string, args: unknown): boolean {
		const key = this.buildKey(tool, args);
		const entry = this.cache.get(key);
		if (!entry) return false;
		return !this.isExpired(entry);
	}

	delete(tool: string, args: unknown): boolean {
		const key = this.buildKey(tool, args);
		const entry = this.cache.get(key);
		if (entry) {
			this.currentSize -= entry.size;
			this.cache.delete(key);
			const index = this.accessOrder.indexOf(key);
			if (index > -1) {
				this.accessOrder.splice(index, 1);
			}
			return true;
		}
		return false;
	}

	deleteByPattern(pattern: string): number {
		let deleted = 0;

		for (const key of this.cache.keys()) {
			if (key.includes(pattern)) {
				const entry = this.cache.get(key);
				if (entry) {
					this.currentSize -= entry.size;
					this.cache.delete(key);
					const index = this.accessOrder.indexOf(key);
					if (index > -1) {
						this.accessOrder.splice(index, 1);
					}
					deleted++;
				}
			}
		}

		return deleted;
	}

	deleteByPrefix(prefix: string): number {
		let deleted = 0;

		for (const key of this.cache.keys()) {
			if (key.startsWith(prefix)) {
				const entry = this.cache.get(key);
				if (entry) {
					this.currentSize -= entry.size;
					this.cache.delete(key);
					const index = this.accessOrder.indexOf(key);
					if (index > -1) {
						this.accessOrder.splice(index, 1);
					}
					deleted++;
				}
			}
		}

		return deleted;
	}

	clear(): void {
		this.cache.clear();
		this.accessOrder = [];
		this.currentSize = 0;
	}

	getStats(): CacheStats {
		return {
			hits: this.stats.hits,
			misses: this.stats.misses,
			evictions: this.stats.evictions,
			size: this.currentSize,
			entryCount: this.cache.size,
		};
	}

	getHitRate(): number {
		const total = this.stats.hits + this.stats.misses;
		return total > 0 ? this.stats.hits / total : 0;
	}

	getEntries(): CacheEntry<T>[] {
		return Array.from(this.cache.values());
	}
}
