import { z } from "zod";
import type { AgentContext } from "../context.js";
import { type SubagentType, spawnSubagent } from "../subagents/manager.js";
import type {
	AnyToolExecutor,
	ToolContext,
	ToolDefinition,
	ToolResult,
} from "./registry.js";

const TODO_WRITE_SCHEMA = z.object({
	todos: z
		.array(
			z.object({
				id: z.string().describe("Unique identifier for the todo item"),
				content: z.string().describe("Brief description of the task"),
				status: z
					.enum(["pending", "in_progress", "completed", "cancelled"])
					.describe("Current status of the task"),
				priority: z
					.enum(["high", "medium", "low"])
					.describe("Priority level of the task"),
			}),
		)
		.describe("The updated todo list"),
});

const QUESTION_SCHEMA = z.object({
	questions: z
		.array(
			z.object({
				question: z.string().describe("Complete question to ask the user"),
				header: z.string().max(30).describe("Very short label (max 30 chars)"),
				options: z
					.array(
						z.object({
							label: z.string().describe("Display text (1-5 words, concise)"),
							description: z.string().describe("Explanation of choice"),
							mode: z
								.string()
								.optional()
								.describe("Optional agent/mode to switch to when selected"),
						}),
					)
					.describe("Available choices"),
				multiple: z
					.boolean()
					.optional()
					.describe("Allow selecting multiple choices"),
			}),
		)
		.describe("Questions to ask"),
});

const TASK_SCHEMA = z.object({
	description: z.string().describe("Short (3-5 words) description of the task"),
	prompt: z.string().describe("The task for the agent to perform"),
	subagent_type: z
		.enum(["general", "explore", "code", "debug"])
		.optional()
		.describe("Type of specialized agent"),
	task_id: z
		.string()
		.optional()
		.describe("Optional ID to resume a previous task session"),
	timeout: z
		.number()
		.int()
		.positive()
		.optional()
		.describe("Timeout in milliseconds (default: 60000)"),
});

let currentTodos: z.infer<typeof TODO_WRITE_SCHEMA>["todos"] = [];
let parentContext: AgentContext | null = null;
let questionResolver:
	| ((questions: QuestionData[]) => Promise<string[]>)
	| null = null;

export interface QuestionOption {
	label: string;
	description?: string;
	mode?: string;
}

export interface QuestionData {
	question: string;
	header: string;
	options: QuestionOption[];
	multiple: boolean;
}

export function setParentContext(ctx: AgentContext): void {
	parentContext = ctx;
}

export function setQuestionResolver(
	resolver: (questions: QuestionData[]) => Promise<string[]>,
): void {
	questionResolver = resolver;
}

export function clearSystemState(): void {
	currentTodos = [];
	parentContext = null;
	questionResolver = null;
}

async function writeTodos(
	args: z.infer<typeof TODO_WRITE_SCHEMA>,
	_ctx: ToolContext,
): Promise<ToolResult> {
	const seenIds = new Set<string>();
	for (const todo of args.todos) {
		if (seenIds.has(todo.id)) {
			return {
				success: false,
				output: "",
				error: `Duplicate todo ID: ${todo.id}. Each todo must have a unique ID.`,
			};
		}
		seenIds.add(todo.id);
	}

	currentTodos = args.todos;

	const statusEmoji = {
		pending: "⏳",
		in_progress: "🔄",
		completed: "✅",
		cancelled: "❌",
	};

	const priorityEmoji = {
		high: "🔴",
		medium: "🟡",
		low: "🟢",
	};

	const lines = args.todos.map((todo) => {
		const status = statusEmoji[todo.status];
		const priority = priorityEmoji[todo.priority];
		return `${status} ${priority} [${todo.id}] ${todo.content}`;
	});

	return {
		success: true,
		output: lines.join("\n") || "No todos",
		metadata: { count: args.todos.length },
	};
}

async function spawnTask(
	args: z.infer<typeof TASK_SCHEMA>,
	_ctx: ToolContext,
): Promise<ToolResult> {
	if (!parentContext) {
		return {
			success: false,
			output: "",
			error:
				"Subagent context not initialized. Task spawning requires an active agent context.",
		};
	}

	const {
		description,
		prompt,
		subagent_type = "general",
		task_id,
		timeout = 60000,
	} = args;

	const timeoutPromise = new Promise<never>((_, reject) => {
		setTimeout(
			() => reject(new Error(`Task timed out after ${timeout}ms`)),
			timeout,
		);
	});

	try {
		const task = await Promise.race([
			spawnSubagent({
				type: subagent_type as SubagentType,
				description,
				prompt,
				parentContext,
				task_id,
			}),
			timeoutPromise,
		]);

		if (task.status === "completed" && task.result) {
			return {
				success: true,
				output: task.result.content || "Task completed successfully",
				metadata: {
					taskId: task.id,
					type: task.type,
					toolCalls: task.result.toolCalls,
					duration:
						task.startTime && task.endTime
							? Math.round(
									(task.endTime.getTime() - task.startTime.getTime()) / 1000,
								)
							: 0,
				},
			};
		}

		return {
			success: false,
			output: "",
			error: task.result?.content || "Task failed to complete",
			metadata: {
				taskId: task.id,
				type: task.type,
			},
		};
	} catch (error) {
		return {
			success: false,
			output: "",
			error: `Failed to spawn subagent: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

async function askQuestion(
	args: z.infer<typeof QUESTION_SCHEMA>,
	ctx: ToolContext,
): Promise<ToolResult> {
	if (!questionResolver) {
		return {
			success: false,
			output: "",
			error:
				"No question handler available. Questions require an interactive session.",
		};
	}

	const { questions } = args;

	if (questions.length === 0) {
		return {
			success: false,
			output: "",
			error: "At least one question is required",
		};
	}

	try {
		const questionData: QuestionData[] = questions.map((q) => ({
			question: q.question,
			header: q.header,
			options: q.options.map((o) => ({
				label: o.label,
				description: o.description,
				mode: o.mode,
			})),
			multiple: q.multiple ?? false,
		}));

		if (ctx.signal?.aborted) {
			return {
				success: false,
				output: "",
				error: "Question cancelled by abort signal",
			};
		}

		const answers = await questionResolver(questionData);

		if (!answers || answers.length === 0) {
			return {
				success: false,
				output: "",
				error: "No answer provided",
			};
		}

		return {
			success: true,
			output: JSON.stringify(answers),
			metadata: {
				questionCount: questions.length,
				answers,
			},
		};
	} catch (error) {
		if (error instanceof Error && error.message === "Question cancelled") {
			return {
				success: false,
				output: "",
				error: "Question cancelled by user",
			};
		}
		return {
			success: false,
			output: "",
			error: `Failed to process questions: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

export const systemTools: ToolDefinition[] = [
	{
		name: "todo_write",
		description:
			"Use this tool to create and manage a structured task list for your current coding session. Helps track progress and demonstrate thoroughness.",
		parameters: TODO_WRITE_SCHEMA,
		execute: writeTodos as AnyToolExecutor,
		category: "system",
		requiresPermission: false,
	},
	{
		name: "task",
		description:
			"Launch a new agent to handle complex, multistep tasks autonomously. Use for exploration, research, or parallel execution.",
		parameters: TASK_SCHEMA,
		execute: spawnTask as AnyToolExecutor,
		category: "system",
		requiresPermission: false,
	},
	{
		name: "question",
		description: `Use this tool when you need to ask the user questions during execution. This allows you to:
1. Gather user preferences or requirements
2. Clarify ambiguous instructions
3. Get decisions on implementation choices as you work
4. Offer choices to the user about what direction to take.

Usage notes:
- When 'custom' is enabled (default), a "Type your own answer" option is added automatically; don't include "Other" or catch-all options
- Answers are returned as arrays of labels; set 'multiple: true' to allow selecting more than one
- If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label`,
		parameters: QUESTION_SCHEMA,
		execute: askQuestion as AnyToolExecutor,
		category: "system",
		requiresPermission: false,
	},
];

export function getTodos() {
	return currentTodos;
}

export function clearTodos() {
	currentTodos = [];
}
