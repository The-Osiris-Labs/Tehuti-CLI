import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkSessionHealth } from "./health.js";
import type { SessionData } from "./manager.js";

describe("checkSessionHealth", () => {
	const baseDir = path.join(os.tmpdir(), "tehuti-health-test");
	const savedCwd = path.join(baseDir, "project");
	const currentCwd = path.join(baseDir, "other");

	beforeEach(async () => {
		await fs.emptyDir(baseDir);
		await fs.ensureDir(savedCwd);
		await fs.ensureDir(currentCwd);
	});

	afterEach(async () => {
		await fs.remove(baseDir);
	});

	function createSessionData(cwd: string): SessionData {
		return {
			metadata: {
				id: "12345678-1234-4234-8234-123456789abc",
				name: "test",
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				cwd,
				model: "test-model",
				messageCount: 1,
				toolCalls: 0,
				tokensUsed: 0,
			},
			messages: [{ role: "user", content: "hello" }],
			appendOnlyLog: [{ role: "user", content: "Started PID 12345" }],
			context: {
				cwd,
				workingDir: cwd,
				metadata: {
					startTime: new Date(),
					toolCalls: 0,
					tokensUsed: 0,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
					filesRead: [],
					filesWritten: [],
					commandsRun: [],
				},
				readFilesThisSession: [],
			},
		};
	}

	it("prefers a valid saved cwd and warns when current cwd differs", async () => {
		const health = await checkSessionHealth(
			createSessionData(savedCwd),
			currentCwd,
		);

		expect(health.resumeCwd).toBe(await fs.realpath(savedCwd));
		expect(health.status).toBe("warning");
		expect(health.warnings.join("\n")).toContain("Session cwd differs");
	});

	it("falls back to current cwd for an explicit load when saved cwd is gone", async () => {
		const missing = path.join(baseDir, "missing");
		const health = await checkSessionHealth(
			createSessionData(missing),
			currentCwd,
			{
				allowFallbackCwd: true,
			},
		);

		expect(health.status).toBe("warning");
		expect(health.resumeCwd).toBe(currentCwd);
		expect(health.warnings.join("\n")).toContain("Saved cwd no longer exists");
	});
});
