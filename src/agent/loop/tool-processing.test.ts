import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentContext } from "../context.js";
import { processToolCalls } from "./tool-processing.js";

const executeToolMock = vi.hoisted(() => vi.fn());

vi.mock("../tools/registry.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../tools/registry.js")>();
	return {
		...actual,
		executeTool: (...args: unknown[]) => executeToolMock(...args),
		getTool: vi.fn().mockReturnValue({
			name: "test_tool",
			intent: "destructive",
			category: "development",
		}),
	};
});

vi.mock("../../hooks/executor.js", () => ({
	hookExecutor: {
		executeHook: vi.fn().mockResolvedValue({ proceed: true }),
	},
}));

vi.mock("../../permissions/index.js", () => ({
	checkPermission: vi.fn().mockResolvedValue({ allowed: true }),
}));

vi.mock("../cache/index.js", () => ({
	getToolCache: vi.fn().mockReturnValue({
		get: vi.fn(),
		set: vi.fn(),
	}),
	invalidateOnBash: vi.fn(),
	invalidateOnWrite: vi.fn(),
	shouldCacheTool: vi.fn().mockReturnValue(false),
}));

vi.mock("../prefetcher.js", () => ({
	getPrefetcher: vi.fn().mockReturnValue({
		getPrefetched: vi.fn().mockReturnValue(null),
	}),
}));

vi.mock("../../utils/telemetry.js", () => ({
	getTelemetry: vi.fn().mockReturnValue({
		recordToolExecution: vi.fn(),
	}),
}));

vi.mock("../tools/plan-mode.js", () => ({
	isPlanMode: vi.fn().mockReturnValue(false),
	isToolAllowedInPlanMode: vi.fn().mockReturnValue(true),
}));

function createContext(): AgentContext {
	return {
		cwd: process.cwd(),
		workingDir: process.cwd(),
		messages: [],
		appendOnlyLog: [],
		config: {
			model: "test-model",
			maxIterations: 10,
			maxTokens: 4000,
			permissions: {
				defaultMode: "trust",
				alwaysAllow: [],
				alwaysDeny: [],
				trustedMode: true,
			},
		} as AgentContext["config"],
		readFilesThisSession: new Set(),
		metadata: {
			startTime: new Date(),
			sessionCost: 0,
			toolCalls: 0,
			tokensUsed: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			filesRead: [],
			filesWritten: [],
			commandsRun: [],
		},
	};
}

describe("processToolCalls", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("preserves a failed tool result when self-healing has no wrapper", async () => {
		executeToolMock.mockResolvedValueOnce({
			success: false,
			output: "",
			error: "boom",
		});
		const onToolResult = vi.fn();
		const ctx = createContext();

		await processToolCalls(
			ctx,
			[
				{
					id: "call_1",
					function: { name: "test_tool", arguments: "{}" },
				},
			],
			{ onToolResult, selfHealer: {} },
		);

		expect(onToolResult).toHaveBeenCalledWith(
			"call_1",
			"test_tool",
			expect.objectContaining({ success: false, error: "boom" }),
		);
		expect(ctx.messages.at(-1)?.content).toContain("Error: boom");
	});

	it("marks argument parse errors as failed tool results", async () => {
		const onToolResult = vi.fn();
		const ctx = createContext();

		await processToolCalls(
			ctx,
			[
				{
					id: "call_1",
					function: { name: "test_tool", arguments: "{" },
				},
			],
			{ onToolResult },
		);

		expect(onToolResult).toHaveBeenCalledWith(
			"call_1",
			"test_tool",
			expect.objectContaining({ success: false }),
		);
		expect(executeToolMock).not.toHaveBeenCalled();
	});
});
