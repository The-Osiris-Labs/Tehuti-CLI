import { describe, expect, it } from "vitest";
import {
	compactMessagesForUi,
	compactToolResultForUi,
	estimateUiMessageChars,
	needsUiCompaction,
	truncateMiddle,
	UI_MAX_MESSAGES,
	UI_MAX_REASONING_CHARS,
	UI_MAX_TEXT_CHARS,
	UI_MAX_TOOL_OUTPUT_CHARS,
	type UiMessage,
} from "./chat-memory.js";

function makeLargeToolResult(size: number) {
	return {
		success: true,
		output: "x".repeat(size),
		nested: {
			output: "y".repeat(size),
		},
	};
}

function makeMessage(id: number, outputSize = 50000): UiMessage {
	return {
		id,
		role: "assistant",
		content: `message-${id} ${"a".repeat(UI_MAX_TEXT_CHARS + 2000)}`,
		blocks: [
			{
				type: "text",
				content: "b".repeat(UI_MAX_TEXT_CHARS + 2000),
			},
			{
				type: "reasoning",
				content: "c".repeat(UI_MAX_REASONING_CHARS + 2000),
			},
			{
				type: "tool",
				id: `tool-${id}`,
				name: "bash",
				description: "large output",
				result: makeLargeToolResult(outputSize),
			},
		],
		toolCalls: [
			{
				id: `tool-${id}`,
				name: "bash",
				description: "large output",
				result: makeLargeToolResult(outputSize),
				isExpanded: false,
			},
		],
	};
}

describe("chat UI memory compaction", () => {
	it("bounds retained messages and compacts old tool payloads", () => {
		const messages = Array.from({ length: 220 }, (_, index) =>
			makeMessage(index),
		);

		expect(needsUiCompaction(messages)).toBe(true);

		const compacted = compactMessagesForUi(messages);

		expect(compacted).toHaveLength(UI_MAX_MESSAGES);
		expect(compacted[0].id).toBe(100);

		const oldMessage = compacted[0];
		expect(oldMessage.toolCalls?.[0].result).toEqual("[Compacted]");
		expect(
			oldMessage.blocks?.find((block) => block.type === "tool")?.result,
		).toEqual("[Compacted]");
		expect(oldMessage.content.length).toBeLessThan(1400);

		const recentMessage = compacted[compacted.length - 1];
		const recentTool = recentMessage.blocks?.find(
			(block) => block.type === "tool",
		);
		expect(recentTool?.result).not.toBeNull();
		expect(estimateUiMessageChars(recentMessage)).toBeLessThan(
			UI_MAX_TEXT_CHARS + UI_MAX_REASONING_CHARS + UI_MAX_TOOL_OUTPUT_CHARS * 4,
		);
	});

	it("truncates huge string and nested tool outputs", () => {
		const compacted = compactToolResultForUi(makeLargeToolResult(50000)) as {
			output: string;
			nested: { output: string };
		};

		expect(compacted.output.length).toBeLessThan(UI_MAX_TOOL_OUTPUT_CHARS + 80);
		expect(compacted.output).toContain("truncated for UI memory");
		expect(compacted.nested.output.length).toBeLessThan(
			UI_MAX_TOOL_OUTPUT_CHARS + 80,
		);
	});

	it("keeps both the beginning and end when truncating text", () => {
		const text = `start-${"m".repeat(200)}-end`;
		const truncated = truncateMiddle(text, 80, "test");

		expect(truncated).toContain("start-");
		expect(truncated).toContain("-end");
		expect(truncated).toContain("test");
	});

	it("keeps historical compaction markers while bounding ordinary messages", () => {
		const marker = {
			id: 999,
			role: "system",
			kind: "compaction" as const,
			content: "historical digest",
		};
		const messages = [
			marker,
			...Array.from({ length: UI_MAX_MESSAGES + 10 }, (_, id) => ({
				id,
				role: "user",
				content: `message-${id}`,
			})),
		];

		const compacted = compactMessagesForUi(messages);

		expect(compacted[0]).toMatchObject({ kind: "compaction", id: 999 });
		expect(
			compacted.filter((message) => message.kind !== "compaction"),
		).toHaveLength(UI_MAX_MESSAGES);
	});
});
