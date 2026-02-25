import { type ChildProcess, spawn } from "node:child_process";
import path from "node:path";
import fs from "fs-extra";
import { z } from "zod";
import { debug } from "../../utils/debug.js";
import type { ToolContext, ToolDefinition, ToolResult } from "./registry.js";

const BASH_SCHEMA = z.object({
	command: z.string().describe("The bash command to execute"),
	description: z
		.string()
		.optional()
		.describe(
			"Clear, concise description of what this command does (5-10 words)",
		),
	workdir: z
		.string()
		.optional()
		.describe("Working directory for the command (default: current directory)"),
	timeout: z
		.number()
		.int()
		.positive()
		.optional()
		.describe("Timeout in milliseconds (default: 120000)"),
	background: z
		.boolean()
		.optional()
		.describe("Run command in background mode (default: false)"),
});

const DANGEROUS_PATTERNS = [
	/\brm\s+(-[rf]+\s+)*\/\s*$/,
	/\brm\s+(-[rf]+\s+)*~/,
	/\brm\s+(-[rf]+\s+)*\*/,
	/>\s*\/dev\/sd[a-z]+/,
	/\bmkfs\b/,
	/\bdd\s+if=/,
	/:\(\)\{\s*:\|:\s*\}\s*;/,
	/\bcurl\b.*\|\s*(\/\w+\/)*(bash|sh|zsh|dash|ksh)\b/,
	/\bwget\b.*\|\s*(\/\w+\/)*(bash|sh|zsh|dash|ksh)\b/,
	/\bchmod\s+(-R\s+)?777\s+\//,
	/\bchmod\s+(-R\s+)?777\s+~/,
	/\bgit\s+push\s+.*(--force|-f)\b/,
	/\bDROP\s+(TABLE|DATABASE|SCHEMA)\b/i,
	/\bTRUNCATE\s+(TABLE)?\s/i,
	/\bDELETE\s+FROM\b/i,
	/\beval\b/,
	/\bexec\b/,
	/\bsource\s+.*\$/,
	/>\s*\/etc\//,
	/>\s*~\/\.ssh\//,
	/\bbase64\b.*\|\s*(\/\w+\/)*(bash|sh|zsh|dash|ksh)\b/,
	/<<\s*['"]?\w+['"]?\s*$/,
	/\bshutdown\b/,
	/\breboot\b/,
	/\binit\s+[06]/,
	/\biptables\b/,
	/\bufw\b/,
	/\bcrontab\s+-[er]/,
	/\bxargs\s+.*\brm\b/,
	/\bpoweroff\b/,
	/\bsystemctl\s+(stop|disable|mask)\s/,
	/\bservice\s+\w+\s+stop\b/,
	/\bkillall\s+-9\b/,
	/\bpkill\s+-9\b/,
	/\bchown\s+(-R\s+)?\w+:\w+\s+\//,
	/\bsudo\b/,
	/\bdoas\b/,
	/\bpkexec\b/,
	/\|\s*(\/\w+\/)*(bash|sh|zsh|dash|ksh)(\s|$)/,
	/\|\s*(\/[\w/]+\/)*env\s+(bash|sh|zsh)/,
	/\bnc\s+.*-[elp]/,
	/\bsocat\b/,
	/\bat\s+.*[fm]/,
	/>\s*~\/\.bashrc/,
	/>\s*~\/\.zshrc/,
	/>\s*~\/\.profile/,
	/\bnpm\s+config\s+set/,
	/\bpip\s+config\s+set/,
	/\bperl\s+(-e|.*-e)/,
	/\bpython\s+(-c|.*-c)\s+['"]/,
	/\bawk\s+.*system\s*\(/,
	/\bfind\s+.*-exec\s+/,
];

const _SAFE_COMMAND_PREFIXES = [
	"git ",
	"git",
	"npm ",
	"npm",
	"node ",
	"node",
	"npx ",
	"npx",
	"yarn ",
	"yarn",
	"pnpm ",
	"pnpm",
	"ls",
	"cat ",
	"echo ",
	"pwd",
	"which ",
	"head ",
	"tail ",
	"wc ",
	"grep ",
	"find ",
	"mkdir ",
	"touch ",
];

function isDangerousCommand(command: string): {
	dangerous: boolean;
	reason?: string;
} {
	const trimmedCommand = command.trim();

	for (const pattern of DANGEROUS_PATTERNS) {
		if (pattern.test(trimmedCommand)) {
			return {
				dangerous: true,
				reason: `Command matches dangerous pattern: ${pattern.source}`,
			};
		}
	}

	const hasSubshell = /\$\([^)]+\)|`[^`]+`/.test(trimmedCommand);
	if (hasSubshell) {
		return {
			dangerous: true,
			reason: "Command contains subshell execution",
		};
	}

	const hasChaining = /;|\|\||&&|\n|\r/.test(trimmedCommand);
	if (hasChaining) {
		const parts = trimmedCommand.split(/;|\|\||&&|\n|\r/);
		for (const part of parts) {
			const trimmedPart = part.trim();
			if (!trimmedPart) continue;
			for (const pattern of DANGEROUS_PATTERNS) {
				if (pattern.test(trimmedPart)) {
					return {
						dangerous: true,
						reason: `Chained command contains dangerous pattern: ${pattern.source}`,
					};
				}
			}
		}
	}

	return { dangerous: false };
}

export { isDangerousCommand };

async function validateWorkingDir(
	workdir: string | undefined,
	cwd: string,
): Promise<{ valid: boolean; resolvedPath?: string; error?: string }> {
	const resolvedWorkdir = workdir ? path.resolve(cwd, workdir) : cwd;

	try {
		const stats = await fs.lstat(resolvedWorkdir);

		if (stats.isSymbolicLink()) {
			const realPath = await fs.realpath(resolvedWorkdir);
			if (!realPath.startsWith(cwd)) {
				return {
					valid: false,
					error: "Symlink points outside working directory",
				};
			}
		}

		if (!stats.isDirectory()) {
			return { valid: false, error: "Path is not a directory" };
		}

		return { valid: true, resolvedPath: resolvedWorkdir };
	} catch (_error) {
		return {
			valid: false,
			error: `Directory does not exist: ${resolvedWorkdir}`,
		};
	}
}

interface BackgroundProcessInfo {
	pid: number;
	command: string;
	cwd: string;
	description?: string;
	startTime: Date;
	status: "running" | "exited" | "killed" | "error";
	exitCode: number | null;
	outputBuffer: string;
	errorBuffer: string;
	childProcess: ChildProcess | null;
}

const backgroundProcesses = new Map<number, BackgroundProcessInfo>();
const MAX_OUTPUT_SIZE = 10 * 1024 * 1024;
const MAX_TOTAL_BACKGROUND_MEMORY = 100 * 1024 * 1024;
const MAX_BACKGROUND_PROCESSES = 50;
const MAX_BACKGROUND_LIFETIME_MS = 24 * 60 * 60 * 1000;
const _MAX_LINES = 10000;

const _totalBackgroundMemory = 0;

function getBackgroundMemoryUsage(): number {
	let total = 0;
	for (const proc of backgroundProcesses.values()) {
		total += proc.outputBuffer.length + proc.errorBuffer.length;
	}
	return total;
}

function trimBuffer(buffer: string, maxSize: number): string {
	if (buffer.length <= maxSize) return buffer;
	return buffer.slice(-maxSize);
}

function startBackgroundProcess(
	command: string,
	cwd: string,
	ctx: ToolContext,
	description?: string,
): Promise<ToolResult> {
	return new Promise((resolve) => {
		let resolved = false;

		const runningCount = Array.from(backgroundProcesses.values()).filter(
			(p) => p.status === "running",
		).length;
		if (runningCount >= MAX_BACKGROUND_PROCESSES) {
			resolve({
				success: false,
				output: "",
				error: `Maximum background processes (${MAX_BACKGROUND_PROCESSES}) reached. Use pruneExitedProcesses() or killProcess() to free slots.`,
			});
			return;
		}

		const currentMemory = getBackgroundMemoryUsage();
		if (currentMemory > MAX_TOTAL_BACKGROUND_MEMORY) {
			pruneExitedProcesses();
			if (getBackgroundMemoryUsage() > MAX_TOTAL_BACKGROUND_MEMORY) {
				resolve({
					success: false,
					output: "",
					error: `Background process memory limit (${MAX_TOTAL_BACKGROUND_MEMORY / 1024 / 1024}MB) exceeded. Clean up existing processes first.`,
				});
				return;
			}
		}

		const proc: ChildProcess = spawn("bash", ["-c", command], {
			cwd,
			env: { ...process.env, ...ctx.env },
			detached: true,
			stdio: ["ignore", "pipe", "pipe"],
		});

		const pid = proc.pid;

		if (!pid) {
			resolve({
				success: false,
				output: "",
				error: "Failed to spawn process: could not get PID",
			});
			return;
		}

		const processInfo: BackgroundProcessInfo = {
			pid,
			command,
			cwd,
			description,
			startTime: new Date(),
			status: "running",
			exitCode: null,
			outputBuffer: "",
			errorBuffer: "",
			childProcess: proc,
		};

		backgroundProcesses.set(pid, processInfo);

		proc.stdout?.on("data", (data: Buffer) => {
			processInfo.outputBuffer += data.toString();
			processInfo.outputBuffer = trimBuffer(
				processInfo.outputBuffer,
				MAX_OUTPUT_SIZE,
			);
		});

		proc.stderr?.on("data", (data: Buffer) => {
			processInfo.errorBuffer += data.toString();
			processInfo.errorBuffer = trimBuffer(
				processInfo.errorBuffer,
				MAX_OUTPUT_SIZE,
			);
		});

		proc.on("error", (error: Error) => {
			processInfo.status = "error";
			processInfo.errorBuffer += `\nProcess error: ${error.message}`;
			debug.log("tools", `Background process ${pid} error: ${error.message}`);
		});

		proc.on("close", (code: number | null) => {
			processInfo.status = "exited";
			processInfo.exitCode = code;
			processInfo.childProcess = null;
			debug.log("tools", `Background process ${pid} exited with code ${code}`);
		});

		proc.unref();

		const lifetimeTimeout = setTimeout(() => {
			if (backgroundProcesses.has(pid)) {
				try {
					process.kill(-pid, "SIGKILL");
				} catch {}
				processInfo.status = "killed";
				processInfo.errorBuffer +=
					"\nProcess killed: exceeded maximum lifetime (24 hours)";
				backgroundProcesses.delete(pid);
			}
		}, MAX_BACKGROUND_LIFETIME_MS);
		lifetimeTimeout.unref();

		setTimeout(() => {
			if (!resolved) {
				resolved = true;
				resolve({
					success: true,
					output: `Started background process with PID ${pid}\nCommand: ${command}\nWorking directory: ${cwd}\n\nUse getProcessOutput(${pid}) to check output, listProcesses() to see all processes, or killProcess(${pid}) to terminate.`,
					metadata: {
						pid,
						command,
						cwd,
						description,
						background: true,
						status: "running",
					},
				});
			}
		}, 100);
	});
}

export function getProcessOutput(
	pid: number,
	options: { lines?: number; tail?: boolean } = {},
): {
	success: boolean;
	output?: string;
	errors?: string;
	status?: string;
	exitCode?: number | null;
	error?: string;
} {
	const proc = backgroundProcesses.get(pid);
	if (!proc) {
		return {
			success: false,
			error: `No background process found with PID ${pid}`,
		};
	}

	const lines = options.lines ?? 100;
	const tail = options.tail ?? true;

	let output = proc.outputBuffer;
	let errors = proc.errorBuffer;

	if (tail) {
		const outputLines = output.split("\n").filter((l) => l.trim());
		const errorLines = errors.split("\n").filter((l) => l.trim());
		output = outputLines.slice(-lines).join("\n");
		errors = errorLines.slice(-lines).join("\n");
	}

	return {
		success: true,
		output,
		errors,
		status: proc.status,
		exitCode: proc.exitCode,
	};
}

export function listProcesses(): Array<{
	pid: number;
	command: string;
	cwd: string;
	description?: string;
	status: string;
	exitCode: number | null;
	startTime: Date;
	outputSize: number;
	errorSize: number;
}> {
	return Array.from(backgroundProcesses.values()).map((p) => ({
		pid: p.pid,
		command: p.command,
		cwd: p.cwd,
		description: p.description,
		status: p.status,
		exitCode: p.exitCode,
		startTime: p.startTime,
		outputSize: p.outputBuffer.length,
		errorSize: p.errorBuffer.length,
	}));
}

export function killProcess(
	pid: number,
	signal: "SIGTERM" | "SIGKILL" = "SIGTERM",
): { success: boolean; error?: string } {
	const proc = backgroundProcesses.get(pid);
	if (!proc) {
		return {
			success: false,
			error: `No background process found with PID ${pid}`,
		};
	}

	if (proc.status !== "running") {
		return {
			success: false,
			error: `Process ${pid} is not running (status: ${proc.status})`,
		};
	}

	try {
		process.kill(-pid, signal);
		proc.status = "killed";
		proc.childProcess = null;
		debug.log("tools", `Killed background process ${pid} with ${signal}`);
		return { success: true };
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		if (
			errorMessage.includes("ESRCH") ||
			errorMessage.includes("no such process")
		) {
			proc.status = "exited";
			proc.childProcess = null;
			return { success: false, error: `Process ${pid} already exited` };
		}
		return {
			success: false,
			error: `Failed to kill process ${pid}: ${errorMessage}`,
		};
	}
}

export function cleanupProcess(pid: number): boolean {
	const proc = backgroundProcesses.get(pid);
	if (!proc) return false;

	if (proc.status === "running" && proc.childProcess) {
		try {
			process.kill(-pid, "SIGKILL");
		} catch {
			// Process might already be dead
		}
	}

	backgroundProcesses.delete(pid);
	return true;
}

export function cleanupAllProcesses(): void {
	for (const [pid, proc] of backgroundProcesses) {
		if (proc.status === "running") {
			try {
				process.kill(-pid, "SIGKILL");
			} catch {
				// Process might already be dead
			}
		}
	}
	backgroundProcesses.clear();
}

export function pruneExitedProcesses(): number {
	let pruned = 0;
	for (const [pid, proc] of backgroundProcesses) {
		if (proc.status !== "running") {
			backgroundProcesses.delete(pid);
			pruned++;
		}
	}
	return pruned;
}

process.on("exit", () => {
	cleanupAllProcesses();
});

async function executeBash(
	args: unknown,
	ctx: ToolContext,
): Promise<ToolResult> {
	const { command, description, workdir, timeout, background } =
		args as z.infer<typeof BASH_SCHEMA>;

	const dangerCheck = isDangerousCommand(command);
	if (dangerCheck.dangerous) {
		return {
			success: false,
			output: "",
			error: `Dangerous command blocked: ${dangerCheck.reason}`,
		};
	}

	const dirValidation = await validateWorkingDir(workdir, ctx.cwd);
	if (!dirValidation.valid) {
		return {
			success: false,
			output: "",
			error: `Invalid working directory: ${dirValidation.error}`,
		};
	}

	const cwd = dirValidation.resolvedPath!;
	const timeoutMs = Math.max(1000, timeout ?? ctx.timeout ?? 120000);

	debug.log(
		"tools",
		`Executing bash: ${command} (cwd: ${cwd}, background: ${background ?? false})`,
	);

	if (background) {
		return startBackgroundProcess(command, cwd, ctx, description);
	}

	return new Promise((resolve) => {
		const proc: ChildProcess = spawn("bash", ["-c", command], {
			cwd,
			env: { ...process.env, ...ctx.env },
			detached: true,
		});

		let stdout = "";
		let stderr = "";
		let resolved = false;
		let timeoutId: NodeJS.Timeout | null = null;

		const cleanup = () => {
			if (timeoutId) {
				clearTimeout(timeoutId);
				timeoutId = null;
			}
		};

		proc.stdout?.on("data", (data: Buffer) => {
			if (resolved) return;
			stdout += data.toString();
			if (stdout.length > MAX_OUTPUT_SIZE) {
				cleanup();
				resolved = true;
				try {
					process.kill(-proc.pid!);
				} catch {}
				resolve({
					success: false,
					output: "",
					error: "Output exceeded 10MB limit",
				});
			}
		});

		proc.stderr?.on("data", (data: Buffer) => {
			if (resolved) return;
			stderr += data.toString();
		});

		timeoutId = setTimeout(() => {
			if (resolved) return;
			cleanup();
			resolved = true;
			try {
				process.kill(-proc.pid!);
			} catch {}
			resolve({
				success: false,
				output: "",
				error: `Command timed out after ${timeoutMs}ms`,
			});
		}, timeoutMs);

		proc.on("close", (code: number | null) => {
			if (resolved) return;
			cleanup();
			resolved = true;
			const output = stdout || stderr || "(no output)";

			resolve({
				success: code === 0,
				output: output.trim(),
				error: code !== 0 ? stderr.trim() : undefined,
				metadata: {
					command,
					description,
					cwd,
					exitCode: code ?? 0,
				},
			});
		});

		proc.on("error", (error: Error) => {
			if (resolved) return;
			cleanup();
			resolved = true;
			resolve({
				success: false,
				output: "",
				error: `Command execution failed: ${error.message}`,
			});
		});
	});
}

export const bashTool: ToolDefinition = {
	name: "bash",
	description: `Executes a given bash command in a persistent shell session with optional timeout, ensuring proper handling and security measures.

All commands run in /Users/youssefsala7 by default. Use the workdir parameter if you need to run a command in a different directory. AVOID using 'cd <directory> && <command>' patterns - use workdir instead.

IMPORTANT: This tool is for terminal operations like git, npm, docker, etc. DO NOT use it for file operations (reading, writing, editing, searching, finding files) - use the specialized tools for this instead.

Before executing the command, please follow these steps:

1. Directory Verification:
   - If the command will create new directories or files, first use ls to verify the parent directory exists and is the correct location
   - For example, before running "mkdir foo/bar", first use ls foo to check that "foo" exists and is the intended parent directory

2. Command Execution:
   - Always quote file paths that contain spaces with double quotes (e.g., rm "path with spaces/file.txt")
   - Examples of proper quoting:
     - mkdir "/Users/name/My Documents" (correct)
     - mkdir /Users/name/My Documents (incorrect - will fail)
     - python "/path/with spaces/script.py" (correct)
     - python /path/with spaces/script.py (incorrect - will fail)
   - After ensuring proper quoting, execute the command.
   - Capture the output of the command.

Background mode:
- Set background: true to run commands in the background
- Returns a PID that can be used to monitor the process
- Use getProcessOutput(pid) to check background process output
- Use listProcesses() to see all running background processes
- Use killProcess(pid) to terminate a background process
- Use cleanupProcess(pid) to remove a process from tracking
- Use pruneExitedProcesses() to clean up finished processes

Security:
- Dangerous commands (rm -rf /, DROP TABLE, etc.) are blocked
- Commands are executed in process groups for proper timeout handling
- Working directories are validated and symlink-safe`,
	parameters: BASH_SCHEMA,
	execute: executeBash,
	category: "bash",
	requiresPermission: true,
};

export {
	getProcessOutput as getBackgroundOutput,
	listProcesses as getBackgroundProcesses,
};
