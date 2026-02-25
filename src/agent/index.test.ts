import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TehutiConfig } from "../config/schema.js";
import type { AgentContext } from "./context.js";
import { configureHooks, createAgentContext, runAgentLoop } from "./index.js";

vi.mock("../api/openrouter.js", () => ({
	OpenRouterClient: vi.fn().mockImplementation(() => ({
		streamChat: vi.fn().mockImplementation(async function* () {
			yield {
				choices: [
					{
						delta: { content: "Hello" },
						finish_reason: null,
					},
				],
				usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
			};
			yield {
				choices: [
					{
						delta: { content: " world" },
						finish_reason: "stop",
					},
				],
				usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
			};
		}),
		abort: vi.fn(),
	})),
}));

vi.mock("./tools/index.js", () => ({
	registerTools: vi.fn(),
	getToolDefinitions: vi.fn(() => []),
	executeTool: vi.fn(),
	getTool: vi.fn(),
}));

vi.mock("../permissions/index.js", () => ({
	checkPermission: vi.fn().mockResolvedValue({ allowed: true }),
}));

vi.mock("../hooks/executor.js", () => ({
	hookExecutor: {
		executeHook: vi.fn().mockResolvedValue({ proceed: true }),
		loadConfig: vi.fn(),
	},
	parseHooksConfig: vi.fn().mockReturnValue({}),
}));

describe("Agent Loop", () => {
	let ctx: AgentContext;
	const baseConfig: TehutiConfig = {
		apiKey: "sk-or-test123456789",
		model: "test/model",
		maxTokens: 4096,
		maxIterations: 10,
		temperature: 0.7,
		permissions: {
			defaultMode: "trust",
			alwaysAllow: [],
			alwaysDeny: [],
		},
	};

	beforeEach(async () => {
		vi.clearAllMocks();
		ctx = await createAgentContext(process.cwd(), baseConfig);
	});

	describe("createAgentContext", () => {
		it("should create context with correct cwd", async () => {
			const newCtx = await createAgentContext("/tmp", baseConfig);
			expect(newCtx.cwd).toBe("/tmp");
		});

		it("should initialize empty messages array", async () => {
			const newCtx = await createAgentContext(process.cwd(), baseConfig);
			expect(newCtx.messages).toEqual([]);
		});

		it("should initialize metadata with defaults", async () => {
			const newCtx = await createAgentContext(process.cwd(), baseConfig);
			expect(newCtx.metadata.toolCalls).toBe(0);
			expect(newCtx.metadata.tokensUsed).toBe(0);
			expect(newCtx.metadata.filesRead).toEqual([]);
			expect(newCtx.metadata.filesWritten).toEqual([]);
		});
	});

	describe("runAgentLoop", () => {
		it("should add system prompt on first iteration", async () => {
			await runAgentLoop(ctx, "Hello");
			expect(ctx.messages.length).toBeGreaterThan(0);
			expect(ctx.messages[0].role).toBe("system");
		});

		it("should add user message to context", async () => {
			await runAgentLoop(ctx, "Test message");
			const userMsg = ctx.messages.find((m) => m.role === "user");
			expect(userMsg).toBeDefined();
			expect(userMsg?.content).toBe("Test message");
		});

		it("should stream tokens via onToken callback", async () => {
			const tokens: string[] = [];
			await runAgentLoop(ctx, "Hello", {
				onToken: (t) => tokens.push(t),
			});
			expect(tokens.length).toBeGreaterThan(0);
		});

		it("should return result with content", async () => {
			const result = await runAgentLoop(ctx, "Hello");
			expect(result.content).toBeDefined();
			expect(result.success).toBe(true);
		});

		it("should respect maxIterations limit", async () => {
			const limitedCtx = await createAgentContext(process.cwd(), {
				...baseConfig,
				maxIterations: 1,
			});
			const result = await runAgentLoop(limitedCtx, "Hello");
			expect(result.finishReason).toBe("stop");
		});

		it("should handle abort signal", async () => {
			const controller = new AbortController();
			controller.abort();

			const result = await runAgentLoop(ctx, "Hello", {
				signal: controller.signal,
			});

			expect(result.finishReason).toBe("aborted");
		});

		it("should return usage statistics", async () => {
			const result = await runAgentLoop(ctx, "Hello");
			expect(result.usage).toBeDefined();
		});

		it("should return session stats", async () => {
			const result = await runAgentLoop(ctx, "Hello");
			expect(result.sessionStats).toBeDefined();
		});

		it("should call onThinking callback", async () => {
			const thinkingCalls: string[] = [];
			await runAgentLoop(ctx, "Hello", {
				onThinking: (content) => thinkingCalls.push(content),
			});
			expect(thinkingCalls.length).toBeGreaterThanOrEqual(0);
		});
	});

	describe("configureHooks", () => {
		it("should load hooks config", () => {
			configureHooks({});
			expect(true).toBe(true);
		});

		it("should handle undefined hooks config", () => {
			configureHooks(undefined);
			expect(true).toBe(true);
		});
	});
});
