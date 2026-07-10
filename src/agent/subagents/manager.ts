import { randomUUID } from "node:crypto";
import type { AgentContext } from "../context.js";
import { createAgentContext } from "../context.js";
import { agentEventBus } from "../events.js";
import { runAgentLoop } from "../index.js";
import type { AgentLoopOptions, AgentLoopResult } from "../loop/runner.js";

export type SubagentType = "general" | "explore" | "code" | "debug";

export interface SubagentTask {
	id: string;
	type: SubagentType;
	description: string;
	prompt: string;
	status: "pending" | "running" | "completed" | "failed" | "killed";
	result?: AgentLoopResult;
	startTime?: Date;
	endTime?: Date;
	abortController?: AbortController;
	context?: AgentContext;
	error?: string;
}

export interface SubagentOptions {
	type: SubagentType;
	description: string;
	prompt: string;
	parentContext: AgentContext;
	task_id?: string;
	timeoutMs?: number;
}

const SYSTEM_PROMPTS: Record<SubagentType, string> = {
	general: `You are a general-purpose agent for handling complex, multistep tasks autonomously.
- Execute multiple units of work efficiently
- Report back with clear, structured results
- Focus on completing the assigned task thoroughly`,

	explore: `You are a fast agent specialized in exploring codebases.
- Quickly find files by patterns (e.g., "src/components/**/*.tsx")
- Search code for keywords (e.g., "API endpoints")
- Answer questions about the codebase structure and patterns
- Be thorough but efficient in your exploration
- Provide concise summaries of your findings`,

	code: `You are a code generation agent specialized in writing high-quality code.
- Write clean, well-structured, idiomatic code
- Follow existing project conventions and patterns
- Include appropriate error handling
- Consider edge cases and test coverage
- Document your code appropriately`,

	debug: `You are a debugging agent specialized in finding and fixing issues.
- Analyze error messages and stack traces
- Identify root causes systematically
- Propose and implement fixes
- Verify fixes resolve the issue
- Document the problem and solution`,
};

const activeTasks = new Map<string, SubagentTask>();

/**
 * Terminal state predicate. Any further status mutations on terminal tasks
 * are no-ops, which prevents the "completed then failed" double-finish bug
 * seen in earlier revisions when an error arrives after success.
 */
function isTerminal(status: SubagentTask["status"]): boolean {
	return status === "completed" || status === "failed" || status === "killed";
}

export async function spawnSubagent(
	options: SubagentOptions,
): Promise<SubagentTask> {
	const taskId = options.task_id ?? randomUUID();

	// Reject re-use of an active task id.
	const existing = activeTasks.get(taskId);
	if (existing && !isTerminal(existing.status)) {
		throw new Error(`Subagent ${taskId} is already ${existing.status}`);
	}

	const task: SubagentTask = {
		id: taskId,
		type: options.type,
		description: options.description,
		prompt: options.prompt,
		status: "pending",
	};

	activeTasks.set(taskId, task);

	const abortController = new AbortController();
	task.abortController = abortController;
	task.status = "running";
	task.startTime = new Date();

	// Wire parent-initiated abort to the local controller. The runner's
	// AbortSignal is the one that actually interrupts the loop.
	const externalTimeoutMs = options.timeoutMs;
	let externalTimeout: NodeJS.Timeout | null = null;
	if (typeof externalTimeoutMs === "number" && externalTimeoutMs > 0) {
		externalTimeout = setTimeout(() => {
			task.status = "killed";
			abortController.abort(new Error(`Subagent ${taskId} timed out`));
		}, externalTimeoutMs);
		externalTimeout.unref();
	}

	try {
		const subContext = await createAgentContext(
			options.parentContext.cwd,
			options.parentContext.config,
		);
		task.context = subContext;

		const systemPrompt = SYSTEM_PROMPTS[options.type];
		subContext.messages.push({
			role: "system",
			content: `${systemPrompt}

## Task
${options.prompt}

## Instructions
- Complete the task autonomously
- Return your findings/results in your final message
- Be thorough but concise`,
		});

		const loopOptions: AgentLoopOptions = {
			onToken: () => {},
			onToolCall: () => {},
			onToolResult: () => {},
			onThinking: () => {},
			signal: abortController.signal,
		};

		const result = await runAgentLoop(subContext, "", loopOptions);

		if (isTerminal(task.status)) {
			// Aborted (killed) during the loop. Return the task as-is.
			return task;
		}

		task.result = result;
		task.status = result.success ? "completed" : "failed";
		if (!result.success) {
			task.error =
				result.error ?? result.finishReason ?? "loop reported failure";
		}
		task.endTime = new Date();

		return task;
	} catch (error) {
		if (isTerminal(task.status)) {
			// Already in a terminal state (e.g., aborted). Preserve the task as-is
			// but record the error message if we don't already have one.
			if (!task.error) {
				task.error = error instanceof Error ? error.message : String(error);
			}
			return task;
		}
		task.status = "failed";
		task.endTime = new Date();
		task.error = error instanceof Error ? error.message : String(error);
		task.result = task.result ?? {
			content: "",
			toolCalls: 0,
			success: false,
			finishReason: "error",
		};
		throw error;
	} finally {
		if (externalTimeout) clearTimeout(externalTimeout);
	}
}

export function getTask(taskId: string): SubagentTask | undefined {
	return activeTasks.get(taskId);
}

export function getActiveTasks(): SubagentTask[] {
	return Array.from(activeTasks.values()).filter((t) => !isTerminal(t.status));
}

export function clearCompletedTasks(): number {
	let cleared = 0;
	for (const [id, task] of activeTasks) {
		if (isTerminal(task.status)) {
			activeTasks.delete(id);
			cleared++;
		}
	}
	return cleared;
}

export function abortTask(taskId: string): boolean {
	const task = activeTasks.get(taskId);
	if (!task) return false;
	if (isTerminal(task.status)) return true;
	task.status = "killed";
	task.endTime = new Date();
	task.abortController?.abort(new Error(`Subagent ${taskId} aborted`));
	return true;
}

/**
 * Inject a message into a running subagent's loop. The message is queued
 * for the loop's `injectionQueue` so the running iteration can pick it up
 * cleanly between tool calls. If the subagent is sleeping, we also emit
 * a wakeup so the loop resumes immediately.
 */
export function sendMessageToTask(
	taskId: string,
	message: string,
): { success: boolean; status?: string; error?: string } {
	const task = activeTasks.get(taskId);
	if (!task) {
		return { success: false, error: "not_found" };
	}
	if (isTerminal(task.status)) {
		return { success: false, status: task.status, error: "not_running" };
	}
	if (!task.context) {
		return { success: false, error: "no_context" };
	}

	task.context.injectionQueue.push(`[Message from Parent]: ${message}`);

	if (task.context.isSleeping) {
		agentEventBus.emit("wakeup", `Message received for task ${taskId}`);
	}

	return { success: true, status: task.status };
}

export function exportState(): Record<string, unknown> {
	const state: Record<string, unknown> = {};
	for (const [id, task] of activeTasks.entries()) {
		state[id] = {
			id: task.id,
			type: task.type,
			description: task.description,
			prompt: task.prompt,
			status: task.status,
			result: task.result,
			startTime: task.startTime,
			endTime: task.endTime,
			error: task.error,
		};
	}
	return state;
}

export function importState(
	state: Record<string, unknown> | null | undefined,
): void {
	if (!state) return;
	for (const [id, taskData] of Object.entries(state)) {
		const data = taskData as Partial<SubagentTask>;
		const incomingStatus = (data.status as SubagentTask["status"]) ?? "killed";
		// In-flight tasks cannot survive a restart. Mark them killed so the
		// caller does not see stale 'running' tasks with no live context.
		const status: SubagentTask["status"] = isTerminal(incomingStatus)
			? incomingStatus
			: "killed";

		activeTasks.set(id, {
			id,
			type: (data.type as SubagentType) ?? "general",
			description: data.description ?? "",
			prompt: data.prompt ?? "",
			status,
			result: data.result,
			error:
				data.error ?? (status === "killed" ? "Lost on restart" : undefined),
			startTime: toDate(data.startTime),
			endTime: toDate(data.endTime),
		});
	}
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
