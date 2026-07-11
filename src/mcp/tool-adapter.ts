import crypto from "node:crypto";
import { z } from "zod";
import { getToolCache } from "../agent/cache/tool-cache.js";
import type {
	ToolContext,
	ToolDefinition,
	ToolResult,
} from "../agent/tools/registry.js";
import type { StandardTool } from "../api/base-client.js";
import type { MCPTool } from "./client.js";

function safeNamePart(
	value: string,
	fallback: string,
	maxLength: number,
	hashInput?: string,
	isServer?: boolean,
): string {
	let safe = value.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");

	if (isServer) {
		safe = safe.replace(/_/g, "-");
	}

	if (hashInput && (value !== safe || safe.length > maxLength)) {
		const hash = crypto
			.createHash("md5")
			.update(hashInput)
			.digest("hex")
			.slice(0, 4);
		const availableLength = Math.max(1, maxLength - 5);
		safe = `${safe.slice(0, availableLength)}${isServer ? "-" : "_"}${hash}`;
	} else if (safe.length > maxLength) {
		safe = safe.slice(0, maxLength);
	}

	return safe || fallback;
}

export function createMCPToolName(
	serverName: string,
	toolName: string,
): string {
	const safeServer = safeNamePart(serverName, "server", 15, serverName, true);
	const safeTool = safeNamePart(toolName, "tool", 43, toolName, false);
	return `mcp_${safeServer}_${safeTool}`;
}

export function deepNormalizeSchema(schema: any, depth = 0): any {
	if (depth > 10) return { type: "string", description: "Schema depth limit exceeded" };
	if (!schema || typeof schema !== "object") return schema;

	if (Array.isArray(schema)) {
		return schema.map((s) => deepNormalizeSchema(s, depth + 1));
	}

	const normalized: any = { ...schema };

	const validTypes = [
		"string",
		"number",
		"integer",
		"boolean",
		"object",
		"array",
		"null",
	];

	if (normalized.type !== undefined) {
		if (
			typeof normalized.type !== "string" ||
			!validTypes.includes(normalized.type)
		) {
			normalized.type = "string";
		}
	} else {
		if (normalized.properties) {
			normalized.type = "object";
		} else if (normalized.items) {
			normalized.type = "array";
		} else {
			normalized.type = "string";
		}
	}

	if (normalized.properties && typeof normalized.properties === "object") {
		const newProps: any = {};
		for (const [k, v] of Object.entries(normalized.properties)) {
			let safeKey = k.replace(/[^a-zA-Z0-9_-]/g, "_");
			if (safeKey.length > 64) safeKey = safeKey.slice(0, 64);
			if (safeKey.length === 0) safeKey = "param";
			newProps[safeKey] = deepNormalizeSchema(v, depth + 1);
		}
		normalized.properties = newProps;
	} else if (normalized.type === "object") {
		normalized.properties = {};
	}

	if (normalized.items) {
		if (typeof normalized.items === "object") {
			normalized.items = deepNormalizeSchema(normalized.items, depth + 1);
		} else {
			delete normalized.items;
		}
	}

	if (normalized.required !== undefined) {
		if (Array.isArray(normalized.required)) {
			normalized.required = normalized.required
				.filter((r: any) => typeof r === "string")
				.map((r: string) => {
					let safe = r.replace(/[^a-zA-Z0-9_-]/g, "_");
					if (safe.length > 64) safe = safe.slice(0, 64);
					return safe.length === 0 ? "param" : safe;
				});
		} else {
			delete normalized.required;
		}
	}

	if (normalized.description !== undefined) {
		if (typeof normalized.description !== "string") {
			normalized.description = String(normalized.description);
		}
		if (normalized.description.length > 2000) {
			normalized.description = normalized.description.slice(0, 2000) + "...";
		}
	}

	return normalized;
}

export function normalizeMCPInputSchema(
	schema: Record<string, unknown> | undefined,
): Record<string, unknown> {
	if (!schema || typeof schema !== "object") {
		return { type: "object", properties: {} };
	}
	const normalized = deepNormalizeSchema(schema);
	return {
		...normalized,
		type: "object",
		properties:
			typeof normalized.properties === "object" && normalized.properties !== null
				? normalized.properties
				: {},
	};
}

export function jsonSchemaToZod(schema: any): z.ZodTypeAny {
	if (!schema || typeof schema !== "object") return z.any();
	switch (schema.type) {
		case "string":
			return z.string();
		case "number":
			return z.number();
		case "integer":
			return z.number().int();
		case "boolean":
			return z.boolean();
		case "array":
			return z.array(jsonSchemaToZod(schema.items));
		case "object": {
			const shape: Record<string, z.ZodTypeAny> = {};
			if (schema.properties) {
				for (const [key, val] of Object.entries(schema.properties)) {
					let field = jsonSchemaToZod(val);
					if (!schema.required?.includes(key)) {
						field = field.optional();
					}
					shape[key] = field;
				}
			}
			return z.object(shape).passthrough();
		}
		default:
			return z.any();
	}
}

export function convertMCPToolToOpenRouter(
	serverName: string,
	tool: MCPTool,
): StandardTool {
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
): StandardTool[] {
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

	const jsonSchema = normalizeMCPInputSchema(tool.inputSchema);
	return {
		name: toolName,
		description: tool.description ?? `MCP tool from ${serverName}`,
		parameters: jsonSchemaToZod(jsonSchema),
		jsonSchema: jsonSchema,
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
					const callResult = result as {
						content: unknown[];
						isError?: boolean;
					};
					const contentArray = callResult.content;
					const isError = !!callResult.isError;
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
							success: !isError,
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

	const rest = fullName.slice(4); // Remove "mcp_"
	const underscoreIdx = rest.indexOf("_");
	if (underscoreIdx === -1) return null;

	return {
		serverName: rest.slice(0, underscoreIdx),
		toolName: rest.slice(underscoreIdx + 1),
	};
}

export function isMCPTool(name: string): boolean {
	return name.startsWith("mcp_") && name.indexOf("_", 4) !== -1;
}
