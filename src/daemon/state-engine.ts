import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import * as chokidar from "chokidar";
import * as cron from "node-cron";
import type { AgentContext } from "../agent/context.js";
import { agentEventBus } from "../agent/events.js";
import { type SubagentTask, swarmManager } from "../agent/swarm/manager.js";
import { debug } from "../utils/debug.js";

export interface StateEngineConfig {
	watchDirs?: string[];
	cronSchedules?: Array<{ cron: string; action: () => void | Promise<void> }>;
	pollIntervalMs?: number;
}

export class DaemonStateEngine extends EventEmitter {
	private isRunning = false;
	private activeContexts: Map<string, AgentContext> = new Map();
	private childProcesses: Map<string, ChildProcess> = new Map();
	private fsWatcher?: chokidar.FSWatcher;
	private cronTasks: cron.ScheduledTask[] = [];
	private pollInterval?: NodeJS.Timeout;

	constructor(private config: StateEngineConfig = {}) {
		super();
		this.setupEventBusListeners();
	}

	private setupEventBusListeners() {
		agentEventBus.on("wakeup", ((reason: string) => {
			debug.log("daemon", `Wakeup triggered: ${reason}`);
			this.emit("wakeup", reason);
		}) as any);
	}

	public async start() {
		if (this.isRunning) return;
		this.isRunning = true;

		const pollMs = this.config.pollIntervalMs ?? 1000;
		this.pollInterval = setInterval(() => this.tick(), pollMs);

		if (this.config.watchDirs && this.config.watchDirs.length > 0) {
			this.fsWatcher = chokidar.watch(this.config.watchDirs, {
				ignoreInitial: true,
				persistent: true,
			});

			this.fsWatcher.on("all", (event: string, path: string) => {
				const msg = `FS Event: ${event} on ${path}`;
				debug.log("daemon", msg);
				agentEventBus.emit("wakeup", msg);
			});
		}

		if (this.config.cronSchedules) {
			for (const schedule of this.config.cronSchedules) {
				const task = cron.schedule(schedule.cron, async () => {
					try {
						await Promise.resolve(schedule.action());
					} catch (error) {
						debug.log(
							"daemon",
							`Cron action error: ${error instanceof Error ? error.message : String(error)}`,
						);
					}
				});
				this.cronTasks.push(task);
			}
		}

		debug.log("daemon", "Daemon State Engine started");
	}

	public async stop() {
		this.isRunning = false;
		if (this.pollInterval) {
			clearInterval(this.pollInterval);
			this.pollInterval = undefined;
		}
		if (this.fsWatcher) {
			await this.fsWatcher.close();
			this.fsWatcher = undefined;
		}
		for (const task of this.cronTasks) {
			task.stop();
		}
		this.cronTasks = [];

		debug.log("daemon", "Daemon State Engine stopped");
	}

	public registerContext(id: string, context: AgentContext) {
		this.activeContexts.set(id, context);
	}

	public unregisterContext(id: string) {
		this.activeContexts.delete(id);
	}

	public monitorChildProcess(id: string, cp: ChildProcess) {
		this.childProcesses.set(id, cp);
		cp.on("exit", (code, signal) => {
			debug.log(
				"daemon",
				`Child process ${id} exited with code ${code} and signal ${signal}`,
			);
			this.childProcesses.delete(id);
			agentEventBus.emit("wakeup", `Child process ${id} exited`);
		});
		cp.on("error", (err) => {
			debug.log("daemon", `Child process ${id} error: ${err.message}`);
			agentEventBus.emit("wakeup", `Child process ${id} error: ${err.message}`);
		});
	}

	private tick() {
		if (!this.isRunning) return;

		for (const [id, context] of Array.from(this.activeContexts.entries())) {
			if (context.isSleeping) {
				// Sleep condition checks could go here
				// For example, checking if a specific event occurred that wakes them
			}
		}

		const subagents = swarmManager.listSubagents();
		for (const agent of subagents as SubagentTask[]) {
			if (
				agent.status === "completed" ||
				agent.status === "failed" ||
				agent.status === "killed"
			) {
				// We can handle subagent cleanup or notification here
				// Example: agentEventBus.emit("wakeup", `Subagent ${agent.id} changed status to ${agent.status}`);
			}
		}
	}
}

export const daemonStateEngine = new DaemonStateEngine();
