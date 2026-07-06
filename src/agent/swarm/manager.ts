import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { loadConfig } from "../../config/index.js";
import { debug } from "../../utils/debug.js";
import { agentEventBus } from "../events.js";
import {
	type AgentLoopResult,
	createAgentContext,
	runAgentLoop,
} from "../index.js";

export interface SubagentTask {
	id: string;
	prompt: string;
	status: "running" | "completed" | "failed" | "killed";
	result?: AgentLoopResult;
	error?: string;
	abortController: AbortController;
	createdAt: Date;
	tokensUsed: number;
	context?: any;
}

export class SwarmManager extends EventEmitter {
	private tasks = new Map<string, SubagentTask>();
	private static instance: SwarmManager;

	private constructor() {
		super();
	}

	public static getInstance(): SwarmManager {
		if (!SwarmManager.instance) {
			SwarmManager.instance = new SwarmManager();
		}
		return SwarmManager.instance;
	}

	private emitUpdate() {
		this.emit("update", this.listSubagents());
	}

	public async spawnSubagent(
		prompt: string,
		workingDir: string,
		parentContext?: any,
	): Promise<string> {
		const id = randomUUID();
		const abortController = new AbortController();

		const config = await loadConfig();

		const subagentContext = await createAgentContext(workingDir, config);

		const task: SubagentTask = {
			id,
			prompt,
			status: "running",
			abortController,
			createdAt: new Date(),
			tokensUsed: 0,
			context: subagentContext,
		};

		this.tasks.set(id, task);
		this.emitUpdate();

		let tokenCount = 0;

		runAgentLoop(subagentContext, prompt, {
			signal: abortController.signal,
			onToken: () => {
				task.tokensUsed++;
				tokenCount++;
				if (tokenCount % 20 === 0) {
					this.emitUpdate();
				}
			},
		})
			.then((result) => {
				if (task.status === "running") {
					task.status = "completed";
					task.result = result;
					this.emitUpdate();
				}
				if (parentContext) {
					const msg = `[Task Completed] Subagent ${id} completed`;
					agentEventBus.emit("wakeup", msg);
				}
			})
			.catch((error) => {
				if (task.status === "running") {
					task.status = "failed";
					task.error = error instanceof Error ? error.message : String(error);
					debug.log("agent", `Subagent ${id} failed:`, error);
					this.emitUpdate();
				}
				if (parentContext) {
					const msg = `[Task Completed] Subagent ${id} failed: ${error instanceof Error ? error.message : String(error)}`;
					agentEventBus.emit("wakeup", msg);
				}
			});

		return id;
	}

	public listSubagents(): Omit<SubagentTask, "abortController">[] {
		return Array.from(this.tasks.values()).map(
			({ abortController, ...rest }) => rest,
		);
	}

	public getSubagent(
		id: string,
	): Omit<SubagentTask, "abortController"> | undefined {
		const task = this.tasks.get(id);
		if (!task) return undefined;
		const { abortController, ...rest } = task;
		return rest;
	}

	public killSubagent(id: string): boolean {
		const task = this.tasks.get(id);
		if (task && task.status === "running") {
			task.abortController.abort();
			task.status = "killed";
			this.emitUpdate();
			return true;
		}
		return false;
	}

	public sendMessage(
		id: string,
		message: string,
	): { success: boolean; status?: string; error?: string } {
		const task = this.tasks.get(id);
		if (!task) {
			return { success: false, error: "not_found" };
		}
		if (task.status !== "running") {
			return { success: false, status: task.status, error: "not_running" };
		}
		if (task.context) {
			task.context.messages.push({
				role: "user",
				content: `[Message from Parent]: ${message}`,
			});
			if (task.context.isSleeping) {
				agentEventBus.emit("wakeup", `Message received for subagent ${id}`);
			}
			return { success: true };
		}
		return { success: false, error: "no_context" };
	}

	public exportState(): any {
		const state: any = {};
		for (const [id, task] of this.tasks.entries()) {
			state[id] = {
				id: task.id,
				prompt: task.prompt,
				status: task.status,
				result: task.result,
				error: task.error,
				createdAt: task.createdAt,
				tokensUsed: task.tokensUsed,
			};
		}
		return state;
	}

	public importState(state: any): void {
		if (!state) return;
		for (const [id, taskData] of Object.entries(state)) {
			const status =
				(taskData as any).status === "running"
					? "killed"
					: (taskData as any).status;
			this.tasks.set(id, {
				...(taskData as any),
				status,
				createdAt: new Date((taskData as any).createdAt),
				abortController: new AbortController(),
			} as SubagentTask);
		}
		this.emitUpdate();
	}
}

export const swarmManager = SwarmManager.getInstance();
