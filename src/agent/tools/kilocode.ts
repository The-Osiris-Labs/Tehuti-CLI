import { z } from "zod";
import { createTool, type ToolContext, type ToolResult } from "./registry.js";
import { KiloCodeClient } from "../../api/kilocode.js";
import type { AgentContext } from "../context.js";

export const configureMemoryBankTool = createTool({
	name: "configure_memory_bank",
	description: "Configure KiloCode memory bank for session persistence. This allows the AI to remember conversation context across sessions.",
	parameters: z.object({
		enabled: z.boolean().describe("Whether to enable memory bank"),
		sessionId: z.string().optional().describe("Optional session ID to continue previous session"),
	}),
	category: "system",
	execute: async (args, ctx: ToolContext): Promise<ToolResult> => {
		const { enabled, sessionId } = args as { enabled: boolean; sessionId?: string };
		
		// Only applicable for KiloCode provider
		const agentCtx = ctx as unknown as AgentContext;
		if (agentCtx.config.provider !== "kilocode") {
			return {
				success: false,
				output: "",
				error: "Memory bank is only available with KiloCode provider",
			};
		}
		
		try {
			const client = KiloCodeClient.getInstance(agentCtx.config);
			client.configureMemoryBank({ enabled, sessionId });
			
			return {
				success: true,
				output: JSON.stringify({
					message: `Memory bank ${enabled ? "enabled" : "disabled"}`,
					sessionId,
				}),
			};
		} catch (error) {
			return {
				success: false,
				output: "",
				error: `Failed to configure memory bank: ${error}`,
			};
		}
	},
});

export const clearMemoryTool = createTool({
	name: "clear_memory",
	description: "Clear KiloCode memory bank. This resets the AI's memory of the current conversation.",
	parameters: z.object({}),
	category: "system",
	execute: async (_args, ctx: ToolContext): Promise<ToolResult> => {
		const agentCtx = ctx as unknown as AgentContext;
		if (agentCtx.config.provider !== "kilocode") {
			return {
				success: false,
				output: "",
				error: "Memory management is only available with KiloCode provider",
			};
		}
		
		try {
			const client = KiloCodeClient.getInstance(agentCtx.config);
			client.clearMemory();
			
			return {
				success: true,
				output: JSON.stringify({ message: "Memory cleared" }),
			};
		} catch (error) {
			return {
				success: false,
				output: "",
				error: `Failed to clear memory: ${error}`,
			};
		}
	},
});

export const configureStreamingTool = createTool({
	name: "configure_streaming",
	description: "Configure KiloCode streaming options.",
	parameters: z.object({
		thinking: z.boolean().optional().describe("Whether to stream thinking processes"),
	}),
	category: "system",
	execute: async (args, ctx: ToolContext): Promise<ToolResult> => {
		const { thinking = true } = args as { thinking?: boolean };
		
		const agentCtx = ctx as unknown as AgentContext;
		if (agentCtx.config.provider !== "kilocode") {
			return {
				success: false,
				output: "",
				error: "Streaming configuration is only available with KiloCode provider",
			};
		}
		
		try {
			const client = KiloCodeClient.getInstance(agentCtx.config);
			client.configureStreaming({ thinking });
			
			return {
				success: true,
				output: JSON.stringify({
					message: "Streaming options configured",
					thinking,
				}),
			};
		} catch (error) {
			return {
				success: false,
				output: "",
				error: `Failed to configure streaming: ${error}`,
			};
		}
	},
});

export const kiloCodeTools = [
	configureMemoryBankTool,
	clearMemoryTool,
	configureStreamingTool,
];