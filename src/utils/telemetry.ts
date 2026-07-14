import { debug } from "./debug.js";

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

export interface ErrorMetric {
	message: string;
	stack?: string;
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
	errors: ErrorMetric[];
	totalErrors: number;
}

export function redactSensitiveInfo(text: string): string {
	if (!text) return text;
	let redacted = text.replace(/sk-[a-zA-Z0-9_-]+/g, "sk-[REDACTED]");
	redacted = redacted.replace(/(?:\/Users\/|\/home\/)[^/]+/g, "~");
	redacted = redacted.replace(/[A-Z]:\\Users\\[^\\]+/gi, "~");
	return redacted;
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
			errors: [],
			totalErrors: 0,
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
		if (this.metrics.toolExecutions.length > 1000)
			this.metrics.toolExecutions.shift();

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
			Math.max(
				1,
				this.metrics.cacheMetrics.hits + this.metrics.cacheMetrics.misses,
			);
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
		if (this.metrics.parallelExecutions.length > 1000)
			this.metrics.parallelExecutions.shift();
	}

	recordCacheStats(hits: number, misses: number, bytesSaved: number = 0): void {
		if (!this.enabled) return;

		this.metrics.cacheMetrics.hits += hits;
		this.metrics.cacheMetrics.misses += misses;
		this.metrics.cacheMetrics.bytesSaved += bytesSaved;
		this.metrics.totalTokensSaved += Math.floor(bytesSaved / 4);
	}
	recordRuleTrigger(pattern: string): void {
		if (!this.enabled) return;
		debug.log("agent", `Stream rule triggered: ${pattern}`);
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
		if (this.metrics.modelCosts.length > 1000) this.metrics.modelCosts.shift();
	}

	recordError(error: unknown): void {
		if (!this.enabled) return;

		let message = "Unknown error";
		let stack: string | undefined;

		if (error instanceof Error) {
			message = error.message;
			stack = error.stack;
		} else if (typeof error === "string") {
			message = error;
		} else {
			try {
				message = JSON.stringify(error);
			} catch {
				message = String(error);
			}
		}

		this.metrics.errors.push({
			message: redactSensitiveInfo(message),
			stack: stack ? redactSensitiveInfo(stack) : undefined,
			timestamp: Date.now(),
		});
		if (this.metrics.errors.length > 100) this.metrics.errors.shift();
		this.metrics.totalErrors++;
	}

	getToolStats(): Map<
		string,
		{ count: number; avgMs: number; totalMs: number; successRate: number }
	> {
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
		summary += `Total Errors: ${this.metrics.totalErrors}\n`;

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
			errors: [],
			totalErrors: 0,
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
