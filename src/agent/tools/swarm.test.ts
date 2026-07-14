import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../swarm/manager.js", () => ({
	swarmManager: {
		spawnSubagent: vi.fn(),
		getSubagent: vi.fn(),
		awaitSubagents: vi.fn(),
		listSubagents: vi.fn(),
		killSubagent: vi.fn(),
		sendMessage: vi.fn(),
	},
}));

vi.mock("../subagents/manager.js", () => ({
	sendMessageToTask: vi.fn(),
}));

import { swarmManager } from "../swarm/manager.js";
import { sendMessageToTask } from "../subagents/manager.js";
import { swarmTools } from "./swarm.js";

const mockedSpawn = vi.mocked(swarmManager.spawnSubagent);
const mockedGet = vi.mocked(swarmManager.getSubagent);
const mockedAwait = vi.mocked(swarmManager.awaitSubagents);
const mockedList = vi.mocked(swarmManager.listSubagents);
const mockedKill = vi.mocked(swarmManager.killSubagent);
const mockedSendMessage = vi.mocked(swarmManager.sendMessage);
const mockedSendToTask = vi.mocked(sendMessageToTask);

describe("swarmTools", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("tool definitions", () => {
		it("should export six tools", () => {
			expect(swarmTools).toHaveLength(6);
		});

		it("should have expected tool names", () => {
			const names = swarmTools.map((t) => t.name);
			expect(names).toEqual([
				"delegate_task",
				"check_subagent_status",
				"await_subagents",
				"list_subagents",
				"abort_subagent",
				"send_message_to_subagent",
			]);
		});

		it("should all belong to the development category", () => {
			for (const tool of swarmTools) {
				expect(tool.category).toBe("development");
			}
		});
	});

	describe("delegate_task", () => {
		const delegateTool = swarmTools.find((t) => t.name === "delegate_task")!;

		it("should return subagent ID on success", async () => {
			mockedSpawn.mockResolvedValue("subagent-123");

			const result = await delegateTool.execute(
				{ prompt: "Do something" },
				{ workingDir: "/tmp", agentContext: undefined } as never,
			);

			expect(result.success).toBe(true);
			expect(result.output).toContain("subagent-123");
			expect(mockedSpawn).toHaveBeenCalledWith({
				prompt: "Do something",
				workingDir: "/tmp",
				parentContext: undefined,
				type: undefined,
				description: undefined,
			});
		});

		it("should pass optional parameters through", async () => {
			mockedSpawn.mockResolvedValue("id-456");

			await delegateTool.execute(
				{
					prompt: "Debug the auth flow",
					description: "debug auth",
					subagent_type: "debug",
					working_dir: "/custom/dir",
				},
				{ workingDir: "/tmp", agentContext: undefined } as never,
			);

			expect(mockedSpawn).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "debug",
					description: "debug auth",
					workingDir: "/custom/dir",
				}),
			);
		});

		it("should return error on spawn failure", async () => {
			mockedSpawn.mockRejectedValue(new Error("process limit reached"));

			const result = await delegateTool.execute(
				{ prompt: "Do something" },
				{ workingDir: "/tmp", agentContext: undefined } as never,
			);

			expect(result.success).toBe(false);
			expect(result.output).toContain("process limit reached");
		});
	});

	describe("check_subagent_status", () => {
		const checkTool = swarmTools.find(
			(t) => t.name === "check_subagent_status",
		)!;

		it("should return not-found when subagent does not exist", async () => {
			mockedGet.mockReturnValue(undefined);

			const result = await checkTool.execute({ id: "nonexistent" });
			expect(result.success).toBe(false);
			expect(result.output).toContain("not found");
		});

		it("should return status details for a running subagent", async () => {
			mockedGet.mockReturnValue({
				id: "abc",
				status: "running",
				createdAt: new Date("2025-01-15T10:00:00Z"),
				type: "code",
				description: "refactor utils",
				tokensUsed: 1200,
				toolCallCount: 5,
				prompt: "refactor",
			});

			const result = await checkTool.execute({ id: "abc" });
			expect(result.success).toBe(true);
			expect(result.output).toContain("running");
			expect(result.output).toContain("refactor utils");
			expect(result.output).toContain("1200");
		});

		it("should include result content for completed subagent", async () => {
			mockedGet.mockReturnValue({
				id: "done",
				status: "completed",
				createdAt: new Date(),
				prompt: "test",
				tokensUsed: 0,
				toolCallCount: 0,
				result: { content: "All tests passed", tokensUsed: 0, duration: 1000 },
			});

			const result = await checkTool.execute({ id: "done" });
			expect(result.output).toContain("completed");
			expect(result.output).toContain("All tests passed");
		});
	});

	describe("await_subagents", () => {
		const awaitTool = swarmTools.find((t) => t.name === "await_subagents")!;

		it("should return not_found for unknown IDs", async () => {
			mockedAwait.mockResolvedValue([
				{ id: "x", status: "not_found" },
			]);

			const result = await awaitTool.execute({
				ids: ["x"],
			});
			expect(result.output).toContain("NOT FOUND");
		});

		it("should format completed results", async () => {
			mockedAwait.mockResolvedValue([
				{
					id: "ok",
					status: "completed",
					result: { content: "Done!", tokensUsed: 0, duration: 500 },
				},
			]);

			const result = await awaitTool.execute({ ids: ["ok"] });
			expect(result.success).toBe(true);
			expect(result.output).toContain("Done!");
		});

		it("should report failed subagents as failure", async () => {
			mockedAwait.mockResolvedValue([
				{ id: "fail", status: "failed", error: "timeout" },
			]);

			const result = await awaitTool.execute({ ids: ["fail"] });
			expect(result.success).toBe(false);
			expect(result.output).toContain("FAILED");
		});
	});

	describe("list_subagents", () => {
		const listTool = swarmTools.find((t) => t.name === "list_subagents")!;

		it("should return no-subagents message when list is empty", async () => {
			mockedList.mockReturnValue([]);

			const result = await listTool.execute({});
			expect(result.success).toBe(true);
			expect(result.output).toBe("No subagents.");
		});

		it("should list running subagents by default", async () => {
			mockedList.mockReturnValue([
				{
					id: "a",
					status: "running",
					prompt: "task a",
					description: "working on A",
				},
				{
					id: "b",
					status: "completed",
					prompt: "task b",
					description: undefined,
				},
			]);

			const result = await listTool.execute({});
			expect(result.output).toContain("a");
			expect(result.output).not.toContain("b");
		});

		it("should include terminal subagents when include_terminal is true", async () => {
			mockedList.mockReturnValue([
				{
					id: "a",
					status: "running",
					prompt: "task a",
					description: undefined,
				},
				{
					id: "b",
					status: "completed",
					prompt: "task b done",
					description: undefined,
				},
			]);

			const result = await listTool.execute({ include_terminal: true });
			expect(result.output).toContain("a");
			expect(result.output).toContain("b");
		});
	});

	describe("abort_subagent", () => {
		const abortTool = swarmTools.find((t) => t.name === "abort_subagent")!;

		it("should report success when killSubagent returns true", async () => {
			mockedKill.mockReturnValue(true);

			const result = await abortTool.execute({ id: "to-kill" });
			expect(result.success).toBe(true);
			expect(result.output).toContain("aborted successfully");
		});

		it("should report failure when killSubagent returns false", async () => {
			mockedKill.mockReturnValue(false);

			const result = await abortTool.execute({ id: "ghost" });
			expect(result.success).toBe(false);
			expect(result.output).toContain("Failed to abort");
		});
	});

	describe("send_message_to_subagent", () => {
		const sendTool = swarmTools.find(
			(t) => t.name === "send_message_to_subagent",
		)!;

		it("should succeed when swarmManager.sendMessage succeeds", async () => {
			mockedSendMessage.mockReturnValue({ success: true });

			const result = await sendTool.execute({
				id: "target",
				message: "hello",
			});
			expect(result.success).toBe(true);
			expect(result.output).toContain("Message sent");
		});

		it("should fallback to sendMessageToTask when not found in swarm", async () => {
			mockedSendMessage.mockReturnValue({ error: "not_found" });
			mockedSendToTask.mockReturnValue({ success: true });

			const result = await sendTool.execute({
				id: "task-1",
				message: "update",
			});
			expect(result.success).toBe(true);
			expect(mockedSendToTask).toHaveBeenCalledWith("task-1", "update");
		});

		it("should report error when subagent is not running", async () => {
			mockedSendMessage.mockReturnValue({
				error: "not_running",
				status: "completed",
			});

			const result = await sendTool.execute({
				id: "done",
				message: "oops",
			});
			expect(result.success).toBe(false);
			expect(result.output).toContain("no longer running");
		});
	});
});
