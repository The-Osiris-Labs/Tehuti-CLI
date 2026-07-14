import { describe, expect, it, vi } from "vitest";
import {
	reviewCodeTool,
	summarizeContextTool,
} from "./kilocode-advanced.js";

describe("kilocodeAdvancedTools", () => {

	it("reviewCodeTool should return error if provider is not kilocode", async () => {
		const mockCtx = {
			config: { provider: "opencode" },
		};

		const result = await reviewCodeTool.execute(
			{ code: "const a = 1;" },
			mockCtx as any,
		);

		expect(result.success).toBe(false);
		expect(result.error).toContain("only available with KiloCode provider");
	});

	it("summarizeContextTool should return error if provider is not kilocode", async () => {
		const mockCtx = {
			config: { provider: "opencode" },
		};

		const result = await summarizeContextTool.execute(
			{ messages: [{ role: "user", content: "hello" }] },
			mockCtx as any,
		);

		expect(result.success).toBe(false);
		expect(result.error).toContain("only available with KiloCode provider");
	});
});
