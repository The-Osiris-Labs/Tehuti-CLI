import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { describe, expect, it } from "vitest";
import type { OpenRouterMessage } from "../api/openrouter.js";
import type { TehutiConfig } from "../config/schema.js";
import {
	addAssistantMessage,
	addAssistantMessageWithTools,
	addToolResult,
	addUserMessage,
	buildSystemPrompt,
	compactContext,
	createAgentContext,
	estimateTokens,
	getContextSummary,
	getToolContext,
	trackCommand,
	trackFileRead,
	trackFileWritten,
	trackToolCall,
} from "./context.js";

describe("Agent Context", () => {
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

	describe("createAgentContext", () => {
		it("should create context with resolved cwd", async () => {
			const ctx = await createAgentContext(".", baseConfig);
			expect(path.isAbsolute(ctx.cwd)).toBe(true);
		});

		it("should create context with empty messages", async () => {
			const ctx = await createAgentContext(process.cwd(), baseConfig);
			expect(ctx.messages).toEqual([]);
		});

		it("should store config", async () => {
			const ctx = await createAgentContext(process.cwd(), baseConfig);
			expect(ctx.config.model).toBe("test/model");
		});

		it("should initialize metadata", async () => {
			const ctx = await createAgentContext(process.cwd(), baseConfig);
			expect(ctx.metadata.startTime).toBeInstanceOf(Date);
			expect(ctx.metadata.toolCalls).toBe(0);
			expect(ctx.metadata.tokensUsed).toBe(0);
			expect(ctx.metadata.filesRead).toEqual([]);
			expect(ctx.metadata.filesWritten).toEqual([]);
			expect(ctx.metadata.commandsRun).toEqual([]);
		});

		it("should load project instructions if AGENTS.md exists", async () => {
			const tempDir = path.join(os.tmpdir(), `tehuti-test-${Date.now()}`);
			await fs.ensureDir(tempDir);
			await fs.writeFile(
				path.join(tempDir, "AGENTS.md"),
				"# Test Instructions",
			);

			const ctx = await createAgentContext(tempDir, baseConfig);
			expect(ctx.projectInstructions).toBe("# Test Instructions");

			await fs.remove(tempDir);
		});

		it("should not fail if no instruction files exist", async () => {
			const tempDir = path.join(os.tmpdir(), `tehuti-test-empty-${Date.now()}`);
			await fs.ensureDir(tempDir);

			const ctx = await createAgentContext(tempDir, baseConfig);
			expect(ctx.projectInstructions).toBeUndefined();

			await fs.remove(tempDir);
		});
	});

	describe("buildSystemPrompt", () => {
		it("should include working directory", async () => {
			const ctx = await createAgentContext(process.cwd(), baseConfig);
			const prompt = buildSystemPrompt(ctx);
			expect(prompt).toContain(process.cwd());
		});

		it("should include max iterations", async () => {
			const ctx = await createAgentContext(process.cwd(), baseConfig);
			const prompt = buildSystemPrompt(ctx);
			expect(prompt).toContain("Maximum iterations: 10");
		});

		it("should include max tokens", async () => {
			const ctx = await createAgentContext(process.cwd(), baseConfig);
			const prompt = buildSystemPrompt(ctx);
			expect(prompt).toContain("Maximum tokens per response: 4096");
		});

		it("should include model name", async () => {
			const ctx = await createAgentContext(process.cwd(), baseConfig);
			const prompt = buildSystemPrompt(ctx);
			expect(prompt).toContain("Model: test/model");
		});

		it("should include project instructions if present", async () => {
			const ctx = await createAgentContext(process.cwd(), baseConfig);
			ctx.projectInstructions = "Custom instructions";
			const prompt = buildSystemPrompt(ctx);
			expect(prompt).toContain("Custom instructions");
			expect(prompt).toContain("## Project Instructions");
		});
	});

	describe("addUserMessage", () => {
		it("should add user message to messages array", async () => {
			const ctx = await createAgentContext(process.cwd(), baseConfig);
			addUserMessage(ctx, "Hello");
			expect(ctx.messages.length).toBe(1);
			expect(ctx.messages[0]).toEqual({ role: "user", content: "Hello" });
		});

		it("should append multiple messages", async () => {
			const ctx = await createAgentContext(process.cwd(), baseConfig);
			addUserMessage(ctx, "First");
			addUserMessage(ctx, "Second");
			expect(ctx.messages.length).toBe(2);
		});
	});

	describe("addAssistantMessage", () => {
		it("should add assistant message to messages array", async () => {
			const ctx = await createAgentContext(process.cwd(), baseConfig);
			addAssistantMessage(ctx, "Response");
			expect(ctx.messages.length).toBe(1);
			expect(ctx.messages[0]).toEqual({
				role: "assistant",
				content: "Response",
			});
		});
	});

	describe("addAssistantMessageWithTools", () => {
		it("should add message without tool calls", async () => {
			const ctx = await createAgentContext(process.cwd(), baseConfig);
			addAssistantMessageWithTools(ctx, "Content");
			expect(ctx.messages[0].tool_calls).toBeUndefined();
		});

		it("should add message with tool calls", async () => {
			const ctx = await createAgentContext(process.cwd(), baseConfig);
			const toolCalls = [
				{
					id: "call_1",
					type: "function" as const,
					function: { name: "test_tool", arguments: "{}" },
				},
			];
			addAssistantMessageWithTools(ctx, "Content", toolCalls);
			expect(ctx.messages[0].tool_calls).toEqual(toolCalls);
		});
	});

	describe("addToolResult", () => {
		it("should add tool result message", async () => {
			const ctx = await createAgentContext(process.cwd(), baseConfig);
			addToolResult(ctx, "call_1", "test_tool", "result");
			expect(ctx.messages.length).toBe(1);
			expect(ctx.messages[0]).toEqual({
				role: "tool",
				tool_call_id: "call_1",
				name: "test_tool",
				content: "result",
			});
		});
	});

	describe("estimateTokens", () => {
		it("should estimate tokens based on character count", () => {
			const messages: OpenRouterMessage[] = [
				{ role: "user", content: "12345678" },
			];
			const tokens = estimateTokens(messages);
			expect(tokens).toBe(2);
		});

		it("should handle string content", () => {
			const messages: OpenRouterMessage[] = [{ role: "user", content: "test" }];
			const tokens = estimateTokens(messages);
			expect(tokens).toBe(1);
		});

		it("should handle array content", () => {
			const messages: OpenRouterMessage[] = [
				{
					role: "user",
					content: [{ type: "text", text: "test" }],
				},
			];
			const tokens = estimateTokens(messages);
			expect(tokens).toBeGreaterThan(0);
		});

		it("should include tool_calls in estimation", () => {
			const messages: OpenRouterMessage[] = [
				{
					role: "assistant",
					content: "test",
					tool_calls: [
						{
							id: "1",
							type: "function",
							function: { name: "tool", arguments: "{}" },
						},
					],
				},
			];
			const tokens = estimateTokens(messages);
			expect(tokens).toBeGreaterThan(0);
		});
	});

	describe("compactContext", () => {
		it("should not compact when under threshold", async () => {
			const ctx = await createAgentContext(process.cwd(), baseConfig);
			ctx.messages = [{ role: "system", content: "System" }];

			const compacted = compactContext(ctx, 1000000);
			expect(compacted).toBe(false);
		});

		it("should preserve system message", async () => {
			const ctx = await createAgentContext(process.cwd(), baseConfig);
			ctx.messages = [
				{ role: "system", content: "System" },
				{ role: "user", content: "A".repeat(100000) },
				{ role: "assistant", content: "B".repeat(100000) },
				{ role: "user", content: "Recent" },
			];

			compactContext(ctx, 1000);
			expect(ctx.messages[0].role).toBe("system");
		});

		it("should preserve recent messages", async () => {
			const ctx = await createAgentContext(process.cwd(), baseConfig);
			ctx.messages = [
				{ role: "system", content: "System" },
				{ role: "user", content: "A".repeat(100000) },
				{ role: "assistant", content: "B".repeat(100000) },
				{ role: "user", content: "Recent" },
			];

			compactContext(ctx, 1000);
			expect(ctx.messages[ctx.messages.length - 1].content).toBe("Recent");
		});
	});

	describe("trackToolCall", () => {
		it("should increment tool call count", async () => {
			const ctx = await createAgentContext(process.cwd(), baseConfig);
			trackToolCall(ctx, "test_tool");
			expect(ctx.metadata.toolCalls).toBe(1);
			trackToolCall(ctx, "another_tool");
			expect(ctx.metadata.toolCalls).toBe(2);
		});
	});

	describe("trackFileRead", () => {
		it("should add file to read list", async () => {
			const ctx = await createAgentContext(process.cwd(), baseConfig);
			trackFileRead(ctx, "/path/to/file");
			expect(ctx.metadata.filesRead).toContain("/path/to/file");
		});

		it("should not duplicate files", async () => {
			const ctx = await createAgentContext(process.cwd(), baseConfig);
			trackFileRead(ctx, "/path/to/file");
			trackFileRead(ctx, "/path/to/file");
			expect(ctx.metadata.filesRead.length).toBe(1);
		});
	});

	describe("trackFileWritten", () => {
		it("should add file to written list", async () => {
			const ctx = await createAgentContext(process.cwd(), baseConfig);
			trackFileWritten(ctx, "/path/to/file");
			expect(ctx.metadata.filesWritten).toContain("/path/to/file");
		});

		it("should not duplicate files", async () => {
			const ctx = await createAgentContext(process.cwd(), baseConfig);
			trackFileWritten(ctx, "/path/to/file");
			trackFileWritten(ctx, "/path/to/file");
			expect(ctx.metadata.filesWritten.length).toBe(1);
		});
	});

	describe("trackCommand", () => {
		it("should add command to list", async () => {
			const ctx = await createAgentContext(process.cwd(), baseConfig);
			trackCommand(ctx, "npm test");
			expect(ctx.metadata.commandsRun).toContain("npm test");
		});

		it("should track multiple commands", async () => {
			const ctx = await createAgentContext(process.cwd(), baseConfig);
			trackCommand(ctx, "npm test");
			trackCommand(ctx, "npm build");
			expect(ctx.metadata.commandsRun.length).toBe(2);
		});
	});

	describe("getContextSummary", () => {
		it("should include duration", async () => {
			const ctx = await createAgentContext(process.cwd(), baseConfig);
			const summary = getContextSummary(ctx);
			expect(summary).toContain("Duration:");
		});

		it("should include tool call count", async () => {
			const ctx = await createAgentContext(process.cwd(), baseConfig);
			ctx.metadata.toolCalls = 5;
			const summary = getContextSummary(ctx);
			expect(summary).toContain("Tool calls: 5");
		});

		it("should include file counts", async () => {
			const ctx = await createAgentContext(process.cwd(), baseConfig);
			ctx.metadata.filesRead = ["a", "b"];
			ctx.metadata.filesWritten = ["c"];
			const summary = getContextSummary(ctx);
			expect(summary).toContain("Files read: 2");
			expect(summary).toContain("Files written: 1");
		});

		it("should include cache savings if present", async () => {
			const ctx = await createAgentContext(process.cwd(), baseConfig);
			ctx.metadata.cacheReadTokens = 1000;
			const summary = getContextSummary(ctx);
			expect(summary).toContain("Cache savings");
		});
	});

	describe("getToolContext", () => {
		it("should return tool context with cwd", async () => {
			const ctx = await createAgentContext(process.cwd(), baseConfig);
			const toolCtx = getToolContext(ctx);
			expect(toolCtx.cwd).toBe(ctx.cwd);
		});

		it("should return tool context with timeout", async () => {
			const ctx = await createAgentContext(process.cwd(), baseConfig);
			const toolCtx = getToolContext(ctx);
			expect(toolCtx.timeout).toBe(120000);
		});

		it("should return tool context with env", async () => {
			const ctx = await createAgentContext(process.cwd(), baseConfig);
			const toolCtx = getToolContext(ctx);
			expect(toolCtx.env).toBeDefined();
		});
	});
});
