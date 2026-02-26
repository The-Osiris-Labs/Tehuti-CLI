import { z } from "zod";
import { createTool, type ToolContext, type ToolResult } from "./registry.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const execFilePromise = promisify(execFile);

export const configureGrepAIMemoryBankTool = createTool({
	name: "configure_grepai_memory_bank",
	description: "Configure GrepAI memory bank for persistent index storage. This allows GrepAI to maintain indexes across sessions.",
	parameters: z.object({
		enabled: z.boolean().describe("Whether to enable memory bank"),
		path: z.string().optional().describe("Path to memory bank storage directory"),
		compression: z.boolean().optional().describe("Whether to compress memory bank"),
	}),
	category: "search",
	execute: async (args, ctx: ToolContext): Promise<ToolResult> => {
		const { enabled, path, compression = true } = args as { 
			enabled: boolean; 
			path?: string; 
			compression?: boolean;
		};
		
		try {
			let memoryPath = path;
			if (!memoryPath) {
				memoryPath = join(ctx.cwd, ".grepai", "memory");
			}
			
			if (!existsSync(memoryPath)) {
				mkdirSync(memoryPath, { recursive: true });
			}
			
			const configPath = join(ctx.cwd, ".grepai", "config.json");
			let config: any = {};
			if (existsSync(configPath)) {
				config = JSON.parse(readFileSync(configPath, "utf8"));
			}
			
			config.memoryBank = {
				enabled,
				path: memoryPath,
				compression,
			};
			
			writeFileSync(configPath, JSON.stringify(config, null, 2));
			
			return {
				success: true,
				output: JSON.stringify({
					message: `GrepAI memory bank ${enabled ? "enabled" : "disabled"}`,
					path: memoryPath,
					compression,
				}),
			};
		} catch (error) {
			return {
				success: false,
				output: "",
				error: `Failed to configure GrepAI memory bank: ${error}`,
			};
		}
	},
});

export const optimizeGrepAIIndexTool = createTool({
	name: "optimize_grepai_index",
	description: "Optimize GrepAI index for better performance and compression.",
	parameters: z.object({
		compact: z.boolean().optional().describe("Whether to compact the index"),
		optimize: z.boolean().optional().describe("Whether to optimize for search speed"),
		cleanup: z.boolean().optional().describe("Whether to clean up unused index files"),
	}),
	category: "search",
	execute: async (args, ctx: ToolContext): Promise<ToolResult> => {
		const { compact = true, optimize = true, cleanup = true } = args as { 
			compact?: boolean; 
			optimize?: boolean; 
			cleanup?: boolean;
		};
		
		try {
			let command = "grepai";
			let argsList = ["optimize"];
			
			if (compact) argsList.push("--compact");
			if (optimize) argsList.push("--optimize");
			if (cleanup) argsList.push("--cleanup");
			
			const { stdout, stderr } = await execFilePromise(command, argsList, {
				cwd: ctx.cwd,
				encoding: "utf8",
				timeout: ctx.timeout,
			});
			
			return {
				success: true,
				output: stdout.trim(),
			};
		} catch (error: any) {
			return {
				success: false,
				output: error.stdout || "",
				error: error.stderr || `Failed to optimize GrepAI index: ${error}`,
			};
		}
	},
});

export const parallelIndexTool = createTool({
	name: "parallel_index",
	description: "Perform parallel indexing for large codebases to speed up the process.",
	parameters: z.object({
		directory: z.string().optional().describe("Directory to index (default: current)"),
		maxWorkers: z.number().int().positive().optional().describe("Maximum number of parallel workers"),
		force: z.boolean().optional().describe("Force re-indexing even if already indexed"),
	}),
	category: "search",
	execute: async (args, ctx: ToolContext): Promise<ToolResult> => {
		const { directory = ctx.cwd, maxWorkers = 4, force = false } = args as { 
			directory?: string; 
			maxWorkers?: number; 
			force?: boolean;
		};
		
		try {
			let command = "grepai";
			let argsList = ["index", directory];
			
			argsList.push("--workers", maxWorkers.toString());
			if (force) argsList.push("--force");
			
			const { stdout, stderr } = await execFilePromise(command, argsList, {
				cwd: ctx.cwd,
				encoding: "utf8",
				timeout: ctx.timeout,
			});
			
			return {
				success: true,
				output: stdout.trim(),
			};
		} catch (error: any) {
			return {
				success: false,
				output: error.stdout || "",
				error: error.stderr || `Failed to perform parallel indexing: ${error}`,
			};
		}
	},
});

export const exportGrepAIIndexTool = createTool({
	name: "export_grepai_index",
	description: "Export GrepAI index to a file for sharing or backup.",
	parameters: z.object({
		outputPath: z.string().describe("Path to export the index file"),
		compress: z.boolean().optional().describe("Whether to compress the exported index"),
	}),
	category: "search",
	execute: async (args, ctx: ToolContext): Promise<ToolResult> => {
		const { outputPath, compress = true } = args as { 
			outputPath: string; 
			compress?: boolean;
		};
		
		try {
			let command = "grepai";
			let argsList = ["export", outputPath];
			
			if (compress) argsList.push("--compress");
			
			const { stdout, stderr } = await execFilePromise(command, argsList, {
				cwd: ctx.cwd,
				encoding: "utf8",
				timeout: ctx.timeout,
			});
			
			return {
				success: true,
				output: stdout.trim(),
			};
		} catch (error: any) {
			return {
				success: false,
				output: error.stdout || "",
				error: error.stderr || `Failed to export GrepAI index: ${error}`,
			};
		}
	},
});

export const importGrepAIIndexTool = createTool({
	name: "import_grepai_index",
	description: "Import GrepAI index from a file for sharing or restore.",
	parameters: z.object({
		inputPath: z.string().describe("Path to the index file to import"),
		force: z.boolean().optional().describe("Force import even if index already exists"),
	}),
	category: "search",
	execute: async (args, ctx: ToolContext): Promise<ToolResult> => {
		const { inputPath, force = false } = args as { 
			inputPath: string; 
			force?: boolean;
		};
		
		try {
			let command = "grepai";
			let argsList = ["import", inputPath];
			
			if (force) argsList.push("--force");
			
			const { stdout, stderr } = await execFilePromise(command, argsList, {
				cwd: ctx.cwd,
				encoding: "utf8",
				timeout: ctx.timeout,
			});
			
			return {
				success: true,
				output: stdout.trim(),
			};
		} catch (error: any) {
			return {
				success: false,
				output: error.stdout || "",
				error: error.stderr || `Failed to import GrepAI index: ${error}`,
			};
		}
	},
});

export const grepaiAdvancedTools = [
	configureGrepAIMemoryBankTool,
	optimizeGrepAIIndexTool,
	parallelIndexTool,
	exportGrepAIIndexTool,
	importGrepAIIndexTool,
];
