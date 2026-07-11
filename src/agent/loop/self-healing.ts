import { exec, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
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

/**
 * SelfHealingManager creates ephemeral git worktrees to validate tool failures.
 * It runs a configurable validation command (default: npm test) and appends
 * failure output to tool errors.
 *
 * NOTE: This is a VALIDATOR, not an auto-fixer — it detects failures but does
 * not automatically apply corrections.
 */
export class SelfHealingManager {
	private static instances = new Set<SelfHealingManager>();
	private static cleanupHandlersRegistered = false;

	private mainDir: string;
	private activeWorktrees: Map<
		string,
		{ worktreePath: string; branchName: string }
	> = new Map();

	public config?: any;

	constructor(mainDir: string, config?: any) {
		this.mainDir = mainDir;
		this.config = config;
		SelfHealingManager.instances.add(this);
		this.cleanupOrphanedWorktrees();
		SelfHealingManager.registerCleanupHandlers();
	}

	/**
	 * Wraps a tool result to add validation context on failure.
	 * When a tool reports success: false, this creates an ephemeral git worktree,
	 * runs the configured validation command, and appends any failure output
	 * to the tool's error message so the LLM sees what broke.
	 *
	 * NOTE: This validates and reports failures — it does NOT auto-fix or
	 * retry the tool. Corrections must be requested from the LLM separately.
	 */
	async wrapToolFailure<T extends { success: boolean }>(
		toolName: string,
		_args: unknown,
		result: T,
	): Promise<T> {
		if (result.success !== false) return result;
		if (this.config?.selfHealing?.enabled === false) return result;
		if (
			![
				"write",
				"edit",
				"bash",
				"apply_diff",
				"delete_file",
				"delete_dir",
				"move",
				"copy",
			].includes(toolName.toLowerCase())
		)
			return result;

		let worktreeInfo: { worktreePath: string; branchName: string } | undefined;
		try {
			worktreeInfo = await this.createShadowWorkspace();
			const validationCommand = this.config?.selfHealing?.command || "npm test";
			const validation = await this.runValidation(
				validationCommand,
				worktreeInfo.worktreePath,
			);
			if (!validation.success) {
				const parsedAdvisory = this.parseFailureOutput(
					validation.output || validation.error || "",
				);
				return {
					...result,
					error: `${(result as any).error || "Tool failed"}\n\n[Self-Healing Advisory]:\n${parsedAdvisory}`,
				} as T;
			}
		} catch {
			// Ignore self-healing system errors and return original result
		} finally {
			if (worktreeInfo) {
				await this.cleanupShadowWorkspace(
					worktreeInfo.worktreePath,
					worktreeInfo.branchName,
				);
			}
		}
		return result;
	}

	private cleanupOrphanedWorktrees() {
		const isPidAlive = (pid: number): boolean => {
			try {
				process.kill(pid, 0);
				return true;
			} catch {
				return false;
			}
		};

		try {
			// Manually delete orphaned shadow directories in .tehuti/shadows/
			const shadowsDir = path.join(this.mainDir, ".tehuti", "shadows");
			if (fs.existsSync(shadowsDir)) {
				const entries = fs.readdirSync(shadowsDir, { withFileTypes: true });
				for (const entry of entries) {
					if (entry.isDirectory()) {
						const match = entry.name.match(/^tehuti-shadow-(\d+)-(\d+)-(.*)$/);
						let shouldClean = false;
						if (match) {
							const pid = parseInt(match[1], 10);
							if (!isPidAlive(pid)) {
								shouldClean = true;
							}
						} else if (entry.name.startsWith("tehuti-shadow-")) {
							// Legacy format, clean up
							shouldClean = true;
						}

						if (shouldClean) {
							const shadowPath = path.join(shadowsDir, entry.name);
							fs.rmSync(shadowPath, { recursive: true, force: true });
						}
					}
				}
			}

			// Clean up orphaned shadow directories in os.tmpdir()
			try {
				const tmpDir = os.tmpdir();
				const tmpEntries = fs.readdirSync(tmpDir, { withFileTypes: true });
				for (const entry of tmpEntries) {
					if (entry.isDirectory() && entry.name.startsWith("tehuti-shadow-")) {
						const match = entry.name.match(/^tehuti-shadow-(\d+)-(\d+)-(.*)$/);
						let shouldClean = false;
						if (match) {
							const pid = parseInt(match[1], 10);
							if (!isPidAlive(pid)) {
								shouldClean = true;
							}
						} else {
							// Legacy format, clean up
							shouldClean = true;
						}

						if (shouldClean) {
							const shadowPath = path.join(tmpDir, entry.name);
							fs.rmSync(shadowPath, { recursive: true, force: true });
						}
					}
				}
			} catch (e) {}

			// Delete ephemeral branches
			const branchesOut = spawnSync(
				"git",
				["branch", "--list", "tehuti-shadow-*"],
				{
					cwd: this.mainDir,
					encoding: "utf-8",
				},
			).stdout;
			if (branchesOut) {
				const branches = branchesOut
					.split("\n")
					.map((b) => b.trim().replace(/^\*\s*/, ""))
					.filter(Boolean);
				for (const branch of branches) {
					const match = branch.match(/^tehuti-shadow-(\d+)-(\d+)-(.*)$/);
					let shouldClean = false;
					if (match) {
						const pid = parseInt(match[1], 10);
						if (!isPidAlive(pid)) {
							shouldClean = true;
						}
					} else {
						// Legacy format, clean up
						shouldClean = true;
					}

					if (shouldClean) {
						spawnSync("git", ["branch", "-D", branch], {
							cwd: this.mainDir,
							stdio: "ignore",
						});
					}
				}
			}

			// Forcefully run git worktree prune
			spawnSync("git", ["worktree", "prune"], {
				cwd: this.mainDir,
				stdio: "ignore",
			});
		} catch (error) {
			// Ignore errors during cleanup
		}
	}

	private cleanupActiveWorktrees() {
		for (const { worktreePath, branchName } of this.activeWorktrees.values()) {
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
			try {
				fs.rmSync(worktreePath, { recursive: true, force: true });
			} catch (e) {}
		}
		this.activeWorktrees.clear();
	}

	private static cleanupAllActiveWorktrees() {
		for (const manager of SelfHealingManager.instances) {
			manager.cleanupActiveWorktrees();
		}
	}

	private static registerCleanupHandlers() {
		if (SelfHealingManager.cleanupHandlersRegistered) {
			return;
		}
		SelfHealingManager.cleanupHandlersRegistered = true;

		process.on("exit", () => {
			SelfHealingManager.cleanupAllActiveWorktrees();
		});

		// Ensure we gracefully clean up on common termination signals
		process.on("SIGINT", () => {
			SelfHealingManager.cleanupAllActiveWorktrees();
			process.exit(130);
		});

		process.on("SIGTERM", () => {
			SelfHealingManager.cleanupAllActiveWorktrees();
			process.exit(143);
		});

		process.on("SIGHUP", () => {
			SelfHealingManager.cleanupAllActiveWorktrees();
			process.exit(129);
		});

		process.on("uncaughtException", () => {
			SelfHealingManager.cleanupAllActiveWorktrees();
		});

		process.on("unhandledRejection", () => {
			SelfHealingManager.cleanupAllActiveWorktrees();
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
		const shadowsDir = path.join(this.mainDir, ".tehuti", "shadows");
		await fs.promises.mkdir(shadowsDir, { recursive: true }).catch(() => {});

		const epoch = Date.now();
		const uniqueId = randomUUID().slice(0, 8);
		const worktreeName = `tehuti-shadow-${process.pid}-${epoch}-${uniqueId}`;
		const worktreePath = path.join(shadowsDir, worktreeName);
		const branchName = `tehuti-shadow-${process.pid}-${epoch}-${uniqueId}`;

		// Create a new branch and worktree
		try {
			await execAsync(`git branch "${branchName}"`, { cwd: this.mainDir });
			await execAsync(`git worktree add "${worktreePath}" "${branchName}"`, {
				cwd: this.mainDir,
			});
			this.activeWorktrees.set(worktreePath, { worktreePath, branchName });
		} catch (error) {
			try {
				try {
					fs.rmSync(worktreePath, { recursive: true, force: true });
				} catch {}
				await execAsync(`git worktree prune`, { cwd: this.mainDir }).catch(
					() => {},
				);
				await execAsync(`git worktree remove --force "${worktreePath}"`, {
					cwd: this.mainDir,
				});
			} catch {}
			try {
				await execAsync(`git branch -D "${branchName}"`, { cwd: this.mainDir });
			} catch {}
			throw error;
		}

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
			].filter((f) => f && !f.startsWith(".tehuti/"));

			if (deletedFiles.length > 0) {
				for (const file of deletedFiles) {
					const dest = path.join(worktreePath, file);
					await fs.promises
						.rm(dest, { recursive: true, force: true })
						.catch(() => {});
				}
			}

			if (filesToCopy.length > 0) {
				const filesListPath = path.join(
					os.tmpdir(),
					`rsync-files-${process.pid}-${Date.now()}-${randomUUID().slice(0, 8)}.txt`,
				);
				await fs.promises.writeFile(
					filesListPath,
					`${filesToCopy.join("\n")}\n`,
				);
				try {
					// Use rsync to robustly copy modified/untracked files while preserving permissions, symlinks, etc.
					await execAsync(
						`rsync -a --files-from="${filesListPath}" . "${worktreePath}"`,
						{
							cwd: this.mainDir,
						},
					);
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
				error: output,
			};
		}
	}

	async cleanupShadowWorkspace(
		worktreePath: string,
		branchName: string,
	): Promise<void> {
		try {
			await execAsync(`git worktree remove --force "${worktreePath}"`, {
				cwd: this.mainDir,
			}).catch(() => {});
			await execAsync(`git branch -D "${branchName}"`, {
				cwd: this.mainDir,
			}).catch(() => {});
		} finally {
			this.activeWorktrees.delete(worktreePath);
			await fs.promises
				.rm(worktreePath, { recursive: true, force: true })
				.catch(() => {});
		}
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
		let errorLines = lines.filter(
			(line) =>
				line.toLowerCase().includes("error") ||
				line.toLowerCase().includes("fail") ||
				/^\s+at\s/.test(line), // Matches stack trace lines
		);

		if (errorLines.length > 50) {
			errorLines = errorLines.slice(0, 50);
		}

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

	/**
	 * Second half of Speculative Multi-Path Execution:
	 * Spawns N subagents in isolated shadow workspaces, listens to their chunked IPC streams
	 * via SwarmManager events, evaluates their validation results as they finish,
	 * auto-merges the first successful winner into the primary branch, and prunes (kills) the rest.
	 */
	async runMultiPathSpeculation(
		prompt: string,
		pathsCount: number,
		parentContext?: any,
	): Promise<{
		winnerId: string | null;
		results: Record<string, ValidationResult>;
	}> {
		// Lazily import to prevent circular dependencies
		const { swarmManager } = await import("../swarm/manager.js");
		const validationCommand = this.config?.selfHealing?.command || "npm test";

		// 1. Create N shadow workspaces
		const worktrees: { worktreePath: string; branchName: string }[] = [];
		for (let i = 0; i < pathsCount; i++) {
			worktrees.push(await this.createShadowWorkspace());
		}

		const subagentIds: string[] = [];
		const results: Record<string, ValidationResult> = {};
		let winnerId: string | null = null;
		let winnerWorktree: string | null = null;

		return new Promise((resolve) => {
			let completedCount = 0;

			// 2. Listen to chunked IPC streams (via swarm orchestrator update events)
			const onUpdate = async () => {
				if (winnerId) return; // Already found a winner

				for (let i = 0; i < pathsCount; i++) {
					const id = subagentIds[i];
					if (!id) continue;

					const task = swarmManager.getSubagent(id);
					// If the IPC chunk stream has emitted a terminal state for this task and we haven't evaluated it yet
					if (
						task &&
						(task.status === "completed" || task.status === "failed") &&
						!results[id]
					) {
						const worktreeInfo = worktrees[i];

						if (task.status === "completed") {
							// 3. Evaluate test/lint results on this specific path
							const validation = await this.runValidation(
								validationCommand,
								worktreeInfo.worktreePath,
							);
							results[id] = validation;

							if (validation.success && !winnerId) {
								winnerId = id;
								winnerWorktree = worktreeInfo.worktreePath;

								// 4. Auto-merge the winner into the primary branch
								const { stdout: status } = await execAsync(
									`git status --porcelain`,
									{ cwd: winnerWorktree },
								);
								if (status.trim()) {
									await fs.promises.cp(winnerWorktree, this.mainDir, {
										recursive: true,
										force: true,
										filter: (src) => {
											const rel = path.relative(winnerWorktree!, src);
											return !rel.startsWith(".git") && rel !== ".git";
										},
									});
								}

								// 5. Prune failures: kill all remaining slower/failing subagents
								swarmManager.pruneFailures(winnerId!, subagentIds);

								cleanupAndResolve();
								return;
							}
						} else {
							results[id] = {
								success: false,
								output: "",
								error: `Subagent failed with status: ${task.status}`,
							};
						}

						completedCount++;
						if (completedCount === pathsCount && !winnerId) {
							// All paths finished, but no winner passed validation
							cleanupAndResolve();
							return;
						}
					}
				}
			};

			const cleanupAndResolve = async () => {
				swarmManager.off("update", onUpdate);

				// Clean up all shadow workspaces (destroying branches and worktrees)
				for (const wt of worktrees) {
					await this.cleanupShadowWorkspace(wt.worktreePath, wt.branchName);
				}
				resolve({ winnerId, results });
			};

			swarmManager.on("update", onUpdate);

			// Spawn the N subagents to trigger the paths concurrently
			(async () => {
				for (let i = 0; i < pathsCount; i++) {
					const id = await swarmManager.spawnSubagent({
						prompt,
						workingDir: worktrees[i].worktreePath,
						parentContext,
						type: "speculative-path",
						description: `Speculative Path ${i + 1}/${pathsCount}`,
					});
					subagentIds.push(id);
				}
			})().catch((error) => {
				console.error("Failed to spawn subagents:", error);
				cleanupAndResolve();
			});
		});
	}
}
