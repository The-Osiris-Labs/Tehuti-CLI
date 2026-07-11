import { SubagentManager } from "./manager.js";
import { execAsync } from "../../utils/exec.js";
import * as fs from "node:fs";
import * as path from "node:path";

export class BackgroundRefactorAgent {
	private manager: SubagentManager;

	constructor(manager: SubagentManager) {
		this.manager = manager;
	}

	/**
	 * Preemptively clones the current context into an ephemeral worktree,
	 * runs linters/tests to identify issues, and queues fixes for review.
	 */
	async computePreemptiveFixes(mainDir: string): Promise<string[]> {
		const worktreePath = path.join(mainDir, `.git/worktrees/refactor-${Date.now()}`);
		const branchName = `refactor-speculation-${Date.now()}`;

		try {
			// Create an isolated worktree branch based on current HEAD
			await execAsync(`git worktree add -b ${branchName} ${worktreePath} HEAD`, {
				cwd: mainDir,
			});

			// Run linters in the worktree
			try {
				await execAsync(`npx @biomejs/biome check src/`, { cwd: worktreePath });
			} catch (lintError: any) {
				// If linting fails, we know there are fixes needed.
				// In a full implementation, we would spawn an agent to fix them here.
				// For now, we return the error output as a suggested fix context.
				return [lintError.stdout || lintError.message];
			}

			// Run tests
			try {
				await execAsync(`npm run test`, { cwd: worktreePath });
			} catch (testError: any) {
				return [testError.stdout || testError.message];
			}

			return []; // No preemptive fixes needed
		} catch (error) {
			console.error("Refactor computation failed:", error);
			return [];
		} finally {
			// Cleanup the ephemeral worktree
			if (fs.existsSync(worktreePath)) {
				await execAsync(`git worktree remove --force ${worktreePath}`, {
					cwd: mainDir,
				}).catch(() => {});
				await execAsync(`git branch -D ${branchName}`, { cwd: mainDir }).catch(() => {});
			}
		}
	}
}
