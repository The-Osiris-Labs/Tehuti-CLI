import { randomUUID } from "node:crypto";
import type { AgentContext } from "../context.js";
import { createAgentContext } from "../context.js";
import { runAgentLoop } from "../index.js";
import type { AgentLoopOptions, AgentLoopResult } from "../loop/runner.js";

export type SubagentType = "general" | "explore" | "code" | "debug";

export interface SubagentTask {
	id: string;
	type: SubagentType;
	description: string;
	prompt: string;
	status: "pending" | "running" | "completed" | "failed";
	result?: AgentLoopResult;
	startTime?: Date;
	endTime?: Date;
	abortController?: AbortController;
	context?: any;
}

export interface SubagentOptions {
	type: SubagentType;
	description: string;
	prompt: string;
	parentContext: AgentContext;
	task_id?: string;
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

export async function spawnSubagent(
	options: SubagentOptions,
): Promise<SubagentTask> {
	const taskId = options.task_id ?? randomUUID();

	const task: SubagentTask = {
		id: taskId,
		type: options.type,
		description: options.description,
		prompt: options.prompt,
		status: "pending",
	};

	activeTasks.set(taskId, task);

	try {
		task.status = "running";
		task.startTime = new Date();
		const abortController = new AbortController();
		task.abortController = abortController;

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
			onToolCall: (_id, _name, _args) => {},
			onToolResult: () => {},
			onThinking: () => {},
			signal: abortController.signal,
		};

		const result = await runAgentLoop(subContext, "", loopOptions);

		task.result = result;
		task.status = result.success ? "completed" : "failed";
		task.endTime = new Date();

		return task;
	} catch (error) {
		task.status = "failed";
		task.endTime = new Date();
		task.result = {
			content: "",
			toolCalls: 0,
			success: false,
			finishReason: "error",
		};
		throw error;
	}
}

export function getTask(taskId: string): SubagentTask | undefined {
	return activeTasks.get(taskId);
}

export function getActiveTasks(): SubagentTask[] {
	return Array.from(activeTasks.values()).filter(
		(t) => t.status === "running" || t.status === "pending",
	);
}

export function clearCompletedTasks(): number {
	let cleared = 0;
	for (const [id, task] of activeTasks) {
		if (task.status === "completed" || task.status === "failed") {
			activeTasks.delete(id);
			cleared++;
		}
	}
	return cleared;
}

export function abortTask(taskId: string): boolean {
	const task = activeTasks.get(taskId);
	if (task && (task.status === "running" || task.status === "pending")) {
		task.abortController?.abort();
		task.status = "failed"; // Aborted counts as failed or killed
		task.endTime = new Date();
		return true;
	}
	return false;
}

export function sendMessageToTask(
	taskId: string,
	message: string,
): { success: boolean; status?: string; error?: string } {
	const task = activeTasks.get(taskId);
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
			import("../events.js").then(({ agentEventBus }) => {
				agentEventBus.emit("wakeup", `Message received for task ${taskId}`);
			});
		}
		return { success: true };
	}
	return { success: false, error: "no_context" };
}

export function exportState(): any {
	const state: any = {};
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
		};
	}
	return state;
}

export function importState(state: any): void {
	if (!state) return;
	for (const [id, taskData] of Object.entries(state)) {
		const status = (taskData as any).status === "running" ? "failed" : (taskData as any).status;
		activeTasks.set(id, {
			...(taskData as any),
			status,
			startTime: (taskData as any).startTime ? new Date((taskData as any).startTime) : undefined,
			endTime: (taskData as any).endTime ? new Date((taskData as any).endTime) : undefined,
		} as SubagentTask);
	}
}
