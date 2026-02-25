import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sessionManager } from "./manager.js";

describe("SessionManager", () => {
	const testDir = path.join(os.tmpdir(), "tehuti-test-sessions");

	beforeEach(async () => {
		await fs.ensureDir(testDir);
	});

	afterEach(async () => {
		await fs.remove(testDir);
	});

	describe("createSession", () => {
		it("should create a new session with metadata", async () => {
			const id = await sessionManager.createSession(testDir, "test-model");

			expect(id).toBeDefined();
			expect(typeof id).toBe("string");

			const metadata = await sessionManager.getSessionMetadata(id);
			expect(metadata).toBeDefined();
			expect(metadata?.model).toBe("test-model");
			expect(metadata?.cwd).toBe(testDir);
		});

		it("should auto-generate session name", async () => {
			const id = await sessionManager.createSession(testDir, "test-model");
			const metadata = await sessionManager.getSessionMetadata(id);

			expect(metadata?.name).toBeDefined();
			expect(metadata?.name).toContain(path.basename(testDir));
		});

		it("should use provided name", async () => {
			const id = await sessionManager.createSession(
				testDir,
				"test-model",
				"my-custom-name",
			);
			const metadata = await sessionManager.getSessionMetadata(id);

			expect(metadata?.name).toBe("my-custom-name");
		});
	});

	describe("generateAutoName", () => {
		it("should include project name", () => {
			const name = sessionManager.generateAutoName(
				"/path/to/my-project",
				"model",
			);
			expect(name).toContain("my-project");
		});

		it("should handle root path", () => {
			const name = sessionManager.generateAutoName("/", "model");
			expect(name).toBeDefined();
			expect(typeof name).toBe("string");
		});
	});

	describe("saveSession and loadSession", () => {
		it("should save and load session data", async () => {
			const id = await sessionManager.createSession(testDir, "test-model");

			const mockContext = {
				cwd: testDir,
				workingDir: testDir,
				messages: [
					{ role: "user" as const, content: "Hello" },
					{ role: "assistant" as const, content: "Hi there!" },
				],
				config: {
					model: "test-model",
					maxIterations: 10,
					maxTokens: 4000,
				},
				metadata: {
					startTime: new Date(),
					toolCalls: 2,
					tokensUsed: 150,
					cacheReadTokens: 50,
					cacheWriteTokens: 100,
					filesRead: ["file1.ts"],
					filesWritten: ["file2.ts"],
					commandsRun: ["npm test"],
				},
			};

			await sessionManager.saveSession(id, mockContext as any);

			const loaded = await sessionManager.loadSession(id);
			expect(loaded).toBeDefined();
			expect(loaded?.messages).toHaveLength(2);
			expect(loaded?.context.metadata.tokensUsed).toBe(150);
		});

		it("should preserve existing name on save", async () => {
			const id = await sessionManager.createSession(
				testDir,
				"test-model",
				"original-name",
			);

			const mockContext = {
				cwd: testDir,
				workingDir: testDir,
				messages: [{ role: "user" as const, content: "test" }],
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

			const loaded = await sessionManager.loadSession(id);
			expect(loaded?.metadata.name).toBe("original-name");
		});

		it("should update name when provided", async () => {
			const id = await sessionManager.createSession(testDir, "test-model");

			const mockContext = {
				cwd: testDir,
				workingDir: testDir,
				messages: [{ role: "user" as const, content: "test" }],
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

			await sessionManager.saveSession(id, mockContext as any, "new-name");

			const loaded = await sessionManager.loadSession(id);
			expect(loaded?.metadata.name).toBe("new-name");
		});
	});

	describe("listSessions", () => {
		it("should list sessions sorted by update time", async () => {
			await sessionManager.createSession(testDir, "model-1");
			await new Promise((r) => setTimeout(r, 10));
			await sessionManager.createSession(testDir, "model-2");

			const sessions = await sessionManager.listSessions();
			expect(sessions.length).toBeGreaterThanOrEqual(2);
			expect(sessions[0].model).toBe("model-2");
		});

		it("should return empty array when no sessions exist for unique cwd", async () => {
			const uniqueDir = path.join(os.tmpdir(), `tehuti-unique-${Date.now()}`);
			const sessions = await sessionManager.listSessions();
			const testSessions = sessions.filter((s) => s.cwd === uniqueDir);
			expect(testSessions).toHaveLength(0);
		});

		it("should include all session metadata", async () => {
			const id = await sessionManager.createSession(
				testDir,
				"test-model",
				"test-session",
			);
			const sessions = await sessionManager.listSessions();
			const found = sessions.find((s) => s.id === id);

			expect(found).toBeDefined();
			expect(found?.name).toBe("test-session");
			expect(found?.model).toBe("test-model");
			expect(found?.cwd).toBe(testDir);
		});
	});

	describe("renameSession", () => {
		it("should rename a session", async () => {
			const id = await sessionManager.createSession(testDir, "test-model");
			await sessionManager.renameSession(id, "my-session");

			const metadata = await sessionManager.getSessionMetadata(id);
			expect(metadata?.name).toBe("my-session");
		});

		it("should update name in session file if exists", async () => {
			const id = await sessionManager.createSession(testDir, "test-model");

			const mockContext = {
				cwd: testDir,
				workingDir: testDir,
				messages: [{ role: "user" as const, content: "test" }],
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
			await sessionManager.renameSession(id, "renamed-session");

			const loaded = await sessionManager.loadSession(id);
			expect(loaded?.metadata.name).toBe("renamed-session");
		});
	});

	describe("deleteSession", () => {
		it("should delete a session", async () => {
			const id = await sessionManager.createSession(testDir, "test-model");
			await sessionManager.deleteSession(id);

			const metadata = await sessionManager.getSessionMetadata(id);
			expect(metadata).toBeNull();
		});

		it("should remove session from list", async () => {
			const id = await sessionManager.createSession(testDir, "test-model");
			await sessionManager.deleteSession(id);

			const sessions = await sessionManager.listSessions();
			expect(sessions.find((s) => s.id === id)).toBeUndefined();
		});
	});

	describe("getRecentSession", () => {
		it("should return most recent session for cwd", async () => {
			const id = await sessionManager.createSession(testDir, "test-model");
			const recentId = await sessionManager.getRecentSession(testDir);

			expect(recentId).toBe(id);
		});

		it("should return most recent session when cwd matches", async () => {
			const otherDir = path.join(os.tmpdir(), "tehuti-test-other");
			await fs.ensureDir(otherDir);

			await sessionManager.createSession(otherDir, "model-other");
			await new Promise((r) => setTimeout(r, 10));
			const expectedId = await sessionManager.createSession(
				testDir,
				"test-model",
			);

			const recentId = await sessionManager.getRecentSession(testDir);
			expect(recentId).toBe(expectedId);

			await fs.remove(otherDir);
		});
	});

	describe("session ID management", () => {
		it("should track current session ID", async () => {
			const id = await sessionManager.createSession(testDir, "test-model");
			expect(sessionManager.getCurrentSessionId()).toBe(id);
		});

		it("should allow setting session ID", () => {
			sessionManager.setCurrentSessionId("test-id");
			expect(sessionManager.getCurrentSessionId()).toBe("test-id");
		});

		it("should update current session ID on load", async () => {
			const id = await sessionManager.createSession(testDir, "test-model");

			const mockContext = {
				cwd: testDir,
				workingDir: testDir,
				messages: [{ role: "user" as const, content: "test" }],
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
			sessionManager.setCurrentSessionId(null);

			await sessionManager.loadSession(id);
			expect(sessionManager.getCurrentSessionId()).toBe(id);
		});
	});

	describe("cleanupOldSessions", () => {
		it("should remove old sessions", async () => {
			const id = await sessionManager.createSession(testDir, "test-model");

			const metadata = await sessionManager.getSessionMetadata(id);
			if (metadata) {
				metadata.updatedAt = new Date(
					Date.now() - 31 * 24 * 60 * 60 * 1000,
				).toISOString();
				const sessionDir = path.join(os.homedir(), ".tehuti", "sessions", id);
				await fs.writeJson(path.join(sessionDir, "metadata.json"), metadata, {
					spaces: 2,
				});
			}

			const cleaned = await sessionManager.cleanupOldSessions(30);
			expect(cleaned).toBeGreaterThanOrEqual(1);

			const metadataAfter = await sessionManager.getSessionMetadata(id);
			expect(metadataAfter).toBeNull();
		});
	});
});
