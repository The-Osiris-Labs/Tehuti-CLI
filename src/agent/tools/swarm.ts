import { z } from "zod";
import { abortTask, sendMessageToTask } from "../subagents/manager.js";
import { swarmManager } from "../swarm/manager.js";
import { createTool, type ToolDefinition } from "./registry.js";

const delegateTaskSchema = z.object({
	prompt: z
		.string()
		.describe("The task description and instructions for the subagent"),
});

const checkSubagentStatusSchema = z.object({
	id: z.string().describe("The ID of the subagent to check"),
});

const abortSubagentSchema = z.object({
	id: z.string().describe("The ID of the subagent to abort"),
});

const sendMessageToSubagentSchema = z.object({
	id: z.string().describe("The ID of the subagent to send a message to"),
	message: z.string().describe("The message to send"),
});

export const swarmTools: ToolDefinition[] = [
	createTool({
		name: "delegate_task",
		description:
			"Spawns a subagent to work on a task in the background. Returns the subagent ID. Useful for delegating independent tasks to be done in parallel.",
		parameters: delegateTaskSchema,
		category: "development",
		isReadonly: false,
		execute: async (args: unknown, ctx) => {
			const { prompt } = args as z.infer<typeof delegateTaskSchema>;
			try {
				const id = await swarmManager.spawnSubagent(
					prompt,
					ctx.workingDir,
					ctx.agentContext,
				);
				return {
					success: true,
					output: `Subagent spawned successfully with ID: ${id}\nUse the check_subagent_status tool to poll its status.`,
				};
			} catch (error) {
				return {
					success: false,
					output: `Failed to spawn subagent: ${error instanceof Error ? error.message : String(error)}`,
				};
			}
		},
	}),
	createTool({
		name: "check_subagent_status",
		description:
			"Checks the status of a previously spawned subagent by its ID.",
		parameters: checkSubagentStatusSchema,
		category: "development",
		isReadonly: true,
		execute: async (args: unknown) => {
			const { id } = args as z.infer<typeof checkSubagentStatusSchema>;
			const subagent = swarmManager.getSubagent(id);

			if (!subagent) {
				return {
					success: false,
					output: `Subagent with ID ${id} not found.`,
				};
			}

			let output = `Subagent ID: ${subagent.id}\nStatus: ${subagent.status}\nCreated At: ${subagent.createdAt.toISOString()}`;

			if (subagent.status === "completed") {
				output += `\nResult:\n${subagent.result?.content ?? "No content returned."}`;
			} else if (subagent.status === "failed") {
				output += `\nError:\n${subagent.error ?? "Unknown error."}`;
			}

			return {
				success: true,
				output,
			};
		},
	}),
	createTool({
		name: "abort_subagent",
		description: "Aborts a running subagent by its ID.",
		parameters: abortSubagentSchema,
		category: "development",
		isReadonly: false,
		execute: async (args: unknown) => {
			const { id } = args as z.infer<typeof abortSubagentSchema>;

			let success = swarmManager.killSubagent(id);
			if (!success) {
				success = abortTask(id);
			}

			if (success) {
				return {
					success: true,
					output: `Subagent ${id} aborted successfully.`,
				};
			}
			return {
				success: false,
				output: `Failed to abort subagent ${id}. It may not be running or may not exist.`,
			};
		},
	}),
	createTool({
		name: "send_message_to_subagent",
		description: "Sends a message to a running subagent by its ID.",
		parameters: sendMessageToSubagentSchema,
		category: "development",
		isReadonly: false,
		execute: async (args: unknown) => {
			const { id, message } = args as z.infer<
				typeof sendMessageToSubagentSchema
			>;

			let result = swarmManager.sendMessage(id, message);
			if (result.error === "not_found") {
				const taskResult = sendMessageToTask(id, message);
				if (taskResult.error !== "not_found") {
					result = taskResult as any;
				}
			}

			if (result.success) {
				return { success: true, output: `Message sent to subagent ${id}.` };
			}

			if (result.error === "not_running") {
				return {
					success: false,
					output: `Failed to send message: Subagent ${id} is no longer running (status: ${result.status}).`,
				};
			}

			return {
				success: false,
				output: `Failed to send message to subagent ${id}. It may not exist or its context is missing.`,
			};
		},
	}),
];
