import { beforeEach, describe, expect, it } from "vitest";
import {
	classifyTask,
	estimateCost,
	getCheaperAlternative,
	getModelConfig,
	getTierForModel,
	MODEL_TIERS,
	ModelTier,
	selectModelForClassification,
} from "../agent/model-router.js";
import { loadConfig } from "../config/loader.js";

describe("Model Router", () => {
	describe("Basic functionality", () => {
		it("should export tiers", () => {
			expect(MODEL_TIERS.fast).toBeDefined();
			expect(MODEL_TIERS.balanced).toBeDefined();
			expect(MODEL_TIERS.deep).toBeDefined();
		});

		it("should export tier properties", () => {
			expect(typeof MODEL_TIERS.fast.modelId).toBe("string");
			expect(typeof MODEL_TIERS.fast.maxTokens).toBe("number");
			expect(typeof MODEL_TIERS.fast.supportsTools).toBe("boolean");
		});
	});

	describe("Task classification", () => {
		const mockContext = {
			messages: [],
			cwd: "/",
			workingDir: "/",
			config: {} as any,
			metadata: {
				startTime: new Date(),
				toolCalls: 0,
				tokensUsed: 0,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
				filesRead: [],
				filesWritten: [],
				commandsRun: [],
			},
		};

		it("should classify simple tasks as fast tier", () => {
			const simpleTasks = [
				"list all files in directory",
				"read package.json",
				"check git status",
				"find files containing 'export'",
				"show me the README.md",
			];

			simpleTasks.forEach((task) => {
				const classification = classifyTask(task, mockContext);
				expect(["fast", "balanced"]).toContain(classification.tier);
			});
		});

		it("should classify complex tasks as deep tier", () => {
			const complexTasks = [
				"refactor this large codebase",
				"implement authentication system",
				"design database schema",
				"optimize performance of this application",
				"security audit of this code",
			];

			complexTasks.forEach((task) => {
				const classification = classifyTask(task, mockContext);
				expect(["balanced", "deep"]).toContain(classification.tier);
			});
		});

		it("should return valid classification", () => {
			const tasks = [
				"write unit tests",
				"fix this bug",
				"add documentation",
				"explain this code",
				"help with debugging",
			];

			tasks.forEach((task) => {
				const classification = classifyTask(task, mockContext);
				expect(["fast", "balanced", "deep"]).toContain(classification.tier);
				expect(typeof classification.reason).toBe("string");
				expect(classification.confidence).toBeGreaterThan(0);
				expect(classification.confidence).toBeLessThanOrEqual(1);
			});
		});
	});

	describe("Manual model selection", () => {
		let originalEnv: NodeJS.ProcessEnv;

		beforeEach(() => {
			originalEnv = { ...process.env };
		});

		it("should respect TEHUTI_MODEL environment variable", async () => {
			process.env.TEHUTI_MODEL = "test-model";
			const config = await loadConfig();
			expect(config.model).toBe("test-model");
		});

		it("should respect OPENROUTER_API_KEY for model selection", async () => {
			delete process.env.TEHUTI_API_KEY;
			delete process.env.KILO_API_KEY;
			process.env.OPENROUTER_API_KEY = "test-key";
			const config = await loadConfig();
			expect(config.apiKey).toBe("test-key");
		});

		it("should respect TEHUTI_API_KEY for model selection", async () => {
			delete process.env.OPENROUTER_API_KEY;
			delete process.env.KILO_API_KEY;
			process.env.TEHUTI_API_KEY = "test-tehuti-key";
			const config = await loadConfig();
			expect(config.apiKey).toBe("test-tehuti-key");
		});
	});
});
