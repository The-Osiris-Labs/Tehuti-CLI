import { type ChildProcess, fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { resolve } from "node:path";
import { debug } from "../../utils/debug.js";
import { agentEventBus } from "../events.js";
import type { AgentLoopResult } from "../index.js";
import { ChunkReceiver } from "./serialization.js";

export interface SubagentTask {
	id: string;
	prompt: string;
	type?: string;
	description?: string;
	status: "pending" | "running" | "completed" | "failed" | "killed";
	result?: AgentLoopResult;
	error?: string;
	process?: ChildProcess;
	createdAt: Date;
	startedAt?: Date;
	endedAt?: Date;
	tokensUsed: number;
	workingDir?: string;
	toolCallCount: number;
	// Last activity timestamp for liveness checks
	lastEventAt?: number;
}

interface SpawnOptions {
	prompt: string;
	workingDir: string;
	parentContext?: any;
	type?: string;
	description?: string;
}

const READY_TIMEOUT_MS = 15_000;
const HARD_KILL_GRACE_MS = 5_000;

export class SwarmManager extends EventEmitter {
	private tasks = new Map<string, SubagentTask>();
	private static instance: SwarmManager;

	private constructor() {
		super();
		this.setMaxListeners(64);
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

	/**
	 * Resolve a safe entry point for the forked child.
	 *
	 * The child re-enters `src/index.ts` (or `dist/index.js`) which checks
	 * `SWARM_RUNNER=1` and hands off to `startRunner()`. We prefer the
	 * compiled entry when it exists (production path) and fall back to the
	 * TypeScript source via `tsx` for development.
	 */
	private resolveEntryFile(): { file: string; nodeArgs: string[] } {
		const candidates: Array<{ file: string; nodeArgs: string[] }> = [];

		// 1. Use process.argv[1] if it points to a real file we can exec.
		const argv1 = process.argv[1];
		if (argv1) {
			const absolute = resolve(argv1);
			if (absolute.endsWith(".ts")) {
				// Source file: invoke via tsx loader.
				candidates.push({ file: absolute, nodeArgs: ["--import", "tsx"] });
			} else {
				candidates.push({ file: absolute, nodeArgs: [] });
			}
		}

		// 2. Look for the compiled entry alongside argv[1].
		if (argv1) {
			const dir = resolve(argv1, "..");
			candidates.push({ file: resolve(dir, "index.js"), nodeArgs: [] });
		}

		// 3. Fall back to a known local dist relative to CWD.
		candidates.push({
			file: resolve(process.cwd(), "dist/index.js"),
			nodeArgs: [],
		});
		candidates.push({
			file: resolve(process.cwd(), "src/index.ts"),
			nodeArgs: ["--import", "tsx"],
		});

		for (const candidate of candidates) {
			try {
				// Cheap existence check via dynamic require: a missing file would
				// throw. Using `fs` instead to keep this synchronous and side-effect free.
				// eslint-disable-next-line @typescript-eslint/no-require-imports
				const fs = require("node:fs") as typeof import("node:fs");
				if (fs.existsSync(candidate.file)) {
					return candidate;
				}
			} catch {
				/* ignore */
			}
		}

		// Last-resort default; fork will fail loudly with ENOENT.
		return { file: argv1 ?? "dist/index.js", nodeArgs: [] };
	}

	public async spawnSubagent(
		prompt: string,
		workingDir: string,
		parentContext?: any,
	): Promise<string>;
	public async spawnSubagent(options: SpawnOptions): Promise<string>;
	public async spawnSubagent(
		promptOrOptions: string | SpawnOptions,
		workingDirArg?: string,
		parentContextArg?: any,
	): Promise<string> {
		const options: SpawnOptions =
			typeof promptOrOptions === "string"
				? {
						prompt: promptOrOptions,
						workingDir: workingDirArg ?? process.cwd(),
						parentContext: parentContextArg,
					}
				: promptOrOptions;

		const { prompt, workingDir, parentContext, type, description } = options;
		const id = randomUUID();

		const { file: entryFile, nodeArgs } = this.resolveEntryFile();

		const childProcess = fork(entryFile, [], {
			env: {
				...process.env,
				SWARM_RUNNER: "1",
			},
			cwd: workingDir,
			stdio: ["ignore", "pipe", "pipe", "ipc"],
			// Important: do not pass execArgv (which may include --inspect flags).
			execArgv: nodeArgs,
		});

		const task: SubagentTask = {
			id,
			prompt,
			type,
			description,
			status: "pending",
			process: childProcess,
			createdAt: new Date(),
			tokensUsed: 0,
			toolCallCount: 0,
			workingDir,
			lastEventAt: Date.now(),
		};

		this.tasks.set(id, task);
		this.emitUpdate();

		let tokenCount = 0;
		const receiver = new ChunkReceiver();
		let ready = false;
		let started = false;

		const readyTimeout = setTimeout(() => {
			if (!ready) {
				debug.log(
					"agent",
					`Subagent ${id} did not become ready in ${READY_TIMEOUT_MS}ms`,
				);
				finishWithError("Subagent did not become ready (timeout)");
			}
		}, READY_TIMEOUT_MS);
		readyTimeout.unref();

		const watchdogInterval = setInterval(() => {
			if (
				task.status === "completed" ||
				task.status === "failed" ||
				task.status === "killed"
			) {
				clearInterval(watchdogInterval);
				return;
			}
			if (task.lastEventAt && Date.now() - task.lastEventAt > 120_000) {
				debug.log("agent", `Subagent ${id} watchdog timeout`);
				finishWithError(
					"Subagent did not respond within 2 minutes (watchdog timeout)",
				);
			}
		}, 30_000);
		watchdogInterval.unref();

		const finishWithError = (errMsg: string) => {
			// State machine: only transition from non-terminal states.
			if (
				task.status === "completed" ||
				task.status === "failed" ||
				task.status === "killed"
			) {
				return;
			}
			task.status = "failed";
			task.error = errMsg;
			task.endedAt = new Date();
			this.emitUpdate();
			if (parentContext) {
				agentEventBus.emit(
					"wakeup",
					`[Task Completed] Subagent ${id} failed: ${errMsg}`,
				);
			}
			killChild(childProcess, HARD_KILL_GRACE_MS);
		};

		const finishWithResult = (result: AgentLoopResult) => {
			// State machine: only transition from non-terminal states.
			if (
				task.status === "completed" ||
				task.status === "failed" ||
				task.status === "killed"
			) {
				return;
			}
			task.status = "completed";
			task.result = result;
			task.endedAt = new Date();
			this.emitUpdate();
			if (parentContext) {
				agentEventBus.emit(
					"wakeup",
					`[Task Completed] Subagent ${id} completed`,
				);
			}
			// Give the IPC channel a tick to flush, then exit cleanly.
			setImmediate(() => {
				if (childProcess.exitCode === null) childProcess.kill();
			});
		};

		const handleMessage = (type: string, payload: any) => {
			task.lastEventAt = Date.now();
			switch (type) {
				case "ready":
					ready = true;
					clearTimeout(readyTimeout);
					if (!started) {
						started = true;
						task.status = "running";
						task.startedAt = new Date();
						this.emitUpdate();
					}
					// Now it is safe to send the start payload.
					try {
						childProcess.send({
							type: "start",
							payload: { prompt, workingDir },
						});
					} catch (err) {
						finishWithError(
							`Failed to dispatch start: ${(err as Error).message}`,
						);
					}
					break;

				case "token":
					task.tokensUsed++;
					tokenCount++;
					if (tokenCount % 20 === 0) {
						this.emitUpdate();
					}
					break;

				case "thinking":
					// Surface thinking to any UI listener; do not count as a tool call.
					this.emit("thinking", { id, content: payload });
					break;

				case "tool_call":
					task.toolCallCount++;
					this.emit("tool_call", { id, call: payload });
					break;

				case "tool_result":
					this.emit("tool_result", { id, result: payload });
					break;

				case "progress":
					this.emit("progress", { id, progress: payload });
					break;

				case "completed":
					finishWithResult(payload as AgentLoopResult);
					break;

				case "error":
					finishWithError(
						typeof payload === "string" ? payload : serializeUnknown(payload),
					);
					break;

				default:
					debug.log("agent", `Subagent ${id}: unknown message type "${type}"`);
			}
		};

		childProcess.on("message", (msg: any) => {
			if (msg && typeof msg.type === "string" && msg.type.endsWith("_chunk")) {
				const { complete, payload } = receiver.receive(msg);
				if (complete) {
					const baseType = msg.type.replace(/_chunk$/, "");
					handleMessage(baseType, payload);
				}
			} else if (msg && typeof msg.type === "string") {
				handleMessage(msg.type, msg.payload);
			}
		});

		// Drain the child's stdout/stderr so the pipe buffer cannot fill up
		// and deadlock the child. We discard the content but keep a tail in
		// the debug log for diagnostics.
		const drain = (stream: NodeJS.ReadableStream, label: string) => {
			let buf = "";
			stream.on("data", (chunk: Buffer | string) => {
				buf += chunk.toString();
				if (buf.length > 4096) buf = buf.slice(-4096);
			});
			stream.on("end", () => {
				if (buf.trim()) {
					debug.log("agent", `Subagent ${id} ${label}: ${buf.trim()}`);
				}
			});
		};
		if (childProcess.stdout) drain(childProcess.stdout, "stdout");
		if (childProcess.stderr) drain(childProcess.stderr, "stderr");

		const cleanupProcess = () => {
			clearTimeout(readyTimeout);
			clearInterval(watchdogInterval);
			if (typeof childProcess.removeAllListeners === "function") {
				childProcess.removeAllListeners();
			}
			if (childProcess.stdout && typeof childProcess.stdout.removeAllListeners === "function") {
				childProcess.stdout.removeAllListeners();
			}
			if (childProcess.stderr && typeof childProcess.stderr.removeAllListeners === "function") {
				childProcess.stderr.removeAllListeners();
			}
			task.process = undefined;
		};

		childProcess.on("error", (error) => {
			clearTimeout(readyTimeout);
			clearInterval(watchdogInterval);
			debug.log("agent", `Subagent ${id} error:`, error);
			finishWithError(error.message);
			if (childProcess.pid === undefined) {
				cleanupProcess();
			}
		});

		childProcess.on("exit", (code, signal) => {
			clearTimeout(readyTimeout);
			clearInterval(watchdogInterval);
			// If we already recorded a terminal status, this exit is expected.
			if (
				task.status === "completed" ||
				task.status === "failed" ||
				task.status === "killed"
			) {
				cleanupProcess();
				return;
			}
			const reason =
				signal === "SIGTERM" || signal === "SIGKILL"
					? `Subagent exited via ${signal} (likely killed) before reporting completion`
					: `Subagent exited with code ${code} before reporting completion`;
			finishWithError(reason);
			cleanupProcess();
		});

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
		if (!task) return false;
		// Idempotent: killing a non-running task is a no-op success.
		if (task.status !== "running" && task.status !== "pending") {
			return true;
		}
		task.status = "killed";
		task.endedAt = new Date();
		const cp = task.process;
		if (cp) {
			killChild(cp, HARD_KILL_GRACE_MS);
		}
		this.emitUpdate();
		if (cp) {
			// Wake parent loop if it is sleeping waiting for this subagent.
			agentEventBus.emit("wakeup", `[Task Completed] Subagent ${id} killed`);
		}
		return true;
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
		if (!task.process) {
			return { success: false, error: "no_process" };
		}
		try {
			task.process.send({
				type: "message",
				payload: `[Message from Parent]: ${message}`,
			});
			return { success: true };
		} catch (err) {
			return {
				success: false,
				error: `send_failed: ${(err as Error).message}`,
			};
		}
	}

	/**
	 * Wait for one or more subagents to reach a terminal state. Resolves with
	 * the current view of each requested id. Times out after `timeoutMs` and
	 * returns whatever state each task is in at that point.
	 */
	public async awaitSubagents(
		ids: string[],
		timeoutMs = 60_000,
	): Promise<
		Array<{
			id: string;
			status: string;
			result?: AgentLoopResult;
			error?: string;
		}>
	> {
		const deadline = Date.now() + timeoutMs;
		const POLL_INTERVAL = 250;

		while (Date.now() < deadline) {
			const views = ids.map((id) => {
				const t = this.tasks.get(id);
				if (!t) {
					return { id, status: "not_found" };
				}
				return {
					id: t.id,
					status: t.status,
					result: t.result,
					error: t.error,
				};
			});

			const allDone = views.every(
				(v) =>
					v.status === "completed" ||
					v.status === "failed" ||
					v.status === "killed" ||
					v.status === "not_found",
			);
			if (allDone) return views;

			await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
		}

		return ids.map((id) => {
			const t = this.tasks.get(id);
			if (!t) return { id, status: "not_found" };
			return {
				id: t.id,
				status: t.status,
				result: t.result,
				error:
					t.error ?? (t.status === "running" ? "await timeout" : undefined),
			};
		});
	}

	public exportState(): Record<string, Omit<SubagentTask, "process">> {
		const state: Record<string, Omit<SubagentTask, "process">> = {};
		for (const [id, task] of this.tasks.entries()) {
			const { process: _process, ...rest } = task;
			state[id] = rest;
		}
		return state;
	}

	public importState(
		state: Record<string, Partial<SubagentTask>> | null | undefined,
	): void {
		if (!state) return;
		for (const [id, taskData] of Object.entries(state)) {
			// Tasks imported from a previous process can never be 'running' —
			// their child process is gone. Mark them as 'killed'.
			const status: SubagentTask["status"] =
				taskData.status === "running" || taskData.status === "pending"
					? "killed"
					: (taskData.status ?? "killed");

			this.tasks.set(id, {
				id,
				prompt: taskData.prompt ?? "",
				type: taskData.type,
				description: taskData.description,
				status,
				result: taskData.result,
				error:
					taskData.error ??
					(status === "killed" ? "Lost on restart" : undefined),
				createdAt: toDate(taskData.createdAt) ?? new Date(),
				startedAt: toDate(taskData.startedAt),
				endedAt: toDate(taskData.endedAt),
				tokensUsed: taskData.tokensUsed ?? 0,
				toolCallCount: taskData.toolCallCount ?? 0,
				workingDir: taskData.workingDir,
			});
		}
		this.emitUpdate();
	}
}

function killChild(cp: ChildProcess, graceMs: number) {
	if (cp.exitCode !== null) return;
	try {
		cp.kill("SIGTERM");
	} catch {
		/* ignore */
	}
	const timer = setTimeout(() => {
		if (cp.exitCode === null) {
			try {
				cp.kill("SIGKILL");
			} catch {
				/* ignore */
			}
		}
	}, graceMs);
	timer.unref();
}

function toDate(value: unknown): Date | undefined {
	if (!value) return undefined;
	if (value instanceof Date) return value;
	if (typeof value === "string" || typeof value === "number") {
		const d = new Date(value);
		return Number.isNaN(d.getTime()) ? undefined : d;
	}
	return undefined;
}

function serializeUnknown(value: unknown): string {
	if (value instanceof Error) return value.message;
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

export const swarmManager = SwarmManager.getInstance();
