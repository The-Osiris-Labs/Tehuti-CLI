import { z } from "zod";
import { mcpManager } from "../../mcp/client.js";
import type {
	AnyToolExecutor,
	ToolContext,
	ToolDefinition,
	ToolResult,
} from "./registry.js";

const GET_PROMPT_SCHEMA = z.object({
	server_name: z.string().describe("Name of the MCP server"),
	prompt_name: z.string().describe("Name of the prompt to retrieve"),
	arguments: z
		.record(z.string())
		.optional()
		.describe("Arguments to pass to the prompt"),
});

const LIST_PROMPTS_SCHEMA = z.object({
	server_name: z
		.string()
		.optional()
		.describe("Filter by server name (optional)"),
});

async function getPrompt(
	args: z.infer<typeof GET_PROMPT_SCHEMA>,
	_ctx: ToolContext,
): Promise<ToolResult> {
	const { server_name, prompt_name, arguments: promptArgs } = args;

	try {
		const result = await mcpManager.getPrompt(
			server_name,
			prompt_name,
			promptArgs,
		);

		const formattedMessages = result.messages
			.map((msg) => {
				const role = msg.role.toUpperCase();
				if (msg.content.type === "text") {
					return `## ${role}\n${msg.content.text}`;
				} else if (msg.content.type === "image") {
					return `## ${role}\n[Image: ${msg.content.mimeType}]`;
				} else if (msg.content.type === "resource") {
					return `## ${role}\n[Resource: ${msg.content.text}]`;
				}
				return `## ${role}\n${JSON.stringify(msg.content)}`;
			})
			.join("\n\n");

		return {
			success: true,
			output: result.description
				? `# ${result.description}\n\n${formattedMessages}`
				: formattedMessages,
			metadata: {
				serverName: server_name,
				promptName: prompt_name,
				messageCount: result.messages.length,
			},
		};
	} catch (error) {
		return {
			success: false,
			output: "",
			error: `Failed to get prompt: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

async function listPrompts(
	args: z.infer<typeof LIST_PROMPTS_SCHEMA>,
	_ctx: ToolContext,
): Promise<ToolResult> {
	const { server_name } = args;

	try {
		const allPrompts = mcpManager.getAllPrompts();

		const filtered = server_name
			? allPrompts.filter((p) => p.serverName === server_name)
			: allPrompts;

		if (filtered.length === 0) {
			return {
				success: true,
				output: server_name
					? `No prompts found for server: ${server_name}`
					: "No MCP prompts available. Connect to MCP servers first.",
				metadata: { count: 0 },
			};
		}

		const output = filtered
			.map(({ serverName, prompt }) => {
				const argsList = prompt.arguments?.length
					? `\n   Arguments: ${prompt.arguments.map((a) => `${a.name}${a.required ? "*" : ""}`).join(", ")}`
					: "";
				return `### ${serverName}: ${prompt.name}
   ${prompt.description ?? "No description"}${argsList}`;
			})
			.join("\n\n");

		return {
			success: true,
			output: `# Available MCP Prompts\n\n${output}`,
			metadata: { count: filtered.length },
		};
	} catch (error) {
		return {
			success: false,
			output: "",
			error: `Failed to list prompts: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

export const mcpPromptTools: ToolDefinition[] = [
	{
		name: "mcp_get_prompt",
		description:
			"Retrieve a prompt template from an MCP server. Returns formatted messages that can be used as context.",
		parameters: GET_PROMPT_SCHEMA,
		execute: getPrompt as AnyToolExecutor,
		category: "mcp",
		requiresPermission: false,
	},
	{
		name: "mcp_list_prompts",
		description: "List all available prompts from connected MCP servers.",
		parameters: LIST_PROMPTS_SCHEMA,
		execute: listPrompts as AnyToolExecutor,
		category: "mcp",
		requiresPermission: false,
	},
];
