import { type ChildProcess, execSync, spawn } from "node:child_process";
import path from "node:path";
import fs from "fs-extra";
import { z } from "zod";
import { debug } from "../../utils/debug.js";
import { type ToolContext, type ToolDefinition, type ToolResult } from "./registry.js";

// Environment variables that must never be forwarded to spawned child processes
const SENSITIVE_ENV_VARS = [
	"TEHUTI_API_KEY",
	"OPENROUTER_API_KEY",
	"ANTHROPIC_API_KEY",
	"OPENAI_API_KEY",
	"GITHUB_TOKEN",
	"GH_TOKEN",
];

function getSanitizedEnv(extra?: Record<string, string>): Record<string, string | undefined> {
	const env: Record<string, string | undefined> = { ...process.env };
	for (const key of SENSITIVE_ENV_VARS) {
		delete env[key];
	}
	if (extra) {
		Object.assign(env, extra);
	}
	return env;
}

let isDockerAvailable = false;
try {
	execSync("docker info", { stdio: "ignore" });
	isDockerAvailable = true;
} catch {
	isDockerAvailable = false;
}

function getSpawnArgs(
	command: string,
	cwd: string,
): { cmd: string; args: string[] } {
	const useDocker =
		isDockerAvailable && process.env.DISABLE_DOCKER_SANDBOX !== "true";
	if (useDocker) {
		return {
			cmd: "docker",
			args: [
				"run",
				"--rm",
				"-i",
				"--cap-drop=ALL",
				"--security-opt=no-new-privileges",
				"-v",
				`${cwd}:/workspace`,
				"-w",
				"/workspace",
				"node:20",
				"bash",
				"-c",
				command,
			],
		};
	}
	return {
		cmd: "bash",
		args: ["-c", command],
	};
}

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

function isDangerousCommand(command: string): {
	dangerous: boolean;
	reason?: string;
} {
	// Patterns for dangerous commands — checked against the raw command string
	const patterns: Array<{ regex: RegExp; reason: string }> = [
		// rm -rf on root or home
		{
			regex: /\brm\s+(-rf|-r\s+-f|--recursive\s+--force)\s+\/\s/,
			reason: "Recursive delete on root filesystem (rm -rf /)",
		},
		{
			regex: /\brm\s+(-rf|-r\s+-f|--recursive\s+--force)\s+\/\s*$/,
			reason: "Recursive delete on root filesystem (rm -rf /)",
		},
		{
			regex: /\brm\s+(-rf|-r\s+-f|--recursive\s+--force)\s+\/\*/,
			reason: "Recursive delete on root filesystem (rm -rf /*)",
		},
		{
			regex: /\brm\s+(-rf|-r\s+-f|--recursive\s+--force)\s+~(\s|$)/,
			reason: "Recursive delete on home directory (rm -rf ~)",
		},

		// Pipe-to-shell: curl | bash, wget | sh, etc.
		{
			regex: /\b(curl|wget)\b.*\|\s*(bash|sh|zsh|dash)\b/,
			reason: "Piping network download to shell interpreter",
		},
		{
			regex: /\b(curl|wget)\b.*\|\s*\/bin\/(bash|sh|zsh|dash)\b/,
			reason: "Piping network download to shell interpreter",
		},
		{
			regex: /\b(curl|wget)\b.*\|\s*\/usr\/bin\/env\s+(bash|sh|zsh|dash)\b/,
			reason: "Piping network download to shell interpreter",
		},

		// Destructive SQL
		{ regex: /\bDROP\s+(TABLE|DATABASE)\s+/i, reason: "Destructive SQL statement detected" },
		{ regex: /\bDELETE\s+FROM\s+/i, reason: "Destructive SQL DELETE statement detected" },
		{
			regex: /\b(DROP\s+TABLE|DROP\s+DATABASE|TRUNCATE\s+TABLE|DELETE\s+FROM\s+\w+\s*;)/i,
			reason: "SQL injection pattern detected (destructive SQL statement)",
		},

		// eval
		{ regex: /\beval\s+\S/, reason: "Unrestricted eval execution detected" },

		// Fork bomb
		{ regex: /:\(\s*\)\s*\{/, reason: "Fork bomb detected" },

		// dd raw disk writes
		{ regex: /\bdd\s+if=\/dev\/(zero|random|urandom)\s+of=\/dev\//, reason: "Raw disk write with dd detected" },

		// mkfs, fdisk, parted — partition/format
		{ regex: /\bmkfs\.\w+\s+/, reason: "Filesystem format command detected" },
		{ regex: /\bfdisk\s+/, reason: "Partition table manipulation detected" },
		{ regex: /\bparted\s+/, reason: "Partition manipulation detected" },

		// chmod/chown -R on root
		{
			regex: /\bchmod\s+(-R|--recursive)\s+0\d{2}\s+\//,
			reason: "Recursive permission removal on root filesystem",
		},
		{
			regex: /\bchown\s+(-R|--recursive)\s+.*\s+\//,
			reason: "Recursive ownership change on root filesystem",
		},

		// Shutdown/reboot/poweroff/halt (without --no-wall safeguard)
		{
			regex: /\b(shutdown|reboot|poweroff|halt)\s*$/,
			reason: "System shutdown/reboot command detected",
		},
		{
			regex: /\b(shutdown|reboot|poweroff|halt)\s+/,
			reason: "System shutdown/reboot command detected",
		},

		// iptables firewall changes
		{ regex: /\biptables\s+-[FP]/, reason: "Firewall rule manipulation detected" },

		// crontab manipulation
		{ regex: /\bcrontab\s+(-e|-r)\b/, reason: "Crontab manipulation detected" },

		// xargs rm
		{ regex: /\bxargs\s+rm\b/, reason: "Bulk file deletion via xargs rm detected" },

		// Base64 decode piped to shell (obfuscated execution)
		{
			regex: /\b(base64|base64\.exe)\s+(-d|--decode|decode)\s*\|\s*(bash|sh|zsh|dash)\b/,
			reason: "Obfuscated script execution via base64 decode",
		},

		// git push --force
		{
			regex: /\bgit\s+push\b.*--force\b/,
			reason: "Force push to git repository detected",
		},

		// Command substitution — $(...) and backticks
		// These enable arbitrary code injection and obfuscation
		{ regex: /\$\(/, reason: "Command substitution ($(...)) detected" },
		{ regex: /`[^`]+`/, reason: "Backtick command substitution detected" },

		// Privilege escalation
		{ regex: /\bsudo\b/i, reason: "Privilege escalation via sudo detected" },
		{ regex: /\bsu\s+-/i, reason: "Privilege escalation via su detected" },
		{
			regex: /\bchmod\s+[0-7]*7[0-7]*\s+\//i,
			reason: "Dangerous permissions set on root filesystem (chmod on /)",
		},
		{
			regex: /\bchown\s+.*\//,
			reason: "Ownership change on root filesystem detected",
		},

		// Network scanning/attack tools
		{ regex: /\bnmap\b/i, reason: "Network scanning tool (nmap) detected" },
		{ regex: /\bncat\b/i, reason: "Network utility (ncat) detected" },
		{ regex: /\bsocat\b/i, reason: "Network utility (socat) detected" },

		// Package manager removal of critical services
		{
			regex: /\bapt\s+(remove|purge)\s+.*\b(nginx|apache|mysql|postgresql|docker)\b/i,
			reason: "Removal of critical service via apt detected",
		},
		{
			regex: /\byum\s+(remove|erase)\s+.*\b(nginx|apache|mysql|postgresql|docker)\b/i,
			reason: "Removal of critical service via yum detected",
		},

		// Disk operations
		{ regex: /\bmkswap\b/i, reason: "Swap filesystem creation detected" },
		{ regex: /\bswapon\b/i, reason: "Swap activation detected" },
		{ regex: /\bff\s+if=/i, reason: "Raw disk write with dd alternative (ff) detected" },
	];

	for (const { regex, reason } of patterns) {
		if (regex.test(command)) {
			return { dangerous: true, reason };
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
const MAX_OUTPUT_SIZE = 50 * 1024 * 1024;
const MAX_TOTAL_BACKGROUND_MEMORY = 1000 * 1024 * 1024;
const MAX_BACKGROUND_PROCESSES = 200;
const MAX_BACKGROUND_LIFETIME_MS = 24 * 60 * 60 * 1000;

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

		const { cmd, args } = getSpawnArgs(command, cwd);
		let proc: ChildProcess;
		try {
			proc = spawn(cmd, args, {
				cwd,
				env: getSanitizedEnv(ctx.env),
				detached: true,
				stdio: ["ignore", "pipe", "pipe"],
			});
		} catch (error) {
			resolve({
				success: false,
				output: "",
				error: `Failed to spawn background process: ${error instanceof Error ? error.message : String(error)}`,
			});
			return;
		}

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
				} catch {
					debug.log("tools", `Failed to kill background process ${pid} after max lifetime`);
				}
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
			debug.log("tools", `cleanupProcess: failed to kill PID ${pid} (already exited)`);
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
				debug.log("tools", `cleanupAllProcesses: background PID ${pid} already dead`);
			}
		}
	}
	backgroundProcesses.clear();

	for (const proc of foregroundProcesses) {
		try {
			if (proc.pid) process.kill(-proc.pid, "SIGKILL");
		} catch {
			debug.log("tools", `cleanupAllProcesses: foreground PID ${proc.pid} already dead`);
		}
	}
	foregroundProcesses.clear();
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

if (process.listeners("exit").length === 0) {
	process.on("exit", () => {
		cleanupAllProcesses();
	});
}

const foregroundProcesses = new Set<ChildProcess>();

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

	const cwd = dirValidation.resolvedPath;
	if (!cwd) {
		return {
			success: false,
			output: "",
			error: "Unable to resolve working directory",
		};
	}
	const timeoutMs = Math.max(1000, timeout ?? ctx.timeout ?? 120000);

	debug.log(
		"tools",
		`Executing bash: ${command} (cwd: ${cwd}, background: ${background ?? false})`,
	);

	if (background) {
		return startBackgroundProcess(command, cwd, ctx, description);
	}

	return new Promise((resolve) => {
		const { cmd, args } = getSpawnArgs(command, cwd);
		let proc: ChildProcess;
		try {
			proc = spawn(cmd, args, {
				cwd,
				env: getSanitizedEnv(ctx.env),
				detached: true,
			});
		} catch (error) {
			resolve({
				success: false,
				output: "",
				error: `Failed to spawn process: ${error instanceof Error ? error.message : String(error)}`,
			});
			return;
		}

		foregroundProcesses.add(proc);

		let stdoutLength = 0;
		const stdoutChunks: Buffer[] = [];
		let stderrLength = 0;
		const stderrChunks: Buffer[] = [];
		let resolved = false;
		let timeoutId: NodeJS.Timeout | null = null;

		const onAbort = () => {
			if (resolved) return;
			cleanup();
			resolved = true;
			try {
				if (proc.pid) {
					process.kill(-proc.pid, "SIGKILL");
				}
			} catch {
				debug.log("tools", "Failed to kill foreground process on user abort");
			}
			resolve({
				success: false,
				output: "",
				error: "Command execution aborted by user",
			});
		};

		const cleanup = () => {
			if (timeoutId) {
				clearTimeout(timeoutId);
				timeoutId = null;
			}
			if (ctx.signal) {
				ctx.signal.removeEventListener("abort", onAbort);
			}
		};

		if (ctx.signal) {
			if (ctx.signal.aborted) {
				onAbort();
				return;
			}
			ctx.signal.addEventListener("abort", onAbort);
		}

		proc.stdout?.on("data", (data: Buffer) => {
			if (resolved) return;
			stdoutChunks.push(data);
			stdoutLength += data.length;
			if (stdoutLength + stderrLength > MAX_OUTPUT_SIZE) {
				cleanup();
				resolved = true;
				try {
					if (proc.pid) process.kill(-proc.pid, "SIGKILL");
				} catch {
					debug.log("tools", "Failed to kill process on stdout limit");
				}
				resolve({
					success: false,
					output: "",
					error:
						"Command output exceeded 1MB limit. Narrow the command, pipe through head/tail, or write large output to a file.",
				});
			}
		});

		proc.stderr?.on("data", (data: Buffer) => {
			if (resolved) return;
			stderrChunks.push(data);
			stderrLength += data.length;
			if (stdoutLength + stderrLength > MAX_OUTPUT_SIZE) {
				cleanup();
				resolved = true;
				try {
					if (proc.pid) process.kill(-proc.pid, "SIGKILL");
				} catch {
					debug.log("tools", "Failed to kill process on stderr limit");
				}
				resolve({
					success: false,
					output: "",
					error:
						"Command output exceeded 1MB limit. Narrow the command, pipe through head/tail, or write large output to a file.",
				});
			}
		});

		timeoutId = setTimeout(() => {
			if (resolved) return;
			cleanup();
			resolved = true;
			try {
				if (proc.pid) process.kill(-proc.pid, "SIGKILL");
			} catch {
				debug.log("tools", `Failed to kill foreground process on timeout after ${timeoutMs}ms`);
			}
			resolve({
				success: false,
				output: "",
				error: `Command timed out after ${timeoutMs}ms`,
			});
		}, timeoutMs);

		proc.on("close", (code: number | null) => {
			foregroundProcesses.delete(proc);
			if (resolved) return;
			cleanup();
			resolved = true;
			const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
			const stderr = Buffer.concat(stderrChunks).toString("utf-8");
			let output = stdout;
			if (stderr) {
				output += (output ? "\n" : "") + stderr;
			}
			output = output || "(no output)";

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
	isReadonly: false,
	estimatedDuration: 1000,
	modifiesFs: true,
	requiresNetwork: false,
	costTier: "low",
};

export {
	getProcessOutput as getBackgroundOutput,
	listProcesses as getBackgroundProcesses,
};
