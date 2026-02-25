import { describe, it, expect, beforeEach, vi } from "vitest";
import { ToolCache, getToolCache, resetToolCache } from "./tool-cache.js";
import type { ToolResult } from "../tools/registry.js";

const FIXED_MTIME = 1700000000000;

vi.mock("node:fs", () => ({
	statSync: vi.fn((path: string) => {
		if (path.includes("nonexistent") || path.includes("/nonexistent")) {
			throw new Error("File not found");
		}
		return { mtimeMs: FIXED_MTIME };
	}),
}));

describe("ToolCache", () => {
	let cache: ToolCache;

	beforeEach(() => {
		cache = new ToolCache();
	});

	const createResult = (output: string, success = true): ToolResult => ({
		output,
		success,
		error: success ? undefined : "Error",
	});

	describe("get and set", () => {
		it("should cache tool results", () => {
			const result = createResult("file content");
			cache.set("read", { file_path: "/test/file.ts" }, result);

			const cached = cache.get("read", { file_path: "/test/file.ts" });
			expect(cached).toEqual(result);
		});

		it("should not cache failed results", () => {
			const failedResult = createResult("error", false);
			cache.set("read", { file_path: "/test/file.ts" }, failedResult);

			const cached = cache.get("read", { file_path: "/test/file.ts" });
			expect(cached).toBeNull();
		});

		it("should return null for uncached tools", () => {
			const cached = cache.get("read", { file_path: "/some/existing/path.ts" });
			expect(cached).toBeNull();
		});
	});

	describe("file modification tracking", () => {
		it("should track file mtimes for file-based tools", () => {
			const result = createResult("content");
			cache.set("read", { file_path: "/test/file.ts" }, result);

			const cached = cache.get("read", { file_path: "/test/file.ts" });
			expect(cached).toEqual(result);
		});
	});

	describe("invalidateFile", () => {
		it("should invalidate cache entries for a specific file", () => {
			cache.set("read", { file_path: "/test/file.ts" }, createResult("content"));
			cache.set("read", { file_path: "/test/other.ts" }, createResult("other"));

			const deleted = cache.invalidateFile("/test/file.ts");

			expect(cache.get("read", { file_path: "/test/file.ts" })).toBeNull();
			expect(cache.get("read", { file_path: "/test/other.ts" })).not.toBeNull();
		});
	});

	describe("invalidateDirectory", () => {
		it("should invalidate cache entries for a directory", () => {
			cache.set("glob", { pattern: "*.ts", path: "/test" }, createResult("files"));
			cache.set("list_dir", { dir_path: "/test" }, createResult("dirs"));

			const deleted = cache.invalidateDirectory("/test");

			expect(deleted).toBeGreaterThan(0);
		});
	});

	describe("getStats", () => {
		it("should return cache statistics", () => {
			cache.set("read", { file_path: "/test/a.ts" }, createResult("a"));
			cache.set("read", { file_path: "/test/b.ts" }, createResult("b"));
			cache.get("read", { file_path: "/test/a.ts" });
			cache.get("read", { file_path: "/nonexistent.ts" });

			const stats = cache.getStats();
			expect(stats.entryCount).toBe(2);
			expect(stats.hits).toBe(1);
			expect(stats.misses).toBe(1);
		});
	});

	describe("getHitRate", () => {
		it("should return cache hit rate", () => {
			cache.set("read", { file_path: "/test/file.ts" }, createResult("content"));

			cache.get("read", { file_path: "/test/file.ts" });
			cache.get("read", { file_path: "/test/file.ts" });
			cache.get("read", { file_path: "/other.ts" });

			const hitRate = cache.getHitRate();
			expect(hitRate).toBeCloseTo(0.667, 2);
		});
	});

	describe("clear", () => {
		it("should clear all cache entries", () => {
			cache.set("read", { file_path: "/test/a.ts" }, createResult("a"));
			cache.set("read", { file_path: "/test/b.ts" }, createResult("b"));
			cache.clear();

			expect(cache.get("read", { file_path: "/test/a.ts" })).toBeNull();
			expect(cache.getStats().entryCount).toBe(0);
		});
	});
});

describe("getToolCache", () => {
	it("should return a singleton instance", () => {
		const c1 = getToolCache();
		const c2 = getToolCache();
		expect(c1).toBe(c2);
	});
});

describe("resetToolCache", () => {
	it("should reset the global cache instance", () => {
		const c1 = getToolCache();
		c1.set("read", { file_path: "/test.ts" }, { output: "content", success: true });

		resetToolCache();

		const c2 = getToolCache();
		expect(c2.get("read", { file_path: "/test.ts" })).toBeNull();
	});
});
