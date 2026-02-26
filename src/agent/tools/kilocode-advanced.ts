import { z } from "zod";
import { createTool, type ToolContext, type ToolResult } from "./registry.js";
import { KiloCodeClient } from "../../api/kilocode.js";
import type { AgentContext } from "../context.js";

export const configureContextManagementTool = createTool({
	name: "configure_context_management",
	description: "Configure KiloCode context management options. This controls how conversation context is handled and summarized.",
	parameters: z.object({
		autoSummarize: z.boolean().optional().describe("Whether to automatically summarize long conversations"),
		maxContextLength: z.number().int().positive().optional().describe("Maximum context length before summarization"),
	}),
	category: "system",
	execute: async (args, ctx: ToolContext): Promise<ToolResult> => {
		const { autoSummarize = true, maxContextLength = 32000 } = args as { autoSummarize?: boolean; maxContextLength?: number };
		
		const agentCtx = ctx as unknown as AgentContext;
		if (agentCtx.config.provider !== "kilocode") {
			return {
				success: false,
				output: "",
				error: "Context management is only available with KiloCode provider",
			};
		}
		
		try {
			const client = KiloCodeClient.getInstance(agentCtx.config);
			client.configureContextManagement({ autoSummarize, maxContextLength });
			
			return {
				success: true,
				output: JSON.stringify({
					message: "Context management configured",
					autoSummarize,
					maxContextLength,
				}),
			};
		} catch (error) {
			return {
				success: false,
				output: "",
				error: `Failed to configure context management: ${error}`,
			};
		}
	},
});

export const reviewCodeTool = createTool({
	name: "review_code",
	description: "Review code for quality, security, and best practices using KiloCode's advanced analysis capabilities.",
	parameters: z.object({
		code: z.string().describe("The code to review"),
		language: z.string().optional().describe("Programming language (auto-detected if not specified)"),
		reviewType: z.enum(["basic", "advanced", "security"]).optional().describe("Type of review to perform"),
		guidelines: z.array(z.string()).optional().describe("Specific guidelines to follow"),
	}),
	category: "development",
	execute: async (args, ctx: ToolContext): Promise<ToolResult> => {
		const { code, language, reviewType = "advanced", guidelines } = args as { 
			code: string; 
			language?: string; 
			reviewType?: "basic" | "advanced" | "security"; 
			guidelines?: string[];
		};
		
		const agentCtx = ctx as unknown as AgentContext;
		if (agentCtx.config.provider !== "kilocode") {
			return {
				success: false,
				output: "",
				error: "Code review is only available with KiloCode provider",
			};
		}
		
		try {
			const client = KiloCodeClient.getInstance(agentCtx.config);
			const review = await client.reviewCode(code, { language, reviewType, guidelines });
			
			return {
				success: true,
				output: JSON.stringify(review),
			};
		} catch (error) {
			return {
				success: false,
				output: "",
				error: `Code review failed: ${error}`,
			};
		}
	},
});

export const summarizeContextTool = createTool({
	name: "summarize_context",
	description: "Summarize conversation history to maintain context while reducing token usage.",
	parameters: z.object({
		messages: z.array(z.object({
			role: z.enum(["system", "user", "assistant", "tool"]),
			content: z.string(),
		})).describe("Conversation history to summarize"),
	}),
	category: "system",
	execute: async (args, ctx: ToolContext): Promise<ToolResult> => {
		const { messages } = args as { messages: any[] };
		
		const agentCtx = ctx as unknown as AgentContext;
		if (agentCtx.config.provider !== "kilocode") {
			return {
				success: false,
				output: "",
				error: "Context summarization is only available with KiloCode provider",
			};
		}
		
		try {
			const client = KiloCodeClient.getInstance(agentCtx.config);
			const summary = await client.summarizeContext(messages);
			
			return {
				success: true,
				output: JSON.stringify(summary),
			};
		} catch (error) {
			return {
				success: false,
				output: "",
				error: `Context summarization failed: ${error}`,
			};
		}
	},
});

export const kilocodeAdvancedTools = [
	configureContextManagementTool,
	reviewCodeTool,
	summarizeContextTool,
];
