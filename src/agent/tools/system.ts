import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { addNode } from "../memory/graph.js";
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
				parentId: z
					.string()
					.optional()
					.describe("Parent task ID for hierarchical nesting"),
				content: z.string().describe("Brief description of the task"),
				status: z
					.enum(["pending", "in_progress", "completed", "cancelled"])
					.describe("Current status of the task"),
				priority: z
					.enum(["high", "medium", "low"])
					.describe("Priority level of the task"),
				createdAt: z
					.string()
					.datetime()
					.describe("ISO 8601 creation timestamp"),
				updatedAt: z.string().datetime().describe("ISO 8601 update timestamp"),
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
	createdAt: z
		.string()
		.datetime()
		.default(() => new Date().toISOString())
		.describe("ISO 8601 creation timestamp"),
	updatedAt: z
		.string()
		.datetime()
		.default(() => new Date().toISOString())
		.describe("ISO 8601 update timestamp"),
});

const WAIT_FOR_EVENT_SCHEMA = z.object({
	reason: z
		.string()
		.describe(
			"Reason for waiting (e.g., 'waiting for background process PID 123 to finish')",
		),
});

function getBacklogPath(): string {
	const safePath = process.cwd().replace(/[^a-zA-Z0-9]/g, "_");
	return path.join(
		os.homedir(),
		".config",
		"tehuti",
		"backlogs",
		`${safePath}.json`,
	);
}

function loadTodos(): z.infer<typeof TODO_WRITE_SCHEMA>["todos"] {
	try {
		const filePath = getBacklogPath();
		if (fs.existsSync(filePath)) {
			const data = fs.readFileSync(filePath, "utf-8");
			const rawTodos = JSON.parse(data) as z.infer<
				typeof TODO_WRITE_SCHEMA
			>["todos"];

			// Garbage collect completed/cancelled tasks older than 24 hours on load
			// Also drop any pending/in_progress tasks since they are orphaned from previous processes
			const ONE_DAY = 24 * 60 * 60 * 1000;
			const now = Date.now();
			const activeTodos = rawTodos.filter((t) => {
				if (!t.updatedAt) return false;
				const age = now - new Date(t.updatedAt).getTime();
				if (age >= ONE_DAY) return false;
				if (t.status === "in_progress" || t.status === "pending") {
					return false;
				}
				return true;
			});

			// If we dropped any, we should resave
			if (activeTodos.length !== rawTodos.length) {
				setTimeout(() => saveTodos(activeTodos), 0);
			}
			return activeTodos;
		}
	} catch (error) {
		// Ignore errors
	}
	return [];
}

function saveTodos(todos: z.infer<typeof TODO_WRITE_SCHEMA>["todos"]): void {
	try {
		const filePath = getBacklogPath();
		const dirPath = path.dirname(filePath);
		if (!fs.existsSync(dirPath)) {
			fs.mkdirSync(dirPath, { recursive: true });
		}
		fs.writeFileSync(filePath, JSON.stringify(todos, null, 2), "utf-8");
	} catch (error) {
		// Ignore errors
	}
}

let currentTodos: z.infer<typeof TODO_WRITE_SCHEMA>["todos"] = loadTodos();
/** Per-session parent context — keyed by sessionId to prevent cross-session corruption. */
const parentContextMap = new Map<string, AgentContext>();
/** Per-session question resolver — keyed by sessionId. */
const questionResolverMap = new Map<
	string,
	(questions: QuestionData[]) => Promise<string[]>
>();

function sessionKey(ctx: { sessionId?: string }): string {
	return ctx.sessionId ?? "default";
}

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
	parentContextMap.set(sessionKey(ctx), ctx);
}

export function setQuestionResolver(
	resolver: (questions: QuestionData[]) => Promise<string[]>,
	sessionId?: string,
): void {
	questionResolverMap.set(sessionId ?? "default", resolver);
}

export function clearSystemState(sessionId?: string): void {
	currentTodos = loadTodos();
	if (sessionId) {
		parentContextMap.delete(sessionId);
		questionResolverMap.delete(sessionId);
	} else {
		parentContextMap.clear();
		questionResolverMap.clear();
	}
}

async function writeTodos(
	args: z.infer<typeof TODO_WRITE_SCHEMA>,
	ctx: ToolContext,
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

	// Detect newly completed todos for memory storage
	const newlyCompleted = args.todos.filter(
		t => t.status === "completed" && !currentTodos.some(ct => ct.id === t.id && ct.status === "completed"),
	);

	currentTodos = args.todos;
	saveTodos(currentTodos);

	// Store completed todos as memory insights for persistence across sessions
	for (const todo of newlyCompleted) {
		await addNode(
			`todo-done-${todo.id}`,
			"insight",
			`Completed: ${todo.content}`,
			ctx.cwd,
			todo.priority === "high" ? 3 : todo.priority === "medium" ? 2 : 1,
			0,
			"verified_fact",
			1.0,
		);
	}

	type TodoItem = (typeof args.todos)[number];
	interface TreeNode extends TodoItem {
		children: TreeNode[];
	}

	// Build tree from flat list
	const nodeMap = new Map<string, TreeNode>();
	const roots: TreeNode[] = [];
	for (const todo of args.todos) {
		nodeMap.set(todo.id, { ...todo, children: [] });
	}
	for (const todo of args.todos) {
		const node = nodeMap.get(todo.id)!;
		if (todo.parentId && nodeMap.has(todo.parentId)) {
			nodeMap.get(todo.parentId)!.children.push(node);
		} else {
			roots.push(node);
		}
	}

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

	function formatTreeNode(
		node: TreeNode,
		prefix: string,
		isLast: boolean,
	): string[] {
		const connector = isLast ? "└─ " : "├─ ";
		const status = statusEmoji[node.status];
		const priority = priorityEmoji[node.priority];
		const line = `${prefix}${connector}${status} ${priority} [${node.id}] ${node.content}`;
		const childLines: string[] = [];
		for (let i = 0; i < node.children.length; i++) {
			const childPrefix = prefix + (isLast ? "   " : "│  ");
			childLines.push(
				...formatTreeNode(node.children[i], childPrefix, i === node.children.length - 1),
			);
		}
		return [line, ...childLines];
	}

	const lines = roots.flatMap((node, i) =>
		formatTreeNode(node, "", i === roots.length - 1),
	);

	return {
		success: true,
		output: lines.join("\n") || "No todos",
		metadata: { count: args.todos.length },
	};
}

async function todoComplete(
	args: { id: string },
	_ctx: ToolContext,
): Promise<ToolResult> {
	const todo = currentTodos.find((t) => t.id === args.id);
	if (!todo) {
		return {
			success: false,
			output: "",
			error: `Todo '${args.id}' not found`,
		};
	}
	todo.status = "completed";
	todo.updatedAt = new Date().toISOString();
	saveTodos(currentTodos);
	return {
		success: true,
		output: `✅ Marked '${args.id}' as completed`,
	};
}

async function todoDelete(
	args: { id: string },
	_ctx: ToolContext,
): Promise<ToolResult> {
	const index = currentTodos.findIndex((t) => t.id === args.id);
	if (index === -1) {
		return {
			success: false,
			output: "",
			error: `Todo '${args.id}' not found`,
		};
	}
	currentTodos.splice(index, 1);
	saveTodos(currentTodos);
	return {
		success: true,
		output: `Deleted '${args.id}'`,
	};
}

async function spawnTask(
	args: z.infer<typeof TASK_SCHEMA>,
	_ctx: ToolContext,
): Promise<ToolResult> {
	const parentCtx = parentContextMap.get(
		_ctx.agentContext?.sessionId ?? "default",
	);
	if (!parentCtx) {
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

	let timeoutId: NodeJS.Timeout | undefined;

	const subagentPromise = spawnSubagent({
		type: subagent_type as SubagentType,
		description,
		prompt,
		parentContext: parentCtx,
		task_id,
		timeoutMs: timeout,
	}).finally(() => {
		clearTimeout(timeoutId);
	});

	const timeoutPromise = new Promise<never>((_, reject) => {
		timeoutId = setTimeout(() => {
			reject(new Error(`Task timed out after ${timeout}ms`));
		}, timeout);
		timeoutId.unref();
	});

	try {
		const task = await Promise.race([
			subagentPromise,
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
	const resolver = questionResolverMap.get(
		ctx.agentContext?.sessionId ?? "default",
	);
	if (!resolver) {
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

		const answers = await resolver(questionData);

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

async function waitForEvent(
	args: z.infer<typeof WAIT_FOR_EVENT_SCHEMA>,
	ctx: ToolContext,
): Promise<ToolResult> {
	if (!ctx.agentContext) {
		return {
			success: false,
			output: "",
			error: "Agent context not available. Cannot sleep.",
		};
	}

	ctx.agentContext.isSleeping = true;

	return {
		success: true,
		output: `Agent is now sleeping. Reason: ${args.reason}. The loop will pause and automatically wake up when an event occurs.`,
	};
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
		isReadonly: true,
	},
	{
		name: "todo_complete",
		description: "Mark a specific todo item as completed by ID",
		parameters: z.object({
			id: z.string().describe("ID of the todo to mark complete"),
		}),
		execute: todoComplete as AnyToolExecutor,
		category: "system",
		requiresPermission: false,
		isReadonly: true,
	},
	{
		name: "todo_delete",
		description: "Delete a todo item by ID",
		parameters: z.object({
			id: z.string().describe("ID of the todo to delete"),
		}),
		execute: todoDelete as AnyToolExecutor,
		category: "system",
		requiresPermission: false,
		isReadonly: true,
	},
	{
		name: "task",
		description:
			"Launch a new agent to handle complex, multistep tasks autonomously. Use for exploration, research, or parallel execution.",
		parameters: TASK_SCHEMA,
		execute: spawnTask as AnyToolExecutor,
		category: "system",
		requiresPermission: false,
		isReadonly: true,
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
		isReadonly: true,
	},
	{
		name: "wait_for_event",
		description:
			"Suspends the agent's execution loop until a background process or subagent finishes. Use this after launching a background task or subagent if you need to wait for its results before proceeding.",
		parameters: WAIT_FOR_EVENT_SCHEMA,
		execute: waitForEvent as AnyToolExecutor,
		category: "system",
		requiresPermission: false,
		isReadonly: true,
	},
];

export function getTodos() {
	return currentTodos;
}

export function getTodosByPhase(): Record<string, z.infer<typeof TODO_WRITE_SCHEMA>["todos"]> {
	const todos = getTodos();
	const phases: Record<string, z.infer<typeof TODO_WRITE_SCHEMA>["todos"]> = {};
	for (const todo of todos) {
		const phase = todo.id.split(/[./]/)[0];
		if (!phases[phase]) phases[phase] = [];
		phases[phase].push(todo);
	}
	return phases;
}

export function clearTodos() {
	currentTodos = [];
	saveTodos(currentTodos);
}

export function completeTodoById(id: string): boolean {
	const todo = currentTodos.find((t) => t.id === id);
	if (!todo) return false;
	todo.status = "completed";
	todo.updatedAt = new Date().toISOString();
	saveTodos(currentTodos);
	return true;
}

export function deleteTodoById(id: string): boolean {
	const index = currentTodos.findIndex((t) => t.id === id);
	if (index === -1) return false;
	currentTodos.splice(index, 1);
	saveTodos(currentTodos);
	return true;
}
