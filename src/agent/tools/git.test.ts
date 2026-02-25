import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	GIT_ADD_SCHEMA,
	GIT_BRANCH_SCHEMA,
	GIT_COMMIT_SCHEMA,
	GIT_DIFF_SCHEMA,
	GIT_LOG_SCHEMA,
	GIT_STATUS_SCHEMA,
	gitTools,
} from "./git.js";

describe("Git Tools", () => {
	let tempDir: string;
	const ctx = { cwd: "", workingDir: "", env: {}, timeout: 30000 };

	beforeEach(() => {
		tempDir = join(tmpdir(), `tehuti-git-test-${Date.now()}`);
		mkdirSync(tempDir, { recursive: true });
		ctx.cwd = tempDir;
		ctx.workingDir = tempDir;
	});

	afterEach(() => {
		try {
			rmSync(tempDir, { recursive: true, force: true });
		} catch {}
	});

	describe("Schemas", () => {
		it("should validate git_status schema", () => {
			expect(() => GIT_STATUS_SCHEMA.parse({})).not.toThrow();
			expect(() => GIT_STATUS_SCHEMA.parse({ porcelain: true })).not.toThrow();
			expect(() => GIT_STATUS_SCHEMA.parse({ short: false })).not.toThrow();
		});

		it("should validate git_diff schema", () => {
			expect(() => GIT_DIFF_SCHEMA.parse({})).not.toThrow();
			expect(() => GIT_DIFF_SCHEMA.parse({ staged: true })).not.toThrow();
			expect(() => GIT_DIFF_SCHEMA.parse({ file: "test.ts" })).not.toThrow();
		});

		it("should validate git_log schema", () => {
			expect(() => GIT_LOG_SCHEMA.parse({})).not.toThrow();
			expect(() => GIT_LOG_SCHEMA.parse({ max_count: 10 })).not.toThrow();
			expect(() => GIT_LOG_SCHEMA.parse({ oneline: false })).not.toThrow();
		});

		it("should validate git_add schema", () => {
			expect(() => GIT_ADD_SCHEMA.parse({ files: ["."] })).not.toThrow();
			expect(() =>
				GIT_ADD_SCHEMA.parse({ files: ["test.ts", "src/"] }),
			).not.toThrow();
			expect(() => GIT_ADD_SCHEMA.parse({ files: [] })).not.toThrow();
		});

		it("should validate git_commit schema", () => {
			expect(() => GIT_COMMIT_SCHEMA.parse({ message: "test" })).not.toThrow();
			expect(() =>
				GIT_COMMIT_SCHEMA.parse({ message: "test", amend: true }),
			).not.toThrow();
		});

		it("should validate git_branch schema", () => {
			expect(() => GIT_BRANCH_SCHEMA.parse({})).not.toThrow();
			expect(() =>
				GIT_BRANCH_SCHEMA.parse({ create: "new-branch" }),
			).not.toThrow();
			expect(() => GIT_BRANCH_SCHEMA.parse({ checkout: "main" })).not.toThrow();
		});
	});

	describe("Tool Definitions", () => {
		it("should have 9 git tools", () => {
			expect(gitTools).toHaveLength(9);
		});

		it("should have correct tool names", () => {
			const names = gitTools.map((t) => t.name);
			expect(names).toContain("git_status");
			expect(names).toContain("git_diff");
			expect(names).toContain("git_log");
			expect(names).toContain("git_add");
			expect(names).toContain("git_commit");
			expect(names).toContain("git_branch");
			expect(names).toContain("git_remote");
			expect(names).toContain("git_pull");
			expect(names).toContain("git_push");
		});

		it("should mark read-only tools as not requiring permission", () => {
			const statusTool = gitTools.find((t) => t.name === "git_status");
			const diffTool = gitTools.find((t) => t.name === "git_diff");
			const logTool = gitTools.find((t) => t.name === "git_log");
			const remoteTool = gitTools.find((t) => t.name === "git_remote");

			expect(statusTool?.requiresPermission).toBe(false);
			expect(diffTool?.requiresPermission).toBe(false);
			expect(logTool?.requiresPermission).toBe(false);
			expect(remoteTool?.requiresPermission).toBe(false);
		});

		it("should mark write tools as requiring permission", () => {
			const addTool = gitTools.find((t) => t.name === "git_add");
			const commitTool = gitTools.find((t) => t.name === "git_commit");
			const branchTool = gitTools.find((t) => t.name === "git_branch");
			const pushTool = gitTools.find((t) => t.name === "git_push");

			expect(addTool?.requiresPermission).toBe(true);
			expect(commitTool?.requiresPermission).toBe(true);
			expect(branchTool?.requiresPermission).toBe(true);
			expect(pushTool?.requiresPermission).toBe(true);
		});

		it("should have correct category", () => {
			for (const tool of gitTools) {
				expect(tool.category).toBe("git");
			}
		});
	});

	describe("Non-git directory handling", () => {
		it("git_status should fail on non-git directory", async () => {
			const statusTool = gitTools.find((t) => t.name === "git_status");
			const result = await statusTool?.execute({}, ctx);

			expect(result.success).toBe(false);
			expect(result.error).toContain("Not a git repository");
		});

		it("git_diff should fail on non-git directory", async () => {
			const diffTool = gitTools.find((t) => t.name === "git_diff");
			const result = await diffTool?.execute({}, ctx);

			expect(result.success).toBe(false);
			expect(result.error).toContain("Not a git repository");
		});

		it("git_log should fail on non-git directory", async () => {
			const logTool = gitTools.find((t) => t.name === "git_log");
			const result = await logTool?.execute({}, ctx);

			expect(result.success).toBe(false);
			expect(result.error).toContain("Not a git repository");
		});

		it("git_add should fail on non-git directory", async () => {
			const addTool = gitTools.find((t) => t.name === "git_add");
			const result = await addTool?.execute({ files: ["."] }, ctx);

			expect(result.success).toBe(false);
			expect(result.error).toContain("Not a git repository");
		});

		it("git_commit should fail on non-git directory", async () => {
			const commitTool = gitTools.find((t) => t.name === "git_commit");
			const result = await commitTool?.execute({ message: "test" }, ctx);

			expect(result.success).toBe(false);
			expect(result.error).toContain("Not a git repository");
		});
	});
});
