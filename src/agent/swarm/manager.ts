import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { runAgentLoop, createAgentContext, type AgentLoopResult } from "../index.js";
import { loadConfig } from "../../config/index.js";
import { debug } from "../../utils/debug.js";

export interface SubagentTask {
	id: string;
	prompt: string;
	status: "running" | "completed" | "failed" | "killed";
	result?: AgentLoopResult;
	error?: string;
	abortController: AbortController;
	createdAt: Date;
	tokensUsed: number;
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
			}
		})
			.then((result) => {
				if (task.status === "running") {
					task.status = "completed";
					task.result = result;
					this.emitUpdate();
				}
			})
			.catch((error) => {
				if (task.status === "running") {
					task.status = "failed";
					task.error = error instanceof Error ? error.message : String(error);
					debug.log("agent", `Subagent ${id} failed:`, error);
					this.emitUpdate();
				}
			});

		return id;
	}

	public listSubagents(): Omit<SubagentTask, "abortController">[] {
		return Array.from(this.tasks.values()).map(
			({ abortController, ...rest }) => rest,
		);
	}

	public getSubagent(id: string): Omit<SubagentTask, "abortController"> | undefined {
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
}

export const swarmManager = SwarmManager.getInstance();
