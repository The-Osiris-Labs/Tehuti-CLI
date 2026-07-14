/**
 * MCP (Model Context Protocol) tool registration and synchronization.
 *
 * Extracted from `agent/index.ts` to reduce module responsibilities.
 * Handles dynamic MCP tool registration, plugin tool registration,
 * and the mcp_pipeline tool definition.
 */
import { mcpManager } from "../mcp/client.js";
import { getPluginRegistry } from "../plugins/index.js";
import { createMCPToolDefinition } from "../mcp/tool-adapter.js";
import { debug } from "../utils/debug.js";
import {
	registerTool,
	registerTools,
	unregisterToolsWhere,
	type ToolDefinition,
} from "./tools/index.js";
import { z } from "zod";
import { executeMCPPipeline } from "./loop/tool-processing.js";

export const mcpPipelineTool: ToolDefinition = {
	name: "mcp_pipeline",
	description:
		"Execute a sequence of MCP tool calls as a pipeline, mapping outputs from one step to the next",
	parameters: z.object({
		steps: z.array(
			z.object({
				tool: z.string(),
				args: z.record(z.unknown()),
				mapping: z.record(z.string()).optional(),
			}),
		),
	}),
	category: "mcp",
	requiresPermission: true,
	execute: async (args, ctx) => {
		return executeMCPPipeline(args, ctx.agentContext ?? ctx, {}, ctx.signal);
	},
};

export function syncMCPToolRegistry(): void {
	try {
		unregisterToolsWhere(
			(tool) =>
				tool.category === "mcp" &&
				tool.name.startsWith("mcp_") &&
				tool.name !== "mcp_get_prompt" &&
				tool.name !== "mcp_list_prompts",
		);

		const dynamicTools = mcpManager
			.getAllTools()
			.map(({ serverName, tool }) =>
				createMCPToolDefinition(serverName, tool, async (args) =>
					mcpManager.executeTool(
						serverName,
						tool.name,
						(args && typeof args === "object" ? args : {}) as Record<
							string,
							unknown
						>,
						120000,
					),
				),
			);

		if (dynamicTools.length > 0) {
			registerTools(dynamicTools);
			debug.log("mcp", `Registered ${dynamicTools.length} dynamic MCP tools`);
		}

		// Register plugin-contributed tools
		const pluginRegistry = getPluginRegistry();
		if (pluginRegistry) {
			const pluginTools = pluginRegistry.getAllTools();
			// Remove previously registered plugin tools to avoid stale entries
			unregisterToolsWhere((tool) => tool.category === "plugin");
			for (const tool of pluginTools) {
				registerTool({
					name: `plugin_${tool.name}`,
					description: tool.description,
					parameters: tool.parameters,
					category: "plugin",
					isReadonly: true,
					execute: async (args) => {
						const result = await pluginRegistry.callTool(tool.name, args);
						return {
							success: result.success,
							output: result.output ?? "",
							error: result.error,
							...(result.metadata ? { metadata: result.metadata } : {}),
						};
					},
				});
			}
			if (pluginTools.length > 0) {
				debug.log("plugins", `Registered ${pluginTools.length} plugin tools`);
			}
		}
	} catch (error) {
		debug.log(
			"mcp",
			`Failed to sync MCP tool registry: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
}

/**
 * Initialize MCP tool synchronization.
 * Wires the tool refresh callback so that mid-session ToolListChangedNotification
 * triggers a lightweight re-registration of the changed server's tools.
 */
export function initMCPTools(): void {
	mcpManager.onToolRefresh(syncMCPToolRegistry);
	syncMCPToolRegistry();
}
