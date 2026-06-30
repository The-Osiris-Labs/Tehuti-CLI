import { describe, expect, it } from "vitest";
import type { OpenRouterMessage } from "../api/openrouter.js";
import {
	compressContext,
	compressContextWithMetrics,
	estimateTokens,
} from "./context-compressor.js";

describe("Context Compressor Stress and Error Propagation", () => {
	it("should handle mixed summarizer success and failure across chunks gracefully", async () => {
		// Create 15 messages which will be split into 3 chunks of size 5
		const messages: OpenRouterMessage[] = [
			{ role: "system", content: "System setup" },
			...Array.from({ length: 15 }, (_, i) => ({
				role: "assistant" as const,
				content: `Chunk item ${i} content that is long enough to trigger compression`,
			})),
			{ role: "user", content: "Final query" },
		];

		// Chunk 0 (items 0-4): Success
		// Chunk 1 (items 5-9): Failure
		// Chunk 2 (items 10-14): Success
		let callCount = 0;
		const flakySummarizer = async (text: string) => {
			callCount++;
			if (callCount === 2) {
				throw new Error("Simulated LLM call failure for chunk 2");
			}
			return `Mocked LLM Summary for chunk ${callCount}`;
		};

		// Set assistant weight lower (e.g., 10) so importance is < 20, triggering [Condensed] prefix.
		// Set target tokens to 1 to guarantee compression triggers.
		const result = await compressContext(messages, flakySummarizer, 1, {
			keepFirstN: 1,
			keepLastN: 1,
			chunkSize: 5,
			weights: {
				assistant: 10,
				toolCall: 0,
				toolResult: 0,
				lengthPenalty: 0,
			},
		});

		// Verify result contains elements from success and fallback chunks
		const contentStr = JSON.stringify(result);
		
		// Chunk 1 and Chunk 3 should be summarized by LLM
		expect(contentStr).toContain("[Previous Context Summary] Mocked LLM Summary for chunk 1");
		expect(contentStr).toContain("[Previous Context Summary] Mocked LLM Summary for chunk 3");

		// Chunk 2 (items 5-9) should fall back to non-LLM condensation
		expect(contentStr).toContain("[Condensed] Chunk item 5 content");
		expect(contentStr).toContain("[Condensed] Chunk item 9 content");

		// System and user messages should be preserved
		expect(result[0]).toEqual(messages[0]);
		expect(result[result.length - 1]).toEqual(messages[messages.length - 1]);
	});

	it("should handle total summarizer failure for all chunks", async () => {
		const messages: OpenRouterMessage[] = [
			{ role: "system", content: "System" },
			...Array.from({ length: 10 }, (_, i) => ({
				role: "assistant" as const,
				content: `Assistant message ${i}`,
			})),
			{ role: "user", content: "User final message" },
		];

		const failingSummarizer = async () => {
			throw new Error("Network Timeout");
		};

		// Set target tokens to 1 to guarantee compression triggers.
		const result = await compressContext(messages, failingSummarizer, 1, {
			keepFirstN: 1,
			keepLastN: 1,
			chunkSize: 2,
			weights: {
				assistant: 10,
				toolCall: 0,
				toolResult: 0,
				lengthPenalty: 0,
			},
		});

		// Every single chunk should have successfully fallen back
		const contentStr = JSON.stringify(result);
		expect(contentStr).toContain("[Condensed]");
		expect(result[0]).toEqual(messages[0]);
		expect(result[result.length - 1]).toEqual(messages[messages.length - 1]);
	});

	it("should handle extremely weird or malformed message structures without throwing", async () => {
		const messages: OpenRouterMessage[] = [
			{ role: "system", content: "" }, // Empty system content
			{ role: "user", content: undefined as any }, // Undefined content
			{ role: "assistant", content: null as any }, // Null content
			{ role: "tool", content: { key: "value" } as any }, // Object content
			{ role: "assistant", content: [1, 2, "three", { complex: true }] as any }, // Mixed array content
			{ role: "assistant", content: "Normal", tool_calls: undefined }, // Missing tool_calls
			{ role: "assistant", content: "Normal with empty tool_calls", tool_calls: [] }, // Empty tool_calls
		];

		// We check that estimateTokens doesn't throw and returns a positive number
		let tokens = 0;
		expect(() => {
			tokens = estimateTokens(messages);
		}).not.toThrow();
		expect(tokens).toBeGreaterThan(0);

		// We check that compressContext completes without throwing
		const summarizer = async () => "summary";
		let compressed: any[] = [];
		await expect((async () => {
			compressed = await compressContext(messages, summarizer, 5, {
				keepFirstN: 1,
				keepLastN: 1,
				chunkSize: 2,
			});
		})()).resolves.not.toThrow();

		expect(compressed.length).toBeGreaterThan(0);
	});
});
