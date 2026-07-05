import { exec } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type {
	ToolContext,
	ToolDefinition,
	ToolResult,
} from "./tools/registry.js";

const execAsync = promisify(exec);

const SHADOW_SCHEMA = z.object({
	command: z
		.string()
		.describe(
			"The bash command/script to execute speculatively in the shadow workspace. This should include making the changes AND running the tests.",
		),
});

async function executeShadowTest(
	args: unknown,
	ctx: ToolContext,
): Promise<ToolResult> {
	const { command } = args as z.infer<typeof SHADOW_SCHEMA>;
	const mainDir = ctx.cwd;
	const worktreeName = `shadow-${Date.now()}`;
	const worktreePath = path.join(os.tmpdir(), worktreeName);
	const branchName = `speculative-${Date.now()}`;

	try {
		// Create a new branch and worktree
		await execAsync(`git branch ${branchName}`, { cwd: mainDir });
		await execAsync(`git worktree add ${worktreePath} ${branchName}`, {
			cwd: mainDir,
		});

		// Run the command in the worktree
		let success = false;
		let output = "";
		try {
			const { stdout, stderr } = await execAsync(command, {
				cwd: worktreePath,
				maxBuffer: 10 * 1024 * 1024, // 10MB
			});
			output = `${stdout}\n${stderr}`;
			success = true;
		} catch (error: any) {
			output =
				(error.stdout || "") +
				"\n" +
				(error.stderr || "") +
				"\n" +
				error.message;
			success = false;
		}

		if (success) {
			// Apply changes back
			// Check if there are changes to commit
			const { stdout: status } = await execAsync(`git status --porcelain`, {
				cwd: worktreePath,
			});
			if (status.trim()) {
				await execAsync(`git add . && git commit -m "Speculative success"`, {
					cwd: worktreePath,
				});

				// Merge into current branch in main workspace
				await execAsync(`git merge ${branchName}`, { cwd: mainDir });
			}
		}

		// Cleanup
		await execAsync(`git worktree remove --force ${worktreePath}`, {
			cwd: mainDir,
		}).catch(() => {});
		await execAsync(`git branch -D ${branchName}`, { cwd: mainDir }).catch(
			() => {},
		);

		return {
			success,
			output: `Speculative test ${success ? "passed and changes applied" : "failed and discarded"}.\n\nOutput:\n${output.trim()}`,
		};
	} catch (error: any) {
		return {
			success: false,
			output: "",
			error: `Failed to setup shadow workspace: ${error.message}`,
		};
	}
}

export const shadowWorkspaceTool: ToolDefinition = {
	name: "test_speculatively",
	description:
		"Create a temporary git worktree mirror, run commands (including modifying files and testing), and only apply changes back to the main workspace if the command succeeds.",
	parameters: SHADOW_SCHEMA,
	execute: executeShadowTest,
	category: "development",
	requiresPermission: true,
	isReadonly: false,
};
