import { describe, expect, it } from "vitest";
import type { AgentContext } from "../context.js";
import { manageContextWindow } from "./compression.js";

describe("manageContextWindow", () => {
	it("should atomically prune matching role: 'tool' messages when removing an assistant message with tool_calls", async () => {
		const messages: any[] = [
			{ role: "system", content: "System prompt" },
			{
				role: "assistant",
				content: "Call tool 1 and 2",
				tool_calls: [
					{
						id: "call_1",
						type: "function",
						function: { name: "foo", arguments: "{}" },
					},
					{
						id: "call_2",
						type: "function",
						function: { name: "bar", arguments: "{}" },
					},
				],
			},
			{ role: "tool", tool_call_id: "call_1", content: "result 1" },
			{ role: "tool", tool_call_id: "call_2", content: "result 2" },
			// Add enough recent messages to form the keep window (keepLastN = 10)
			{ role: "user", content: "m1" },
			{ role: "assistant", content: "m2" },
			{ role: "user", content: "m3" },
			{ role: "assistant", content: "m4" },
			{ role: "user", content: "m5" },
			{ role: "assistant", content: "m6" },
			{ role: "user", content: "m7" },
			{ role: "assistant", content: "m8" },
			{ role: "user", content: "m9" },
			{ role: "assistant", content: "m10" },
			{ role: "user", content: "m11" },
		];

		const ctx = {
			messages,
			modelContextLength: 100, // Very small max context so compression triggers
			config: {},
		} as unknown as AgentContext;

		await manageContextWindow(ctx, {} as any, 100);

		const remainingToolCallIds = ctx.messages
			.filter((m) => m.role === "tool")
			.map((m) => m.tool_call_id);

		expect(remainingToolCallIds).toEqual([]);
		expect(ctx.messages[0].role).toBe("system");
	});
});
