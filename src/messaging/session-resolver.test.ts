import { describe, expect, it } from "vitest";
import { SessionResolver } from "./session-resolver.js";

describe("SessionResolver LRU Cache Synchronization", () => {
	it("synchronizes eviction between sessionCache and reverseCache when CACHE_MAX_SIZE is reached", () => {
		const resolver = new SessionResolver();

		// Populate cache up to max size (1000) using private updateCache helper
		for (let i = 1; i <= 1000; i++) {
			(resolver as any).updateCache(`sender-${i}`, `session-${i}`);
		}

		expect(resolver.getCacheSize()).toBe(1000);
		expect(resolver.getReverseCacheSize()).toBe(1000);

		// Verify sender-1 is present in both caches
		expect((resolver as any).sessionCache.has("sender-1")).toBe(true);
		expect((resolver as any).reverseCache.has("session-1")).toBe(true);

		// Insert 1001st item, causing sender-1/session-1 to be evicted from both caches
		(resolver as any).updateCache("sender-1001", "session-1001");

		expect(resolver.getCacheSize()).toBe(1000);
		expect(resolver.getReverseCacheSize()).toBe(1000);

		// Verify sender-1 and session-1 are evicted from both caches
		expect((resolver as any).sessionCache.has("sender-1")).toBe(false);
		expect((resolver as any).reverseCache.has("session-1")).toBe(false);

		// Verify sender-1001 / session-1001 exist
		expect((resolver as any).sessionCache.get("sender-1001")).toBe(
			"session-1001",
		);
		expect((resolver as any).reverseCache.get("session-1001")).toBe(
			"sender-1001",
		);
	});

	it("removes old mappings from reverseCache when updating an existing sender to a new session ID", () => {
		const resolver = new SessionResolver();
		(resolver as any).updateCache("sender-A", "session-old");

		expect((resolver as any).reverseCache.get("session-old")).toBe("sender-A");

		(resolver as any).updateCache("sender-A", "session-new");

		expect((resolver as any).sessionCache.get("sender-A")).toBe("session-new");
		expect((resolver as any).reverseCache.get("session-new")).toBe("sender-A");
		expect((resolver as any).reverseCache.has("session-old")).toBe(false);
	});
});
