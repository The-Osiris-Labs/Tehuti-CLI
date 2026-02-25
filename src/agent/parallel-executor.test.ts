import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
	classifyToolCalls,
	canRunInParallel,
	executeToolsParallel,
	getParallelizableCount,
	getSequentialCount,
	SAFE_PARALLEL_TOOLS,
	WRITE_TOOLS,
	INTERACTIVE_TOOLS,
} from "./parallel-executor.js";
import type { ToolCall } from "./parallel-executor.js";

vi.mock("./tools/registry.js", () => ({
	executeTool: vi.fn().mockImplementation(async (name: string) => {
		await new Promise((r) => setTimeout(r, 10));
		return { success: true, output: `${name} result` };
	}),
	getTool: vi.fn().mockReturnValue(null),
}));

vi.mock("./cache/index.js", () => ({
	getToolCache: vi.fn().mockReturnValue({
		get: vi.fn().mockReturnValue(null),
		set: vi.fn(),
		has: vi.fn().mockReturnValue(false),
	}),
	shouldCacheTool: vi.fn().mockReturnValue(true),
	invalidateOnWrite: vi.fn(),
	resetToolCache: vi.fn(),
}));

vi.mock("../utils/telemetry.js", () => ({
	getTelemetry: vi.fn().mockReturnValue({
		recordToolExecution: vi.fn(),
		recordParallelExecution: vi.fn(),
		getToolStats: vi.fn().mockReturnValue(new Map()),
	}),
	resetTelemetry: vi.fn(),
}));

	describe("Parallel Executor", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("Tool Classification Sets", () => {
		it("should have correct SAFE_PARALLEL_TOOLS", () => {
			expect(SAFE_PARALLEL_TOOLS.has("read")).toBe(true);
			expect(SAFE_PARALLEL_TOOLS.has("read_file")).toBe(true);
			expect(SAFE_PARALLEL_TOOLS.has("glob")).toBe(true);
			expect(SAFE_PARALLEL_TOOLS.has("grep")).toBe(true);
			expect(SAFE_PARALLEL_TOOLS.has("list_dir")).toBe(true);
			expect(SAFE_PARALLEL_TOOLS.has("web_fetch")).toBe(true);
			expect(SAFE_PARALLEL_TOOLS.has("git_status")).toBe(true);
			expect(SAFE_PARALLEL_TOOLS.has("write")).toBe(false);
		});

		it("should have correct WRITE_TOOLS", () => {
			expect(WRITE_TOOLS.has("write")).toBe(true);
			expect(WRITE_TOOLS.has("write_file")).toBe(true);
			expect(WRITE_TOOLS.has("edit")).toBe(true);
			expect(WRITE_TOOLS.has("edit_file")).toBe(true);
			expect(WRITE_TOOLS.has("delete_file")).toBe(true);
			expect(WRITE_TOOLS.has("read")).toBe(false);
		});

		it("should have correct INTERACTIVE_TOOLS", () => {
			expect(INTERACTIVE_TOOLS.has("question")).toBe(true);
			expect(INTERACTIVE_TOOLS.has("read")).toBe(false);
		});
	});

	describe("classifyToolCalls", () => {
		it("should classify parallel tools correctly", () => {
			const toolCalls: ToolCall[] = [
				{ id: "1", function: { name: "read", arguments: '{"file_path":"/a.ts"}' } },
				{ id: "2", function: { name: "glob", arguments: '{"pattern":"*.ts"}' } },
				{ id: "3", function: { name: "grep", arguments: '{"pattern":"test"}' } },
			];

			const result = classifyToolCalls(toolCalls);

			expect(result.parallel).toHaveLength(3);
			expect(result.sequential).toHaveLength(0);
			expect(result.interactive).toHaveLength(0);
		});

		it("should classify write tools as sequential", () => {
			const toolCalls: ToolCall[] = [
				{ id: "1", function: { name: "write", arguments: '{"file_path":"/a.ts"}' } },
				{ id: "2", function: { name: "edit", arguments: '{"file_path":"/b.ts"}' } },
			];

			const result = classifyToolCalls(toolCalls);

			expect(result.parallel).toHaveLength(0);
			expect(result.sequential).toHaveLength(2);
		});

		it("should classify interactive tools correctly", () => {
			const toolCalls: ToolCall[] = [
				{ id: "1", function: { name: "question", arguments: '{"text":"Continue?"}' } },
			];

			const result = classifyToolCalls(toolCalls);

			expect(result.interactive).toHaveLength(1);
		});

		it("should classify mixed tool calls", () => {
			const toolCalls: ToolCall[] = [
				{ id: "1", function: { name: "read", arguments: '{}' } },
				{ id: "2", function: { name: "write", arguments: '{}' } },
				{ id: "3", function: { name: "glob", arguments: '{}' } },
				{ id: "4", function: { name: "question", arguments: '{}' } },
			];

			const result = classifyToolCalls(toolCalls);

			expect(result.parallel).toHaveLength(2);
			expect(result.sequential).toHaveLength(1);
			expect(result.interactive).toHaveLength(1);
		});
	});

	describe("canRunInParallel", () => {
		it("should return true for read-only tools", () => {
			const toolCalls: ToolCall[] = [
				{ id: "1", function: { name: "read", arguments: '{}' } },
				{ id: "2", function: { name: "glob", arguments: '{}' } },
			];

			expect(canRunInParallel(toolCalls)).toBe(true);
		});

		it("should return false when write tools present", () => {
			const toolCalls: ToolCall[] = [
				{ id: "1", function: { name: "read", arguments: '{}' } },
				{ id: "2", function: { name: "write", arguments: '{}' } },
			];

			expect(canRunInParallel(toolCalls)).toBe(false);
		});

		it("should return false when interactive tools present", () => {
			const toolCalls: ToolCall[] = [
				{ id: "1", function: { name: "read", arguments: '{}' } },
				{ id: "2", function: { name: "question", arguments: '{}' } },
			];

			expect(canRunInParallel(toolCalls)).toBe(false);
		});
	});

	describe("getParallelizableCount", () => {
		it("should count parallelizable tools", () => {
			const toolCalls: ToolCall[] = [
				{ id: "1", function: { name: "read", arguments: '{}' } },
				{ id: "2", function: { name: "write", arguments: '{}' } },
				{ id: "3", function: { name: "glob", arguments: '{}' } },
				{ id: "4", function: { name: "grep", arguments: '{}' } },
			];

			expect(getParallelizableCount(toolCalls)).toBe(3);
		});
	});

	describe("getSequentialCount", () => {
		it("should count sequential tools", () => {
			const toolCalls: ToolCall[] = [
				{ id: "1", function: { name: "read", arguments: '{}' } },
				{ id: "2", function: { name: "write", arguments: '{}' } },
				{ id: "3", function: { name: "edit", arguments: '{}' } },
				{ id: "4", function: { name: "question", arguments: '{}' } },
			];

			expect(getSequentialCount(toolCalls)).toBe(2);
		});
	});

	describe("executeToolsParallel", () => {
		const mockCtx = {
			messages: [],
			config: { model: "test" },
			cwd: "/test",
			metadata: { tokensUsed: 0 },
			toolCallCount: 0,
			toolCalls: [],
		} as unknown as Parameters<typeof executeToolsParallel>[1]["ctx"];

		const mockToolContext = {};

		it("should execute parallel tools concurrently", async () => {
			const toolCalls: ToolCall[] = [
				{ id: "1", function: { name: "read", arguments: '{"file_path":"/a.ts"}' } },
				{ id: "2", function: { name: "read", arguments: '{"file_path":"/b.ts"}' } },
				{ id: "3", function: { name: "read", arguments: '{"file_path":"/c.ts"}' } },
			];

			const addToolResult = vi.fn();
			const results = await executeToolsParallel(toolCalls, {
				ctx: mockCtx,
				toolContext: mockToolContext,
				addToolResult,
				maxConcurrency: 5,
			});

			expect(results).toHaveLength(3);
			expect(addToolResult).toHaveBeenCalledTimes(3);
		});

		it("should execute sequential tools in order", async () => {
			const toolCalls: ToolCall[] = [
				{ id: "1", function: { name: "write", arguments: '{"file_path":"/a.ts"}' } },
				{ id: "2", function: { name: "write", arguments: '{"file_path":"/b.ts"}' } },
			];

			const addToolResult = vi.fn();
			const results = await executeToolsParallel(toolCalls, {
				ctx: mockCtx,
				toolContext: mockToolContext,
				addToolResult,
			});

			expect(results).toHaveLength(2);
		});

		it("should handle mixed parallel and sequential tools", async () => {
			const toolCalls: ToolCall[] = [
				{ id: "1", function: { name: "read", arguments: '{}' } },
				{ id: "2", function: { name: "glob", arguments: '{}' } },
				{ id: "3", function: { name: "write", arguments: '{}' } },
			];

			const addToolResult = vi.fn();
			const results = await executeToolsParallel(toolCalls, {
				ctx: mockCtx,
				toolContext: mockToolContext,
				addToolResult,
			});

			expect(results).toHaveLength(3);
		});

		it("should call onToolCall callback", async () => {
			const toolCalls: ToolCall[] = [
				{ id: "1", function: { name: "read", arguments: '{"file_path":"/a.ts"}' } },
			];

			const onToolCall = vi.fn();
			await executeToolsParallel(toolCalls, {
				ctx: mockCtx,
				toolContext: mockToolContext,
				addToolResult: vi.fn(),
				onToolCall,
			});

			expect(onToolCall).toHaveBeenCalledWith("read", { file_path: "/a.ts" });
		});

		it("should call onToolResult callback", async () => {
			const toolCalls: ToolCall[] = [
				{ id: "1", function: { name: "read", arguments: '{}' } },
			];

			const onToolResult = vi.fn();
			await executeToolsParallel(toolCalls, {
				ctx: mockCtx,
				toolContext: mockToolContext,
				addToolResult: vi.fn(),
				onToolResult,
			});

			expect(onToolResult).toHaveBeenCalled();
		});

		it("should handle invalid JSON arguments", async () => {
			const toolCalls: ToolCall[] = [
				{ id: "1", function: { name: "read", arguments: "not valid json" } },
			];

			const results = await executeToolsParallel(toolCalls, {
				ctx: mockCtx,
				toolContext: mockToolContext,
				addToolResult: vi.fn(),
			});

			expect(results[0]?.success).toBe(false);
		});

		it("should respect maxConcurrency", async () => {
			const toolCalls: ToolCall[] = Array.from({ length: 10 }, (_, i) => ({
				id: String(i),
				function: { name: "read", arguments: `{"file":"/${i}.ts"}` },
			}));

			const addToolResult = vi.fn();
			await executeToolsParallel(toolCalls, {
				ctx: mockCtx,
				toolContext: mockToolContext,
				addToolResult,
				maxConcurrency: 2,
			});

			expect(addToolResult).toHaveBeenCalledTimes(10);
		});
	});
});
