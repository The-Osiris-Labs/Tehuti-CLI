import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, resetGlobalConfig, saveGlobalConfig } from "./loader.js";

describe("Config Loader", () => {
	const testDir = path.join(os.tmpdir(), "tehuti-config-test");
	const originalEnv = process.env;

	beforeEach(async () => {
		await fs.ensureDir(testDir);
		process.env = { ...originalEnv };
		delete process.env.OPENROUTER_API_KEY;
		delete process.env.TEHUTI_API_KEY;
		delete process.env.TEHUTI_MODEL;
		resetGlobalConfig();
	});

	afterEach(async () => {
		await fs.remove(testDir);
		process.env = originalEnv;
	});

	describe("loadConfig", () => {
		it("should return default config when no config file exists", async () => {
			const config = await loadConfig(testDir);

			expect(config).toBeDefined();
			expect(config.maxIterations).toBeGreaterThan(0);
			expect(config.maxTokens).toBeGreaterThan(0);
		});

		it("should use OPENROUTER_API_KEY environment variable", async () => {
			process.env.OPENROUTER_API_KEY = "test-api-key";

			const config = await loadConfig(testDir);

			expect(config.apiKey).toBe("test-api-key");
		});

		it("should use TEHUTI_API_KEY environment variable", async () => {
			process.env.TEHUTI_API_KEY = "tehuti-api-key";

			const config = await loadConfig(testDir);

			expect(config.apiKey).toBe("tehuti-api-key");
		});

		it("should use TEHUTI_MODEL environment variable", async () => {
			process.env.TEHUTI_MODEL = "test-model";

			const config = await loadConfig(testDir);

			expect(config.model).toBe("test-model");
		});

		it("should prioritize env vars over file config", async () => {
			process.env.OPENROUTER_API_KEY = "env-key";

			const config = await loadConfig(testDir);

			expect(config.apiKey).toBe("env-key");
		});
	});

	describe("saveGlobalConfig", () => {
		it("should save API key to global config", async () => {
			saveGlobalConfig({ apiKey: "saved-key" });

			const config = await loadConfig(testDir);
			expect(config.apiKey).toBe("saved-key");
		});

		it("should save model to global config", async () => {
			saveGlobalConfig({ model: "saved-model" });

			const config = await loadConfig(testDir);
			expect(config.model).toBe("saved-model");
		});
	});

	describe("resetGlobalConfig", () => {
		it("should clear global config", async () => {
			saveGlobalConfig({ apiKey: "test-key", model: "test-model" });
			resetGlobalConfig();

			const config = await loadConfig(testDir);
			expect(config.apiKey).toBeUndefined();
		});
	});
});
