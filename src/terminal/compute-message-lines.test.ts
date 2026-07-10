import { describe, expect, it } from "vitest";
import { computeMessageLines } from "./output.js";

describe("computeMessageLines — array content", () => {
	it("counts lines for an array of {type, content} blocks (regression for tier1.test.ts:26)", () => {
		// Simulate the E2E test 26 shape: content is an array of blocks
		// (the canonical shape from the agent loop).
		const msg = {
			role: "assistant",
			content: [
				{ type: "text", content: "Hello world." },
				{ type: "text", content: "Second block." },
				{ type: "text", content: "Third line." },
			],
		};
		const lines = computeMessageLines(msg, 80);
		// 1 role header + 3 text blocks, each at least 1 line wrapped.
		// Before the fix, this returned 2 (just header + 1 line).
		// After the fix, it should be at least 4.
		expect(lines).toBeGreaterThanOrEqual(4);
	});

	it("counts lines for an array of {text} fragments without explicit type", () => {
		// Some streaming sources push {text: "..."} fragments without type.
		const msg = {
			role: "assistant",
			content: [
				{ text: "Hello world." },
				{ text: "Second line." },
				{ text: "Third." },
			],
		};
		const lines = computeMessageLines(msg, 80);
		expect(lines).toBeGreaterThanOrEqual(4);
	});

	it("handles mixed content shapes (string + array)", () => {
		const msg = {
			role: "user",
			content: "Plain text message.",
		};
		const lines = computeMessageLines(msg, 80);
		expect(lines).toBeGreaterThanOrEqual(2);
	});

	it("handles reasoning blocks in array", () => {
		const msg = {
			role: "assistant",
			content: [
				{ type: "reasoning", content: "Let me think..." },
				{ type: "text", content: "Answer." },
			],
		};
		const lines = computeMessageLines(msg, 80);
		// 1 header + 2 reasoning borders + 1 wrap + 1 text + 1 margin
		expect(lines).toBeGreaterThanOrEqual(4);
	});
});
