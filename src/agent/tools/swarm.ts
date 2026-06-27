import { z } from "zod";
import { createTool, type ToolDefinition } from "./registry.js";
import { swarmManager } from "../swarm/manager.js";

const delegateTaskSchema = z.object({
	prompt: z.string().describe("The task description and instructions for the subagent"),
});

const checkSubagentStatusSchema = z.object({
	id: z.string().describe("The ID of the subagent to check"),
});

export const swarmTools: ToolDefinition[] = [
	createTool({
		name: "delegate_task",
		description: "Spawns a subagent to work on a task in the background. Returns the subagent ID. Useful for delegating independent tasks to be done in parallel.",
		parameters: delegateTaskSchema,
		category: "development",
		isReadonly: false,
		execute: async (args: unknown, ctx) => {
			const { prompt } = args as z.infer<typeof delegateTaskSchema>;
			try {
				const id = await swarmManager.spawnSubagent(prompt, ctx.workingDir);
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
		description: "Checks the status of a previously spawned subagent by its ID.",
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
];
