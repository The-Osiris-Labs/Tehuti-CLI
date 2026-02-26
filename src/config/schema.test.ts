import { describe, it, expect } from "vitest";
import { TEHUTI_CONFIG_SCHEMA, DEFAULT_CONFIG } from "../config/schema.js";
import type { TehutiConfig } from "../config/schema.js";

describe("Config Schema", () => {
	describe("Validation", () => {
		it("should validate default config", () => {
			const result = TEHUTI_CONFIG_SCHEMA.safeParse(DEFAULT_CONFIG);
			expect(result.success).toBe(true);
		});

		it("should validate minimal valid config", () => {
			const minimalConfig = {
				model: "giga-potato",
				provider: "kilocode",
			};

			const result = TEHUTI_CONFIG_SCHEMA.safeParse(minimalConfig);
			expect(result.success).toBe(true);
		});

		it("should validate config with API key", () => {
			const config = {
				...DEFAULT_CONFIG,
				apiKey: "test-api-key",
			};

			const result = TEHUTI_CONFIG_SCHEMA.safeParse(config);
			expect(result.success).toBe(true);
			expect((result as any).data.apiKey).toBe("test-api-key");
		});

		it("should validate custom provider config", () => {
			const config = {
				...DEFAULT_CONFIG,
				provider: "custom",
				customProvider: {
					name: "Test Provider",
					baseUrl: "https://api.test.com/v1",
					apiKey: "test-key",
					headers: {
						"Content-Type": "application/json",
					},
				},
			};

			const result = TEHUTI_CONFIG_SCHEMA.safeParse(config);
			expect(result.success).toBe(true);
			expect((result as any).data.provider).toBe("custom");
			expect((result as any).data.customProvider?.name).toBe("Test Provider");
			expect((result as any).data.customProvider?.baseUrl).toBe("https://api.test.com/v1");
			expect((result as any).data.customProvider?.apiKey).toBe("test-key");
		});

		it("should reject config with invalid temperature", () => {
			const invalidConfigs = [
				{ ...DEFAULT_CONFIG, temperature: -0.1 },
				{ ...DEFAULT_CONFIG, temperature: 2.1 },
			];

			invalidConfigs.forEach((config) => {
				const result = TEHUTI_CONFIG_SCHEMA.safeParse(config);
				expect(result.success).toBe(false);
			});
		});

		it("should reject config with invalid model selection mode", () => {
			const config = {
				...DEFAULT_CONFIG,
				modelSelection: "invalid-mode",
			};

			const result = TEHUTI_CONFIG_SCHEMA.safeParse(config);
			expect(result.success).toBe(false);
		});

		it("should reject config with invalid provider", () => {
			const config = {
				...DEFAULT_CONFIG,
				provider: "invalid-provider",
			};

			const result = TEHUTI_CONFIG_SCHEMA.safeParse(config);
			expect(result.success).toBe(false);
		});
	});
});