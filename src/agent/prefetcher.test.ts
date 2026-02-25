import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prefetcher, getPrefetcher, resetPrefetcher } from "./prefetcher.js";
import type { ToolContext } from "./tools/registry.js";

vi.mock("./tools/registry.js", () => ({
	executeTool: vi.fn().mockResolvedValue({ success: true, output: "result" }),
}));

vi.mock("./cache/index.js", () => ({
	getToolCache: vi.fn().mockReturnValue({
		has: vi.fn().mockReturnValue(false),
	}),
}));

describe("Prefetcher", () => {
	let prefetcher: Prefetcher;

	beforeEach(() => {
		resetPrefetcher();
		prefetcher = new Prefetcher();
		vi.clearAllMocks();
	});

	afterEach(() => {
		resetPrefetcher();
	});

	describe("setEnabled", () => {
		it("should disable prefetching", () => {
			prefetcher.setEnabled(false);
			prefetcher.predict("read", { file_path: "/test.ts" }, {} as ToolContext);

			expect(prefetcher.getPendingCount()).toBe(0);
		});

		it("should clear pending when disabled", () => {
			const ctx = { cwd: "/test" } as ToolContext;
			prefetcher.predict("git_status", {}, ctx);
			expect(prefetcher.getPendingCount()).toBeGreaterThan(0);

			prefetcher.setEnabled(false);
			expect(prefetcher.getPendingCount()).toBe(0);
		});
	});

	describe("predict", () => {
		it("should predict file_info after read", () => {
			const ctx = { cwd: "/test" } as ToolContext;
			prefetcher.predict("read", { file_path: "/test/file.ts" }, ctx);

			expect(prefetcher.hasPrefetched("file_info", { file_path: "/test/file.ts" })).toBe(true);
		});

		it("should predict list_dir after read", () => {
			const ctx = { cwd: "/test" } as ToolContext;
			prefetcher.predict("read", { file_path: "/test/subdir/file.ts" }, ctx);

			expect(prefetcher.hasPrefetched("list_dir", { dir_path: "/test/subdir" })).toBe(true);
		});

		it("should predict git_diff after git_status", () => {
			const ctx = { cwd: "/test" } as ToolContext;
			prefetcher.predict("git_status", {}, ctx);

			expect(prefetcher.hasPrefetched("git_diff", {})).toBe(true);
		});

		it("should not exceed max prefetch queue", () => {
			const ctx = { cwd: "/test" } as ToolContext;

			for (let i = 0; i < 20; i++) {
				prefetcher.predict("read", { file_path: `/test/file${i}.ts` }, ctx);
			}

			expect(prefetcher.getPendingCount()).toBeLessThanOrEqual(10);
		});

		it("should not prefetch same tool+args twice", () => {
			const ctx = { cwd: "/test" } as ToolContext;
			prefetcher.predict("read", { file_path: "/test/file.ts" }, ctx);
			const count1 = prefetcher.getPendingCount();

			prefetcher.predict("read", { file_path: "/test/file.ts" }, ctx);
			const count2 = prefetcher.getPendingCount();

			expect(count1).toBe(count2);
		});
	});

	describe("getPrefetched", () => {
		it("should return pending promise and delete it", async () => {
			const ctx = { cwd: "/test" } as ToolContext;
			prefetcher.predict("git_status", {}, ctx);

			const pending = prefetcher.getPrefetched("git_diff", {});
			expect(pending).not.toBeNull();
			expect(prefetcher.hasPrefetched("git_diff", {})).toBe(false);

			const result = await pending;
			expect(result).toEqual({ success: true, output: "result" });
		});

		it("should return null if not prefetched", () => {
			const result = prefetcher.getPrefetched("read", { file_path: "/not-prefetched.ts" });
			expect(result).toBeNull();
		});
	});

	describe("recordPattern", () => {
		it("should record tool usage patterns", () => {
			prefetcher.recordPattern("read", { file_path: "/test.ts" });
			prefetcher.recordPattern("read", { file_path: "/test.ts" });
			prefetcher.recordPattern("glob", { pattern: "*.ts" });

			const stats = prefetcher.getStats();
			expect(stats.recentPatternCount).toBe(3);
		});

		it("should limit recent patterns", () => {
			for (let i = 0; i < 100; i++) {
				prefetcher.recordPattern("read", { file_path: `/test${i}.ts` });
			}

			const stats = prefetcher.getStats();
			expect(stats.recentPatternCount).toBeLessThanOrEqual(50);
		});
	});

	describe("predictFromHistory", () => {
		it("should return empty array with no history", () => {
			const predictions = prefetcher.predictFromHistory();
			expect(predictions).toEqual([]);
		});

		it("should return predictions based on frequency", () => {
			prefetcher.recordPattern("read", { file_path: "/test.ts" });
			prefetcher.recordPattern("read", { file_path: "/test.ts" });

			const predictions = prefetcher.predictFromHistory();

			expect(predictions).toBeInstanceOf(Array);
		});

		it("should return at most 5 predictions", () => {
			for (let i = 0; i < 10; i++) {
				prefetcher.recordPattern("read", { file_path: `/test${i}.ts` });
				prefetcher.recordPattern("read", { file_path: `/test${i}.ts` });
			}

			const predictions = prefetcher.predictFromHistory();
			expect(predictions.length).toBeLessThanOrEqual(5);
		});
	});

	describe("clear", () => {
		it("should clear pending and history", () => {
			const ctx = { cwd: "/test" } as ToolContext;
			prefetcher.predict("git_status", {}, ctx);
			prefetcher.recordPattern("read", { file_path: "/test.ts" });

			prefetcher.clear();

			expect(prefetcher.getPendingCount()).toBe(0);
			expect(prefetcher.getStats().recentPatternCount).toBe(0);
		});
	});

	describe("getStats", () => {
		it("should return stats object", () => {
			const ctx = { cwd: "/test" } as ToolContext;
			prefetcher.predict("git_status", {}, ctx);

			const stats = prefetcher.getStats();

			expect(stats).toHaveProperty("pendingCount");
			expect(stats).toHaveProperty("recentPatternCount");
			expect(stats.pendingCount).toBeGreaterThan(0);
		});
	});
});

describe("Global Prefetcher", () => {
	afterEach(() => {
		resetPrefetcher();
	});

	it("should return singleton instance", () => {
		const instance1 = getPrefetcher();
		const instance2 = getPrefetcher();

		expect(instance1).toBe(instance2);
	});

	it("should reset singleton", () => {
		const instance1 = getPrefetcher();
		resetPrefetcher();
		const instance2 = getPrefetcher();

		expect(instance1).not.toBe(instance2);
	});
});
