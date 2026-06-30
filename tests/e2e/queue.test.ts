import { describe, it, expect } from "vitest";
import { setupE2EEnvironment, enqueueMockResponse } from "./helpers/e2e-helper.js";
import { createProgram } from "../../src/cli/index.js";
import * as path from "node:path";

describe("Tehuti CLI E2E Mock Queue & Fallbacks", () => {
	it("should handle multiple enqueued responses sequentially (multi-turn tool flow)", async () => {
		const env = await setupE2EEnvironment();

		// Enqueue response 1: LLM decides to call the 'read' tool on package.json
		enqueueMockResponse({
			toolCalls: [{
				name: "read",
				arguments: JSON.stringify({ filePath: path.join(process.cwd(), "package.json") }),
			}],
		});

		// Enqueue response 2: LLM answers based on tool result
		enqueueMockResponse({
			content: "I have read package.json. It contains the project description.",
		});

		try {
			const program = createProgram();
			// Run program in one-shot mode
			await program.parseAsync(["node", "tehuti", "read package.json"]);

			const output = env.getOutput();
			// The final output should contain the second response
			expect(output).toContain("I have read package.json. It contains the project description.");
			expect(env.mockExit).not.toHaveBeenCalledWith(1);
		} finally {
			await env.cleanup();
		}
	});

	it("should handle error fallback and retry on retryable API errors", async () => {
		const env = await setupE2EEnvironment();

		// Enqueue response 1: A rate limit error
		enqueueMockResponse({
			error: new Error("Rate limit exceeded. Please wait before making more requests."),
		});

		// Enqueue response 2: Success response on the next retry attempt
		enqueueMockResponse({
			content: "Successful response after a rate limit retry!",
		});

		try {
			const program = createProgram();
			// Run program. Since a retryable error occurs, the agent loop (via withRetry)
			// should retry, calling streamChat again, which consumes the second response.
			await program.parseAsync(["node", "tehuti", "retry check"]);

			const output = env.getOutput();
			expect(output).toContain("Successful response after a rate limit retry!");
			expect(env.mockExit).not.toHaveBeenCalledWith(1);
		} finally {
			await env.cleanup();
		}
	});
});
