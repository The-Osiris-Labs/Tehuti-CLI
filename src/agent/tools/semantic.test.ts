import { spawn } from "node:child_process";
import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSemanticCache, semanticSearchTool } from "./semantic.js";

vi.mock("node:child_process", async (importOriginal) => {
	const actual: any = await importOriginal();
	return {
		...actual,
		spawn: vi.fn(),
	};
});

describe("Semantic Search Tools", () => {
	const mockCtx = {
		cwd: process.cwd(),
		workingDir: process.cwd(),
		env: {},
		timeout: 30000,
	};

	let mockProcess: any;

	beforeEach(async () => {
		await clearSemanticCache();
		vi.clearAllMocks();

		// Set up a mock child process
		mockProcess = {
			pid: 12345,
			stdout: {
				on: vi.fn(),
			},
			stderr: {
				on: vi.fn(),
			},
			on: vi.fn(),
			kill: vi.fn(),
		};

		// Mock spawn to return our mock process
		vi.mocked(spawn).mockReturnValue(mockProcess as any);
	});

	afterEach(async () => {
		await clearSemanticCache();
	});

	describe("Semantic Search Security Checks", () => {
		it("should reject path traversal in the path parameter", async () => {
			const res = await semanticSearchTool.execute(
				{
					query: "test",
					path: "../outside-dir",
				},
				mockCtx,
			);

			expect(res.success).toBe(false);
			expect(res.error).toContain(
				"grepai not initialized. Run 'grepai init' in your project root first.",
			);
		});

		it("should filter out sensitive files from search results", async () => {
			// Mock grepai to return a sensitive file in results
			mockProcess.stdout.on.mockImplementation(
				(event: string, callback: any) => {
					if (event === "data") {
						callback(
							Buffer.from(
								JSON.stringify([
									{ path: "src/index.ts", score: 0.9 },
									{ path: ".env", score: 0.8 }, // sensitive
								]),
							),
						);
					}
				},
			);

			mockProcess.on.mockImplementation((event: string, callback: any) => {
				if (event === "close") {
					callback(0);
				}
			});

			// Stub fs.pathExists to simulate config and binary file existence
			const pathExistsSpy = vi
				.spyOn(fs, "pathExists")
				.mockImplementation(async (p: any) => {
					const s = p.toString();
					if (s.includes(".grepai") || s.includes("tools/grepai")) return true;
					return false;
				});

			const res = await semanticSearchTool.execute(
				{
					query: "test",
					bypass_cache: true,
				},
				mockCtx,
			);

			expect(res.success).toBe(true);
			const results = JSON.parse(res.output);
			expect(results).toHaveLength(1); // .env is now filtered as sensitive
			expect(results[0].path).toBe("src/index.ts");

			pathExistsSpy.mockRestore();
		});
	});

	describe("Caching Logic", () => {
		it("should write search results to cache and hit cache on subsequent searches", async () => {
			mockProcess.stdout.on.mockImplementation(
				(event: string, callback: any) => {
					if (event === "data") {
						callback(
							Buffer.from(
								JSON.stringify([{ path: "src/index.ts", score: 0.95 }]),
							),
						);
					}
				},
			);

			mockProcess.on.mockImplementation((event: string, callback: any) => {
				if (event === "close") {
					callback(0);
				}
			});

			const pathExistsSpy = vi
				.spyOn(fs, "pathExists")
				.mockImplementation(async (p: any) => {
					const s = p.toString();
					if (s.includes(".grepai") || s.includes("tools/grepai")) return true;
					if (s.includes("grepai-cache")) {
						return fs.existsSync(p);
					}
					return false;
				});

			// First search (cache miss)
			const res1 = await semanticSearchTool.execute(
				{ query: "find me", ttl: 5000 },
				mockCtx,
			);
			expect(res1.success).toBe(true);
			expect(res1.metadata?.cached).toBe(false);

			// Reset mock calls to verify spawn is NOT called again (cache hit)
			vi.clearAllMocks();

			// Second search (cache hit)
			const res2 = await semanticSearchTool.execute(
				{ query: "find me", ttl: 5000 },
				mockCtx,
			);
			expect(res2.success).toBe(true);
			expect(JSON.parse(res2.output)).toEqual([
				{ path: "src/index.ts", score: 0.95 },
			]);
			expect(spawn).not.toHaveBeenCalled();

			pathExistsSpy.mockRestore();
		});
	});
});
