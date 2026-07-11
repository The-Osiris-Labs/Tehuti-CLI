import { describe, expect, it } from "vitest";
import { SessionResolver } from "./session-resolver.js";

describe("SessionResolver Cache", () => {
	it("evicts oldest entries from platformCache and profileCache when CACHE_MAX_SIZE is reached", () => {
		const resolver = new SessionResolver();

		// Populate caches up to max size (1000 pairs) using private updateCache helper
		for (let i = 1; i <= 1000; i++) {
			(resolver as any).updateCache(
				`sender-${i}`,
				`profile-${i}`,
				`session-${i}`,
			);
		}

		const platformCache = (resolver as any).platformCache as Map<
			string,
			string
		>;
		const profileCache = (resolver as any).profileCache as Map<string, string>;

		expect(platformCache.size).toBe(1000);
		expect(profileCache.size).toBe(1000);

		// Verify first entries are present
		expect(platformCache.has("sender-1")).toBe(true);
		expect(profileCache.has("profile-1")).toBe(true);

		// Insert 1001st entry, causing sender-1/profile-1 to be evicted from both caches
		(resolver as any).updateCache(
			"sender-1001",
			"profile-1001",
			"session-1001",
		);

		expect(platformCache.size).toBe(1000);
		expect(profileCache.size).toBe(1000);

		// Verify sender-1 and profile-1 are evicted from both caches
		expect(platformCache.has("sender-1")).toBe(false);
		expect(profileCache.has("profile-1")).toBe(false);

		// Verify sender-1001 / session-1001 exist
		expect(platformCache.get("sender-1001")).toBe("profile-1001");
		expect(profileCache.get("profile-1001")).toBe("session-1001");
	});

	it("removes old mappings from profileCache when updating an existing sender to a new profile/session", () => {
		const resolver = new SessionResolver();
		(resolver as any).updateCache("sender-A", "profile-old", "session-old");

		const profileCache = (resolver as any).profileCache as Map<string, string>;

		expect(profileCache.get("profile-old")).toBe("session-old");

		(resolver as any).updateCache("sender-A", "profile-new", "session-new");

		const platformCache = (resolver as any).platformCache as Map<
			string,
			string
		>;
		expect(platformCache.get("sender-A")).toBe("profile-new");
		expect(profileCache.get("profile-new")).toBe("session-new");
		expect(profileCache.has("profile-old")).toBe(false);
	});
});
