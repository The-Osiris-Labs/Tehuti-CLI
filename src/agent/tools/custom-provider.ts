import { z } from "zod";
import { createTool, type ToolContext, type ToolResult } from "./registry.js";
import { CustomProviderClient } from "../../api/custom-provider.js";
import type { AgentContext } from "../context.js";

export const configureCustomProviderTool = createTool({
	name: "configure_custom_provider",
	description: "Configure custom AI provider settings. This allows using any OpenAI-compatible API as a custom provider.",
	parameters: z.object({
		name: z.string().describe("Name of the custom provider"),
		baseUrl: z.string().describe("API endpoint base URL"),
		apiKey: z.string().optional().describe("API key for the custom provider"),
		headers: z.record(z.string()).optional().describe("Additional headers to send with requests"),
	}),
	category: "system",
	execute: async (args, ctx: ToolContext): Promise<ToolResult> => {
		const { name, baseUrl, apiKey, headers = {} } = args as { 
			name: string; 
			baseUrl: string; 
			apiKey?: string; 
			headers?: Record<string, string>;
		};
		
		const agentCtx = ctx as unknown as AgentContext;
		
		try {
			agentCtx.config.provider = "custom";
			agentCtx.config.customProvider = {
				name,
				baseUrl,
				apiKey,
				headers,
			};
			
			// Reset the client instance to use new configuration
			CustomProviderClient.resetInstance();
			
			return {
				success: true,
				output: JSON.stringify({
					message: `Custom provider "${name}" configured`,
					baseUrl,
					headers: Object.keys(headers),
				}),
			};
		} catch (error) {
			return {
				success: false,
				output: "",
				error: `Failed to configure custom provider: ${error}`,
			};
		}
	},
});

export const setCustomHeaderTool = createTool({
	name: "set_custom_header",
	description: "Set a custom HTTP header for the configured custom provider.",
	parameters: z.object({
		key: z.string().describe("Header name"),
		value: z.string().describe("Header value"),
	}),
	category: "system",
	execute: async (args, ctx: ToolContext): Promise<ToolResult> => {
		const { key, value } = args as { key: string; value: string };
		
		const agentCtx = ctx as unknown as AgentContext;
		
		try {
			if (agentCtx.config.provider !== "custom") {
				return {
					success: false,
					output: "",
					error: "This command is only available with custom provider",
				};
			}
			
			if (!agentCtx.config.customProvider) {
				return {
					success: false,
					output: "",
					error: "Custom provider not configured. Please configure first.",
				};
			}
			
			if (!agentCtx.config.customProvider.headers) {
				agentCtx.config.customProvider.headers = {};
			}
			
			agentCtx.config.customProvider.headers[key] = value;
			
			CustomProviderClient.resetInstance();
			
			return {
				success: true,
				output: JSON.stringify({
					message: `Header "${key}" set successfully`,
				}),
			};
		} catch (error) {
			return {
				success: false,
				output: "",
				error: `Failed to set custom header: ${error}`,
			};
		}
	},
});

export const removeCustomHeaderTool = createTool({
	name: "remove_custom_header",
	description: "Remove a custom HTTP header from the configured custom provider.",
	parameters: z.object({
		key: z.string().describe("Header name to remove"),
	}),
	category: "system",
	execute: async (args, ctx: ToolContext): Promise<ToolResult> => {
		const { key } = args as { key: string };
		
		const agentCtx = ctx as unknown as AgentContext;
		
		try {
			if (agentCtx.config.provider !== "custom") {
				return {
					success: false,
					output: "",
					error: "This command is only available with custom provider",
				};
			}
			
			if (!agentCtx.config.customProvider?.headers?.[key]) {
				return {
					success: true,
					output: JSON.stringify({
						message: `Header "${key}" does not exist`,
					}),
				};
			}
			
			delete agentCtx.config.customProvider.headers[key];
			
			CustomProviderClient.resetInstance();
			
			return {
				success: true,
				output: JSON.stringify({
					message: `Header "${key}" removed successfully`,
				}),
			};
		} catch (error) {
			return {
				success: false,
				output: "",
				error: `Failed to remove custom header: ${error}`,
			};
		}
	},
});

export const getCustomProviderInfoTool = createTool({
	name: "get_custom_provider_info",
	description: "Get information about the currently configured custom provider.",
	parameters: z.object({}),
	category: "system",
	execute: async (_args, ctx: ToolContext): Promise<ToolResult> => {
		const agentCtx = ctx as unknown as AgentContext;
		
		try {
			if (agentCtx.config.provider !== "custom" || !agentCtx.config.customProvider) {
				return {
					success: false,
					output: "",
					error: "Custom provider not configured",
				};
			}
			
			const info = {
				name: agentCtx.config.customProvider.name,
				baseUrl: agentCtx.config.customProvider.baseUrl,
				headers: agentCtx.config.customProvider.headers,
			};
			
			return {
				success: true,
				output: JSON.stringify(info),
			};
		} catch (error) {
			return {
				success: false,
				output: "",
				error: `Failed to get custom provider info: ${error}`,
			};
		}
	},
});

export const customProviderTools = [
	configureCustomProviderTool,
	setCustomHeaderTool,
	removeCustomHeaderTool,
	getCustomProviderInfoTool,
];
