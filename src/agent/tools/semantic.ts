import { spawn } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import fs from "fs-extra";
import { z } from "zod";
import { resolvePath, validatePathSecurity } from "./fs.js";
import { createTool, type ToolContext, type ToolResult } from "./registry.js";

// Cache directory for grepai search results
const GREPAI_CACHE_DIR = path.join(process.cwd(), ".tehuti", "grepai-cache");

// Ensure cache directory exists
async function ensureCacheDirectory(): Promise<void> {
	if (!(await fs.pathExists(GREPAI_CACHE_DIR))) {
		await fs.ensureDir(GREPAI_CACHE_DIR);
	}
}

// Generate cache key from query and options
function generateCacheKey(
	query: string,
	options?: { limit?: number; path?: string },
): string {
	const hash = crypto.createHash("sha256");
	hash.update(query);
	if (options?.limit) hash.update(`limit:${options.limit}`);
	if (options?.path) hash.update(`path:${options.path}`);
	return hash.digest("hex").slice(0, 16);
}

// Cache entry interface
interface CacheEntry {
	query: string;
	options?: { limit?: number; path?: string };
	results: any;
	timestamp: number;
	ttl: number;
}

// Default TTL: 1 hour (3600 seconds)
const DEFAULT_TTL = 3600000;

// Track background processes to prevent zombie leaks
const spawnedProcesses = new Set<any>();

export function trackProcess(proc: any) {
	spawnedProcesses.add(proc);
	proc.on("exit", () => {
		spawnedProcesses.delete(proc);
	});
}

// Register exit and termination listeners
function cleanupProcesses() {
	for (const proc of spawnedProcesses) {
		try {
			proc.kill("SIGKILL");
		} catch (_e) {
			// Ignore
		}
	}
	spawnedProcesses.clear();
}

process.on("exit", cleanupProcesses);
process.on("SIGINT", () => {
	cleanupProcesses();
	process.exit(130);
});
process.on("SIGTERM", () => {
	cleanupProcesses();
	process.exit(143);
});

// Path to grepai executable - support local and system-wide installations
const getGrepaiPath = async (cwd: string): Promise<string> => {
	const localPath = path.resolve(cwd, "tools", "grepai");
	const systemPath = "/usr/local/bin/grepai";

	if (await fs.pathExists(localPath)) {
		return localPath;
	}

	try {
		const { execSync } = await import("node:child_process");
		const pathOutput = execSync("which grepai", { encoding: "utf8" }).trim();
		if (pathOutput) return pathOutput;
	} catch (_err) {
		// Ignore check failure
	}

	if (await fs.pathExists(systemPath)) {
		return systemPath;
	}

	throw new Error(
		"grepai executable not found. Install it with: curl -sSL https://raw.githubusercontent.com/yoanbernabeu/grepai/main/install.sh | sh",
	);
};

export const semanticSearchTool = createTool({
	name: "semantic",
	description:
		"Search codebase semantically using natural language (grep for the AI era). Returns most relevant code chunks with file paths, line numbers, and relevance scores. Results are cached and filtered for security.",
	parameters: z.object({
		query: z
			.string()
			.describe("Natural language query describing what you're searching for"),
		limit: z
			.number()
			.int()
			.positive()
			.optional()
			.default(10)
			.describe("Maximum number of results to return"),
		path: z
			.string()
			.optional()
			.describe("Path prefix to filter search results"),
		ttl: z
			.number()
			.int()
			.positive()
			.optional()
			.default(DEFAULT_TTL)
			.describe("Time to live for cache entry in milliseconds"),
		bypass_cache: z
			.boolean()
			.optional()
			.default(false)
			.describe("If true, bypass cache and perform a fresh search"),
	}),
	category: "search",
	execute: async (args, ctx: ToolContext): Promise<ToolResult> => {
		const {
			query,
			limit = 10,
			path: searchPath,
			ttl = DEFAULT_TTL,
			bypass_cache = false,
		} = args as {
			query: string;
			limit?: number;
			path?: string;
			ttl?: number;
			bypass_cache?: boolean;
		};

		// Path traversal checks for query path prefix
		if (searchPath) {
			const resolvedSearchPath = resolvePath(searchPath, ctx.cwd);
			const security = validatePathSecurity(resolvedSearchPath, ctx.cwd);
			if (!security.safe) {
				return {
					success: false,
					output: "",
					error: security.reason || "Security restriction: path is invalid.",
				};
			}
		}

		await ensureCacheDirectory();
		const cacheKey = generateCacheKey(query, { limit, path: searchPath });
		const cachePath = path.join(GREPAI_CACHE_DIR, `${cacheKey}.json`);

		// Check cache
		if (!bypass_cache && (await fs.pathExists(cachePath))) {
			try {
				const cacheData = JSON.parse(
					await fs.readFile(cachePath, "utf8"),
				) as CacheEntry;
				const now = Date.now();
				if (now - cacheData.timestamp < ttl) {
					return {
						success: true,
						output: JSON.stringify(cacheData.results, null, 2),
						metadata: { cached: true, cacheKey },
					};
				}
			} catch (_err) {
				// Silently fallback to fresh search
			}
		}

		const grepaiPath = await getGrepaiPath(ctx.cwd);

		// Check if grepai is initialized
		const grepaiConfigPath = path.join(ctx.cwd, ".grepai");
		if (!(await fs.pathExists(grepaiConfigPath))) {
			return {
				success: false,
				output: "",
				error:
					"grepai not initialized. Run 'grepai init' in your project root first.",
			};
		}

		// Build search command
		const commandArgs = ["search", query, "--json", `--limit=${limit}`];
		if (searchPath) {
			commandArgs.push(`--path=${searchPath}`);
		}

		return new Promise((resolve) => {
			const grepai = spawn(grepaiPath, commandArgs, {
				cwd: ctx.cwd,
				stdio: "pipe",
			});

			trackProcess(grepai);

			let stdout = "";
			let stderr = "";

			grepai.stdout.on("data", (data: Buffer) => {
				stdout += data.toString("utf-8");
			});

			grepai.stderr.on("data", (data: Buffer) => {
				stderr += data.toString("utf-8");
			});

			grepai.on("close", (code: number) => {
				if (code !== 0) {
					resolve({
						success: false,
						output: "",
						error: stderr.trim() || `grepai search failed with code ${code}`,
					});
					return;
				}

				try {
					const results = JSON.parse(stdout);

					// Apply directory traversal security checks and sensitive path exclusions to each result
					const filteredResults = Array.isArray(results)
						? results.filter((item: any) => {
								if (!item.path) return true;
								const resolvedItemPath = resolvePath(item.path, ctx.cwd);
								const sec = validatePathSecurity(resolvedItemPath, ctx.cwd);
								return sec.safe;
							})
						: results;

					// Cache the clean results
					const cacheEntry: CacheEntry = {
						query,
						options: { limit, path: searchPath },
						results: filteredResults,
						timestamp: Date.now(),
						ttl,
					};
					fs.writeFile(cachePath, JSON.stringify(cacheEntry))
						.then(() => {
							resolve({
								success: true,
								output: JSON.stringify(filteredResults, null, 2),
								metadata: { cached: false, cacheKey },
							});
						})
						.catch(() => {
							resolve({
								success: true,
								output: JSON.stringify(filteredResults, null, 2),
								metadata: { cached: false, cacheKey },
							});
						});
				} catch (parseError) {
					resolve({
						success: false,
						output: "",
						error: `Failed to parse grepai output: ${parseError}`,
					});
				}
			});
		});
	},
});

export const semanticInitTool = createTool({
	name: "semantic_init",
	description:
		"Initialize grepai in the current directory. This sets up the semantic index for your codebase.",
	parameters: z.object({
		embedder: z
			.enum(["ollama", "openai"])
			.optional()
			.default("ollama")
			.describe("Embedding provider (ollama for local, openai for cloud)"),
		model: z.string().optional().describe("Embedding model to use"),
	}),
	category: "system",
	execute: async (args, ctx: ToolContext): Promise<ToolResult> => {
		const { embedder = "ollama", model } = args as {
			embedder?: string;
			model?: string;
		};

		const grepaiPath = await getGrepaiPath(ctx.cwd);

		const commandArgs = ["init"];
		if (model) {
			commandArgs.push(`--embedder=${embedder}`);
			commandArgs.push(`--model=${model}`);
		}

		return new Promise((resolve) => {
			const grepai = spawn(grepaiPath, commandArgs, {
				cwd: ctx.cwd,
				stdio: "pipe",
			});

			trackProcess(grepai);

			let _stdout = "";
			let stderr = "";

			grepai.stdout.on("data", (data: Buffer) => {
				_stdout += data.toString("utf-8");
			});

			grepai.stderr.on("data", (data: Buffer) => {
				stderr += data.toString("utf-8");
			});

			grepai.on("close", (code: number) => {
				if (code !== 0) {
					resolve({
						success: false,
						output: "",
						error: stderr.trim() || `grepai init failed with code ${code}`,
					});
					return;
				}

				resolve({
					success: true,
					output:
						"grepai initialized successfully. Start indexing with 'grepai watch'.",
				});
			});
		});
	},
});

export const semanticStatusTool = createTool({
	name: "semantic_status",
	description: "Check grepai index status and browse indexed files.",
	parameters: z.object({}),
	category: "system",
	execute: async (_args, ctx: ToolContext): Promise<ToolResult> => {
		const grepaiPath = await getGrepaiPath(ctx.cwd);

		return new Promise((resolve) => {
			const grepai = spawn(grepaiPath, ["status"], {
				cwd: ctx.cwd,
				stdio: "pipe",
			});

			trackProcess(grepai);

			let stdout = "";
			let stderr = "";

			grepai.stdout.on("data", (data: Buffer) => {
				stdout += data.toString("utf-8");
			});

			grepai.stderr.on("data", (data: Buffer) => {
				stderr += data.toString("utf-8");
			});

			grepai.on("close", (code: number) => {
				if (code !== 0) {
					resolve({
						success: false,
						output: "",
						error: stderr.trim() || `grepai status failed with code ${code}`,
					});
					return;
				}

				resolve({
					success: true,
					output: stdout.trim(),
				});
			});
		});
	},
});

export const semanticTraceTool = createTool({
	name: "semantic_trace",
	description:
		"Trace symbol callers and callees using grepai's call graph analysis.",
	parameters: z.object({
		symbol: z.string().describe("Function or method name to trace"),
		direction: z
			.enum(["callers", "callees", "graph"])
			.optional()
			.default("callers")
			.describe("Trace direction: callers, callees, or full graph"),
	}),
	category: "search",
	execute: async (args, ctx: ToolContext): Promise<ToolResult> => {
		const { symbol, direction = "callers" } = args as {
			symbol: string;
			direction?: string;
		};

		const grepaiPath = await getGrepaiPath(ctx.cwd);
		const commandArgs = ["trace", direction, symbol];

		return new Promise((resolve) => {
			const grepai = spawn(grepaiPath, commandArgs, {
				cwd: ctx.cwd,
				stdio: "pipe",
			});

			trackProcess(grepai);

			let stdout = "";
			let stderr = "";

			grepai.stdout.on("data", (data: Buffer) => {
				stdout += data.toString("utf-8");
			});

			grepai.stderr.on("data", (data: Buffer) => {
				stderr += data.toString("utf-8");
			});

			grepai.on("close", (code: number) => {
				if (code !== 0) {
					resolve({
						success: false,
						output: "",
						error: stderr.trim() || `grepai trace failed with code ${code}`,
					});
					return;
				}

				resolve({
					success: true,
					output: stdout.trim(),
				});
			});
		});
	},
});

// Helper for testing/clearing cache manually in test files
export async function clearSemanticCache() {
	if (await fs.pathExists(GREPAI_CACHE_DIR)) {
		await fs.remove(GREPAI_CACHE_DIR);
	}
}

export const semanticTools = [
	semanticSearchTool,
	semanticInitTool,
	semanticStatusTool,
	semanticTraceTool,
];
