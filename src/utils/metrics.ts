/**
 * OpenTelemetry-compatible metrics collector.
 *
 * Provides counters, gauges, and histograms with label support.
 * Standalone utility — does not depend on or modify the existing telemetry module.
 */

export interface Metric {
	name: string;
	value: number;
	labels?: Record<string, string>;
	timestamp: number;
}

export class MetricsCollector {
	private metrics: Metric[] = [];
	private counters = new Map<string, number>();
	private histograms = new Map<string, number[]>();

	/** Increment a named counter by 1. */
	counter(name: string, labels?: Record<string, string>): void {
		const key = `${name}:${JSON.stringify(labels ?? {})}`;
		this.counters.set(key, (this.counters.get(key) ?? 0) + 1);
	}

	/** Record a gauge value (point-in-time measurement). */
	gauge(name: string, value: number, labels?: Record<string, string>): void {
		this.metrics.push({ name, value, labels, timestamp: Date.now() });
	}

	/** Record a histogram observation. */
	histogram(name: string, value: number, labels?: Record<string, string>): void {
		const key = `${name}:${JSON.stringify(labels ?? {})}`;
		const values = this.histograms.get(key) ?? [];
		values.push(value);
		this.histograms.set(key, values);
	}

	/** Get the total count for a counter name (across all label combinations). */
	getCounter(name: string): number {
		let total = 0;
		for (const [key, value] of this.counters) {
			if (key.startsWith(name + ":")) total += value;
		}
		return total;
	}

	/** Get aggregated histogram stats for a name (across all label combinations). */
	getHistogram(name: string): { avg: number; p50: number; p99: number } {
		let values: number[] = [];
		for (const [key, vals] of this.histograms) {
			if (key.startsWith(name + ":")) values.push(...vals);
		}
		values.sort((a, b) => a - b);
		return {
			avg: values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0,
			p50: values[Math.floor(values.length * 0.5)] ?? 0,
			p99: values[Math.floor(values.length * 0.99)] ?? 0,
		};
	}

	/** Return all recorded gauge metrics. */
	export(): Metric[] {
		return [...this.metrics];
	}

	/** Clear all collected metrics, counters, and histograms. */
	reset(): void {
		this.metrics = [];
		this.counters.clear();
		this.histograms.clear();
	}
}

/** Singleton metrics collector for application-wide use. */
export const metrics = new MetricsCollector();
