import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import * as chokidar from "chokidar";
import * as cron from "node-cron";
import type { AgentContext } from "../agent/context.js";
import { agentEventBus } from "../agent/events.js";
import { type SubagentTask, swarmManager } from "../agent/swarm/manager.js";
import { ConnectorManager } from "../messaging/connector-manager.js";
import { debug } from "../utils/debug.js";

export interface StateEngineConfig {
	watchDirs?: string[];
	cronSchedules?: Array<{ cron: string; action: () => void | Promise<void> }>;
	pollIntervalMs?: number;
	messaging?: any; // From TehutiConfig
}

export class DaemonStateEngine extends EventEmitter {
	private isRunning = false;
	private activeContexts: Map<string, AgentContext> = new Map();
	private childProcesses: Map<string, ChildProcess> = new Map();
	private fsWatcher?: chokidar.FSWatcher;
	private cronTasks: cron.ScheduledTask[] = [];
	private pollInterval?: NodeJS.Timeout;
	private connectorManager?: ConnectorManager;

	constructor(private config: StateEngineConfig = {}) {
		super();
		this.setupEventBusListeners();
	}

	private setupEventBusListeners() {
		agentEventBus.on("wakeup", ((reason: string) => {
			try {
				debug.log("daemon", `Wakeup triggered: ${reason}`);
				this.emit("wakeup", reason);
			} catch (error) {
				debug.log(
					"daemon",
					`Error in wakeup handler: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}) as any);
	}

	public async start() {
		if (this.isRunning) return;
		this.isRunning = true;

		const pollMs = this.config.pollIntervalMs ?? 1000;
		this.pollInterval = setInterval(() => this.tick(), pollMs);

		if (this.config.watchDirs && this.config.watchDirs.length > 0) {
			try {
				this.fsWatcher = chokidar.watch(this.config.watchDirs, {
					ignoreInitial: true,
					persistent: true,
				});

				this.fsWatcher.on("all", (event: string, path: string) => {
					try {
						const msg = `FS Event: ${event} on ${path}`;
						debug.log("daemon", msg);
						agentEventBus.emit("wakeup", msg);
					} catch (err) {
						debug.log(
							"daemon",
							`Error handling FS event: ${err instanceof Error ? err.message : String(err)}`,
						);
					}
				});

				this.fsWatcher.on("error", (error: any) => {
					debug.log("daemon", `FS Watcher error: ${error instanceof Error ? error.message : String(error)}`);
				});
			} catch (error) {
				debug.log(
					"daemon",
					`Failed to start FS watcher: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}

		if (this.config.cronSchedules) {
			for (const schedule of this.config.cronSchedules) {
				try {
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
				} catch (error) {
					debug.log(
						"daemon",
						`Failed to schedule cron task: ${error instanceof Error ? error.message : String(error)}`,
					);
				}
			}
		}

		if (this.config.messaging) {
			try {
				this.connectorManager = new ConnectorManager(this.config.messaging);
				await this.connectorManager.start();
				debug.log("daemon", "Messaging ConnectorManager started successfully.");
			} catch (err: any) {
				debug.log(
					"daemon",
					`Messaging ConnectorManager failed to start: ${err.message}`,
				);
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

		for (const cp of this.childProcesses.values()) {
			if (!cp.killed) {
				cp.kill("SIGTERM");
			}
		}
		this.childProcesses.clear();

		if (this.connectorManager) {
			try {
				await this.connectorManager.stop();
				this.connectorManager = undefined;
			} catch (err: any) {
				debug.log("daemon", `Error stopping ConnectorManager: ${err.message}`);
			}
		}

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
			try {
				debug.log(
					"daemon",
					`Child process ${id} exited with code ${code} and signal ${signal}`,
				);
				this.childProcesses.delete(id);
				agentEventBus.emit("wakeup", `Child process ${id} exited`);
			} catch (error) {
				debug.log(
					"daemon",
					`Error in child process exit handler: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		});
		cp.on("error", (err) => {
			try {
				debug.log("daemon", `Child process ${id} error: ${err.message}`);
				agentEventBus.emit(
					"wakeup",
					`Child process ${id} error: ${err.message}`,
				);
			} catch (error) {
				debug.log(
					"daemon",
					`Error in child process error handler: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		});
	}

	private tick() {
		try {
			if (!this.isRunning) return;

			for (const [_id, context] of Array.from(this.activeContexts.entries())) {
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
		} catch (error) {
			debug.log(
				"daemon",
				`Error in tick interval: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
}

export const daemonStateEngine = new DaemonStateEngine();
