import { describe, it, expect, beforeEach } from 'vitest';
import { MetricsCollector } from './metrics.js';

describe('MetricsCollector', () => {
	let metrics: MetricsCollector;

	beforeEach(() => {
		metrics = new MetricsCollector();
	});

	it('should track counters', () => {
		metrics.counter('test.counter');
		metrics.counter('test.counter');
		expect(metrics.getCounter('test.counter')).toBe(2);
	});

	it('should track histograms', () => {
		metrics.histogram('test.hist', 100);
		metrics.histogram('test.hist', 200);
		const stats = metrics.getHistogram('test.hist');
		expect(stats.avg).toBe(150);
	});

	it('should reset metrics', () => {
		metrics.counter('test.counter');
		metrics.reset();
		expect(metrics.getCounter('test.counter')).toBe(0);
	});

	it('should track gauges', () => {
		metrics.gauge('test.gauge', 42);
		const exported = metrics.export();
		expect(exported).toHaveLength(1);
		expect(exported[0].name).toBe('test.gauge');
		expect(exported[0].value).toBe(42);
	});

	it('should support labels on counters', () => {
		metrics.counter('http.requests', { method: 'GET' });
		metrics.counter('http.requests', { method: 'POST' });
		expect(metrics.getCounter('http.requests')).toBe(2);
	});

	it('should aggregate histogram percentiles', () => {
		for (let i = 1; i <= 100; i++) {
			metrics.histogram('latency', i);
		}
		const stats = metrics.getHistogram('latency');
		expect(stats.avg).toBe(50.5);
	expect(stats.p50).toBe(51);
	expect(stats.p99).toBe(100);
	});

	it('should return empty stats for unknown histogram', () => {
		const stats = metrics.getHistogram('nonexistent');
		expect(stats).toEqual({ avg: 0, p50: 0, p99: 0 });
	});

	it('should return zero for unknown counter', () => {
		expect(metrics.getCounter('nonexistent')).toBe(0);
	});

	it('should reset histograms and gauges', () => {
		metrics.histogram('h', 10);
		metrics.gauge('g', 5);
		metrics.reset();
		expect(metrics.getHistogram('h')).toEqual({ avg: 0, p50: 0, p99: 0 });
		expect(metrics.export()).toHaveLength(0);
	});
});
