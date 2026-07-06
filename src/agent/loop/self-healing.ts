import { exec, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export interface ValidationResult {
	success: boolean;
	output: string;
	error?: string;
}

export class SelfHealingManager {
	private mainDir: string;
	private activeWorktrees: Map<
		string,
		{ worktreePath: string; branchName: string }
	> = new Map();

	constructor(mainDir: string) {
		this.mainDir = mainDir;
		this.registerCleanupHandlers();
	}

	private registerCleanupHandlers() {
		const cleanup = () => {
			for (const {
				worktreePath,
				branchName,
			} of this.activeWorktrees.values()) {
				try {
					spawnSync("git", ["worktree", "remove", "--force", worktreePath], {
						cwd: this.mainDir,
						stdio: "ignore",
					});
					spawnSync("git", ["branch", "-D", branchName], {
						cwd: this.mainDir,
						stdio: "ignore",
					});
				} catch (e) {}
			}
			this.activeWorktrees.clear();
		};

		process.on("exit", cleanup);
		
		// Ensure we gracefully clean up on common termination signals
		process.on("SIGINT", () => {
			cleanup();
			process.exit(130);
		});
		
		process.on("SIGTERM", () => {
			cleanup();
			process.exit(143);
		});
	}

	/**
	 * Creates an ephemeral shadow workspace using git worktree.
	 * @returns The path to the created worktree and the branch name used.
	 */
	async createShadowWorkspace(): Promise<{
		worktreePath: string;
		branchName: string;
	}> {
		const worktreeName = `shadow-healing-${Date.now()}`;
		const worktreePath = path.join(os.tmpdir(), worktreeName);
		const branchName = `healing-speculative-${Date.now()}`;

		// Create a new branch and worktree
		await execAsync(`git branch ${branchName}`, { cwd: this.mainDir });
		await execAsync(`git worktree add ${worktreePath} ${branchName}`, {
			cwd: this.mainDir,
		});

		this.activeWorktrees.set(worktreePath, { worktreePath, branchName });

		// Sync uncommitted changes to the shadow workspace
		try {
			const { stdout: deletedFilesOut } = await execAsync(
				"git diff --name-only --diff-filter=D HEAD",
				{ cwd: this.mainDir },
			);
			const { stdout: modifiedFilesOut } = await execAsync(
				"git diff --name-only --diff-filter=d HEAD",
				{ cwd: this.mainDir },
			);
			const { stdout: untrackedFilesOut } = await execAsync(
				"git ls-files --others --exclude-standard",
				{ cwd: this.mainDir },
			);

			const deletedFiles = deletedFilesOut.split("\n").filter(Boolean);
			const filesToCopy = [
				...modifiedFilesOut.split("\n"),
				...untrackedFilesOut.split("\n"),
			].filter(Boolean);

			if (deletedFiles.length > 0) {
				for (const file of deletedFiles) {
					const dest = path.join(worktreePath, file);
					await fs.promises
						.rm(dest, { recursive: true, force: true })
						.catch(() => {});
				}
			}

			if (filesToCopy.length > 0) {
				const filesListPath = path.join(os.tmpdir(), `rsync-files-${Date.now()}.txt`);
				await fs.promises.writeFile(filesListPath, filesToCopy.join("\n") + "\n");
				try {
					// Use rsync to robustly copy modified/untracked files while preserving permissions, symlinks, etc.
					await execAsync(`rsync -a --files-from="${filesListPath}" . "${worktreePath}"`, {
						cwd: this.mainDir,
					});
				} catch (rsyncErr) {
					// Fallback to manual copy if rsync fails
					for (const file of filesToCopy) {
						const src = path.join(this.mainDir, file);
						const dest = path.join(worktreePath, file);
						await fs.promises
							.mkdir(path.dirname(dest), { recursive: true })
							.catch(() => {});
						try {
							const stat = await fs.promises.lstat(src);
							await fs.promises
								.rm(dest, { recursive: true, force: true })
								.catch(() => {});
							if (stat.isSymbolicLink()) {
								const target = await fs.promises.readlink(src);
								await fs.promises.symlink(target, dest);
							} else {
								await fs.promises.cp(src, dest, { preserveTimestamps: true });
							}
						} catch (err) {}
					}
				} finally {
					await fs.promises.rm(filesListPath, { force: true }).catch(() => {});
				}
			}
		} catch (error) {
			// Ignore if not a git repo or if syncing fails
		}

		return { worktreePath, branchName };
	}

	/**
	 * Applies speculative changes in the shadow workspace.
	 * This could be running a command that edits files or just running a passed script.
	 * @param command The command to execute in the worktree to apply changes.
	 * @param worktreePath The path of the shadow workspace.
	 */
	async applySpeculativeChanges(
		command: string,
		worktreePath: string,
	): Promise<void> {
		await execAsync(command, { cwd: worktreePath });
	}

	/**
	 * Runs a validation command (e.g., 'npm run typecheck' or tests) in the shadow workspace.
	 * @param command The validation command.
	 * @param worktreePath The path of the shadow workspace.
	 * @returns The result containing success boolean, stdout/stderr output.
	 */
	async runValidation(
		command: string,
		worktreePath: string,
	): Promise<ValidationResult> {
		try {
			const { stdout, stderr } = await execAsync(command, {
				cwd: worktreePath,
				maxBuffer: 10 * 1024 * 1024,
			});
			return {
				success: true,
				output: `${stdout}\n${stderr}`,
			};
		} catch (error: any) {
			const output = `${error.stdout || ""}\n${error.stderr || ""}\n${error.message || ""}`;
			return {
				success: false,
				output,
				error: error.message,
			};
		}
	}

	/**
	 * Cleans up the ephemeral shadow workspace.
	 * @param worktreePath The path of the shadow workspace.
	 * @param branchName The branch name to be deleted.
	 */
	async cleanupShadowWorkspace(
		worktreePath: string,
		branchName: string,
	): Promise<void> {
		this.activeWorktrees.delete(worktreePath);
		await execAsync(`git worktree remove --force ${worktreePath}`, {
			cwd: this.mainDir,
		}).catch(() => {});
		await execAsync(`git branch -D ${branchName}`, { cwd: this.mainDir }).catch(
			() => {},
		);
	}

	/**
	 * Parses the output from a failed validation and formats it for LLM context.
	 * @param output The raw output from the validation command.
	 * @returns A formatted string containing the stack traces or error lines.
	 */
	parseFailureOutput(output: string): string {
		// A simple heuristic: extract lines containing 'error:', 'failed', or stack trace patterns.
		// For a more robust implementation, we could parse specific testing framework outputs.
		const lines = output.split("\n");
		const errorLines = lines.filter(
			(line) =>
				line.toLowerCase().includes("error") ||
				line.toLowerCase().includes("failed") ||
				/^\s+at\s/.test(line), // Matches stack trace lines
		);

		if (errorLines.length === 0) {
			return `Validation failed. Full output:\n${output.substring(0, 1000)}`;
		}

		return `Validation failed with the following errors/stack traces:\n\n${errorLines.join("\n")}\n\nPlease analyze these failures and suggest a fix.`;
	}

	/**
	 * Formats the failure trace for injecting back into LLM context as a system prompt addition.
	 * @param result The ValidationResult object.
	 */
	injectFailureContext(result: ValidationResult): string {
		if (result.success) {
			return "Validation successful. No failures to inject.";
		}

		const parsed = this.parseFailureOutput(result.output);
		return `<validation_failure>\n${parsed}\n</validation_failure>`;
	}
}
