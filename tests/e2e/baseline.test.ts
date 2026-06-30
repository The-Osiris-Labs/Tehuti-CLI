import { describe, it, expect } from "vitest";
import { setupE2EEnvironment, enqueueMockResponse } from "./helpers/e2e-helper.js";
import { createProgram } from "../../src/cli/index.js";

describe("Tehuti CLI E2E Baseline", () => {
	it("should run CLI in one-shot mode and yield mock LLM output", async () => {
		const env = await setupE2EEnvironment();

		enqueueMockResponse({
			content: "Greetings! I am Tehuti, the scribe of the gods.",
		});

		try {
			const program = createProgram();
			// Run the program in one-shot mode: tehuti "hello"
			await program.parseAsync(["node", "tehuti", "hello"]);

			// Verify output contains the mocked response content
			const output = env.getOutput();
			expect(output).toContain("Greetings! I am Tehuti, the scribe of the gods.");
			expect(env.mockExit).not.toHaveBeenCalledWith(1);
		} finally {
			await env.cleanup();
		}
	});

	it("should run CLI with --json option and output structured JSON", async () => {
		const env = await setupE2EEnvironment();

		enqueueMockResponse({
			content: "Structured JSON response content",
		});

		try {
			const program = createProgram();
			// Run the program with a prompt and --json flag
			await program.parseAsync(["node", "tehuti", "--json", "what is your name"]);

			// Verify output contains a valid JSON matching the one-shot format
			const output = env.getOutput();
			expect(output).toContain('"content": "Structured JSON response content"');
			expect(output).toContain('"success": true');
			
			// Try to parse the JSON portion from output
			const lines = output.trim().split("\n");
			const jsonStart = lines.findIndex(line => line.trim().startsWith("{"));
			expect(jsonStart).toBeGreaterThan(-1);
			
			const jsonString = lines.slice(jsonStart).join("\n");
			const parsed = JSON.parse(jsonString);
			expect(parsed.content).toBe("Structured JSON response content");
			expect(parsed.success).toBe(true);
			
			expect(env.mockExit).not.toHaveBeenCalledWith(1);
		} finally {
			await env.cleanup();
		}
	});
});
