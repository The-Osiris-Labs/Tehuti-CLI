import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	clearCacheFromDisk,
	getCacheStats,
	loadCacheFromDisk,
	saveCacheToDisk,
} from "./persistent-cache.js";
import { getToolCache, resetToolCache } from "./tool-cache.js";

const CACHE_DIR = path.join(os.homedir(), ".tehuti", "cache");
const CACHE_FILE = path.join(CACHE_DIR, "tool-cache.json");

vi.mock("node:fs", async () => {
	const actual = await vi.importActual<typeof fs>("node:fs");
	return {
		...actual,
		existsSync: vi.fn(),
		mkdirSync: vi.fn(),
		writeFileSync: vi.fn(),
		readFileSync: vi.fn(),
		rmSync: vi.fn(),
		statSync: vi.fn(),
	};
});

describe("Persistent Cache", () => {
	beforeEach(() => {
		resetToolCache();
		vi.clearAllMocks();
	});

	afterEach(() => {
		resetToolCache();
	});

	describe("saveCacheToDisk", () => {
		it("should not save when cache is empty", () => {
			const cache = getToolCache();
			expect(cache.getStats().entryCount).toBe(0);

			saveCacheToDisk();

			expect(fs.writeFileSync).not.toHaveBeenCalled();
		});

		it("should save cache entries to disk", () => {
			const cache = getToolCache();
			cache.set("read", { file_path: "/test/file.ts" }, {
				success: true,
				output: "file content",
			});

			saveCacheToDisk();

			expect(fs.mkdirSync).toHaveBeenCalledWith(CACHE_DIR, { recursive: true });
			expect(fs.writeFileSync).toHaveBeenCalled();

			const writtenData = JSON.parse(
				(vi.mocked(fs.writeFileSync).mock.calls[0]?.[1] as string) || "{}",
			);
			expect(writtenData.version).toBe(1);
			expect(writtenData.entries).toHaveLength(1);
			expect(writtenData.entries[0].key).toBe(
				'read:{"file_path":"/test/file.ts"}',
			);
		});

		it("should handle write errors gracefully", () => {
			const cache = getToolCache();
			cache.set("read", { file_path: "/test/file.ts" }, {
				success: true,
				output: "content",
			});

			vi.mocked(fs.writeFileSync).mockImplementation(() => {
				throw new Error("Write failed");
			});

			expect(() => saveCacheToDisk()).not.toThrow();
		});
	});

	describe("loadCacheFromDisk", () => {
		it("should do nothing when cache file does not exist", () => {
			vi.mocked(fs.existsSync).mockReturnValue(false);

			loadCacheFromDisk();

			expect(fs.readFileSync).not.toHaveBeenCalled();
		});

		it("should load valid cache entries", () => {
			const mockCache = {
				version: 1,
				entries: [
					{
						key: 'read:{"file_path":"/test/file.ts"}',
						result: { success: true, output: "cached content" },
						timestamp: Date.now(),
						ttl: 300000,
					},
				],
				savedAt: Date.now(),
			};

			vi.mocked(fs.existsSync).mockReturnValue(true);
			vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockCache));

			loadCacheFromDisk();

			const cache = getToolCache();
			const cached = cache.get("read", { file_path: "/test/file.ts" });
			expect(cached).not.toBeNull();
			expect(cached?.output).toBe("cached content");
		});

		it("should skip entries with wrong version", () => {
			const mockCache = {
				version: 2,
				entries: [
					{
						key: 'read:{"file_path":"/test/file.ts"}',
						result: { success: true, output: "content" },
						timestamp: Date.now(),
					},
				],
				savedAt: Date.now(),
			};

			vi.mocked(fs.existsSync).mockReturnValue(true);
			vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockCache));

			loadCacheFromDisk();

			const cache = getToolCache();
			expect(cache.get("read", { file_path: "/test/file.ts" })).toBeNull();
		});

		it("should skip expired entries", () => {
			const oldTimestamp = Date.now() - 10 * 60 * 1000;
			const mockCache = {
				version: 1,
				entries: [
					{
						key: 'read:{"file_path":"/test/file.ts"}',
						result: { success: true, output: "content" },
						timestamp: oldTimestamp,
						ttl: 60000,
					},
				],
				savedAt: oldTimestamp,
			};

			vi.mocked(fs.existsSync).mockReturnValue(true);
			vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockCache));

			loadCacheFromDisk();

			const cache = getToolCache();
			expect(cache.get("read", { file_path: "/test/file.ts" })).toBeNull();
		});

		it("should skip cache older than 24 hours", () => {
			const oldTimestamp = Date.now() - 25 * 60 * 60 * 1000;
			const mockCache = {
				version: 1,
				entries: [
					{
						key: 'read:{"file_path":"/test/file.ts"}',
						result: { success: true, output: "content" },
						timestamp: oldTimestamp,
					},
				],
				savedAt: oldTimestamp,
			};

			vi.mocked(fs.existsSync).mockReturnValue(true);
			vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockCache));

			loadCacheFromDisk();

			const cache = getToolCache();
			expect(cache.get("read", { file_path: "/test/file.ts" })).toBeNull();
		});

		it("should handle corrupt cache file gracefully", () => {
			vi.mocked(fs.existsSync).mockReturnValue(true);
			vi.mocked(fs.readFileSync).mockReturnValue("not valid json");

			expect(() => loadCacheFromDisk()).not.toThrow();

			const cache = getToolCache();
			expect(cache.getStats().entryCount).toBe(0);
		});
	});

	describe("clearCacheFromDisk", () => {
		it("should remove cache file if it exists", () => {
			vi.mocked(fs.existsSync).mockReturnValue(true);

			clearCacheFromDisk();

			expect(fs.rmSync).toHaveBeenCalledWith(CACHE_FILE, { force: true });
		});

		it("should handle non-existent file", () => {
			vi.mocked(fs.existsSync).mockReturnValue(false);

			expect(() => clearCacheFromDisk()).not.toThrow();
		});
	});

	describe("getCacheStats", () => {
		it("should return zero stats when no cache file", () => {
			vi.mocked(fs.existsSync).mockReturnValue(false);

			const stats = getCacheStats();

			expect(stats).toEqual({ diskSize: 0, diskEntries: 0 });
		});

		it("should return cache stats from disk", () => {
			const mockCache = {
				version: 1,
				entries: [
					{ key: "read:{}", result: { success: true, output: "a" }, timestamp: 1 },
					{ key: "glob:{}", result: { success: true, output: "b" }, timestamp: 2 },
				],
				savedAt: Date.now(),
			};

			vi.mocked(fs.existsSync).mockReturnValue(true);
			vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockCache));
			vi.mocked(fs.statSync).mockReturnValue({ size: 1024 } as fs.Stats);

			const stats = getCacheStats();

			expect(stats.diskSize).toBe(1024);
			expect(stats.diskEntries).toBe(2);
		});
	});
});
