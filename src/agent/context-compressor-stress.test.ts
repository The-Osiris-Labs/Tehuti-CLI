import { describe, expect, it } from "vitest";
import type { OpenRouterMessage } from "../api/openrouter.js";
import {
	compressContext,
	compressContextWithMetrics,
	estimateTokens,
	createContextSummarizer,
} from "./context-compressor.js";

describe("Context Compressor Stress and Error Propagation Tests", () => {
	const createLargeMessages = (count: number, length: number): OpenRouterMessage[] => {
		return [
			{ role: "system", content: "System setup" },
			...Array.from({ length: count }, (_, i) => ({
				role: "tool" as const,
				content: `Tool message index ${i}: ` + "A".repeat(length),
			})),
			{ role: "assistant", content: "Final response" },
		];
	};

	it("should fall back to local condensing if summarizer throws a standard Error", async () => {
		const messages = createLargeMessages(10, 500); // 12 messages total
		const failingSummarizer = async () => {
			throw new Error("API Limit Reached");
		};

		const result = await compressContext(messages, failingSummarizer, 100, {
			keepFirstN: 1,
			keepLastN: 1,
			chunkSize: 3,
		});

		// Fallback should run and return condensed messages
		expect(result.length).toBeGreaterThan(0);
		expect(result[0]).toEqual(messages[0]); // Keep first N preserved
		expect(result[result.length - 1]).toEqual(messages[messages.length - 1]); // Keep last N preserved

		// The middle messages should have the "[Condensed]" prefix
		const condensed = result.slice(1, -1);
		expect(condensed.length).toBeGreaterThan(0);
		for (const msg of condensed) {
			if (msg.role !== "system") {
				expect(msg.content).toContain("[Condensed]");
			}
		}
	});

	it("should handle partial failures where some chunks fail but others succeed", async () => {
		const messages = createLargeMessages(6, 500); // 8 messages total
		let chunkCallCount = 0;

		const partialFailingSummarizer = async (text: string) => {
			chunkCallCount++;
			if (chunkCallCount % 2 === 0) {
				throw new Error("Simulated Chunk Failure");
			}
			return `LLM Summary of chunk ${chunkCallCount}`;
		};

		const result = await compressContext(messages, partialFailingSummarizer, 100, {
			keepFirstN: 1,
			keepLastN: 1,
			chunkSize: 2, // 6 messages divided into 3 chunks of size 2
		});

		// The results should be a mix of LLM summary and local condensing
		const middle = result.slice(1, -1);
		
		// Chunk 1 (success) -> 1 LLM Summary message
		// Chunk 2 (fail) -> 2 local condensed messages
		// Chunk 3 (success) -> 1 LLM Summary message
		// Total middle = 1 + 2 + 1 = 4 messages
		expect(middle).toHaveLength(4);
		
		expect(middle[0].content).toContain("[Previous Context Summary] LLM Summary of chunk 1");
		expect(middle[1].content).toContain("[Condensed]");
		expect(middle[2].content).toContain("[Condensed]");
		expect(middle[3].content).toContain("[Previous Context Summary] LLM Summary of chunk 3");
	});

	it("should safely handle non-Error rejection types from the summarizer", async () => {
		const messages = createLargeMessages(5, 500);
		
		// Summarizer rejecting with a string
		const stringRejectSummarizer = async () => {
			throw "Fatal string error";
		};

		const result = await compressContext(messages, stringRejectSummarizer, 100, {
			keepFirstN: 1,
			keepLastN: 1,
			chunkSize: 2,
		});

		expect(result.length).toBeGreaterThan(0);
		expect(result.slice(1, -1).some(m => m.content.includes("[Condensed]"))).toBe(true);
	});

	it("should handle extremely large messages without crashing or running out of memory", async () => {
		// Create messages containing very large contents (e.g. 500,000 characters)
		const messages: OpenRouterMessage[] = [
			{ role: "system", content: "System" },
			{ role: "tool", content: "Big content: " + "X".repeat(500000) },
			{ role: "tool", content: "Another content: " + "Y".repeat(200000) },
			{ role: "user", content: "End" }
		];

		const summarizer = async () => "Short Summary";

		// Target tokens is small, forcing compression
		const result = await compressContext(messages, summarizer, 10, {
			keepFirstN: 1,
			keepLastN: 1,
			chunkSize: 2,
		});

		expect(result.length).toBeLessThan(messages.length);
		expect(result[0]).toEqual(messages[0]);
		expect(result[result.length - 1]).toEqual(messages[messages.length - 1]);
	});

	it("should return the original list if target tokens is unreachable or invalid", async () => {
		const messages = createLargeMessages(5, 100);
		const summarizer = async () => "Summary";

		// Compress with an extremely large target token
		const resultLargeTarget = await compressContext(messages, summarizer, 1000000);
		expect(resultLargeTarget).toEqual(messages);

		// Compress with a negative target token
		const resultNegativeTarget = await compressContext(messages, summarizer, -100, {
			keepFirstN: 2,
			keepLastN: 2,
		});
		// Should still complete and do its best without throwing
		expect(resultNegativeTarget.length).toBeLessThanOrEqual(messages.length);
	});

	it("should handle edge case where keepFirstN or keepLastN is larger than messages list length", async () => {
		const messages = createLargeMessages(3, 100); // 5 messages total
		const summarizer = async () => "Summary";

		const result = await compressContext(messages, summarizer, 10, {
			keepFirstN: 10,
			keepLastN: 10,
		});

		expect(result).toEqual(messages);
	});

	it("should handle empty or single message inputs gracefully", async () => {
		const summarizer = async () => "Summary";

		const emptyResult = await compressContext([], summarizer, 10);
		expect(emptyResult).toEqual([]);

		const singleMsg: OpenRouterMessage[] = [{ role: "user", content: "Hello" }];
		const singleResult = await compressContext(singleMsg, summarizer, 10);
		expect(singleResult).toEqual(singleMsg);
	});
});
