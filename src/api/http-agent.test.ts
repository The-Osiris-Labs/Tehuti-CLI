import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	getAgent,
	getAgentStats,
	initializeHttpAgent,
	resetAgent,
} from "./http-agent.js";

describe("http-agent", () => {
	beforeEach(async () => {
		await resetAgent();
	});

	afterEach(async () => {
		await resetAgent();
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

	it("should reset correctly", async () => {
		initializeHttpAgent();
		expect(getAgent()).not.toBeNull();

		await resetAgent();
		expect(getAgent()).toBeNull();
		expect(getAgentStats().pools).toBe(0);
	});
});
