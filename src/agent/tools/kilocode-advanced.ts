import { z } from "zod";
import { KiloCodeClient } from "../../api/kilocode.js";
import type { AgentContext } from "../context.js";
import { createTool, type ToolContext, type ToolResult } from "./registry.js";


/**
 * @status implemented — sends code to KiloCode for review via real API calls
 *
 * Delegates to KiloCodeClient.reviewCode() which uses the BaseAPIClient
 * HTTP stack (completeChat with retry, streaming, rate-limiting).
 *
 * @note The result parsing uses JSON.parse(content || "{}") which is fragile —
 *   if the model returns non-JSON text, this will throw.
 *   The language, reviewType, and guidelines parameters are passed to
 *   KiloCodeClient.reviewCode() but the method ignores guidelines in the
 *   system prompt it constructs.
 */
export const reviewCodeTool = createTool({
	name: "review_code",
	description:
		"Review code for quality, security, and best practices using KiloCode's advanced analysis capabilities.",
	parameters: z.object({
		code: z.string().describe("The code to review"),
		language: z
			.string()
			.optional()
			.describe("Programming language (auto-detected if not specified)"),
		reviewType: z
			.enum(["basic", "advanced", "security"])
			.optional()
			.describe("Type of review to perform"),
		guidelines: z
			.array(z.string())
			.optional()
			.describe("Specific guidelines to follow"),
	}),
	category: "development",
	execute: async (args, ctx: ToolContext): Promise<ToolResult> => {
		const {
			code,
			language,
			reviewType = "advanced",
			guidelines,
		} = args as {
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
			const review = await client.reviewCode(code, {
				language,
				reviewType,
				guidelines,
			});

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

/**
 * @status implemented — summarizes conversation history via real KiloCode API calls
 *
 * Delegates to KiloCodeClient.summarizeContext() which uses the BaseAPIClient
 * HTTP stack (completeChat with retry, streaming, rate-limiting).
 *
 * @note The result parsing uses JSON.parse(content || "{}") which is fragile —
 *   if the model returns non-JSON text, this will throw.
 */
export const summarizeContextTool = createTool({
	name: "summarize_context",
	description:
		"Summarize conversation history to maintain context while reducing token usage.",
	parameters: z.object({
		messages: z
			.array(
				z.object({
					role: z.enum(["system", "user", "assistant", "tool"]),
					content: z.string(),
				}),
			)
			.describe("Conversation history to summarize"),
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
	reviewCodeTool,
	summarizeContextTool,
];
