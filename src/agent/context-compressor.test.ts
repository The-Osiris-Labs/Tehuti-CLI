import { describe, expect, it } from "vitest";
import type { AgentContext } from "./context.js";
import { compactContext } from "./context.js";
import {
	buildStructuredCompactionDigest,
	compressContext,
	formatCompactionDigest,
} from "./context-compressor.js";

describe("structured context compaction", () => {
	it("records observed tool actions, errors, requests, and milestones", () => {
		const digest = buildStructuredCompactionDigest(
			[
				{ role: "user", content: "Fix the failing test" },
				{
					role: "assistant",
					content: "I will update the test and run it again.",
					tool_calls: [
						{
							id: "call-1",
							type: "function",
							function: { name: "bash", arguments: "{}" },
						},
					],
				},
				{ role: "tool", name: "bash", content: "Error: test failed" },
			],
			{ activeStartIndex: 3, originalTokens: 90, compactedTokens: 30 },
		);

		const formatted = formatCompactionDigest(digest);
		expect(digest.actions).toContain("bash × 1");
		expect(digest.recoveries[0]).toContain("test failed");
		expect(digest.openThreads).toContain("Fix the failing test");
		expect(formatted).toContain("Key decisions / commitments observed");
		expect(formatted).toContain("untrusted historical evidence");
	});

	it("keeps the full audit transcript while compacting the model copy", () => {
		const messages = [
			{ role: "system" as const, content: "System" },
			...Array.from({ length: 30 }, (_, index) => ({
				role: (index % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
				content: `message-${index}`,
			})),
		];
		const archive = [...messages];
		const ctx = {
			messages,
			appendOnlyLog: archive,
			compactionHistory: [],
			config: {},
		} as unknown as AgentContext;

		expect(compactContext(ctx, 1)).toBe(true);
		expect(ctx.appendOnlyLog).toHaveLength(archive.length);
		expect(ctx.compactionHistory).toHaveLength(1);
		expect(
			ctx.messages.some(
				(message) =>
					message.role === "system" &&
					typeof message.content === "string" &&
					message.content.includes("TEHUTI COMPACTION DIGEST"),
			),
		).toBe(true);
	});

	it("replaces the compacted model message with a system digest", () => {
		const result = compressContext(
			[
				{ role: "system", content: "System" },
				...Array.from({ length: 14 }, (_, index) => ({
					role: "user" as const,
					content: `message-${index}`,
				})),
			],
			{ keepFirstN: 1, keepLastN: 4 },
		);

		expect(result.digest).toBeDefined();
		expect(
			result.messages.some(
				(message) =>
					message.role === "system" &&
					typeof message.content === "string" &&
					message.content.includes("TEHUTI COMPACTION DIGEST"),
			),
		).toBe(true);
	});
});
