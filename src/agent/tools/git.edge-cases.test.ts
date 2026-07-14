import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	GIT_ADD_SCHEMA,
	GIT_BRANCH_SCHEMA,
	GIT_COMMIT_SCHEMA,
	GIT_DIFF_SCHEMA,
	GIT_LOG_SCHEMA,
	GIT_PUSH_SCHEMA,
	GIT_REMOTE_SCHEMA,
	GIT_STATUS_SCHEMA,
	gitTools,
} from "./git.js";

describe("git edge cases", () => {
	let tempDir: string;
	const ctx = { cwd: "", workingDir: "", env: {}, timeout: 30000 };

	beforeEach(() => {
		tempDir = join(tmpdir(), `tehuti-git-edge-${Date.now()}`);
		mkdirSync(tempDir, { recursive: true });
		ctx.cwd = tempDir;
		ctx.workingDir = tempDir;
	});

	afterEach(() => {
		try {
			rmSync(tempDir, { recursive: true, force: true });
		} catch {}
	});

	function initGitRepo(dir: string): void {
		execSync("git init", { cwd: dir, stdio: "ignore" });
		execSync("git config user.email 'test@test.com'", {
			cwd: dir,
			stdio: "ignore",
		});
		execSync("git config user.name 'Test'", { cwd: dir, stdio: "ignore" });
	}

	function createCommit(dir: string, filename: string, content: string): void {
		writeFileSync(join(dir, filename), content);
		execSync(`git add ${filename}`, { cwd: dir, stdio: "ignore" });
		execSync('git commit -m "test commit"', { cwd: dir, stdio: "ignore" });
	}

	describe("empty repository", () => {
		it("should handle git status on empty repo (no commits)", async () => {
			initGitRepo(tempDir);
			const statusTool = gitTools.find((t) => t.name === "git_status");
			const result = await statusTool?.execute({}, ctx);

			expect(result?.success).toBe(true);
		});

		it("should handle git log on empty repo (no commits)", async () => {
			initGitRepo(tempDir);
			const logTool = gitTools.find((t) => t.name === "git_log");
			const result = await logTool?.execute({}, ctx);

			// git log fails on a repo with no commits — the tool should not crash
			expect(result).toBeDefined();
			expect(result?.error).toBeDefined();
		});

		it("should handle git diff on empty repo (no commits)", async () => {
			initGitRepo(tempDir);
			const diffTool = gitTools.find((t) => t.name === "git_diff");
			const result = await diffTool?.execute({}, ctx);

			expect(result?.success).toBe(true);
			expect(result?.output).toContain("No changes");
		});

		it("should handle git add on empty repo", async () => {
			initGitRepo(tempDir);
			writeFileSync(join(tempDir, "file.txt"), "content");
			const addTool = gitTools.find((t) => t.name === "git_add");
			const result = await addTool?.execute({ files: ["file.txt"] }, ctx);

			expect(result?.success).toBe(true);
		});

		it("should handle git branch list on empty repo", async () => {
			initGitRepo(tempDir);
			const branchTool = gitTools.find((t) => t.name === "git_branch");
			const result = await branchTool?.execute({ list: true }, ctx);

			expect(result?.success).toBe(true);
		});
	});

	describe("detached HEAD", () => {
		it("should handle git status in detached HEAD state", async () => {
			initGitRepo(tempDir);
			createCommit(tempDir, "file.txt", "initial");
			createCommit(tempDir, "file2.txt", "second");

			// Get the first commit hash and detach HEAD
			const firstCommit = execSync("git rev-parse HEAD~1", {
				cwd: tempDir,
				encoding: "utf-8",
			}).trim();
			execSync(`git checkout ${firstCommit}`, { cwd: tempDir, stdio: "ignore" });

			const statusTool = gitTools.find((t) => t.name === "git_status");
			const result = await statusTool?.execute({}, ctx);

			expect(result?.success).toBe(true);
		});

		it("should handle git log in detached HEAD state", async () => {
			initGitRepo(tempDir);
			createCommit(tempDir, "file.txt", "initial");
			createCommit(tempDir, "file2.txt", "second");

			const firstCommit = execSync("git rev-parse HEAD~1", {
				cwd: tempDir,
				encoding: "utf-8",
			}).trim();
			execSync(`git checkout ${firstCommit}`, { cwd: tempDir, stdio: "ignore" });

			const logTool = gitTools.find((t) => t.name === "git_log");
			const result = await logTool?.execute({}, ctx);

			expect(result?.success).toBe(true);
		});

		it("should handle git diff in detached HEAD state", async () => {
			initGitRepo(tempDir);
			createCommit(tempDir, "file.txt", "initial");
			createCommit(tempDir, "file2.txt", "second");

			const firstCommit = execSync("git rev-parse HEAD~1", {
				cwd: tempDir,
				encoding: "utf-8",
			}).trim();
			execSync(`git checkout ${firstCommit}`, { cwd: tempDir, stdio: "ignore" });

			const diffTool = gitTools.find((t) => t.name === "git_diff");
			const result = await diffTool?.execute({}, ctx);

			expect(result?.success).toBe(true);
		});
	});

	describe("merge conflicts", () => {
		it("should handle git status with merge conflicts", async () => {
			initGitRepo(tempDir);

			// Create initial commit
			writeFileSync(join(tempDir, "conflict.txt"), "line1\nline2\nline3");
			execSync("git add conflict.txt", { cwd: tempDir, stdio: "ignore" });
			execSync('git commit -m "initial"', { cwd: tempDir, stdio: "ignore" });

			// Create branch and make conflicting change
			execSync("git checkout -b branch1", { cwd: tempDir, stdio: "ignore" });
			writeFileSync(join(tempDir, "conflict.txt"), "line1\nbranch1\nline3");
			execSync("git add conflict.txt", { cwd: tempDir, stdio: "ignore" });
			execSync('git commit -m "branch1 change"', {
				cwd: tempDir,
				stdio: "ignore",
			});

			// Go back to main and make different change
			execSync("git checkout main", { cwd: tempDir, stdio: "ignore" });
			writeFileSync(join(tempDir, "conflict.txt"), "line1\nmain\nline3");
			execSync("git add conflict.txt", { cwd: tempDir, stdio: "ignore" });
			execSync('git commit -m "main change"', { cwd: tempDir, stdio: "ignore" });

			// Merge should cause conflict
			try {
				execSync("git merge branch1", { cwd: tempDir, stdio: "ignore" });
			} catch {
				// Merge conflict is expected
			}

			const statusTool = gitTools.find((t) => t.name === "git_status");
			const result = await statusTool?.execute({}, ctx);

			expect(result?.success).toBe(true);
		});

		it("should handle git diff with merge conflicts", async () => {
			initGitRepo(tempDir);

			writeFileSync(join(tempDir, "conflict.txt"), "line1\nline2\nline3");
			execSync("git add conflict.txt", { cwd: tempDir, stdio: "ignore" });
			execSync('git commit -m "initial"', { cwd: tempDir, stdio: "ignore" });

			execSync("git checkout -b branch1", { cwd: tempDir, stdio: "ignore" });
			writeFileSync(join(tempDir, "conflict.txt"), "line1\nbranch1\nline3");
			execSync("git add conflict.txt", { cwd: tempDir, stdio: "ignore" });
			execSync('git commit -m "branch1 change"', {
				cwd: tempDir,
				stdio: "ignore",
			});

			execSync("git checkout main", { cwd: tempDir, stdio: "ignore" });
			writeFileSync(join(tempDir, "conflict.txt"), "line1\nmain\nline3");
			execSync("git add conflict.txt", { cwd: tempDir, stdio: "ignore" });
			execSync('git commit -m "main change"', { cwd: tempDir, stdio: "ignore" });

			try {
				execSync("git merge branch1", { cwd: tempDir, stdio: "ignore" });
			} catch {
				// Expected
			}

			const diffTool = gitTools.find((t) => t.name === "git_diff");
			const result = await diffTool?.execute({}, ctx);

			expect(result?.success).toBe(true);
		});
	});

	describe("schema edge cases", () => {
		it("should validate git_status with all options", () => {
			expect(() =>
				GIT_STATUS_SCHEMA.parse({ porcelain: true, short: false }),
			).not.toThrow();
		});

		it("should validate git_diff with all options", () => {
			expect(() =>
				GIT_DIFF_SCHEMA.parse({
					staged: true,
					file: "test.ts",
					branch: "main",
				}),
			).not.toThrow();
		});

		it("should validate git_log with all options", () => {
			expect(() =>
				GIT_LOG_SCHEMA.parse({
					max_count: 5,
					oneline: false,
					file: "test.ts",
				}),
			).not.toThrow();
		});

		it("should validate git_add with multiple files", () => {
			expect(() =>
				GIT_ADD_SCHEMA.parse({
					files: ["file1.ts", "file2.ts", "src/", "."],
				}),
			).not.toThrow();
		});

		it("should validate git_commit with amend option", () => {
			expect(() =>
				GIT_COMMIT_SCHEMA.parse({
					message: "amend test",
					amend: true,
				}),
			).not.toThrow();
		});

		it("should validate git_branch with all options", () => {
			expect(() =>
				GIT_BRANCH_SCHEMA.parse({
					list: true,
					create: "new-branch",
					delete: "old-branch",
					checkout: "main",
				}),
			).not.toThrow();
		});

		it("should validate git_remote with verbose option", () => {
			expect(() =>
				GIT_REMOTE_SCHEMA.parse({ verbose: true }),
			).not.toThrow();
		});

		it("should validate git_push with all options", () => {
			expect(() =>
				GIT_PUSH_SCHEMA.parse({
					remote: "origin",
					branch: "main",
					set_upstream: true,
				}),
			).not.toThrow();
		});

		it("should validate schemas with undefined optional fields", () => {
			expect(() => GIT_STATUS_SCHEMA.parse({})).not.toThrow();
			expect(() => GIT_DIFF_SCHEMA.parse({})).not.toThrow();
			expect(() => GIT_LOG_SCHEMA.parse({})).not.toThrow();
			expect(() => GIT_ADD_SCHEMA.parse({ files: [] })).not.toThrow();
			expect(() => GIT_COMMIT_SCHEMA.parse({ message: "test" })).not.toThrow();
			expect(() => GIT_BRANCH_SCHEMA.parse({})).not.toThrow();
			expect(() => GIT_REMOTE_SCHEMA.parse({})).not.toThrow();
			expect(() => GIT_PUSH_SCHEMA.parse({})).not.toThrow();
		});

		it("should reject git_commit without message", () => {
			expect(() => GIT_COMMIT_SCHEMA.parse({})).toThrow();
		});

		it("should reject git_add without files", () => {
			expect(() => GIT_ADD_SCHEMA.parse({})).toThrow();
		});

		it("should reject git_log with negative max_count", () => {
			expect(() =>
				GIT_LOG_SCHEMA.parse({ max_count: -1 }),
			).toThrow();
		});

		it("should reject git_log with zero max_count", () => {
			expect(() =>
				GIT_LOG_SCHEMA.parse({ max_count: 0 }),
			).toThrow();
		});

		it("should reject git_log with non-integer max_count", () => {
			expect(() =>
				GIT_LOG_SCHEMA.parse({ max_count: 1.5 }),
			).toThrow();
		});
	});

	describe("special characters in file paths", () => {
		it("should handle git add with file containing spaces", async () => {
			initGitRepo(tempDir);
			writeFileSync(join(tempDir, "file with spaces.txt"), "content");
			const addTool = gitTools.find((t) => t.name === "git_add");
			const result = await addTool?.execute(
				{ files: ["file with spaces.txt"] },
				ctx,
			);

			expect(result?.success).toBe(true);
		});

		it("should handle git add with unicode filename", async () => {
			initGitRepo(tempDir);
			writeFileSync(join(tempDir, "日本語ファイル.txt"), "content");
			const addTool = gitTools.find((t) => t.name === "git_add");
			const result = await addTool?.execute(
				{ files: ["日本語ファイル.txt"] },
				ctx,
			);

			expect(result?.success).toBe(true);
		});

		it("should handle git add with emoji filename", async () => {
			initGitRepo(tempDir);
			writeFileSync(join(tempDir, "🎉.txt"), "content");
			const addTool = gitTools.find((t) => t.name === "git_add");
			const result = await addTool?.execute({ files: ["🎉.txt"] }, ctx);

			expect(result?.success).toBe(true);
		});
	});

	describe("non-git directory edge cases", () => {
		it("should handle nested non-git directory", async () => {
			const nestedDir = join(tempDir, "a", "b", "c");
			mkdirSync(nestedDir, { recursive: true });
			ctx.cwd = nestedDir;
			ctx.workingDir = nestedDir;

			const statusTool = gitTools.find((t) => t.name === "git_status");
			const result = await statusTool?.execute({}, ctx);

			expect(result?.success).toBe(false);
			expect(result?.error).toContain("Not a git repository");
		});

		it("should handle non-existent directory", async () => {
			const nonExistentDir = join(tempDir, "nonexistent");
			mkdirSync(nonExistentDir, { recursive: true });
			const subDir = join(nonExistentDir, "subdir");
			// Don't create subDir
			ctx.cwd = subDir;
			ctx.workingDir = subDir;

			const statusTool = gitTools.find((t) => t.name === "git_status");
			const result = await statusTool?.execute({}, ctx);

			expect(result?.success).toBe(false);
		});
	});

	describe("branch operations edge cases", () => {
		it("should handle creating branch with special characters", async () => {
			initGitRepo(tempDir);
			createCommit(tempDir, "file.txt", "content");

			const branchTool = gitTools.find((t) => t.name === "git_branch");
			const result = await branchTool?.execute(
				{ create: "feature/my-branch" },
				ctx,
			);

			expect(result?.success).toBe(true);
		});

		it("should handle creating branch with unicode name", async () => {
			initGitRepo(tempDir);
			createCommit(tempDir, "file.txt", "content");

			const branchTool = gitTools.find((t) => t.name === "git_branch");
			const result = await branchTool?.execute(
				{ create: "feature/日本語" },
				ctx,
			);

			expect(result?.success).toBe(true);
		});

		it("should handle listing branches in single-branch repo", async () => {
			initGitRepo(tempDir);
			createCommit(tempDir, "file.txt", "content");

			const branchTool = gitTools.find((t) => t.name === "git_branch");
			const result = await branchTool?.execute({ list: true }, ctx);

			expect(result?.success).toBe(true);
		});
	});

	describe("commit message edge cases", () => {
		it("should handle commit with very long message", async () => {
			initGitRepo(tempDir);
			writeFileSync(join(tempDir, "file.txt"), "content");
			execSync("git add file.txt", { cwd: tempDir, stdio: "ignore" });

			const longMessage = "a".repeat(1000);
			const commitTool = gitTools.find((t) => t.name === "git_commit");
			const result = await commitTool?.execute(
				{ message: longMessage },
				ctx,
			);

			expect(result?.success).toBe(true);
		});

		it("should handle commit with multiline message", async () => {
			initGitRepo(tempDir);
			writeFileSync(join(tempDir, "file.txt"), "content");
			execSync("git add file.txt", { cwd: tempDir, stdio: "ignore" });

			const multilineMessage = "Subject\n\nBody paragraph 1\n\nBody paragraph 2";
			const commitTool = gitTools.find((t) => t.name === "git_commit");
			const result = await commitTool?.execute(
				{ message: multilineMessage },
				ctx,
			);

			expect(result?.success).toBe(true);
		});

		it("should handle commit with unicode message", async () => {
			initGitRepo(tempDir);
			writeFileSync(join(tempDir, "file.txt"), "content");
			execSync("git add file.txt", { cwd: tempDir, stdio: "ignore" });

			const unicodeMessage = "日本語コミットメッセージ café";
			const commitTool = gitTools.find((t) => t.name === "git_commit");
			const result = await commitTool?.execute(
				{ message: unicodeMessage },
				ctx,
			);

			expect(result?.success).toBe(true);
		});

		it("should handle commit with emoji message", async () => {
			initGitRepo(tempDir);
			writeFileSync(join(tempDir, "file.txt"), "content");
			execSync("git add file.txt", { cwd: tempDir, stdio: "ignore" });

			const emojiMessage = "🎉 Initial commit 🚀";
			const commitTool = gitTools.find((t) => t.name === "git_commit");
			const result = await commitTool?.execute(
				{ message: emojiMessage },
				ctx,
			);

			expect(result?.success).toBe(true);
		});
	});

	describe("repo_path resolution edge cases", () => {
		it("should handle relative repo_path", async () => {
			initGitRepo(tempDir);
			createCommit(tempDir, "file.txt", "content");

			const statusTool = gitTools.find((t) => t.name === "git_status");
			const result = await statusTool?.execute(
				{ repo_path: "." },
				ctx,
			);

			expect(result?.success).toBe(true);
		});

		it("should handle parent directory repo_path", async () => {
			const subdir = join(tempDir, "subdir");
			mkdirSync(subdir, { recursive: true });
			initGitRepo(tempDir);
			createCommit(tempDir, "file.txt", "content");

			ctx.cwd = subdir;
			ctx.workingDir = subdir;

			const statusTool = gitTools.find((t) => t.name === "git_status");
			const result = await statusTool?.execute(
				{ repo_path: ".." },
				ctx,
			);

			expect(result?.success).toBe(true);
		});
	});
});
