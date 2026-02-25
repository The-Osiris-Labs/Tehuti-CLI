import { spawn } from "node:child_process";
import path from "node:path";
import fs from "fs-extra";
import { z } from "zod";
import type {
	AnyToolExecutor,
	ToolContext,
	ToolDefinition,
	ToolResult,
} from "./registry.js";

export const GIT_STATUS_SCHEMA = z.object({
	repo_path: z
		.string()
		.optional()
		.describe("Path to git repository (default: current directory)"),
	porcelain: z
		.boolean()
		.optional()
		.describe("Machine-readable output (default: false)"),
	short: z.boolean().optional().describe("Short format output (default: true)"),
});

export const GIT_DIFF_SCHEMA = z.object({
	repo_path: z.string().optional().describe("Path to git repository"),
	staged: z
		.boolean()
		.optional()
		.describe("Show staged changes (default: false)"),
	file: z.string().optional().describe("Specific file to diff"),
	branch: z.string().optional().describe("Compare with branch"),
});

export const GIT_LOG_SCHEMA = z.object({
	repo_path: z.string().optional().describe("Path to git repository"),
	max_count: z
		.number()
		.int()
		.positive()
		.optional()
		.describe("Maximum commits to show (default: 10)"),
	oneline: z
		.boolean()
		.optional()
		.describe("One line per commit (default: true)"),
	file: z.string().optional().describe("Show commits for specific file"),
});

export const GIT_ADD_SCHEMA = z.object({
	repo_path: z.string().optional().describe("Path to git repository"),
	files: z.array(z.string()).describe("Files to add (use ['.'] for all)"),
});

export const GIT_COMMIT_SCHEMA = z.object({
	repo_path: z.string().optional().describe("Path to git repository"),
	message: z.string().describe("Commit message"),
	amend: z
		.boolean()
		.optional()
		.describe("Amend previous commit (default: false)"),
});

export const GIT_BRANCH_SCHEMA = z.object({
	repo_path: z.string().optional().describe("Path to git repository"),
	list: z.boolean().optional().describe("List branches (default: true)"),
	create: z.string().optional().describe("Create new branch with this name"),
	delete: z.string().optional().describe("Delete branch with this name"),
	checkout: z.string().optional().describe("Switch to this branch"),
});

export const GIT_REMOTE_SCHEMA = z.object({
	repo_path: z.string().optional().describe("Path to git repository"),
	verbose: z.boolean().optional().describe("Show URLs (default: true)"),
});

export const GIT_PULL_SCHEMA = z.object({
	repo_path: z.string().optional().describe("Path to git repository"),
	remote: z.string().optional().describe("Remote name (default: origin)"),
	branch: z.string().optional().describe("Branch to pull"),
});

export const GIT_PUSH_SCHEMA = z.object({
	repo_path: z.string().optional().describe("Path to git repository"),
	remote: z.string().optional().describe("Remote name (default: origin)"),
	branch: z.string().optional().describe("Branch to push"),
	set_upstream: z
		.boolean()
		.optional()
		.describe("Set upstream (default: false)"),
});

async function runGit(
	args: string[],
	cwd: string,
	timeout: number = 30000,
): Promise<{ stdout: string; stderr: string; code: number }> {
	return new Promise((resolve) => {
		const proc = spawn("git", args, { cwd });
		let stdout = "";
		let stderr = "";
		let resolved = false;
		const timeoutId = setTimeout(() => {
			if (!resolved) {
				resolved = true;
				proc.kill("SIGKILL");
				resolve({ stdout: "", stderr: "Git command timed out", code: 124 });
			}
		}, timeout);

		proc.stdout.on("data", (data) => {
			stdout += data.toString();
		});
		proc.stderr.on("data", (data) => {
			stderr += data.toString();
		});

		proc.on("close", (code) => {
			if (!resolved) {
				clearTimeout(timeoutId);
				resolved = true;
				resolve({ stdout, stderr, code: code ?? 0 });
			}
		});

		proc.on("error", (error) => {
			if (!resolved) {
				clearTimeout(timeoutId);
				resolved = true;
				resolve({ stdout: "", stderr: error.message, code: 1 });
			}
		});
	});
}

async function gitStatus(
	args: z.infer<typeof GIT_STATUS_SCHEMA>,
	ctx: ToolContext,
): Promise<ToolResult> {
	const repoPath = args.repo_path
		? path.resolve(ctx.cwd, args.repo_path)
		: ctx.cwd;

	if (!(await fs.pathExists(path.join(repoPath, ".git")))) {
		return { success: false, output: "", error: "Not a git repository" };
	}

	const gitArgs = ["status"];
	if (args.porcelain) gitArgs.push("--porcelain");
	else if (args.short !== false) gitArgs.push("-s");

	const result = await runGit(gitArgs, repoPath);

	if (result.code !== 0) {
		return {
			success: false,
			output: "",
			error: result.stderr || "Git status failed",
		};
	}

	return {
		success: true,
		output: result.stdout || "Working tree clean",
		metadata: { repoPath },
	};
}

async function gitDiff(
	args: z.infer<typeof GIT_DIFF_SCHEMA>,
	ctx: ToolContext,
): Promise<ToolResult> {
	const repoPath = args.repo_path
		? path.resolve(ctx.cwd, args.repo_path)
		: ctx.cwd;

	if (!(await fs.pathExists(path.join(repoPath, ".git")))) {
		return { success: false, output: "", error: "Not a git repository" };
	}

	const gitArgs = ["diff"];
	if (args.staged) gitArgs.push("--staged");
	if (args.branch) gitArgs.push(args.branch);
	if (args.file) gitArgs.push("--", args.file);

	const result = await runGit(gitArgs, repoPath);

	if (result.code !== 0) {
		return {
			success: false,
			output: "",
			error: result.stderr || "Git diff failed",
		};
	}

	const truncated = result.stdout.length > 50000;
	const output = truncated
		? `${result.stdout.slice(0, 50000)}\n... (truncated)`
		: result.stdout;

	return {
		success: true,
		output: output || "No changes",
		metadata: { repoPath, truncated },
	};
}

async function gitLog(
	args: z.infer<typeof GIT_LOG_SCHEMA>,
	ctx: ToolContext,
): Promise<ToolResult> {
	const repoPath = args.repo_path
		? path.resolve(ctx.cwd, args.repo_path)
		: ctx.cwd;

	if (!(await fs.pathExists(path.join(repoPath, ".git")))) {
		return { success: false, output: "", error: "Not a git repository" };
	}

	const gitArgs = ["log"];
	if (args.oneline !== false) gitArgs.push("--oneline");
	if (args.max_count) gitArgs.push(`-${args.max_count}`);
	else gitArgs.push("-10");
	if (args.file) gitArgs.push("--", args.file);

	const result = await runGit(gitArgs, repoPath);

	if (result.code !== 0) {
		return {
			success: false,
			output: "",
			error: result.stderr || "Git log failed",
		};
	}

	return {
		success: true,
		output: result.stdout || "No commits",
		metadata: { repoPath },
	};
}

async function gitAdd(
	args: z.infer<typeof GIT_ADD_SCHEMA>,
	ctx: ToolContext,
): Promise<ToolResult> {
	const repoPath = args.repo_path
		? path.resolve(ctx.cwd, args.repo_path)
		: ctx.cwd;

	if (!(await fs.pathExists(path.join(repoPath, ".git")))) {
		return { success: false, output: "", error: "Not a git repository" };
	}

	const gitArgs = ["add", ...args.files];
	const result = await runGit(gitArgs, repoPath);

	if (result.code !== 0) {
		return {
			success: false,
			output: "",
			error: result.stderr || "Git add failed",
		};
	}

	return {
		success: true,
		output: `Added: ${args.files.join(", ")}`,
		metadata: { repoPath, files: args.files },
	};
}

async function gitCommit(
	args: z.infer<typeof GIT_COMMIT_SCHEMA>,
	ctx: ToolContext,
): Promise<ToolResult> {
	const repoPath = args.repo_path
		? path.resolve(ctx.cwd, args.repo_path)
		: ctx.cwd;

	if (!(await fs.pathExists(path.join(repoPath, ".git")))) {
		return { success: false, output: "", error: "Not a git repository" };
	}

	const gitArgs = ["commit", "-m", args.message];
	if (args.amend) gitArgs.push("--amend");

	const result = await runGit(gitArgs, repoPath);

	if (result.code !== 0) {
		if (result.stderr.includes("nothing to commit")) {
			return {
				success: true,
				output: "Nothing to commit",
				metadata: { repoPath },
			};
		}
		return {
			success: false,
			output: "",
			error: result.stderr || "Git commit failed",
		};
	}

	return {
		success: true,
		output: result.stdout,
		metadata: { repoPath, message: args.message },
	};
}

async function gitBranch(
	args: z.infer<typeof GIT_BRANCH_SCHEMA>,
	ctx: ToolContext,
): Promise<ToolResult> {
	const repoPath = args.repo_path
		? path.resolve(ctx.cwd, args.repo_path)
		: ctx.cwd;

	if (!(await fs.pathExists(path.join(repoPath, ".git")))) {
		return { success: false, output: "", error: "Not a git repository" };
	}

	if (args.checkout) {
		const result = await runGit(["checkout", args.checkout], repoPath);
		if (result.code !== 0) {
			return {
				success: false,
				output: "",
				error: result.stderr || "Git checkout failed",
			};
		}
		return {
			success: true,
			output: `Switched to branch: ${args.checkout}`,
			metadata: { repoPath },
		};
	}

	if (args.create) {
		const result = await runGit(["checkout", "-b", args.create], repoPath);
		if (result.code !== 0) {
			return {
				success: false,
				output: "",
				error: result.stderr || "Git branch create failed",
			};
		}
		return {
			success: true,
			output: `Created and switched to: ${args.create}`,
			metadata: { repoPath },
		};
	}

	if (args.delete) {
		const result = await runGit(["branch", "-d", args.delete], repoPath);
		if (result.code !== 0) {
			return {
				success: false,
				output: "",
				error: result.stderr || "Git branch delete failed",
			};
		}
		return {
			success: true,
			output: `Deleted branch: ${args.delete}`,
			metadata: { repoPath },
		};
	}

	const result = await runGit(["branch", "-a"], repoPath);

	if (result.code !== 0) {
		return {
			success: false,
			output: "",
			error: result.stderr || "Git branch list failed",
		};
	}

	return {
		success: true,
		output: result.stdout,
		metadata: { repoPath },
	};
}

async function gitRemote(
	args: z.infer<typeof GIT_REMOTE_SCHEMA>,
	ctx: ToolContext,
): Promise<ToolResult> {
	const repoPath = args.repo_path
		? path.resolve(ctx.cwd, args.repo_path)
		: ctx.cwd;

	if (!(await fs.pathExists(path.join(repoPath, ".git")))) {
		return { success: false, output: "", error: "Not a git repository" };
	}

	const gitArgs = ["remote"];
	if (args.verbose !== false) gitArgs.push("-v");

	const result = await runGit(gitArgs, repoPath);

	if (result.code !== 0) {
		return {
			success: false,
			output: "",
			error: result.stderr || "Git remote failed",
		};
	}

	return {
		success: true,
		output: result.stdout || "No remotes configured",
		metadata: { repoPath },
	};
}

async function gitPull(
	args: z.infer<typeof GIT_PULL_SCHEMA>,
	ctx: ToolContext,
): Promise<ToolResult> {
	const repoPath = args.repo_path
		? path.resolve(ctx.cwd, args.repo_path)
		: ctx.cwd;

	if (!(await fs.pathExists(path.join(repoPath, ".git")))) {
		return { success: false, output: "", error: "Not a git repository" };
	}

	const gitArgs = ["pull"];
	if (args.remote) gitArgs.push(args.remote);
	if (args.branch) gitArgs.push(args.branch);

	const result = await runGit(gitArgs, repoPath, 60000);

	if (result.code !== 0) {
		return {
			success: false,
			output: "",
			error: result.stderr || "Git pull failed",
		};
	}

	return {
		success: true,
		output: result.stdout || "Already up to date",
		metadata: { repoPath },
	};
}

async function gitPush(
	args: z.infer<typeof GIT_PUSH_SCHEMA>,
	ctx: ToolContext,
): Promise<ToolResult> {
	const repoPath = args.repo_path
		? path.resolve(ctx.cwd, args.repo_path)
		: ctx.cwd;

	if (!(await fs.pathExists(path.join(repoPath, ".git")))) {
		return { success: false, output: "", error: "Not a git repository" };
	}

	const gitArgs = ["push"];
	if (args.set_upstream) gitArgs.push("-u");
	if (args.remote) gitArgs.push(args.remote);
	if (args.branch) gitArgs.push(args.branch);

	const result = await runGit(gitArgs, repoPath, 60000);

	if (result.code !== 0) {
		return {
			success: false,
			output: "",
			error: result.stderr || "Git push failed",
		};
	}

	return {
		success: true,
		output: result.stdout || "Push successful",
		metadata: { repoPath },
	};
}

export const gitTools: ToolDefinition[] = [
	{
		name: "git_status",
		description:
			"Show the working tree status. Lists modified, staged, and untracked files.",
		parameters: GIT_STATUS_SCHEMA,
		execute: gitStatus as AnyToolExecutor,
		category: "git",
		requiresPermission: false,
	},
	{
		name: "git_diff",
		description: "Show changes between commits, commit and working tree, etc.",
		parameters: GIT_DIFF_SCHEMA,
		execute: gitDiff as AnyToolExecutor,
		category: "git",
		requiresPermission: false,
	},
	{
		name: "git_log",
		description: "Show commit logs. Lists recent commits with their messages.",
		parameters: GIT_LOG_SCHEMA,
		execute: gitLog as AnyToolExecutor,
		category: "git",
		requiresPermission: false,
	},
	{
		name: "git_add",
		description: "Add file contents to the index. Stage files for commit.",
		parameters: GIT_ADD_SCHEMA,
		execute: gitAdd as AnyToolExecutor,
		category: "git",
		requiresPermission: true,
	},
	{
		name: "git_commit",
		description: "Record changes to the repository. Creates a new commit.",
		parameters: GIT_COMMIT_SCHEMA,
		execute: gitCommit as AnyToolExecutor,
		category: "git",
		requiresPermission: true,
	},
	{
		name: "git_branch",
		description: "List, create, or delete branches. Switch between branches.",
		parameters: GIT_BRANCH_SCHEMA,
		execute: gitBranch as AnyToolExecutor,
		category: "git",
		requiresPermission: true,
	},
	{
		name: "git_remote",
		description: "Show remote repositories. Lists configured remotes.",
		parameters: GIT_REMOTE_SCHEMA,
		execute: gitRemote as AnyToolExecutor,
		category: "git",
		requiresPermission: false,
	},
	{
		name: "git_pull",
		description:
			"Fetch from and integrate with another repository or local branch.",
		parameters: GIT_PULL_SCHEMA,
		execute: gitPull as AnyToolExecutor,
		category: "git",
		requiresPermission: true,
	},
	{
		name: "git_push",
		description:
			"Update remote refs along with associated objects. Push commits to remote.",
		parameters: GIT_PUSH_SCHEMA,
		execute: gitPush as AnyToolExecutor,
		category: "git",
		requiresPermission: true,
	},
];
