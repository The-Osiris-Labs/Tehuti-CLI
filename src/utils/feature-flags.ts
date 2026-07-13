/**
 * Tehuti Feature Flag System
 *
 * Runtime feature flags for gradual feature rollout and A/B testing.
 */

export interface FeatureFlag {
	/** Unique flag key */
	key: string;
	/** Human-readable description */
	description: string;
	/** Default value */
	defaultValue: boolean;
	/** Current value (may be overridden) */
	enabled: boolean;
	/** Rollout percentage (0-100) */
	rolloutPercentage: number;
	/** User segments that have this flag */
	segments: string[];
	/** When the flag was created */
	createdAt: number;
	/** When the flag was last updated */
	updatedAt: number;
	/** Metadata */
	metadata?: Record<string, unknown>;
}

export interface ABTestConfig {
	/** Test identifier */
	testId: string;
	/** Test description */
	description: string;
	/** Flag key that controls this test */
	flagKey: string;
	/** Control group percentage (0-100) */
	controlPercentage: number;
	/** Variant configurations */
	variants: Array<{
		name: string;
		percentage: number;
		metadata?: Record<string, unknown>;
	}>;
	/** Start date */
	startDate: number;
	/** End date (0 = no end) */
	endDate: number;
	/** Whether the test is active */
	active: boolean;
}

export interface ABTestResult {
	testId: string;
	variant: string;
	metricName: string;
	value: number;
	timestamp: number;
}

class FeatureFlagManager {
	private flags = new Map<string, FeatureFlag>();
	private abTests = new Map<string, ABTestConfig>();
	private abResults: ABTestResult[] = [];
	private userId: string;

	constructor(userId?: string) {
		this.userId = userId || "default";
		this.initializeDefaults();
	}

	private initializeDefaults(): void {
		const defaults: Array<Omit<FeatureFlag, "createdAt" | "updatedAt">> = [
			{
				key: "plugins.enabled",
				description: "Enable plugin system",
				defaultValue: true,
				enabled: true,
				rolloutPercentage: 100,
				segments: [],
			},
			{
				key: "api.server",
				description: "Enable public API server",
				defaultValue: false,
				enabled: false,
				rolloutPercentage: 0,
				segments: [],
			},
			{
				key: "telemetry.detailed",
				description: "Collect detailed telemetry metrics",
				defaultValue: false,
				enabled: false,
				rolloutPercentage: 10,
				segments: [],
			},
			{
				key: "ui.streaming_thinking",
				description: "Stream thinking tokens in UI",
				defaultValue: true,
				enabled: true,
				rolloutPercentage: 100,
				segments: [],
			},
			{
				key: "agent.parallel_tools",
				description: "Enable parallel tool execution",
				defaultValue: true,
				enabled: true,
				rolloutPercentage: 100,
				segments: [],
			},
			{
				key: "cache.aggressive",
				description: "Enable aggressive caching strategy",
				defaultValue: false,
				enabled: false,
				rolloutPercentage: 25,
				segments: [],
			},
			{
				key: "ui.command_palette_v2",
				description: "New command palette UI",
				defaultValue: false,
				enabled: false,
				rolloutPercentage: 50,
				segments: ["beta"],
			},
		];

		const now = Date.now();
		for (const flag of defaults) {
			this.flags.set(flag.key, {
				...flag,
				createdAt: now,
				updatedAt: now,
			});
		}
	}

	/**
	 * Check if a feature flag is enabled
	 */
	isEnabled(key: string): boolean {
		const flag = this.flags.get(key);
		if (!flag) return false;
		return flag.enabled;
	}

	/**
	 * Get a flag's full configuration
	 */
	getFlag(key: string): FeatureFlag | undefined {
		return this.flags.get(key);
	}

	/**
	 * Get all flags
	 */
	getAllFlags(): FeatureFlag[] {
		return Array.from(this.flags.values());
	}

	/**
	 * Set a flag's enabled state
	 */
	setEnabled(key: string, enabled: boolean): void {
		const flag = this.flags.get(key);
		if (flag) {
			flag.enabled = enabled;
			flag.updatedAt = Date.now();
		}
	}

	/**
	 * Create a new feature flag
	 */
	createFlag(
		key: string,
		description: string,
		defaultValue: boolean,
		rolloutPercentage = 100,
	): FeatureFlag {
		const now = Date.now();
		const flag: FeatureFlag = {
			key,
			description,
			defaultValue,
			enabled: defaultValue,
			rolloutPercentage,
			segments: [],
			createdAt: now,
			updatedAt: now,
		};
		this.flags.set(key, flag);
		return flag;
	}

	/**
	 * Remove a feature flag
	 */
	removeFlag(key: string): boolean {
		return this.flags.delete(key);
	}

	/**
	 * Set rollout percentage for a flag
	 */
	setRolloutPercentage(key: string, percentage: number): void {
		const flag = this.flags.get(key);
		if (flag) {
			flag.rolloutPercentage = Math.max(0, Math.min(100, percentage));
			flag.updatedAt = Date.now();
		}
	}

	/**
	 * Create an A/B test
	 */
	createABTest(config: ABTestConfig): void {
		this.abTests.set(config.testId, config);
	}

	/**
	 * Get A/B test assignment for a user
	 */
	getABTestVariant(testId: string): string {
		const test = this.abTests.get(testId);
		if (!test || !test.active) return "control";

		const now = Date.now();
		if (test.endDate > 0 && now > test.endDate) return "control";

		// Simple hash-based assignment for consistency
		const hash = this.simpleHash(`${testId}:${this.userId}`);
		const bucket = hash % 100;

		let cumulative = 0;
		for (const variant of test.variants) {
			cumulative += variant.percentage;
			if (bucket < cumulative) {
				return variant.name;
			}
		}

		return "control";
	}

	/**
	 * Record an A/B test result
	 */
	recordABTestResult(
		testId: string,
		variant: string,
		metricName: string,
		value: number,
	): void {
		this.abResults.push({
			testId,
			variant,
			metricName,
			value,
			timestamp: Date.now(),
		});

		// Keep last 10000 results
		if (this.abResults.length > 10000) {
			this.abResults = this.abResults.slice(-5000);
		}
	}

	/**
	 * Get A/B test results summary
	 */
	getABTestResults(testId: string): Record<string, Record<string, number>> {
		const results: Record<string, Record<string, number>> = {};

		for (const result of this.abResults) {
			if (result.testId !== testId) continue;

			if (!results[result.variant]) {
				results[result.variant] = {};
			}
			if (!results[result.variant][result.metricName]) {
				results[result.variant][result.metricName] = 0;
			}
			results[result.variant][result.metricName] += result.value;
		}

		return results;
	}

	/**
	 * Export all flags as JSON
	 */
	exportFlags(): string {
		return JSON.stringify(
			{
				flags: Array.from(this.flags.values()),
				abTests: Array.from(this.abTests.values()),
			},
			null,
			2,
		);
	}

	/**
	 * Import flags from JSON
	 */
	importFlags(json: string): void {
		const data = JSON.parse(json);

		if (data.flags) {
			for (const flag of data.flags) {
				this.flags.set(flag.key, flag);
			}
		}

		if (data.abTests) {
			for (const test of data.abTests) {
				this.abTests.set(test.testId, test);
			}
		}
	}

	/**
	 * Simple hash function for consistent bucket assignment
	 */
	private simpleHash(str: string): number {
		let hash = 0;
		for (let i = 0; i < str.length; i++) {
			const char = str.charCodeAt(i);
			hash = (hash << 5) - hash + char;
			hash = hash & hash; // Convert to 32-bit integer
		}
		return Math.abs(hash);
	}
}

let globalFlagManager: FeatureFlagManager | null = null;

export function getFeatureFlags(): FeatureFlagManager {
	if (!globalFlagManager) {
		globalFlagManager = new FeatureFlagManager();
	}
	return globalFlagManager;
}

export function resetFeatureFlags(): void {
	globalFlagManager = null;
}

export { FeatureFlagManager };
