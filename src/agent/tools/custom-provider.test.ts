import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../api/custom-provider.js", () => ({
	CustomProviderClient: {
		resetInstance: vi.fn(),
	},
}));

import { CustomProviderClient } from "../../api/custom-provider.js";
import {
	customProviderTools,
	configureCustomProviderTool,
	setCustomHeaderTool,
	removeCustomHeaderTool,
	getCustomProviderInfoTool,
} from "./custom-provider.js";
import type { ToolContext } from "./registry.js";

const mockedReset = vi.mocked(CustomProviderClient.resetInstance);

function mockCtx(config: Record<string, unknown> = {}): ToolContext {
	return {
		config,
		workingDir: "/tmp/test",
		agentContext: undefined,
	} satisfies ToolContext;
}

describe("customProviderTools", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("tool definitions", () => {
		it("should export four tools", () => {
			expect(customProviderTools).toHaveLength(4);
		});

		it("should have expected tool names", () => {
			const names = customProviderTools.map((t) => t.name);
			expect(names).toEqual([
				"configure_custom_provider",
				"set_custom_header",
				"remove_custom_header",
				"get_custom_provider_info",
			]);
		});

		it("should all belong to the system category", () => {
			for (const tool of customProviderTools) {
				expect(tool.category).toBe("system");
			}
		});

		it("configureCustomProviderTool should be the first tool", () => {
			expect(customProviderTools[0]).toBe(configureCustomProviderTool);
		});

		it("setCustomHeaderTool should be the second tool", () => {
			expect(customProviderTools[1]).toBe(setCustomHeaderTool);
		});

		it("removeCustomHeaderTool should be the third tool", () => {
			expect(customProviderTools[2]).toBe(removeCustomHeaderTool);
		});

		it("getCustomProviderInfoTool should be the fourth tool", () => {
			expect(customProviderTools[3]).toBe(getCustomProviderInfoTool);
		});
	});

	describe("configure_custom_provider", () => {
		it("should configure provider and reset client", async () => {
			const config: Record<string, unknown> = {};
			const result = await configureCustomProviderTool.execute(
				{
					name: "openai-compat",
					baseUrl: "https://api.example.com/v1",
					apiKey: "sk-test",
					headers: { "X-Custom": "value" },
				},
				mockCtx(config) as never,
			);

			expect(result.success).toBe(true);
			expect(config.provider).toBe("custom");
			expect(config.customProvider).toEqual({
				name: "openai-compat",
				baseUrl: "https://api.example.com/v1",
				apiKey: "sk-test",
				headers: { "X-Custom": "value" },
			});
			expect(mockedReset).toHaveBeenCalled();
		});

		it("should handle missing optional parameters", async () => {
			const config: Record<string, unknown> = {};
			const result = await configureCustomProviderTool.execute(
				{
					name: "minimal",
					baseUrl: "https://api.min.com",
				},
				mockCtx(config) as never,
			);

			expect(result.success).toBe(true);
			expect(config.customProvider).toEqual({
				name: "minimal",
				baseUrl: "https://api.min.com",
				apiKey: undefined,
				headers: {},
			});
		});
	});

	describe("set_custom_header", () => {
		it("should set a header when provider is custom", async () => {
			const config: Record<string, unknown> = {
				provider: "custom",
				customProvider: { name: "test", baseUrl: "https://x.com", headers: {} },
			};

			const result = await setCustomHeaderTool.execute(
				{ key: "Authorization", value: "Bearer tok" },
				mockCtx(config) as never,
			);

			expect(result.success).toBe(true);
			expect(config.customProvider).toMatchObject({
				headers: { Authorization: "Bearer tok" },
			});
			expect(mockedReset).toHaveBeenCalled();
		});

		it("should reject when provider is not custom", async () => {
			const result = await setCustomHeaderTool.execute(
				{ key: "X-Api-Key", value: "123" },
				mockCtx({ provider: "openai" }) as never,
			);

			expect(result.success).toBe(false);
			expect(result.error).toContain("only available with custom provider");
		});

		it("should reject when customProvider is not configured", async () => {
			const result = await setCustomHeaderTool.execute(
				{ key: "X-Api-Key", value: "123" },
				mockCtx({ provider: "custom" }) as never,
			);

			expect(result.success).toBe(false);
			expect(result.error).toContain("not configured");
		});

		it("should create headers map if it does not exist", async () => {
			const config: Record<string, unknown> = {
				provider: "custom",
				customProvider: { name: "test", baseUrl: "https://x.com" },
			};

			await setCustomHeaderTool.execute(
				{ key: "New-Header", value: "val" },
				mockCtx(config) as never,
			);

			expect(
				(config.customProvider as Record<string, unknown>).headers,
			).toEqual({ "New-Header": "val" });
		});
	});

	describe("remove_custom_header", () => {
		it("should remove an existing header", async () => {
			const config: Record<string, unknown> = {
				provider: "custom",
				customProvider: {
					name: "test",
					baseUrl: "https://x.com",
					headers: { "X-Old": "value" },
				},
			};

			const result = await removeCustomHeaderTool.execute(
				{ key: "X-Old" },
				mockCtx(config) as never,
			);

			expect(result.success).toBe(true);
			expect(
				(config.customProvider as Record<string, unknown>).headers,
			).not.toHaveProperty("X-Old");
		});

		it("should succeed gracefully when header does not exist", async () => {
			const config: Record<string, unknown> = {
				provider: "custom",
				customProvider: { name: "test", baseUrl: "https://x.com", headers: {} },
			};

			const result = await removeCustomHeaderTool.execute(
				{ key: "nonexistent" },
				mockCtx(config) as never,
			);

			expect(result.success).toBe(true);
			expect(result.output).toContain("does not exist");
		});

		it("should reject when provider is not custom", async () => {
			const result = await removeCustomHeaderTool.execute(
				{ key: "X-Key" },
				mockCtx({ provider: "openai" }) as never,
			);

			expect(result.success).toBe(false);
			expect(result.error).toContain("only available with custom provider");
		});
	});

	describe("get_custom_provider_info", () => {
		it("should return provider info when configured", async () => {
			const config: Record<string, unknown> = {
				provider: "custom",
				customProvider: {
					name: "my-llm",
					baseUrl: "https://llm.example.com",
					headers: { "X-Foo": "bar" },
				},
			};

			const result = await getCustomProviderInfoTool.execute(
				{},
				mockCtx(config) as never,
			);

			expect(result.success).toBe(true);
			const parsed = JSON.parse(result.output as string);
			expect(parsed.name).toBe("my-llm");
			expect(parsed.baseUrl).toBe("https://llm.example.com");
			expect(parsed.headers).toEqual({ "X-Foo": "bar" });
		});

		it("should reject when provider is not custom", async () => {
			const result = await getCustomProviderInfoTool.execute(
				{},
				mockCtx({ provider: "openai" }) as never,
			);

			expect(result.success).toBe(false);
			expect(result.error).toContain("not configured");
		});

		it("should reject when customProvider is missing", async () => {
			const result = await getCustomProviderInfoTool.execute(
				{},
				mockCtx({ provider: "custom" }) as never,
			);

			expect(result.success).toBe(false);
			expect(result.error).toContain("not configured");
		});
	});
});
