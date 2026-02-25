import { describe, it, expect, beforeEach } from "vitest";
import { TelemetryCollector, getTelemetry, resetTelemetry } from "./telemetry.js";

describe("TelemetryCollector", () => {
	let telemetry: TelemetryCollector;

	beforeEach(() => {
		telemetry = new TelemetryCollector();
	});

	describe("recordToolExecution", () => {
		it("should record tool execution metrics", () => {
			telemetry.recordToolExecution("read", 100, true, false);

			const stats = telemetry.getToolStats();
			expect(stats.get("read")).toBeDefined();
			expect(stats.get("read")?.count).toBe(1);
			expect(stats.get("read")?.totalMs).toBe(100);
			expect(stats.get("read")?.avgMs).toBe(100);
			expect(stats.get("read")?.successRate).toBe(1);
		});

		it("should track cache hits and misses", () => {
			telemetry.recordToolExecution("read", 50, true, true);
			telemetry.recordToolExecution("read", 100, true, false);
			telemetry.recordToolExecution("glob", 30, true, true);

			const metrics = telemetry.getMetrics();
			expect(metrics.totalToolCalls).toBe(3);
			expect(metrics.totalCacheHits).toBe(2);
			expect(metrics.totalCacheMisses).toBe(1);
			expect(metrics.cacheMetrics.hitRate).toBeCloseTo(0.667, 2);
		});

		it("should calculate success rate correctly", () => {
			telemetry.recordToolExecution("bash", 100, true, false);
			telemetry.recordToolExecution("bash", 150, false, false);
			telemetry.recordToolExecution("bash", 200, true, false);

			const stats = telemetry.getToolStats();
			expect(stats.get("bash")?.successRate).toBeCloseTo(0.667, 2);
		});
	});

	describe("recordParallelExecution", () => {
		it("should record parallel execution savings", () => {
			telemetry.recordParallelExecution(3, 500, 1500);

			const metrics = telemetry.getMetrics();
			expect(metrics.parallelExecutions).toHaveLength(1);
			expect(metrics.parallelExecutions[0].toolCount).toBe(3);
			expect(metrics.parallelExecutions[0].savingsMs).toBe(1000);
		});

		it("should calculate total savings", () => {
			telemetry.recordParallelExecution(3, 500, 1500);
			telemetry.recordParallelExecution(2, 300, 800);

			const savings = telemetry.getTotalSavings();
			expect(savings.timeMs).toBe(1500);
		});
	});

	describe("recordModelCost", () => {
		it("should record model cost metrics", () => {
			telemetry.recordModelCost("test-model", 1000, 500, 0.01);

			const metrics = telemetry.getMetrics();
			expect(metrics.modelCosts).toHaveLength(1);
			expect(metrics.modelCosts[0].model).toBe("test-model");
			expect(metrics.modelCosts[0].promptTokens).toBe(1000);
			expect(metrics.modelCosts[0].cost).toBe(0.01);
		});
	});

	describe("getSummary", () => {
		it("should generate a summary string", () => {
			telemetry.recordToolExecution("read", 100, true, true);
			telemetry.recordToolExecution("write", 200, true, false);
			telemetry.recordParallelExecution(2, 500, 1000);

			const summary = telemetry.getSummary();
			expect(summary).toContain("Performance Summary");
			expect(summary).toContain("Total Tool Calls: 2");
			expect(summary).toContain("Cache Hit Rate");
		});
	});

	describe("reset", () => {
		it("should reset all metrics", () => {
			telemetry.recordToolExecution("read", 100, true, false);
			telemetry.recordModelCost("model", 100, 50, 0.01);

			telemetry.reset();

			const metrics = telemetry.getMetrics();
			expect(metrics.totalToolCalls).toBe(0);
			expect(metrics.modelCosts).toHaveLength(0);
		});
	});

	describe("setEnabled", () => {
		it("should not record metrics when disabled", () => {
			telemetry.setEnabled(false);
			telemetry.recordToolExecution("read", 100, true, false);

			const metrics = telemetry.getMetrics();
			expect(metrics.totalToolCalls).toBe(0);
		});
	});
});

describe("getTelemetry", () => {
	it("should return a singleton instance", () => {
		const t1 = getTelemetry();
		const t2 = getTelemetry();
		expect(t1).toBe(t2);
	});
});

describe("resetTelemetry", () => {
	it("should reset the global telemetry instance", () => {
		const t1 = getTelemetry();
		t1.recordToolExecution("read", 100, true, false);

		resetTelemetry();

		const t2 = getTelemetry();
		expect(t2.getMetrics().totalToolCalls).toBe(0);
	});
});
