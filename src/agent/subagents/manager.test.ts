import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentContext } from "../context.js";

// Mock the heavy agent loop so we can drive the manager through known
// state transitions without spinning up a real LLM.
const runAgentLoopMock = vi.fn();
vi.mock("../index.js", () => ({
	runAgentLoop: (...args: unknown[]) => runAgentLoopMock(...args),
}));

const injectionQueuePushMock = vi.fn();
const agentEventBusEmitMock = vi.fn();

vi.mock("../events.js", () => ({
	agentEventBus: {
		emit: (...args: unknown[]) => agentEventBusEmitMock(...args),
		on: () => {},
		once: () => {},
		off: () => {},
	},
	wakeupQueue: { consume: async () => "" },
}));

const createAgentContextMock = vi.fn();
vi.mock("../context.js", () => ({
	createAgentContext: (...args: unknown[]) => createAgentContextMock(...args),
}));

import * as SubagentManager from "./manager.js";

const {
	abortTask,
	clearCompletedTasks,
	getActiveTasks,
	getTask,
	importState,
	sendMessageToTask,
	spawnSubagent,
} = SubagentManager;

const mockContext = (overrides: Partial<AgentContext> = {}): AgentContext =>
	({
		cwd: process.cwd(),
		config: { provider: "opencode", model: "deepseek-v4-flash" } as any,
		messages: [],
		metadata: {} as any,
		isSleeping: false,
		modelContextLength: 0,
		...overrides,
	}) as unknown as AgentContext;

describe("subagent manager", () => {
	beforeEach(() => {
		runAgentLoopMock.mockReset();
		createAgentContextMock.mockReset();
		injectionQueuePushMock.mockReset();
		agentEventBusEmitMock.mockReset();

		createAgentContextMock.mockImplementation(
			async (cwd: string, config: unknown) => ({
				cwd,
				config,
				messages: [],
				metadata: {},
				isSleeping: false,
				modelContextLength: 0,
				injectionQueue: {
					push: (...args: unknown[]) => injectionQueuePushMock(...args),
					consumeAll: () => [],
					clear: () => {},
				},
			}),
		);
	});

	afterEach(() => {
		clearCompletedTasks();
	});

	describe("spawnSubagent", () => {
		it("marks task as completed when loop succeeds", async () => {
			runAgentLoopMock.mockResolvedValue({
				content: "ok",
				toolCalls: 2,
				success: true,
				finishReason: "stop",
			});

			const task = await spawnSubagent({
				type: "explore",
				description: "Explore repo",
				prompt: "list files",
				parentContext: mockContext(),
			});

			expect(task.status).toBe("completed");
			expect(task.result?.content).toBe("ok");
			expect(task.error).toBeUndefined();
			expect(task.startTime).toBeDefined();
			expect(task.endTime).toBeDefined();
		});

		it("marks task as failed and preserves error when loop reports failure", async () => {
			runAgentLoopMock.mockResolvedValue({
				content: "",
				toolCalls: 0,
				success: false,
				finishReason: "error",
				error: "Provider timeout",
			});

			const task = await spawnSubagent({
				type: "code",
				description: "Generate code",
				prompt: "do something",
				parentContext: mockContext(),
			});

			expect(task.status).toBe("failed");
			expect(task.error).toBe("Provider timeout");
		});

		it("uses finishReason as error message when no error field present", async () => {
			runAgentLoopMock.mockResolvedValue({
				content: "",
				toolCalls: 0,
				success: false,
				finishReason: "length",
			});

			const task = await spawnSubagent({
				type: "code",
				description: "x",
				prompt: "y",
				parentContext: mockContext(),
			});

			expect(task.status).toBe("failed");
			expect(task.error).toBe("length");
		});

		it("transitions to killed if abort is called before loop completes", async () => {
			let resolveLoop!: (value: unknown) => void;
			runAgentLoopMock.mockReturnValue(
				new Promise((resolve) => {
					resolveLoop = resolve;
				}),
			);

			const taskPromise = spawnSubagent({
				type: "debug",
				description: "long task",
				prompt: "investigate",
				parentContext: mockContext(),
			});

			await new Promise((r) => setImmediate(r));

			const running = getActiveTasks();
			expect(running.length).toBe(1);
			const id = running[0].id;

			const ok = abortTask(id);
			expect(ok).toBe(true);

			resolveLoop({
				content: "late",
				toolCalls: 0,
				success: true,
				finishReason: "stop",
			});

			const task = await taskPromise;
			expect(task.status).toBe("killed");
			expect(task.error).toBeUndefined();
		});

		it("rejects re-use of an active task id", async () => {
			let resolveLoop!: (value: unknown) => void;
			runAgentLoopMock.mockReturnValue(
				new Promise((resolve) => {
					resolveLoop = resolve;
				}),
			);

			const first = spawnSubagent({
				type: "general",
				description: "first",
				prompt: "p",
				parentContext: mockContext(),
				task_id: "dupe-id",
			});
			await new Promise((r) => setImmediate(r));

			await expect(
				spawnSubagent({
					type: "general",
					description: "second",
					prompt: "p",
					parentContext: mockContext(),
					task_id: "dupe-id",
				}),
			).rejects.toThrow(/already running/);

			resolveLoop({
				content: "x",
				toolCalls: 0,
				success: true,
				finishReason: "stop",
			});
			await first;
		});

		it("records error from a thrown exception", async () => {
			runAgentLoopMock.mockRejectedValue(new Error("boom"));

			await expect(
				spawnSubagent({
					type: "general",
					description: "x",
					prompt: "y",
					parentContext: mockContext(),
				}),
			).rejects.toThrow("boom");
		});
	});

	describe("abortTask", () => {
		it("returns false for unknown id", () => {
			expect(abortTask("nope")).toBe(false);
		});

		it("is idempotent on already-killed tasks", async () => {
			runAgentLoopMock.mockResolvedValue({
				content: "ok",
				toolCalls: 0,
				success: true,
				finishReason: "stop",
			});
			const task = await spawnSubagent({
				type: "general",
				description: "x",
				prompt: "y",
				parentContext: mockContext(),
			});
			expect(abortTask(task.id)).toBe(true);
			expect(abortTask(task.id)).toBe(true);
		});
	});

	describe("sendMessageToTask", () => {
		it("returns not_found for unknown id", () => {
			const result = sendMessageToTask("nope", "hi");
			expect(result.success).toBe(false);
			expect(result.error).toBe("not_found");
		});

		it("pushes to injectionQueue and wakes sleeping subagent", async () => {
			let resolveLoop!: (value: unknown) => void;
			runAgentLoopMock.mockReturnValue(
				new Promise((resolve) => {
					resolveLoop = resolve;
				}),
			);

			createAgentContextMock.mockImplementation(async () => ({
				cwd: process.cwd(),
				config: { provider: "opencode", model: "deepseek-v4-flash" },
				messages: [],
				metadata: {},
				isSleeping: true,
				modelContextLength: 0,
				injectionQueue: {
					push: (...args: unknown[]) => injectionQueuePushMock(...args),
					consumeAll: () => [],
					clear: () => {},
				},
			}));

			const p = spawnSubagent({
				type: "explore",
				description: "x",
				prompt: "y",
				parentContext: mockContext(),
			});
			await new Promise((r) => setImmediate(r));
			const id = getActiveTasks()[0].id;

			const result = sendMessageToTask(id, "extra context");
			expect(result.success).toBe(true);
			expect(injectionQueuePushMock).toHaveBeenCalledWith(
				"[Message from Parent]: extra context",
			);
			expect(agentEventBusEmitMock).toHaveBeenCalledWith(
				"wakeup",
				expect.stringContaining(id),
			);

			resolveLoop({
				content: "ok",
				toolCalls: 0,
				success: true,
				finishReason: "stop",
			});
			await p;
		});

		it("does not wake when subagent is not sleeping", async () => {
			let resolveLoop!: (value: unknown) => void;
			runAgentLoopMock.mockReturnValue(
				new Promise((resolve) => {
					resolveLoop = resolve;
				}),
			);

			const p = spawnSubagent({
				type: "explore",
				description: "x",
				prompt: "y",
				parentContext: mockContext(),
			});
			await new Promise((r) => setImmediate(r));
			const id = getActiveTasks()[0].id;

			agentEventBusEmitMock.mockClear();
			injectionQueuePushMock.mockClear();
			const result = sendMessageToTask(id, "ping");
			expect(result.success).toBe(true);
			expect(injectionQueuePushMock).toHaveBeenCalled();
			expect(agentEventBusEmitMock).not.toHaveBeenCalled();

			resolveLoop({
				content: "ok",
				toolCalls: 0,
				success: true,
				finishReason: "stop",
			});
			await p;
		});
	});

	describe("importState", () => {
		it("marks in-flight tasks as killed with explanatory error", () => {
			importState({
				"abc-123": {
					id: "abc-123",
					type: "general",
					description: "lost",
					prompt: "p",
					status: "running",
					startTime: new Date().toISOString(),
				},
			});
			const t = getTask("abc-123");
			expect(t?.status).toBe("killed");
			expect(t?.error).toBe("Lost on restart");
		});

		it("handles Date objects (not just ISO strings)", () => {
			importState({
				"date-test": {
					id: "date-test",
					type: "general",
					description: "d",
					prompt: "p",
					status: "completed",
					startTime: new Date(),
					endTime: new Date(),
				},
			});
			const t = getTask("date-test");
			expect(t?.status).toBe("completed");
			expect(t?.startTime).toBeInstanceOf(Date);
			expect(t?.endTime).toBeInstanceOf(Date);
		});

		it("is a no-op for null/undefined", () => {
			expect(() => importState(null)).not.toThrow();
			expect(() => importState(undefined)).not.toThrow();
		});
	});
});
