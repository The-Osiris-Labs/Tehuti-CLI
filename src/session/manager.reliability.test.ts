import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// We need to test the validator (private) and the atomic write behavior.
// Re-construct them via a focused unit by importing the public surface
// and observing behavior through saveSession / loadSession.
import { sessionManager } from "./manager.js";

let testDir: string;

beforeEach(async () => {
	testDir = await fs.mkdtemp(path.join(os.tmpdir(), "tehuti-reliability-"));
	// The session manager has a single shared `sessionsDir`. Point it at a
	// per-test directory to keep tests isolated.
	(sessionManager as any).sessionsDir = path.join(testDir, "sessions");
	await fs.ensureDir((sessionManager as any).sessionsDir);
});

afterEach(async () => {
	await fs.remove(testDir);
});

describe("session atomicity", () => {
	it("saveSession leaves the file in a valid state on disk (no .tmp leftover)", async () => {
		const id = await sessionManager.createSession(testDir, "test-model");
		const mockContext = {
			cwd: testDir,
			workingDir: testDir,
			messages: [{ role: "user" as const, content: "atomic test" }],
			appendOnlyLog: [{ role: "user" as const, content: "atomic test" }],
			config: { model: "test-model", maxIterations: 10, maxTokens: 4000 },
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
		};

		await sessionManager.saveSession(id, mockContext as any);

		const sessionDir = path.join((sessionManager as any).sessionsDir, id);
		// After a successful save, no .tmp file should remain.
		const tmpExists = await fs.pathExists(
			path.join(sessionDir, "session.json.tmp"),
		);
		expect(tmpExists).toBe(false);

		// Final file is parseable JSON with our content.
		const final = await fs.readJson(path.join(sessionDir, "session.json"));
		expect(final.messages[0].content).toBe("atomic test");
	});

	it("loadSession rejects a file with invalid structure", async () => {
		const id = await sessionManager.createSession(testDir, "test-model");
		const sessionDir = path.join((sessionManager as any).sessionsDir, id);
		// Write a totally invalid file (missing required fields).
		await fs.writeJson(path.join(sessionDir, "session.json"), {
			foo: "bar",
		});

		const result = await sessionManager.loadSession(id);
		expect(result).toBeNull();
	});

	it("loadSession rejects a file where messages lack a role", async () => {
		const id = await sessionManager.createSession(testDir, "test-model");
		const sessionDir = path.join((sessionManager as any).sessionsDir, id);
		await fs.writeJson(path.join(sessionDir, "session.json"), {
			metadata: {
				id,
				name: "broken",
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				cwd: testDir,
				model: "test-model",
				messageCount: 1,
				toolCalls: 0,
				tokensUsed: 0,
			},
			messages: [{ content: "no role" }], // missing role
			appendOnlyLog: [],
			context: {
				cwd: testDir,
				workingDir: testDir,
				readFilesThisSession: [],
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
			},
		});

		const result = await sessionManager.loadSession(id);
		expect(result).toBeNull();
	});

	it("loadSession rejects a file where metadata has wrong types", async () => {
		const id = await sessionManager.createSession(testDir, "test-model");
		const sessionDir = path.join((sessionManager as any).sessionsDir, id);
		await fs.writeJson(path.join(sessionDir, "session.json"), {
			metadata: {
				id,
				name: "broken",
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				cwd: testDir,
				model: "test-model",
				messageCount: "not-a-number", // should be number
				toolCalls: 0,
				tokensUsed: 0,
			},
			messages: [],
			appendOnlyLog: [],
			context: {
				cwd: testDir,
				workingDir: testDir,
				readFilesThisSession: [],
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
			},
		});

		const result = await sessionManager.loadSession(id);
		expect(result).toBeNull();
	});
});

describe("session corruption recovery", () => {
	it("survives a corrupted JSON file without crashing", async () => {
		const id = await sessionManager.createSession(testDir, "test-model");
		const sessionDir = path.join((sessionManager as any).sessionsDir, id);
		// Write invalid JSON
		await fs.writeFile(
			path.join(sessionDir, "session.json"),
			"{ this is not valid json",
		);

		const result = await sessionManager.loadSession(id);
		expect(result).toBeNull();
	});
});
