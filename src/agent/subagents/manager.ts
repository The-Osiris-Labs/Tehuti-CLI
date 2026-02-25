import { randomUUID } from "node:crypto";
import type { AgentContext } from "../context.js";
import { createAgentContext } from "../context.js";
import type { AgentLoopOptions, AgentLoopResult } from "../index.js";
import { runAgentLoop } from "../index.js";

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

		const subContext = await createAgentContext(
			options.parentContext.cwd,
			options.parentContext.config,
		);

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
