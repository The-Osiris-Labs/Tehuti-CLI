import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	getAgent,
	getAgentStats,
	getPool,
	initializeHttpAgent,
	resetAgent,
} from "./http-agent.js";

describe("http-agent", () => {
	beforeEach(() => {
		resetAgent();
	});

	afterEach(() => {
		resetAgent();
	});

	it("should initialize the agent", () => {
		expect(getAgent()).toBeNull();
		initializeHttpAgent({
			connections: 10,
			pipelining: 2,
		});
		expect(getAgent()).not.toBeNull();

		const stats = getAgentStats();
		expect(stats.initialized).toBe(true);
		expect(stats.pools).toBe(0);
	});

	it("should create pools correctly", () => {
		initializeHttpAgent();
		const pool1 = getPool("https://openrouter.ai");
		expect(pool1).toBeDefined();

		const stats = getAgentStats();
		expect(stats.pools).toBe(1);
		expect(stats.poolsDetails["https://openrouter.ai"]).toBeDefined();

		const pool2 = getPool("https://openrouter.ai");
		expect(pool2).toBe(pool1); // should reuse
	});

	it("should reset correctly", () => {
		initializeHttpAgent();
		getPool("https://openrouter.ai");
		expect(getAgent()).not.toBeNull();
		expect(getAgentStats().pools).toBe(1);

		resetAgent();
		expect(getAgent()).toBeNull();
		expect(getAgentStats().pools).toBe(0);
	});
});
