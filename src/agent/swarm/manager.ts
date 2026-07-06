import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { fork, type ChildProcess } from "node:child_process";
import { debug } from "../../utils/debug.js";
import { agentEventBus } from "../events.js";
import type { AgentLoopResult } from "../index.js";
import { ChunkReceiver } from "./serialization.js";

export interface SubagentTask {
	id: string;
	prompt: string;
	status: "running" | "completed" | "failed" | "killed";
	result?: AgentLoopResult;
	error?: string;
	process?: ChildProcess;
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
		parentContext?: any,
	): Promise<string> {
		const id = randomUUID();

		const entryFile = process.argv[1];
		const childProcess = fork(entryFile, [], {
			env: {
				...process.env,
				SWARM_RUNNER: "1",
			},
			cwd: workingDir,
			stdio: ["pipe", "pipe", "pipe", "ipc"],
		});

		const task: SubagentTask = {
			id,
			prompt,
			status: "running",
			process: childProcess,
			createdAt: new Date(),
			tokensUsed: 0,
		};

		this.tasks.set(id, task);
		this.emitUpdate();

		let tokenCount = 0;
		const receiver = new ChunkReceiver();

		const handleMessage = (type: string, payload: any) => {
			if (type === "token") {
				task.tokensUsed++;
				tokenCount++;
				if (tokenCount % 20 === 0) {
					this.emitUpdate();
				}
			} else if (type === "completed") {
				if (task.status === "running") {
					task.status = "completed";
					task.result = payload;
					this.emitUpdate();
				}
				if (parentContext) {
					const msg = `[Task Completed] Subagent ${id} completed`;
					agentEventBus.emit("wakeup", msg);
				}
				childProcess.kill();
			} else if (type === "error") {
				if (task.status === "running") {
					task.status = "failed";
					task.error = payload;
					debug.log("agent", `Subagent ${id} failed:`, payload);
					this.emitUpdate();
				}
				if (parentContext) {
					const msg = `[Task Completed] Subagent ${id} failed: ${payload}`;
					agentEventBus.emit("wakeup", msg);
				}
				childProcess.kill();
			}
		};

		childProcess.on("message", (msg: any) => {
			if (msg.type?.endsWith("_chunk")) {
				const { complete, payload } = receiver.receive(msg);
				if (complete) {
					const baseType = msg.type.replace("_chunk", "");
					handleMessage(baseType, payload);
				}
			} else {
				handleMessage(msg.type, msg.payload);
			}
		});

		childProcess.on("error", (error) => {
			if (task.status === "running") {
				task.status = "failed";
				task.error = error.message;
				this.emitUpdate();
				if (parentContext) {
					agentEventBus.emit(
						"wakeup",
						`[Task Completed] Subagent ${id} failed: ${error.message}`,
					);
				}
			}
		});

		childProcess.on("exit", (code) => {
			if (task.status === "running") {
				task.status = "failed";
				task.error = `Process exited with code ${code}`;
				this.emitUpdate();
				if (parentContext) {
					agentEventBus.emit(
						"wakeup",
						`[Task Completed] Subagent ${id} failed: exited with code ${code}`,
					);
				}
			}
		});

		childProcess.send({ type: "start", payload: { prompt, workingDir } });

		return id;
	}

	public listSubagents(): Omit<SubagentTask, "process">[] {
		return Array.from(this.tasks.values()).map(({ process, ...rest }) => rest);
	}

	public getSubagent(id: string): Omit<SubagentTask, "process"> | undefined {
		const task = this.tasks.get(id);
		if (!task) return undefined;
		const { process, ...rest } = task;
		return rest;
	}

	public killSubagent(id: string): boolean {
		const task = this.tasks.get(id);
		if (task && task.status === "running") {
			if (task.process) {
				task.process.kill();
			}
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
		if (task.process) {
			task.process.send({
				type: "message",
				payload: `[Message from Parent]: ${message}`,
			});
			return { success: true };
		}
		return { success: false, error: "no_process" };
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
			} as SubagentTask);
		}
		this.emitUpdate();
	}
}

export const swarmManager = SwarmManager.getInstance();
