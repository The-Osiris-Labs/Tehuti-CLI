import { z } from "zod";
import { spawn } from "node:child_process";
import { createTool, type ToolContext, type ToolResult } from "./registry.js";
import path from "node:path";
import fs from "fs-extra";

// Path to grepai executable - support local and system-wide installations
const getGrepaiPath = (): string => {
	const localPath = path.join(process.cwd(), "tools", "grepai");
	const systemPath = "/usr/local/bin/grepai";
	
	if (fs.existsSync(localPath)) {
		return localPath;
	} else if (fs.existsSync(systemPath)) {
		return systemPath;
	}
	
	throw new Error("grepai executable not found. Install it with: curl -sSL https://raw.githubusercontent.com/yoanbernabeu/grepai/main/install.sh | sh");
};

export const grepaiSearchTool = createTool({
	name: "grepai_search",
	description: "Search codebase semantically using natural language (grep for the AI era). Returns most relevant code chunks with file paths, line numbers, and relevance scores.",
	parameters: z.object({
		query: z.string().describe("Natural language query describing what you're searching for"),
		limit: z.number().int().positive().optional().default(10).describe("Maximum number of results to return"),
		path: z.string().optional().describe("Path prefix to filter search results"),
	}),
	category: "search",
	execute: async (args, ctx: ToolContext): Promise<ToolResult> => {
		const { query, limit = 10, path: searchPath } = args as { query: string; limit?: number; path?: string };
		
		const grepaiPath = getGrepaiPath();
		
		// Check if grepai is initialized
		const grepaiConfigPath = path.join(ctx.cwd, ".grepai");
		if (!fs.existsSync(grepaiConfigPath)) {
			return {
				success: false,
				output: "",
				error: "grepai not initialized. Run 'grepai init' in your project root first.",
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
					resolve({
						success: true,
						output: JSON.stringify(results, null, 2),
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

export const grepaiInitTool = createTool({
	name: "grepai_init",
	description: "Initialize grepai in the current directory. This sets up the semantic index for your codebase.",
	parameters: z.object({
		embedder: z.enum(["ollama", "openai"]).optional().default("ollama").describe("Embedding provider (ollama for local, openai for cloud)"),
		model: z.string().optional().describe("Embedding model to use"),
	}),
	category: "system",
	execute: async (args, ctx: ToolContext): Promise<ToolResult> => {
		const { embedder = "ollama", model } = args as { embedder?: string; model?: string };
		
		const grepaiPath = getGrepaiPath();
		
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
						error: stderr.trim() || `grepai init failed with code ${code}`,
					});
					return;
				}
				
				resolve({
					success: true,
					output: "grepai initialized successfully. Start indexing with 'grepai watch'.",
				});
			});
		});
	},
});

export const grepaiStatusTool = createTool({
	name: "grepai_status",
	description: "Check grepai index status and browse indexed files.",
	parameters: z.object({}),
	category: "system",
	execute: async (_args, ctx: ToolContext): Promise<ToolResult> => {
		const grepaiPath = getGrepaiPath();
		
		return new Promise((resolve) => {
			const grepai = spawn(grepaiPath, ["status"], {
				cwd: ctx.cwd,
				stdio: "pipe",
			});
			
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

export const grepaiTraceTool = createTool({
	name: "grepai_trace",
	description: "Trace symbol callers and callees using grepai's call graph analysis.",
	parameters: z.object({
		symbol: z.string().describe("Function or method name to trace"),
		direction: z.enum(["callers", "callees", "graph"]).optional().default("callers").describe("Trace direction: callers, callees, or full graph"),
	}),
	category: "search",
	execute: async (args, ctx: ToolContext): Promise<ToolResult> => {
		const { symbol, direction = "callers" } = args as { symbol: string; direction?: string };
		
		const grepaiPath = getGrepaiPath();
		
		const commandArgs = ["trace", direction, symbol];
		
		return new Promise((resolve) => {
			const grepai = spawn(grepaiPath, commandArgs, {
				cwd: ctx.cwd,
				stdio: "pipe",
			});
			
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

import { grepaiMcpServeTool, grepaiListWorkspacesTool, grepaiCreateWorkspaceTool, grepaiWatchTool, grepaiUpdateTool } from "./grepai-mcp.js";
import { grepaiSearchWithCacheTool, grepaiClearCacheTool, grepaiCacheStatusTool } from "./grepai-cache.js";

export const grepaiTools = [
	grepaiSearchTool,
	grepaiInitTool,
	grepaiStatusTool,
	grepaiTraceTool,
	grepaiMcpServeTool,
	grepaiListWorkspacesTool,
	grepaiCreateWorkspaceTool,
	grepaiWatchTool,
	grepaiUpdateTool,
	grepaiSearchWithCacheTool,
	grepaiClearCacheTool,
	grepaiCacheStatusTool,
];