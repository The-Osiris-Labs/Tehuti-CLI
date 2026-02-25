import { beforeEach, describe, expect, it } from "vitest";
import { costTracker, getModelPricing, type UsageMetrics } from "./cost.js";

describe("Cost Tracker", () => {
	beforeEach(() => {
		costTracker.reset();
	});

	describe("getModelPricing", () => {
		it("should return pricing for Claude models", () => {
			const pricing = getModelPricing("anthropic/claude-sonnet-4");
			expect(pricing.input).toBe(3);
			expect(pricing.output).toBe(15);
		});

		it("should return pricing for GPT-4 models", () => {
			const pricing = getModelPricing("openai/gpt-4o");
			expect(pricing.input).toBe(2.5);
			expect(pricing.output).toBe(10);
		});

		it("should return pricing for Gemini models", () => {
			const pricing = getModelPricing("google/gemini-pro-1.5");
			expect(pricing.input).toBe(1.25);
			expect(pricing.output).toBe(5);
		});

		it("should return pricing for DeepSeek models", () => {
			const pricing = getModelPricing("deepseek/deepseek-chat");
			expect(pricing.input).toBe(0.14);
			expect(pricing.output).toBe(0.28);
		});

		it("should return default pricing for unknown models", () => {
			const pricing = getModelPricing("unknown/model");
			expect(pricing.input).toBe(0);
			expect(pricing.output).toBe(0);
		});

		it("should include cache pricing for supported models", () => {
			const pricing = getModelPricing("anthropic/claude-sonnet-4");
			expect(pricing.cacheRead).toBeDefined();
			expect(pricing.cacheWrite).toBeDefined();
		});
	});

	describe("calculateCost", () => {
		it("should calculate cost correctly", () => {
			const usage: UsageMetrics = {
				promptTokens: 1000,
				completionTokens: 500,
				totalTokens: 1500,
			};

			const cost = costTracker.calculateCost(
				"anthropic/claude-sonnet-4",
				usage,
			);

			expect(cost.inputCost).toBeCloseTo(0.003, 6);
			expect(cost.outputCost).toBeCloseTo(0.0075, 6);
			expect(cost.totalCost).toBeCloseTo(0.0105, 6);
		});

		it("should include cache read cost", () => {
			const usage: UsageMetrics = {
				promptTokens: 1000,
				completionTokens: 500,
				totalTokens: 1500,
				cacheReadTokens: 500,
			};

			const cost = costTracker.calculateCost(
				"anthropic/claude-sonnet-4",
				usage,
			);

			expect(cost.cacheReadCost).toBeGreaterThan(0);
			expect(cost.totalCost).toBe(
				cost.inputCost + cost.outputCost + cost.cacheReadCost,
			);
		});

		it("should include cache write cost", () => {
			const usage: UsageMetrics = {
				promptTokens: 1000,
				completionTokens: 500,
				totalTokens: 1500,
				cacheWriteTokens: 200,
			};

			const cost = costTracker.calculateCost(
				"anthropic/claude-sonnet-4",
				usage,
			);

			expect(cost.cacheWriteCost).toBeGreaterThan(0);
		});

		it("should handle zero usage", () => {
			const usage: UsageMetrics = {
				promptTokens: 0,
				completionTokens: 0,
				totalTokens: 0,
			};

			const cost = costTracker.calculateCost(
				"anthropic/claude-sonnet-4",
				usage,
			);

			expect(cost.totalCost).toBe(0);
		});
	});

	describe("trackRequest", () => {
		it("should track request usage", () => {
			const usage: UsageMetrics = {
				promptTokens: 1000,
				completionTokens: 500,
				totalTokens: 1500,
			};

			costTracker.trackRequest("anthropic/claude-sonnet-4", usage);

			const stats = costTracker.getSessionStats();
			expect(stats.totalPromptTokens).toBe(1000);
			expect(stats.totalCompletionTokens).toBe(500);
			expect(stats.requestCount).toBe(1);
		});

		it("should accumulate usage across requests", () => {
			const usage1: UsageMetrics = {
				promptTokens: 1000,
				completionTokens: 500,
				totalTokens: 1500,
			};
			const usage2: UsageMetrics = {
				promptTokens: 2000,
				completionTokens: 1000,
				totalTokens: 3000,
			};

			costTracker.trackRequest("anthropic/claude-sonnet-4", usage1);
			costTracker.trackRequest("anthropic/claude-sonnet-4", usage2);

			const stats = costTracker.getSessionStats();
			expect(stats.totalPromptTokens).toBe(3000);
			expect(stats.totalCompletionTokens).toBe(1500);
			expect(stats.requestCount).toBe(2);
		});

		it("should accumulate cost", () => {
			const usage: UsageMetrics = {
				promptTokens: 1000,
				completionTokens: 500,
				totalTokens: 1500,
			};

			costTracker.trackRequest("anthropic/claude-sonnet-4", usage);
			costTracker.trackRequest("anthropic/claude-sonnet-4", usage);

			const stats = costTracker.getSessionStats();
			expect(stats.totalCost).toBeGreaterThan(0);
		});

		it("should track cache tokens", () => {
			const usage: UsageMetrics = {
				promptTokens: 1000,
				completionTokens: 500,
				totalTokens: 1500,
				cacheReadTokens: 500,
				cacheWriteTokens: 200,
			};

			costTracker.trackRequest("anthropic/claude-sonnet-4", usage);

			const stats = costTracker.getSessionStats();
			expect(stats.totalCacheReadTokens).toBe(500);
			expect(stats.totalCacheWriteTokens).toBe(200);
		});
	});

	describe("getSessionStats", () => {
		it("should return session statistics", () => {
			const stats = costTracker.getSessionStats();

			expect(stats).toHaveProperty("totalPromptTokens");
			expect(stats).toHaveProperty("totalCompletionTokens");
			expect(stats).toHaveProperty("totalCacheReadTokens");
			expect(stats).toHaveProperty("totalCacheWriteTokens");
			expect(stats).toHaveProperty("totalCost");
			expect(stats).toHaveProperty("requestCount");
		});
	});

	describe("formatCost", () => {
		it("should format small costs in cents", () => {
			const formatted = costTracker.formatCost(0.005);
			expect(formatted).toContain("¢");
		});

		it("should format larger costs in dollars", () => {
			const formatted = costTracker.formatCost(1.5);
			expect(formatted).toContain("$");
			expect(formatted).not.toContain("¢");
		});
	});

	describe("getSessionSummary", () => {
		it("should return formatted summary", () => {
			const usage: UsageMetrics = {
				promptTokens: 1000,
				completionTokens: 500,
				totalTokens: 1500,
			};

			costTracker.trackRequest("anthropic/claude-sonnet-4", usage);

			const summary = costTracker.getSessionSummary();

			expect(summary).toContain("Session");
			expect(summary).toContain("Requests: 1");
			expect(summary).toContain("Tokens");
			expect(summary).toContain("Cost:");
		});

		it("should include cache savings when present", () => {
			const usage: UsageMetrics = {
				promptTokens: 1000,
				completionTokens: 500,
				totalTokens: 1500,
				cacheReadTokens: 500,
			};

			costTracker.trackRequest("anthropic/claude-sonnet-4", usage);

			const summary = costTracker.getSessionSummary();

			expect(summary).toContain("Cache");
		});

		it("should not include cache savings when zero", () => {
			const usage: UsageMetrics = {
				promptTokens: 1000,
				completionTokens: 500,
				totalTokens: 1500,
			};

			costTracker.trackRequest("anthropic/claude-sonnet-4", usage);

			const summary = costTracker.getSessionSummary();

			expect(summary).not.toContain("Cache savings");
		});
	});

	describe("reset", () => {
		it("should reset all counters", () => {
			const usage: UsageMetrics = {
				promptTokens: 1000,
				completionTokens: 500,
				totalTokens: 1500,
			};

			costTracker.trackRequest("anthropic/claude-sonnet-4", usage);
			costTracker.reset();

			const stats = costTracker.getSessionStats();
			expect(stats.totalPromptTokens).toBe(0);
			expect(stats.totalCompletionTokens).toBe(0);
			expect(stats.requestCount).toBe(0);
			expect(stats.totalCost).toBe(0);
		});
	});
});
