import { z } from "zod";
import type {
	ToolContext,
	ToolDefinition,
	ToolResult,
} from "../agent/tools/registry.js";
import type { OpenRouterTool } from "../api/openrouter.js";
import type { MCPTool } from "./client.js";

export function convertMCPToolToOpenRouter(
	serverName: string,
	tool: MCPTool,
): OpenRouterTool {
	// Use colon as delimiter to avoid underscore parsing issues
	return {
		type: "function",
		function: {
			name: `mcp_${serverName}:${tool.name}`,
			description:
				tool.description ?? `MCP tool: ${tool.name} (from ${serverName})`,
			parameters: tool.inputSchema,
		},
	};
}

export function convertMCPToolsToOpenRouter(
	tools: Array<{ serverName: string; tool: MCPTool }>,
): OpenRouterTool[] {
	return tools.map(({ serverName, tool }) =>
		convertMCPToolToOpenRouter(serverName, tool),
	);
}

export function createMCPToolDefinition(
	serverName: string,
	tool: MCPTool,
	executor: (args: unknown) => Promise<unknown>,
): ToolDefinition {
	return {
		name: `mcp_${serverName}:${tool.name}`,
		description: tool.description ?? `MCP tool from ${serverName}`,
		parameters: z.object({}).passthrough(),
		category: "mcp",
		requiresPermission: true,
		execute: async (args: unknown, _ctx: ToolContext): Promise<ToolResult> => {
			try {
				const result = await executor(args);

				// Handle MCP content array
				if (
					typeof result === "object" &&
					result !== null &&
					"content" in result
				) {
					const contentArray = (result as { content: unknown[] }).content;
					if (Array.isArray(contentArray)) {
						const output = contentArray
							.map((c) => {
								const content = c as {
									type?: string;
									text?: string;
									mimeType?: string;
									resource?: { uri?: string };
								};
								if (content.type === "text") return content.text ?? "";
								if (content.type === "image")
									return `[Image: ${content.mimeType}]`;
								if (content.type === "resource")
									return `[Resource: ${content.resource?.uri}]`;
								return JSON.stringify(c);
							})
							.join("\n");

						return {
							success: true,
							output,
							metadata: { serverName, toolName: tool.name },
						};
					}
				}

				return {
					success: true,
					output:
						typeof result === "string"
							? result
							: JSON.stringify(result, null, 2),
					metadata: { serverName, toolName: tool.name },
				};
			} catch (error) {
				return {
					success: false,
					output: "",
					error: error instanceof Error ? error.message : String(error),
				};
			}
		},
	};
}

export function parseMCPToolName(
	fullName: string,
): { serverName: string; toolName: string } | null {
	// Use colon as delimiter: mcp_serverName:toolName
	const match = fullName.match(/^mcp_([^:]+):(.+)$/);
	if (!match) return null;

	return {
		serverName: match[1],
		toolName: match[2],
	};
}

export function isMCPTool(name: string): boolean {
	return name.startsWith("mcp_") && name.includes(":");
}
