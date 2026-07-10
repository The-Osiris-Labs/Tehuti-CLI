import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock node:child_process so we can capture fork() calls without
// actually starting a Node process.
const forkMock = vi.fn();
const childInstances: any[] = [];

function makeChild() {
	const handlers: Record<string, Array<(...args: any[]) => void>> = {};
	const sendMock = vi.fn();
	const killMock = vi.fn();
	const child = {
		send: sendMock,
		kill: killMock,
		killed: false,
		stdout: { on: vi.fn() },
		stderr: { on: vi.fn() },
		on: (event: string, fn: (...args: any[]) => void) => {
			(handlers[event] ||= []).push(fn);
			return child;
		},
		_emit: (event: string, ...args: any[]) => {
			for (const fn of handlers[event] || []) fn(...args);
		},
		_send: sendMock,
		_kill: killMock,
	};
	childInstances.push(child);
	return child;
}

vi.mock("node:child_process", () => ({
	fork: (...args: unknown[]) => {
		forkMock(...args);
		return makeChild();
	},
}));

import { SwarmManager } from "./manager.js";

describe("SwarmManager", () => {
	let manager: SwarmManager;

	beforeEach(() => {
		// Reset singleton between tests
		(SwarmManager as any).instance = undefined;
		manager = SwarmManager.getInstance();
		forkMock.mockReset();
		childInstances.length = 0;
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe("spawnSubagent", () => {
		it("forks a child with SWARM_RUNNER=1 and resolved entry file", async () => {
			const idPromise = manager.spawnSubagent("hello", process.cwd());
			const child = childInstances[0];
			// Simulate the child becoming ready and then completing.
			queueMicrotask(() => child._emit("message", { type: "ready" }));
			const id = await idPromise;
			expect(id).toMatch(/^[0-9a-f-]{36}$/);
			expect(forkMock).toHaveBeenCalledTimes(1);
			const callArgs = forkMock.mock.calls[0];
			// fork signature: fork(file, args, options). Options is the 3rd arg.
			expect(callArgs[2].env.SWARM_RUNNER).toBe("1");
			expect(callArgs[2].stdio).toContain("ipc");
		});

		it("transitions pending -> running on ready handshake", async () => {
			const idPromise = manager.spawnSubagent("hello", process.cwd());
			const child = childInstances[0];
			queueMicrotask(() => child._emit("message", { type: "ready" }));
			const id = await idPromise;
			expect(manager.getSubagent(id)?.status).toBe("running");
			// The 'start' payload should have been sent as a follow-up.
			expect(child._send).toHaveBeenCalledWith(
				expect.objectContaining({ type: "start" }),
			);
		});

		it("transitions running -> completed on completion message", async () => {
			const idPromise = manager.spawnSubagent("hello", process.cwd());
			const child = childInstances[0];
			queueMicrotask(() => child._emit("message", { type: "ready" }));
			const id = await idPromise;

			const result = {
				content: "done",
				toolCalls: 0,
				success: true,
				finishReason: "stop",
			};
			child._emit("message", { type: "completed", payload: result });

			expect(manager.getSubagent(id)?.status).toBe("completed");
			expect(manager.getSubagent(id)?.result?.content).toBe("done");
		});

		it("transitions running -> failed on error message", async () => {
			const idPromise = manager.spawnSubagent("hello", process.cwd());
			const child = childInstances[0];
			queueMicrotask(() => child._emit("message", { type: "ready" }));
			const id = await idPromise;

			child._emit("message", { type: "error", payload: "boom" });
			expect(manager.getSubagent(id)?.status).toBe("failed");
			expect(manager.getSubagent(id)?.error).toBe("boom");
		});

		it("does not regress a completed task to failed if error arrives after", async () => {
			const idPromise = manager.spawnSubagent("hello", process.cwd());
			const child = childInstances[0];
			queueMicrotask(() => child._emit("message", { type: "ready" }));
			const id = await idPromise;

			const result = {
				content: "done",
				toolCalls: 0,
				success: true,
				finishReason: "stop",
			};
			child._emit("message", { type: "completed", payload: result });
			expect(manager.getSubagent(id)?.status).toBe("completed");

			// Stale error after completion
			child._emit("message", { type: "error", payload: "late error" });
			expect(manager.getSubagent(id)?.status).toBe("completed");
			expect(manager.getSubagent(id)?.error).toBeUndefined();
		});

		it("reassembles chunked messages", async () => {
			const idPromise = manager.spawnSubagent("hello", process.cwd());
			const child = childInstances[0];
			queueMicrotask(() => child._emit("message", { type: "ready" }));
			const id = await idPromise;

			const big = {
				content: "x".repeat(600_000),
				toolCalls: 0,
				success: true,
				finishReason: "stop",
			};
			const json = JSON.stringify(big);
			const CHUNK = 512 * 1024;
			const chunks = Math.ceil(json.length / CHUNK);
			const idStr = "test-chunk-id";
			for (let i = 0; i < chunks; i++) {
				child._emit("message", {
					type: "completed_chunk",
					id: idStr,
					chunkIndex: i,
					totalChunks: chunks,
					payload: json.substring(i * CHUNK, (i + 1) * CHUNK),
				});
			}
			expect(manager.getSubagent(id)?.status).toBe("completed");
			expect(manager.getSubagent(id)?.result?.content.length).toBe(600_000);
		});

		it("marks failed if child exits before reporting", async () => {
			const idPromise = manager.spawnSubagent("hello", process.cwd());
			const child = childInstances[0];
			queueMicrotask(() => child._emit("message", { type: "ready" }));
			const id = await idPromise;

			child._emit("exit", 1, null);
			const t = manager.getSubagent(id);
			expect(t?.status).toBe("failed");
			expect(t?.error).toMatch(/exited with code 1/);
		});

		it("counts tokens and tool calls from streamed events", async () => {
			const idPromise = manager.spawnSubagent("hello", process.cwd());
			const child = childInstances[0];
			queueMicrotask(() => child._emit("message", { type: "ready" }));
			const id = await idPromise;

			for (let i = 0; i < 3; i++) child._emit("message", { type: "token" });
			child._emit("message", {
				type: "tool_call",
				payload: { id: "1", name: "read", args: {} },
			});
			child._emit("message", {
				type: "tool_call",
				payload: { id: "2", name: "read", args: {} },
			});

			const t = manager.getSubagent(id);
			expect(t?.tokensUsed).toBe(3);
			expect(t?.toolCallCount).toBe(2);
		});
	});

	describe("killSubagent", () => {
		it("returns false for unknown id", () => {
			expect(manager.killSubagent("nope")).toBe(false);
		});

		it("marks task killed and signals child", async () => {
			const idPromise = manager.spawnSubagent("hello", process.cwd());
			const child = childInstances[0];
			queueMicrotask(() => child._emit("message", { type: "ready" }));
			const id = await idPromise;

			manager.killSubagent(id);
			expect(manager.getSubagent(id)?.status).toBe("killed");
			expect(child._kill).toHaveBeenCalledWith("SIGTERM");
		});

		it("does not regress a terminal task", async () => {
			const idPromise = manager.spawnSubagent("hello", process.cwd());
			const child = childInstances[0];
			queueMicrotask(() => child._emit("message", { type: "ready" }));
			const id = await idPromise;

			child._emit("message", {
				type: "completed",
				payload: {
					content: "x",
					toolCalls: 0,
					success: true,
					finishReason: "stop",
				},
			});
			manager.killSubagent(id);
			expect(manager.getSubagent(id)?.status).toBe("completed");
		});
	});

	describe("sendMessage", () => {
		it("returns not_found for unknown id", () => {
			const r = manager.sendMessage("nope", "hi");
			expect(r.success).toBe(false);
			expect(r.error).toBe("not_found");
		});

		it("forwards message to running child", async () => {
			const idPromise = manager.spawnSubagent("hello", process.cwd());
			const child = childInstances[0];
			queueMicrotask(() => child._emit("message", { type: "ready" }));
			const id = await idPromise;

			const r = manager.sendMessage(id, "go");
			expect(r.success).toBe(true);
			expect(child._send).toHaveBeenCalledWith({
				type: "message",
				payload: "[Message from Parent]: go",
			});
		});

		it("rejects when not running", async () => {
			const idPromise = manager.spawnSubagent("hello", process.cwd());
			const child = childInstances[0];
			queueMicrotask(() => child._emit("message", { type: "ready" }));
			const id = await idPromise;

			child._emit("message", {
				type: "completed",
				payload: {
					content: "x",
					toolCalls: 0,
					success: true,
					finishReason: "stop",
				},
			});
			const r = manager.sendMessage(id, "go");
			expect(r.success).toBe(false);
			expect(r.error).toBe("not_running");
			expect(r.status).toBe("completed");
		});
	});

	describe("awaitSubagents", () => {
		it("resolves immediately if all subagents are terminal", async () => {
			const idPromise = manager.spawnSubagent("hello", process.cwd());
			const child = childInstances[0];
			queueMicrotask(() => child._emit("message", { type: "ready" }));
			const id = await idPromise;

			child._emit("message", {
				type: "completed",
				payload: {
					content: "done",
					toolCalls: 0,
					success: true,
					finishReason: "stop",
				},
			});

			const views = await manager.awaitSubagents([id], 1000);
			expect(views).toHaveLength(1);
			expect(views[0].status).toBe("completed");
			expect(views[0].result?.content).toBe("done");
		});

		it("returns timeout state for still-running tasks", async () => {
			const idPromise = manager.spawnSubagent("hello", process.cwd());
			const child = childInstances[0];
			queueMicrotask(() => child._emit("message", { type: "ready" }));
			const id = await idPromise;

			const views = await manager.awaitSubagents([id], 200);
			expect(views[0].status).toBe("running");
			expect(views[0].error).toBe("await timeout");
		});

		it("reports not_found for unknown ids", async () => {
			const views = await manager.awaitSubagents(["does-not-exist"], 100);
			expect(views[0].status).toBe("not_found");
		});
	});

	describe("importState", () => {
		it("forces running tasks to killed and tags them with restart reason", () => {
			manager.importState({
				"orphan-1": {
					id: "orphan-1",
					prompt: "p",
					status: "running",
					createdAt: new Date(),
					tokensUsed: 0,
					toolCallCount: 0,
				},
			});
			const t = manager.getSubagent("orphan-1");
			expect(t?.status).toBe("killed");
			expect(t?.error).toBe("Lost on restart");
		});

		it("preserves terminal states", () => {
			manager.importState({
				"done-1": {
					id: "done-1",
					prompt: "p",
					status: "completed",
					createdAt: new Date(),
					tokensUsed: 10,
					toolCallCount: 2,
					result: {
						content: "ok",
						toolCalls: 2,
						success: true,
						finishReason: "stop",
					},
				},
			});
			const t = manager.getSubagent("done-1");
			expect(t?.status).toBe("completed");
			expect(t?.tokensUsed).toBe(10);
		});

		it("is a no-op for null/undefined", () => {
			expect(() => manager.importState(null)).not.toThrow();
			expect(() => manager.importState(undefined)).not.toThrow();
		});
	});
});
