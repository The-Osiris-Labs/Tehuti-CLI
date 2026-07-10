import { z } from "zod";
import { sendMessageToTask } from "../subagents/manager.js";
import { swarmManager } from "../swarm/manager.js";
import { createTool, type ToolDefinition } from "./registry.js";

const delegateTaskSchema = z.object({
	prompt: z
		.string()
		.min(1)
		.describe("The task description and instructions for the subagent"),
	description: z
		.string()
		.optional()
		.describe("Short (3-5 words) description of what this subagent will do"),
	subagent_type: z
		.enum(["general", "explore", "code", "debug"])
		.optional()
		.describe(
			"Type of specialized subagent (used as a hint for system prompt)",
		),
	task_id: z
		.string()
		.optional()
		.describe("Optional ID to assign to the subagent for later reference"),
	working_dir: z
		.string()
		.optional()
		.describe(
			"Override the working directory for the subagent (defaults to current cwd)",
		),
});

const checkSubagentStatusSchema = z.object({
	id: z.string().describe("The ID of the subagent to check"),
});

const abortSubagentSchema = z.object({
	id: z.string().describe("The ID of the subagent to abort"),
});

const sendMessageToSubagentSchema = z.object({
	id: z.string().describe("The ID of the subagent to send a message to"),
	message: z.string().min(1).describe("The message to send"),
});

const awaitSubagentsSchema = z.object({
	ids: z.array(z.string()).min(1).describe("IDs of subagents to wait on"),
	timeout_ms: z
		.number()
		.int()
		.positive()
		.optional()
		.describe("Maximum time to wait in milliseconds (default 60000)"),
});

const listSubagentsSchema = z.object({
	include_terminal: z
		.boolean()
		.optional()
		.describe("Include completed/failed/killed subagents in the listing"),
});

export const swarmTools: ToolDefinition[] = [
	createTool({
		name: "delegate_task",
		description:
			"Spawns a subagent (forked Node.js process) to work on a task in the background. Returns the subagent ID immediately. Use `await_subagents` or `check_subagent_status` to retrieve results.",
		parameters: delegateTaskSchema,
		category: "development",
		isReadonly: false,
		execute: async (args: unknown, ctx) => {
			const { prompt, description, subagent_type, task_id, working_dir } =
				args as z.infer<typeof delegateTaskSchema>;
			try {
				const id = await swarmManager.spawnSubagent({
					prompt,
					workingDir: working_dir ?? ctx.workingDir,
					parentContext: ctx.agentContext,
					type: subagent_type,
					description,
				});
				// Note: the task_id parameter from the schema is not currently
				// threaded through SwarmManager (which always uses a fresh UUID).
				// It is accepted for forward-compatibility.
				void task_id;
				return {
					success: true,
					output: `Subagent spawned with ID: ${id}\nUse await_subagents or check_subagent_status to retrieve results.`,
					metadata: { id },
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

			const lines: string[] = [
				`Subagent ID: ${subagent.id}`,
				`Status: ${subagent.status}`,
				`Created At: ${subagent.createdAt.toISOString()}`,
			];
			if (subagent.type) lines.push(`Type: ${subagent.type}`);
			if (subagent.description)
				lines.push(`Description: ${subagent.description}`);
			if (subagent.tokensUsed > 0)
				lines.push(`Tokens Used: ${subagent.tokensUsed}`);
			if (subagent.toolCallCount > 0)
				lines.push(`Tool Calls: ${subagent.toolCallCount}`);

			if (subagent.status === "completed") {
				lines.push(
					`Result:\n${subagent.result?.content ?? "No content returned."}`,
				);
			} else if (subagent.status === "failed") {
				lines.push(`Error: ${subagent.error ?? "Unknown error."}`);
			} else if (subagent.status === "killed") {
				lines.push(`Killed.`);
			}

			return {
				success: true,
				output: lines.join("\n"),
				metadata: {
					id: subagent.id,
					status: subagent.status,
					tokensUsed: subagent.tokensUsed,
					toolCallCount: subagent.toolCallCount,
				},
			};
		},
	}),
	createTool({
		name: "await_subagents",
		description:
			"Waits for one or more subagents to reach a terminal state and returns their results. Use after spawning one or more subagents to collect their outputs.",
		parameters: awaitSubagentsSchema,
		category: "development",
		isReadonly: true,
		execute: async (args: unknown) => {
			const { ids, timeout_ms } = args as z.infer<typeof awaitSubagentsSchema>;
			const views = await swarmManager.awaitSubagents(
				ids,
				timeout_ms ?? 60_000,
			);

			const lines: string[] = [];
			let allOk = true;
			for (const v of views) {
				if (v.status === "not_found") {
					allOk = false;
					lines.push(`[${v.id}] NOT FOUND`);
					continue;
				}
				if (v.status === "completed") {
					lines.push(
						`[${v.id}] COMPLETED\n${v.result?.content ?? "(no content)"}`,
					);
				} else if (v.status === "failed") {
					allOk = false;
					lines.push(`[${v.id}] FAILED\n${v.error ?? "Unknown error."}`);
				} else if (v.status === "killed") {
					allOk = false;
					lines.push(`[${v.id}] KILLED`);
				} else {
					// Still running (timeout exhausted). Surface partial state.
					allOk = false;
					lines.push(
						`[${v.id}] TIMEOUT (status=${v.status})\n${v.error ?? "Still running."}`,
					);
				}
			}

			return {
				success: allOk,
				output: lines.join("\n\n"),
				metadata: { views },
			};
		},
	}),
	createTool({
		name: "list_subagents",
		description:
			"Lists all known subagents and their current status. Use to discover which spawned tasks still need attention.",
		parameters: listSubagentsSchema,
		category: "development",
		isReadonly: true,
		execute: async (args: unknown) => {
			const { include_terminal } = args as z.infer<typeof listSubagentsSchema>;
			const all = swarmManager.listSubagents();
			const filtered = include_terminal
				? all
				: all.filter((s) => s.status === "running" || s.status === "pending");

			if (filtered.length === 0) {
				return {
					success: true,
					output: "No subagents.",
					metadata: { count: 0 },
				};
			}

			const lines = filtered.map(
				(s) =>
					`${s.id}  ${s.status.padEnd(10)}  ${(s.description ?? s.prompt.slice(0, 60)).trim()}`,
			);
			return {
				success: true,
				output: lines.join("\n"),
				metadata: { count: filtered.length },
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

			const success = swarmManager.killSubagent(id);
			// Best-effort fallback: also try the in-process subagent registry
			// (used by the `task` tool, separate from `delegate_task`).
			if (!success) {
				// We do not import abortTask directly because the swarm tools
				// own the IPC-spawned subagents. If we ever wire those two
				// registries together, do it here.
				void sendMessageToTask; // keep import for symmetry
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

			const result = swarmManager.sendMessage(id, message);
			if (result.error === "not_found") {
				const taskResult = sendMessageToTask(id, message);
				if (taskResult.error !== "not_found") {
					if (taskResult.success) {
						return { success: true, output: `Message sent to subagent ${id}.` };
					}
					return {
						success: false,
						output: `Failed to send message: Subagent ${id} is no longer running (status: ${taskResult.status}).`,
					};
				}
			} else if (result.success) {
				return { success: true, output: `Message sent to subagent ${id}.` };
			} else if (result.error === "not_running") {
				return {
					success: false,
					output: `Failed to send message: Subagent ${id} is no longer running (status: ${result.status}).`,
				};
			}

			return {
				success: false,
				output: `Failed to send message to subagent ${id}. It may not exist.`,
			};
		},
	}),
];
