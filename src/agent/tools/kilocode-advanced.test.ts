import { describe, expect, it, vi } from "vitest";
import {
	configureContextManagementTool,
	reviewCodeTool,
	summarizeContextTool,
} from "./kilocode-advanced.js";

describe("kilocodeAdvancedTools", () => {
	it("configureContextManagementTool should return honest structured diagnostic indicating scaffolded runtime enforcement", async () => {
		const mockCtx = {
			config: {
				provider: "kilocode",
				apiKey: "mock-kilocode-api-key-12345",
				model: "minimax-m3",
			},
		};

		const result = await configureContextManagementTool.execute(
			{ autoSummarize: true, maxContextLength: 16000 },
			mockCtx as any,
		);

		expect(result.success).toBe(true);
		const parsed = JSON.parse(result.output);
		expect(parsed.status).toBe("scaffolded");
		expect(parsed.feature).toBe("configure_context_management");
		expect(parsed.configured).toEqual({
			autoSummarize: true,
			maxContextLength: 16000,
		});
	});

	it("configureContextManagementTool should return error if provider is not kilocode", async () => {
		const mockCtx = {
			config: { provider: "opencode" },
		};

		const result = await configureContextManagementTool.execute(
			{ autoSummarize: true, maxContextLength: 16000 },
			mockCtx as any,
		);

		expect(result.success).toBe(false);
		expect(result.error).toContain("only available with KiloCode provider");
	});

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
