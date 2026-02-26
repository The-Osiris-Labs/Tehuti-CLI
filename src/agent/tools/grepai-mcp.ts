import { z } from "zod";
import { createTool, type ToolContext, type ToolResult } from "./registry.js";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "fs-extra";
import { grepaiSearchTool, grepaiInitTool, grepaiStatusTool, grepaiTraceTool } from "./grepai.js";

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

export const grepaiMcpServeTool = createTool({
	name: "grepai_mcp_serve",
	description: "Start grepai as an MCP (Model Context Protocol) server. This allows other MCP clients to connect and use grepai's semantic search capabilities.",
	parameters: z.object({
		workspace: z.string().optional().describe("Workspace name for multi-project search"),
		port: z.number().int().positive().optional().describe("Port to listen on"),
	}),
	category: "system",
	execute: async (args, ctx: ToolContext): Promise<ToolResult> => {
		const { workspace, port } = args as { workspace?: string; port?: number };
		
		const grepaiPath = getGrepaiPath();
		
		const commandArgs = ["mcp-serve"];
		if (workspace) {
			commandArgs.push(`--workspace=${workspace}`);
		}
		if (port) {
			commandArgs.push(`--port=${port}`);
		}
		
		// Start grepai MCP server in background
		const grepai = spawn(grepaiPath, commandArgs, {
			cwd: ctx.cwd,
			stdio: "pipe",
			detached: true,
			shell: false,
		});
		
		let stdout = "";
		let stderr = "";
		
		grepai.stdout.on("data", (data: Buffer) => {
			stdout += data.toString("utf-8");
		});
		
		grepai.stderr.on("data", (data: Buffer) => {
			stderr += data.toString("utf-8");
		});
		
		// Wait for server to start
		await new Promise(resolve => setTimeout(resolve, 2000));
		
		// Check if server is still running
		if (grepai.pid) {
			try {
				// Send null signal to check if process is running
				process.kill(grepai.pid, 0);
				return {
					success: true,
					output: JSON.stringify({
						message: "grepai MCP server started successfully",
						pid: grepai.pid,
						port,
						workspace,
					}),
				};
			} catch (error) {
				return {
					success: false,
					output: "",
					error: stderr || "Server failed to start",
				};
			}
		} else {
			return {
				success: false,
				output: "",
				error: stderr || "Failed to start grepai MCP server",
			};
		}
	},
});

export const grepaiListWorkspacesTool = createTool({
	name: "grepai_list_workspaces",
	description: "List all available grepai workspaces. Use this to manage multi-project semantic indexes.",
	parameters: z.object({}),
	category: "search",
	execute: async (_args, ctx: ToolContext): Promise<ToolResult> => {
		const grepaiPath = getGrepaiPath();
		
		return new Promise((resolve) => {
			const grepai = spawn(grepaiPath, ["workspace", "list"], {
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
						error: stderr.trim() || `grepai workspace list failed with code ${code}`,
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

export const grepaiCreateWorkspaceTool = createTool({
	name: "grepai_create_workspace",
	description: "Create a new grepai workspace for multi-project semantic search.",
	parameters: z.object({
		name: z.string().describe("Workspace name"),
		projectPaths: z.array(z.string()).optional().describe("List of project paths to include in the workspace"),
	}),
	category: "system",
	execute: async (args, ctx: ToolContext): Promise<ToolResult> => {
		const { name, projectPaths = [] } = args as { name: string; projectPaths?: string[] };
		
		const grepaiPath = getGrepaiPath();
		
		const commandArgs = ["workspace", "create", name];
		for (const projectPath of projectPaths) {
			commandArgs.push("--project", projectPath);
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
						error: stderr.trim() || `grepai workspace create failed with code ${code}`,
					});
					return;
				}
				
				resolve({
					success: true,
					output: `Workspace '${name}' created successfully.${projectPaths.length > 0 ? ` Added ${projectPaths.length} project(s).` : ''}`,
				});
			});
		});
	},
});

export const grepaiWatchTool = createTool({
	name: "grepai_watch",
	description: "Start the grepai watch daemon to keep the semantic index up-to-date with file changes.",
	parameters: z.object({
		workspace: z.string().optional().describe("Workspace name to watch"),
	}),
	category: "system",
	execute: async (args, ctx: ToolContext): Promise<ToolResult> => {
		const { workspace } = args as { workspace?: string };
		
		const grepaiPath = getGrepaiPath();
		
		const commandArgs = ["watch"];
		if (workspace) {
			commandArgs.push(`--workspace=${workspace}`);
		}
		
		// Start watch process in background
		const grepai = spawn(grepaiPath, commandArgs, {
			cwd: ctx.cwd,
			stdio: "pipe",
			detached: true,
			shell: false,
		});
		
		let stdout = "";
		let stderr = "";
		
		grepai.stdout.on("data", (data: Buffer) => {
			stdout += data.toString("utf-8");
		});
		
		grepai.stderr.on("data", (data: Buffer) => {
			stderr += data.toString("utf-8");
		});
		
		// Give it time to start
		await new Promise(resolve => setTimeout(resolve, 1000));
		
		if (grepai.pid) {
			return {
				success: true,
				output: JSON.stringify({
					message: "grepai watch daemon started successfully",
					pid: grepai.pid,
					workspace,
				}),
			};
		} else {
			return {
				success: false,
				output: "",
				error: stderr || "Failed to start grepai watch daemon",
			};
		}
	},
});

export const grepaiUpdateTool = createTool({
	name: "grepai_update",
	description: "Update grepai to the latest version.",
	parameters: z.object({
		force: z.boolean().optional().default(false).describe("Force update even if latest version is already installed"),
	}),
	category: "system",
	execute: async (args, ctx: ToolContext): Promise<ToolResult> => {
		const { force = false } = args as { force?: boolean };
		
		const grepaiPath = getGrepaiPath();
		
		const commandArgs = ["update"];
		if (force) {
			commandArgs.push("--force");
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
						error: stderr.trim() || `grepai update failed with code ${code}`,
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

