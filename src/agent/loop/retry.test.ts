import { describe, expect, it } from "vitest";
import { withRetry } from "./retry.js";

describe("withRetry hardening", () => {
	it("should abort immediately when signal is aborted during sleep", async () => {
		const controller = new AbortController();
		let attempts = 0;

		const promise = withRetry(
			async () => {
				attempts++;
				throw new Error("500 Internal Server Error");
			},
			{
				maxRetries: 5,
				initialDelayMs: 10000,
				signal: controller.signal,
			},
		);

		setTimeout(() => controller.abort(), 50);

		await expect(promise).rejects.toThrow("Aborted");
		expect(attempts).toBe(1);
	});
});
