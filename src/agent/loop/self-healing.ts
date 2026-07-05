import { exec } from "node:child_process";
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

	constructor(mainDir: string) {
		this.mainDir = mainDir;
	}

	/**
	 * Creates an ephemeral shadow workspace using git worktree.
	 * @returns The path to the created worktree and the branch name used.
	 */
	async createShadowWorkspace(): Promise<{ worktreePath: string; branchName: string }> {
		const worktreeName = `shadow-healing-${Date.now()}`;
		const worktreePath = path.join(os.tmpdir(), worktreeName);
		const branchName = `healing-speculative-${Date.now()}`;

		// Create a new branch and worktree
		await execAsync(`git branch ${branchName}`, { cwd: this.mainDir });
		await execAsync(`git worktree add ${worktreePath} ${branchName}`, {
			cwd: this.mainDir,
		});

		return { worktreePath, branchName };
	}

	/**
	 * Applies speculative changes in the shadow workspace.
	 * This could be running a command that edits files or just running a passed script.
	 * @param command The command to execute in the worktree to apply changes.
	 * @param worktreePath The path of the shadow workspace.
	 */
	async applySpeculativeChanges(command: string, worktreePath: string): Promise<void> {
		await execAsync(command, { cwd: worktreePath });
	}

	/**
	 * Runs a validation command (e.g., 'npm run typecheck' or tests) in the shadow workspace.
	 * @param command The validation command.
	 * @param worktreePath The path of the shadow workspace.
	 * @returns The result containing success boolean, stdout/stderr output.
	 */
	async runValidation(command: string, worktreePath: string): Promise<ValidationResult> {
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
	async cleanupShadowWorkspace(worktreePath: string, branchName: string): Promise<void> {
		await execAsync(`git worktree remove --force ${worktreePath}`, {
			cwd: this.mainDir,
		}).catch(() => {});
		await execAsync(`git branch -D ${branchName}`, { cwd: this.mainDir }).catch(() => {});
	}

	/**
	 * Parses the output from a failed validation and formats it for LLM context.
	 * @param output The raw output from the validation command.
	 * @returns A formatted string containing the stack traces or error lines.
	 */
	parseFailureOutput(output: string): string {
		// A simple heuristic: extract lines containing 'error:', 'failed', or stack trace patterns.
		// For a more robust implementation, we could parse specific testing framework outputs.
		const lines = output.split('\n');
		const errorLines = lines.filter(line => 
			line.toLowerCase().includes('error') || 
			line.toLowerCase().includes('failed') || 
			/^\s+at\s/.test(line) // Matches stack trace lines
		);

		if (errorLines.length === 0) {
			return `Validation failed. Full output:\n${output.substring(0, 1000)}`;
		}

		return `Validation failed with the following errors/stack traces:\n\n${errorLines.join('\n')}\n\nPlease analyze these failures and suggest a fix.`;
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
