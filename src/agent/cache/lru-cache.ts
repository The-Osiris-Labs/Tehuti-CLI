export interface CacheEntry<T = unknown> {
	key: string;
	result: T;
	timestamp: number;
	mtime?: number;
	size: number;
	hitCount: number;
	ttl?: number;
}

export interface CacheStats {
	hits: number;
	misses: number;
	evictions: number;
	size: number;
	entryCount: number;
}

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

export class LRUCache<T = unknown> {
	private cache = new Map<string, CacheEntry<T>>();
	private accessOrder: string[] = [];
	private currentSize = 0;
	private readonly config: Required<CacheConfig>;
	private stats = { hits: 0, misses: 0, evictions: 0 };

	constructor(config: CacheConfig = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

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

	private buildKey(tool: string, args: unknown): string {
		const argsStr = typeof args === "string" ? args : JSON.stringify(args);
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
			(this.currentSize > this.config.maxSize || this.cache.size >= this.config.maxEntries) &&
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

	set(tool: string, args: unknown, result: T, options?: { mtime?: number; ttl?: number }): void {
		const key = this.buildKey(tool, args);
		const size = this.estimateSize(result);

		const existingEntry = this.cache.get(key);
		if (existingEntry) {
			this.currentSize -= existingEntry.size;
		}

		while (
			(this.currentSize + size > this.config.maxSize || this.cache.size >= this.config.maxEntries) &&
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
		const regex = new RegExp(pattern);
		let deleted = 0;

		for (const key of this.cache.keys()) {
			if (regex.test(key)) {
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
