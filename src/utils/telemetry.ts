export interface ToolExecutionMetric {
	toolName: string;
	durationMs: number;
	success: boolean;
	cacheHit: boolean;
	timestamp: number;
}

export interface ParallelExecutionMetric {
	toolCount: number;
	parallelMs: number;
	sequentialEstimateMs: number;
	savingsMs: number;
	timestamp: number;
}

export interface CacheMetric {
	hits: number;
	misses: number;
	hitRate: number;
	bytesSaved: number;
}

export interface ModelCostMetric {
	model: string;
	promptTokens: number;
	completionTokens: number;
	cost: number;
	timestamp: number;
}

export interface PerformanceMetrics {
	toolExecutions: ToolExecutionMetric[];
	parallelExecutions: ParallelExecutionMetric[];
	cacheMetrics: CacheMetric;
	modelCosts: ModelCostMetric[];
	sessionStart: number;
	totalToolCalls: number;
	totalCacheHits: number;
	totalCacheMisses: number;
	totalTokensSaved: number;
	totalCostSaved: number;
}

class TelemetryCollector {
	private metrics: PerformanceMetrics;
	private enabled: boolean = true;

	constructor() {
		this.metrics = {
			toolExecutions: [],
			parallelExecutions: [],
			cacheMetrics: { hits: 0, misses: 0, hitRate: 0, bytesSaved: 0 },
			modelCosts: [],
			sessionStart: Date.now(),
			totalToolCalls: 0,
			totalCacheHits: 0,
			totalCacheMisses: 0,
			totalTokensSaved: 0,
			totalCostSaved: 0,
		};
	}

	setEnabled(enabled: boolean): void {
		this.enabled = enabled;
	}

	recordToolExecution(
		toolName: string,
		durationMs: number,
		success: boolean,
		cacheHit: boolean = false,
	): void {
		if (!this.enabled) return;

		this.metrics.toolExecutions.push({
			toolName,
			durationMs,
			success,
			cacheHit,
			timestamp: Date.now(),
		});

		this.metrics.totalToolCalls++;

		if (cacheHit) {
			this.metrics.totalCacheHits++;
			this.metrics.cacheMetrics.hits++;
		} else {
			this.metrics.totalCacheMisses++;
			this.metrics.cacheMetrics.misses++;
		}

		this.metrics.cacheMetrics.hitRate =
			this.metrics.cacheMetrics.hits /
			(Math.max(1, this.metrics.cacheMetrics.hits + this.metrics.cacheMetrics.misses));
	}

	recordParallelExecution(
		toolCount: number,
		parallelMs: number,
		sequentialEstimateMs: number,
	): void {
		if (!this.enabled) return;

		const savingsMs = Math.max(0, sequentialEstimateMs - parallelMs);

		this.metrics.parallelExecutions.push({
			toolCount,
			parallelMs,
			sequentialEstimateMs,
			savingsMs,
			timestamp: Date.now(),
		});
	}

	recordCacheStats(hits: number, misses: number, bytesSaved: number = 0): void {
		if (!this.enabled) return;

		this.metrics.cacheMetrics.hits += hits;
		this.metrics.cacheMetrics.misses += misses;
		this.metrics.cacheMetrics.bytesSaved += bytesSaved;
		this.metrics.totalTokensSaved += Math.floor(bytesSaved / 4);
	}

	recordModelCost(
		model: string,
		promptTokens: number,
		completionTokens: number,
		cost: number,
	): void {
		if (!this.enabled) return;

		this.metrics.modelCosts.push({
			model,
			promptTokens,
			completionTokens,
			cost,
			timestamp: Date.now(),
		});
	}

	getToolStats(): Map<string, { count: number; avgMs: number; totalMs: number; successRate: number }> {
		const stats = new Map<
			string,
			{ count: number; avgMs: number; totalMs: number; successRate: number }
		>();

		for (const metric of this.metrics.toolExecutions) {
			const existing = stats.get(metric.toolName) || {
				count: 0,
				avgMs: 0,
				totalMs: 0,
				successRate: 0,
			};
			existing.count++;
			existing.totalMs += metric.durationMs;
			existing.avgMs = existing.totalMs / existing.count;
			if (metric.success) {
				existing.successRate++;
			}
			stats.set(metric.toolName, existing);
		}

		for (const [, stat] of stats) {
			stat.successRate = stat.successRate / stat.count;
		}

		return stats;
	}

	getTotalSavings(): { timeMs: number; tokens: number; cost: number } {
		const parallelSavings = this.metrics.parallelExecutions.reduce(
			(sum, m) => sum + m.savingsMs,
			0,
		);

		return {
			timeMs: parallelSavings,
			tokens: this.metrics.totalTokensSaved,
			cost: this.metrics.totalCostSaved,
		};
	}

	getSessionDuration(): number {
		return Date.now() - this.metrics.sessionStart;
	}

	getSummary(): string {
		const toolStats = this.getToolStats();
		const savings = this.getTotalSavings();

		let summary = `\n📊 Performance Summary\n`;
		summary += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
		summary += `Session Duration: ${(this.getSessionDuration() / 1000).toFixed(1)}s\n`;
		summary += `Total Tool Calls: ${this.metrics.totalToolCalls}\n`;
		summary += `Cache Hit Rate: ${(this.metrics.cacheMetrics.hitRate * 100).toFixed(1)}%\n`;
		summary += `Time Saved (Parallel): ${(savings.timeMs / 1000).toFixed(2)}s\n`;
		summary += `Tokens Saved (Cache): ${this.metrics.totalTokensSaved.toLocaleString()}\n`;

		if (toolStats.size > 0) {
			summary += `\n🔧 Tool Performance:\n`;
			const sortedStats = Array.from(toolStats.entries()).sort(
				(a, b) => b[1].totalMs - a[1].totalMs,
			);
			for (const [tool, stat] of sortedStats.slice(0, 5)) {
				summary += `  ${tool}: ${stat.count} calls, avg ${stat.avgMs.toFixed(0)}ms\n`;
			}
		}

		return summary;
	}

	getMetrics(): PerformanceMetrics {
		return { ...this.metrics };
	}

	reset(): void {
		this.metrics = {
			toolExecutions: [],
			parallelExecutions: [],
			cacheMetrics: { hits: 0, misses: 0, hitRate: 0, bytesSaved: 0 },
			modelCosts: [],
			sessionStart: Date.now(),
			totalToolCalls: 0,
			totalCacheHits: 0,
			totalCacheMisses: 0,
			totalTokensSaved: 0,
			totalCostSaved: 0,
		};
	}
}

let globalTelemetry: TelemetryCollector | null = null;

export function getTelemetry(): TelemetryCollector {
	if (!globalTelemetry) {
		globalTelemetry = new TelemetryCollector();
	}
	return globalTelemetry;
}

export function resetTelemetry(): void {
	if (globalTelemetry) {
		globalTelemetry.reset();
	}
}

export { TelemetryCollector };
