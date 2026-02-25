import { describe, it, expect, beforeEach, vi } from "vitest";
import { LRUCache } from "./lru-cache.js";

describe("LRUCache", () => {
	let cache: LRUCache<string>;

	beforeEach(() => {
		cache = new LRUCache<string>({
			maxSize: 1000,
			maxEntries: 10,
			defaultTtl: 60000,
		});
	});

	describe("get and set", () => {
		it("should store and retrieve values", () => {
			cache.set("key1", { data: "value1" }, "value1");
			const result = cache.get("key1", { data: "value1" });
			expect(result).toBe("value1");
		});

		it("should return null for missing keys", () => {
			const result = cache.get("missing", {});
			expect(result).toBeNull();
		});

		it("should generate consistent keys for same args", () => {
			const args = { path: "/test/file.ts" };
			cache.set("read", args, "content");
			const result = cache.get("read", args);
			expect(result).toBe("content");
		});

		it("should differentiate keys for different args", () => {
			cache.set("read", { path: "/file1.ts" }, "content1");
			cache.set("read", { path: "/file2.ts" }, "content2");

			expect(cache.get("read", { path: "/file1.ts" })).toBe("content1");
			expect(cache.get("read", { path: "/file2.ts" })).toBe("content2");
		});
	});

	describe("TTL expiration", () => {
		it.skip("should mark entries as expired after TTL", () => {
		});

		it.skip("should use custom TTL over default", () => {
		});
	});

	describe("LRU eviction", () => {
		it("should evict least recently used entries when max entries reached", () => {
			const smallCache = new LRUCache<string>({
				maxSize: 10000,
				maxEntries: 3,
				defaultTtl: 60000,
			});

			smallCache.set("a", {}, "1");
			smallCache.set("b", {}, "2");
			smallCache.set("c", {}, "3");
			smallCache.set("d", {}, "4");

			expect(smallCache.get("a", {})).toBeNull();
			expect(smallCache.get("b", {})).toBe("2");
			expect(smallCache.get("c", {})).toBe("3");
			expect(smallCache.get("d", {})).toBe("4");
		});

		it("should update LRU order on get", () => {
			const smallCache = new LRUCache<string>({
				maxSize: 10000,
				maxEntries: 3,
				defaultTtl: 60000,
			});

			smallCache.set("a", {}, "1");
			smallCache.set("b", {}, "2");
			smallCache.set("c", {}, "3");

			smallCache.get("a", {});

			smallCache.set("d", {}, "4");

			expect(smallCache.get("a", {})).toBe("1");
			expect(smallCache.get("b", {})).toBeNull();
			expect(smallCache.get("c", {})).toBe("3");
		});
	});

	describe("delete operations", () => {
		it("should delete by key", () => {
			cache.set("key", { id: 1 }, "value");
			expect(cache.delete("key", { id: 1 })).toBe(true);
			expect(cache.get("key", { id: 1 })).toBeNull();
		});

		it("should delete by pattern", () => {
			cache.set("read", { path: "/test/a.ts" }, "a");
			cache.set("read", { path: "/test/b.ts" }, "b");
			cache.set("write", { path: "/test/c.ts" }, "c");

			const deleted = cache.deleteByPattern("/test");
			expect(deleted).toBeGreaterThan(0);
		});

		it("should delete by prefix", () => {
			cache.set("read", {}, "a");
			cache.set("write", {}, "b");

			const deleted = cache.deleteByPrefix("read");
			expect(deleted).toBeGreaterThanOrEqual(1);
			expect(cache.get("read", {})).toBeNull();
		});
	});

	describe("getStats", () => {
		it("should return cache statistics", () => {
			cache.set("key1", {}, "value1");
			cache.set("key2", {}, "value2");
			cache.get("key1", {});
			cache.get("missing", {});

			const stats = cache.getStats();
			expect(stats.entryCount).toBe(2);
			expect(stats.hits).toBe(1);
			expect(stats.misses).toBe(1);
		});

		it("should calculate hit rate", () => {
			cache.set("key", {}, "value");
			cache.get("key", {});
			cache.get("key", {});
			cache.get("missing", {});

			expect(cache.getHitRate()).toBeCloseTo(0.667, 2);
		});
	});

	describe("clear", () => {
		it("should clear all entries", () => {
			cache.set("a", {}, "1");
			cache.set("b", {}, "2");
			cache.clear();

			expect(cache.get("a", {})).toBeNull();
			expect(cache.get("b", {})).toBeNull();
			expect(cache.getStats().entryCount).toBe(0);
		});
	});

	describe("has", () => {
		it("should check if key exists", () => {
			cache.set("key", { id: 1 }, "value");
			expect(cache.has("key", { id: 1 })).toBe(true);
			expect(cache.has("key", { id: 2 })).toBe(false);
			expect(cache.has("missing", {})).toBe(false);
		});
	});
});
