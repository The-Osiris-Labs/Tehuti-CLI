import { describe, expect, it } from "vitest";
import {
	compressContext,
	compressContextWithMetrics,
	createContextSummarizer,
	createSmartSummarizer,
	estimateTokens,
	identifyCriticalMessages,
	progressiveCompress,
} from "./context-compressor.js";
import type { OpenRouterMessage } from "../api/openrouter.js";

describe("Context Compressor", () => {
	describe("estimateTokens", () => {
		it("should estimate tokens from messages", () => {
			const messages: OpenRouterMessage[] = [
				{ role: "user", content: "Hello world" },
				{ role: "assistant", content: "Hi there" },
			];

			const tokens = estimateTokens(messages);

			expect(tokens).toBeGreaterThan(0);
		});

		it("should handle complex content", () => {
			const messages: OpenRouterMessage[] = [
				{
					role: "assistant",
					content: { type: "text", text: "complex content" },
				},
			];

			const tokens = estimateTokens(messages);

			expect(tokens).toBeGreaterThan(0);
		});
	});

	describe("identifyCriticalMessages", () => {
		it("should identify system messages as critical", () => {
			const messages: OpenRouterMessage[] = [
				{ role: "system", content: "You are a helpful assistant" },
				{ role: "user", content: "Hello" },
			];

			const critical = identifyCriticalMessages(messages);

			expect(critical).toContain(0);
		});

		it("should identify messages with multiple critical patterns as critical", () => {
			const messages: OpenRouterMessage[] = [
				{ role: "user", content: "Do something" },
				{ role: "assistant", content: "I encountered an error and the operation failed. This is important." },
			];

			const critical = identifyCriticalMessages(messages);

			expect(critical.length).toBeGreaterThan(0);
		});

		it("should identify messages with error and decision patterns as critical", () => {
			const messages: OpenRouterMessage[] = [
				{ role: "user", content: "Do something" },
				{ role: "assistant", content: "Error occurred. Decision: we will fix it." },
			];

			const critical = identifyCriticalMessages(messages);

			expect(critical.length).toBeGreaterThan(0);
		});

		it("should not identify tool messages as critical by default (score 15 < threshold 20)", () => {
			const messages: OpenRouterMessage[] = [
				{ role: "user", content: "Read file" },
				{ role: "tool", content: "file content" },
			];

			const critical = identifyCriticalMessages(messages);

			expect(critical.length).toBe(0);
		});

		it("should identify messages with TODO and important patterns as critical", () => {
			const messages: OpenRouterMessage[] = [
				{ role: "assistant", content: "TODO: fix this. Important: check this later." },
			];

			const critical = identifyCriticalMessages(messages);

			expect(critical.length).toBeGreaterThan(0);
		});

		it("should identify messages with 4+ code blocks as critical", () => {
			const messagesWithCode: OpenRouterMessage[] = [
				{ role: "assistant", content: "Code:\n```ts\n1\n```\n```ts\n2\n```\n```ts\n3\n```\n```ts\n4\n```" },
			];

			const critical = identifyCriticalMessages(messagesWithCode);

			expect(critical.length).toBeGreaterThan(0);
		});

		it("should score code blocks higher than no code", () => {
			const messagesWithCode: OpenRouterMessage[] = [
				{ role: "assistant", content: "Here's code:\n```typescript\nconst x = 1;\n```" },
			];
			const messagesWithoutCode: OpenRouterMessage[] = [
				{ role: "assistant", content: "Just text, no code" },
			];

			const criticalWithCode = identifyCriticalMessages(messagesWithCode);
			const criticalWithoutCode = identifyCriticalMessages(messagesWithoutCode);

			expect(criticalWithCode.length).toBeGreaterThanOrEqual(criticalWithoutCode.length);
		});
	});

	describe("compressContext", () => {
		it("should return messages unchanged if under target tokens", async () => {
			const messages: OpenRouterMessage[] = [
				{ role: "system", content: "You are helpful" },
				{ role: "user", content: "Hi" },
			];

			const result = await compressContext(messages, async () => "summary", {
				targetTokens: 100000,
			});

			expect(result).toEqual(messages);
		});

		it("should return messages unchanged if too few to compress", async () => {
			const messages: OpenRouterMessage[] = [
				{ role: "system", content: "You are helpful" },
				{ role: "user", content: "Hi" },
			];

			const result = await compressContext(messages, async () => "summary", {
				targetTokens: 10,
				keepFirstN: 2,
				keepLastN: 2,
			});

			expect(result).toEqual(messages);
		});

		it("should compress messages when over target tokens", async () => {
			const messages: OpenRouterMessage[] = [
				{ role: "system", content: "System prompt" },
				...Array.from({ length: 20 }, (_, i) => ({
					role: "user" as const,
					content: `Message ${i} with lots of content to make it long enough to trigger compression`.repeat(
						10,
					),
				})),
				{ role: "user", content: "Final message" },
			];

			const summarizer = async (text: string) => `Summary of: ${text.slice(0, 50)}`;
			const result = await compressContext(messages, summarizer, {
				targetTokens: 1000,
				keepFirstN: 1,
				keepLastN: 2,
				chunkSize: 5,
			});

			expect(result.length).toBeLessThan(messages.length);
			expect(result[0]).toEqual(messages[0]);
		});

		it("should handle summarizer errors gracefully", async () => {
			const messages: OpenRouterMessage[] = [
				{ role: "system", content: "System" },
				...Array.from({ length: 20 }, (_, i) => ({
					role: "user" as const,
					content: `Message ${i} with content`.repeat(20),
				})),
			];

			const failingSummarizer = async () => {
				throw new Error("Summarizer failed");
			};

			const result = await compressContext(messages, failingSummarizer, {
				targetTokens: 500,
				keepFirstN: 1,
				keepLastN: 2,
				chunkSize: 3,
			});

			expect(result.length).toBeLessThanOrEqual(messages.length);
			expect(result[0]).toEqual(messages[0]);
		});
	});

	describe("compressContextWithMetrics", () => {
		it("should return compression metrics", async () => {
			const messages: OpenRouterMessage[] = [
				{ role: "system", content: "System" },
				...Array.from({ length: 15 }, (_, i) => ({
					role: "user" as const,
					content: `Message ${i} `.repeat(50),
				})),
			];

			const result = await compressContextWithMetrics(
				messages,
				async () => "Summary",
				{ targetTokens: 500, keepFirstN: 1, keepLastN: 2, chunkSize: 3 },
			);

			expect(result).toHaveProperty("messages");
			expect(result).toHaveProperty("removedCount");
			expect(result).toHaveProperty("compressedCount");
			expect(result).toHaveProperty("originalTokens");
			expect(result).toHaveProperty("newTokens");
			expect(result).toHaveProperty("savedTokens");
			expect(result.originalTokens).toBeGreaterThan(result.newTokens);
		});
	});

	describe("progressiveCompress", () => {
		it("should return messages unchanged if under target", () => {
			const messages: OpenRouterMessage[] = [
				{ role: "user", content: "Hello" },
				{ role: "assistant", content: "Hi" },
			];

			const result = progressiveCompress(messages, 10000);

			expect(result).toEqual(messages);
		});

		it("should progressively remove low-importance messages", () => {
			const messages: OpenRouterMessage[] = [
				{ role: "system", content: "System prompt" },
				...Array.from({ length: 50 }, (_, i) => ({
					role: "user" as const,
					content: `Regular message ${i}`,
				})),
			];

			const targetTokens = 500;
			const result = progressiveCompress(messages, targetTokens);

			expect(result.length).toBeLessThan(messages.length);
			expect(result[0]).toEqual(messages[0]);
		});

		it("should preserve critical messages", () => {
			const messages: OpenRouterMessage[] = [
				{ role: "system", content: "System" },
				{ role: "user", content: "Do something" },
				{ role: "assistant", content: "Error: Something went wrong" },
				{ role: "user", content: "Try again" },
			];

			const result = progressiveCompress(messages, 50);

			const errorIndex = result.findIndex((m) =>
				m.content.toString().includes("Error"),
			);
			expect(errorIndex).toBeGreaterThanOrEqual(0);
		});
	});

	describe("createContextSummarizer", () => {
		it("should create a summarizer function", () => {
			const modelCall = async (prompt: string) => `Summary: ${prompt.slice(0, 20)}`;
			const summarizer = createContextSummarizer(modelCall);

			expect(typeof summarizer).toBe("function");
		});

		it("should return fallback on model call failure", async () => {
			const failingModelCall = async () => {
				throw new Error("Model failed");
			};
			const summarizer = createContextSummarizer(failingModelCall);

			const result = await summarizer("Some text");

			expect(result).toBe("Context was summarized but details are no longer available.");
		});
	});

	describe("createSmartSummarizer", () => {
		it("should create a summarizer with context hint", async () => {
			const modelCall = async (prompt: string, systemPrompt?: string) => {
				expect(systemPrompt).toBeDefined();
				return "Smart summary";
			};

			const summarizer = createSmartSummarizer(modelCall);
			const result = await summarizer("Some content", "Working on file.ts");

			expect(result).toBe("Smart summary");
		});

		it("should handle errors gracefully", async () => {
			const failingModelCall = async () => {
				throw new Error("Failed");
			};

			const summarizer = createSmartSummarizer(failingModelCall);
			const result = await summarizer("Content");

			expect(result).toBe("Context summarized.");
		});
	});
});
