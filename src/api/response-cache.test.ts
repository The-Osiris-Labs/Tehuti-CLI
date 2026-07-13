import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { APIResponseCache } from "./response-cache.js";
import type { StandardResponse } from "./base-client.js";

// Override the cache directory for testing
const TEST_CACHE_DIR = join(process.cwd(), ".tehuti-test", "api-cache");

// Helper to create a mock response
function mockResponse(text: string): StandardResponse {
	return {
		text,
		model: "test-model",
		finishReason: "stop",
		usage: { inputTokens: 10, outputTokens: 5 },
	};
}

// Helper to create messages
function messages(content: string) {
	return [{ role: "user" as const, content }];
}

describe("APIResponseCache LRU Eviction", () => {
	let cache: APIResponseCache;

	beforeEach(async () => {
		// Clean test directory
		if (existsSync(TEST_CACHE_DIR)) {
			rmSync(TEST_CACHE_DIR, { recursive: true, force: true });
		}
		mkdirSync(TEST_CACHE_DIR, { recursive: true });

		// Reset singleton to use test directory
		APIResponseCache.resetInstance();
		cache = APIResponseCache.getInstance();
		// Override cacheDirectory for testing
		(cache as any).cacheDirectory = TEST_CACHE_DIR;
	});

	afterEach(async () => {
		if (existsSync(TEST_CACHE_DIR)) {
			rmSync(TEST_CACHE_DIR, { recursive: true, force: true });
		}
	});

	it("should return null for cache miss", async () => {
		const result = await cache.get(messages("miss"));
		expect(result).toBeNull();
	});

	it("should cache and retrieve a response", async () => {
		const msgs = messages("hello");
		const response = mockResponse("world");

		await cache.set(msgs, response);
		const cached = await cache.get(msgs);

		expect(cached).toBeDefined();
		expect(cached?.text).toBe("world");
	});

	it("should delete expired entries on get()", async () => {
		const msgs = messages("expire");
		const response = mockResponse("expired");

		// Set with 1ms TTL
		await cache.set(msgs, response, { ttl: 1 });

		// Wait for expiry
		await new Promise((resolve) => setTimeout(resolve, 10));

		// Get should return null AND delete the file
		const result = await cache.get(msgs);
		expect(result).toBeNull();

		// Verify file was deleted
		const files = await readdir(TEST_CACHE_DIR);
		expect(files.filter((f) => f.endsWith(".json")).length).toBe(0);
	});

	it("should track hits and misses in stats", async () => {
		const msgs = messages("stats");
		const response = mockResponse("tracked");

		// Miss
		await cache.get(msgs);
		let stats = await cache.getStats();
		expect(stats.misses).toBe(1);
		expect(stats.hits).toBe(0);

		// Set and hit
		await cache.set(msgs, response);
		await cache.get(msgs);
		stats = await cache.getStats();
		expect(stats.hits).toBe(1);
		expect(stats.misses).toBe(1);
	});

	it("should enforce MAX_ENTRIES limit via LRU eviction", async () => {
		// Override MAX_ENTRIES for testing
		(cache as any).maxEntries = 5;

		// Fill cache with 5 entries
		for (let i = 0; i < 5; i++) {
			await cache.set(messages(`entry-${i}`), mockResponse(`resp-${i}`));
		}

		let files = await readdir(TEST_CACHE_DIR);
		expect(files.filter((f) => f.endsWith(".json")).length).toBe(5);

		// Add one more — should evict oldest (entry-0)
		await cache.set(messages("new-entry"), mockResponse("new"));

		files = await readdir(TEST_CACHE_DIR);
		expect(files.filter((f) => f.endsWith(".json")).length).toBe(5);

		// Verify entry-0 was evicted (LRU)
		const result = await cache.get(messages("entry-0"));
		expect(result).toBeNull();

		// Verify new-entry exists
		const newResult = await cache.get(messages("new-entry"));
		expect(newResult).toBeDefined();
	});

	it("should update lastAccess on get() for LRU tracking", async () => {
		(cache as any).maxEntries = 3;

		// Add 3 entries
		await cache.set(messages("a"), mockResponse("1"));
		await cache.set(messages("b"), mockResponse("2"));
		await cache.set(messages("c"), mockResponse("3"));

		// Access "a" to make it most recent
		await cache.get(messages("a"));

		// Add new entry — should evict "b" (oldest lastAccess)
		await cache.set(messages("d"), mockResponse("4"));

		const bResult = await cache.get(messages("b"));
		expect(bResult).toBeNull(); // "b" was evicted

		const aResult = await cache.get(messages("a"));
		expect(aResult).toBeDefined(); // "a" was kept (recently accessed)
	});

	it("should enforce size budget via LRU eviction", async () => {
		// Override MAX_BYTES for testing (small budget)
		(cache as any).maxBytes = 500; // 500 bytes

		// Add entries until over budget
		for (let i = 0; i < 10; i++) {
			await cache.set(messages(`big-${i}`), mockResponse("x".repeat(100)));
		}

		// Verify eviction happened
		const stats = await cache.getStats();
		expect(stats.evictions).toBeGreaterThan(0);
		expect(stats.sizeBytes).toBeLessThanOrEqual(500);
	});

	it("should track evictions in stats", async () => {
		(cache as any).maxEntries = 2;

		await cache.set(messages("1"), mockResponse("a"));
		await cache.set(messages("2"), mockResponse("b"));

		let stats = await cache.getStats();
		expect(stats.evictions).toBe(0);

		// Trigger eviction
		await cache.set(messages("3"), mockResponse("c"));

		stats = await cache.getStats();
		expect(stats.evictions).toBeGreaterThan(0);
	});

	it("sweep() should remove expired entries and enforce limits", async () => {
		// Add expired entry
		await cache.set(messages("expired"), mockResponse("old"), { ttl: 1 });
		await new Promise((resolve) => setTimeout(resolve, 10));

		// Add valid entries
		await cache.set(messages("valid"), mockResponse("new"));

		// Run sweep
		const result = await cache.sweep();
		expect(result.expired).toBeGreaterThan(0);

		// Verify expired entry was removed
		const expiredResult = await cache.get(messages("expired"));
		expect(expiredResult).toBeNull();

		// Verify valid entry still exists
		const validResult = await cache.get(messages("valid"));
		expect(validResult).toBeDefined();
	});

	it("sweep() should enforce MAX_ENTRIES via LRU", async () => {
		(cache as any).maxEntries = 3;

		// Write 5 entries directly (bypass evictIfNeeded in set())
		// so sweep() has entries above the limit to evict
		const { writeFile } = await import("node:fs/promises");
		const now = Date.now();
		for (let i = 0; i < 5; i++) {
			const cacheKey = `sweep-${i}`;
			const cachePath = join(TEST_CACHE_DIR, `${cacheKey}.json`);
			const entry = {
				messages: messages(`sweep-${i}`),
				options: { model: "test-model" },
				response: mockResponse(`resp-${i}`),
				timestamp: now,
				ttl: 900000,
				lastAccess: now - (5 - i) * 1000, // stagger lastAccess for LRU
			};
			await writeFile(cachePath, JSON.stringify(entry));
		}

		// Verify 5 entries exist before sweep
		let files = await readdir(TEST_CACHE_DIR);
		expect(files.filter((f) => f.endsWith(".json")).length).toBe(5);

		// Run sweep
		const result = await cache.sweep();
		expect(result.evicted).toBeGreaterThan(0);

		// Verify only 3 remain
		files = await readdir(TEST_CACHE_DIR);
		expect(files.filter((f) => f.endsWith(".json")).length).toBe(3);
	});

	it("sweep() should enforce size budget via LRU", async () => {
		(cache as any).maxBytes = 300; // Small budget

		// Write entries directly (bypass evictIfNeeded in set())
		// so sweep() has entries over budget to evict
		const { writeFile } = await import("node:fs/promises");
		const now = Date.now();
		for (let i = 0; i < 5; i++) {
			const cacheKey = `size-${i}`;
			const cachePath = join(TEST_CACHE_DIR, `${cacheKey}.json`);
			const entry = {
				messages: messages(`size-${i}`),
				options: { model: "test-model" },
				response: mockResponse("x".repeat(100)),
				timestamp: now,
				ttl: 900000,
				lastAccess: now - (5 - i) * 1000, // stagger lastAccess for LRU
			};
			await writeFile(cachePath, JSON.stringify(entry));
		}

		// Run sweep
		const result = await cache.sweep();
		expect(result.evicted).toBeGreaterThan(0);

		// Verify size is under budget
		const stats = await cache.getStats();
		expect(stats.sizeBytes).toBeLessThanOrEqual(300);
	});

	it("clear() should remove all entries", async () => {
		for (let i = 0; i < 3; i++) {
			await cache.set(messages(`clear-${i}`), mockResponse(`resp-${i}`));
		}

		const cleared = await cache.clear();
		expect(cleared).toBe(3);

		const files = await readdir(TEST_CACHE_DIR);
		expect(files.filter((f) => f.endsWith(".json")).length).toBe(0);
	});

	it("should handle corrupt cache entries gracefully", async () => {
		const msgs = messages("corrupt");
		await cache.set(msgs, mockResponse("valid"));

		// Corrupt the file
		const files = await readdir(TEST_CACHE_DIR);
		const corruptFile = join(TEST_CACHE_DIR, files[0]);
		const { writeFile } = await import("node:fs/promises");
		await writeFile(corruptFile, "not valid json {{{");

		// Get should handle gracefully and delete corrupt file
		const result = await cache.get(msgs);
		expect(result).toBeNull();

		// Verify file was deleted
		const remainingFiles = await readdir(TEST_CACHE_DIR);
		expect(remainingFiles.length).toBe(0);
	});
});

describe("APIResponseCache Stats", () => {
	let cache: APIResponseCache;

	beforeEach(async () => {
		if (existsSync(TEST_CACHE_DIR)) {
			rmSync(TEST_CACHE_DIR, { recursive: true, force: true });
		}
		mkdirSync(TEST_CACHE_DIR, { recursive: true });

		APIResponseCache.resetInstance();
		cache = APIResponseCache.getInstance();
		(cache as any).cacheDirectory = TEST_CACHE_DIR;
	});

	afterEach(async () => {
		if (existsSync(TEST_CACHE_DIR)) {
			rmSync(TEST_CACHE_DIR, { recursive: true, force: true });
		}
	});

	it("getStats() should return current stats", async () => {
		const stats = await cache.getStats();
		expect(stats).toHaveProperty("hits");
		expect(stats).toHaveProperty("misses");
		expect(stats).toHaveProperty("evictions");
		expect(stats).toHaveProperty("entries");
		expect(stats).toHaveProperty("sizeBytes");
	});

	it("stats should reflect cache operations", async () => {
		// Initial state
		let stats = await cache.getStats();
		expect(stats.hits).toBe(0);
		expect(stats.misses).toBe(0);
		expect(stats.evictions).toBe(0);
		expect(stats.entries).toBe(0);
		expect(stats.sizeBytes).toBe(0);

		// Miss
		await cache.get(messages("miss"));
		stats = await cache.getStats();
		expect(stats.misses).toBe(1);

		// Set
		await cache.set(messages("hit"), mockResponse("data"));
		stats = await cache.getStats();
		expect(stats.entries).toBe(1);
		expect(stats.sizeBytes).toBeGreaterThan(0);

		// Hit
		await cache.get(messages("hit"));
		stats = await cache.getStats();
		expect(stats.hits).toBe(1);
	});
});
