import { z } from "zod";
import type {
	ToolContext,
	ToolDefinition,
	ToolResult,
} from "../agent/tools/registry.js";
import type { OpenRouterTool } from "../api/openrouter.js";
import type { MCPTool } from "./client.js";
import { getToolCache } from "../agent/cache/tool-cache.js";

function stableHash(input: string): string {
	let hash = 5381;
	for (let i = 0; i < input.length; i++) {
		hash = (hash * 33) ^ input.charCodeAt(i);
	}
	return (hash >>> 0).toString(36).padStart(7, "0").slice(0, 7);
}

function safeNamePart(value: string, fallback: string, maxLength: number): string {
	const safe = value
		.replace(/[^a-zA-Z0-9_-]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.slice(0, maxLength);
	return safe || fallback;
}

export function createMCPToolName(serverName: string, toolName: string): string {
	const safeServer = safeNamePart(serverName, "server", 18);
	const safeTool = safeNamePart(toolName, "tool", 28);
	const hash = stableHash(`${serverName}:${toolName}`);
	return `mcp_${safeServer}__${safeTool}__${hash}`;
}

export function normalizeMCPInputSchema(
	schema: Record<string, unknown> | undefined,
): Record<string, unknown> {
	if (!schema || typeof schema !== "object") {
		return { type: "object", properties: {} };
	}

	return {
		...schema,
		type: "object",
		properties:
			typeof schema.properties === "object" && schema.properties !== null
				? schema.properties
				: {},
	};
}

export function convertMCPToolToOpenRouter(
	serverName: string,
	tool: MCPTool,
): OpenRouterTool {
	return {
		type: "function",
		function: {
			name: createMCPToolName(serverName, tool.name),
			description:
				tool.description ?? `MCP tool: ${tool.name} (from ${serverName})`,
			parameters: normalizeMCPInputSchema(tool.inputSchema),
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
	const toolName = createMCPToolName(serverName, tool.name);

	return {
		name: toolName,
		description: tool.description ?? `MCP tool from ${serverName}`,
		parameters: z.object({}).passthrough(),
		jsonSchema: normalizeMCPInputSchema(tool.inputSchema),
		category: "mcp",
		requiresPermission: true,
		execute: async (args: unknown, _ctx: ToolContext): Promise<ToolResult> => {
			const cache = getToolCache();
			const cachedResult = cache.get(toolName, args);
			if (cachedResult) {
				return cachedResult;
			}

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
						let output = "";
						for (let i = 0; i < contentArray.length; i++) {
							if (i > 0) output += "\n";
							const content = contentArray[i] as {
								type?: string;
								text?: string;
								mimeType?: string;
								resource?: { uri?: string };
							};
							if (content.type === "text") output += content.text ?? "";
							else if (content.type === "image")
								output += `[Image: ${content.mimeType}]`;
							else if (content.type === "resource")
								output += `[Resource: ${content.resource?.uri}]`;
							else output += JSON.stringify(contentArray[i]);
						}

						const finalResult = {
							success: true,
							output,
							metadata: { serverName, toolName: tool.name },
						};
						cache.set(toolName, args, finalResult);
						return finalResult;
					}
				}

				const finalResult = {
					success: true,
					output:
						typeof result === "string"
							? result
							: JSON.stringify(result, null, 2),
					metadata: { serverName, toolName: tool.name },
				};
				cache.set(toolName, args, finalResult);
				return finalResult;
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
	if (!isMCPTool(fullName)) return null;

	const parts = fullName.slice("mcp_".length).split("__");
	if (parts.length < 3) return null;
	return {
		serverName: parts[0],
		toolName: parts.slice(1, -1).join("__"),
	};
}

export function isMCPTool(name: string): boolean {
	return name.startsWith("mcp_") && name.includes("__");
}
