import { type ChildProcess, spawn } from "node:child_process";
import path from "node:path";
import fs from "fs-extra";
import { z } from "zod";
import { isDangerousCommand } from "./bash.js";
import type {
	AnyToolExecutor,
	ToolContext,
	ToolDefinition,
	ToolResult,
} from "./registry.js";

const MAX_PROCESSES = 50;

const START_BACKGROUND_SCHEMA = z.object({
	command: z.string().describe("The command to run in the background"),
	description: z
		.string()
		.optional()
		.describe("A description of what the command does"),
	workdir: z.string().optional().describe("Working directory for the command"),
	env: z.record(z.string()).optional().describe("Environment variables to set"),
});

const LIST_PROCESSES_SCHEMA = z.object({});

const READ_OUTPUT_SCHEMA = z.object({
	pid: z.number().int().positive().describe("The PID of the process"),
	lines: z
		.number()
		.int()
		.positive()
		.optional()
		.describe("Number of lines to read (default: 100)"),
});

const KILL_PROCESS_SCHEMA = z.object({
	pid: z.number().int().positive().describe("The PID of the process to kill"),
	signal: z
		.enum(["SIGTERM", "SIGKILL", "SIGINT"])
		.optional()
		.describe("Signal to send (default: SIGTERM)"),
});

interface BackgroundProcess {
	pid: number;
	command: string;
	description?: string;
	startTime: Date;
	status: "running" | "exited" | "killed" | "error";
	exitCode?: number;
	output: string[];
	error: string[];
	process?: ChildProcess;
}

const backgroundProcesses = new Map<number, BackgroundProcess>();

function validateWorkdir(
	workdir: string | undefined,
	cwd: string,
): { safe: boolean; reason?: string } {
	if (!workdir) return { safe: true };

	const resolvedWorkdir = path.resolve(cwd, workdir);
	const relativePath = path.relative(cwd, resolvedWorkdir);

	if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
		return {
			safe: false,
			reason: "Working directory must be within the project directory",
		};
	}

	return { safe: true };
}

function cleanupBackgroundProcesses(): void {
	for (const [pid, proc] of backgroundProcesses) {
		if (proc.status === "running" && proc.process) {
			try {
				process.kill(-pid, "SIGKILL");
			} catch {
				// Process might already be dead
			}
		}
	}
	backgroundProcesses.clear();
}

process.on("exit", cleanupBackgroundProcesses);
process.on("SIGINT", () => {
	cleanupBackgroundProcesses();
	process.exit(130);
});
process.on("SIGTERM", () => {
	cleanupBackgroundProcesses();
	process.exit(143);
});

function addOutput(pid: number, type: "stdout" | "stderr", data: string): void {
	const proc = backgroundProcesses.get(pid);
	if (!proc) return;

	const lines = data.split("\n");
	const target = type === "stdout" ? proc.output : proc.error;

	for (const line of lines) {
		if (line.trim()) {
			target.push(line);
			if (target.length > 10000) {
				target.shift();
			}
		}
	}
}

async function startBackground(
	args: z.infer<typeof START_BACKGROUND_SCHEMA>,
	ctx: ToolContext,
): Promise<ToolResult> {
	const { command, description, workdir, env } = args;

	const dangerCheck = isDangerousCommand(command);
	if (dangerCheck.dangerous) {
		return {
			success: false,
			output: "",
			error: `Command rejected: ${dangerCheck.reason}`,
		};
	}

	if (backgroundProcesses.size >= MAX_PROCESSES) {
		return {
			success: false,
			output: "",
			error: `Maximum background process limit reached (${MAX_PROCESSES}). Kill some processes first.`,
		};
	}

	const workdirCheck = validateWorkdir(workdir, ctx.cwd);
	if (!workdirCheck.safe) {
		return {
			success: false,
			output: "",
			error: `Security error: ${workdirCheck.reason}`,
		};
	}

	const cwd = workdir ? path.resolve(ctx.cwd, workdir) : ctx.cwd;

	if (!(await fs.pathExists(cwd))) {
		return {
			success: false,
			output: "",
			error: `Working directory does not exist: ${cwd}`,
		};
	}

	try {
		const proc = spawn("bash", ["-c", command], {
			cwd,
			env: { ...process.env, ...ctx.env, ...env } as Record<string, string>,
			detached: true,
			stdio: ["ignore", "pipe", "pipe"],
		});

		const pid = proc.pid!;
		const bgProc: BackgroundProcess = {
			pid,
			command,
			description,
			startTime: new Date(),
			status: "running",
			output: [],
			error: [],
			process: proc,
		};

		backgroundProcesses.set(pid, bgProc);

		proc.stdout?.on("data", (data: Buffer) => {
			addOutput(pid, "stdout", data.toString());
		});

		proc.stderr?.on("data", (data: Buffer) => {
			addOutput(pid, "stderr", data.toString());
		});

		proc.on("close", (code) => {
			const p = backgroundProcesses.get(pid);
			if (p) {
				p.status = "exited";
				p.exitCode = code ?? 0;
			}
		});

		proc.on("error", (error) => {
			const p = backgroundProcesses.get(pid);
			if (p) {
				p.status = "exited";
				p.error.push(`Process error: ${error.message}`);
			}
		});

		proc.unref();

		return {
			success: true,
			output: `Started background process with PID ${pid}\nCommand: ${command}\nWorking directory: ${cwd}`,
			metadata: { pid, command, cwd },
		};
	} catch (error) {
		return {
			success: false,
			output: "",
			error: `Failed to start background process: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

async function listProcesses(
	_args: z.infer<typeof LIST_PROCESSES_SCHEMA>,
	_ctx: ToolContext,
): Promise<ToolResult> {
	if (backgroundProcesses.size === 0) {
		return {
			success: true,
			output: "No background processes running.",
			metadata: { count: 0 },
		};
	}

	const lines = Array.from(backgroundProcesses.values()).map((proc) => {
		const elapsed = Math.round((Date.now() - proc.startTime.getTime()) / 1000);
		const statusIcon =
			proc.status === "running" ? "🟢" : proc.status === "exited" ? "🔴" : "⚪";
		return `${statusIcon} PID ${proc.pid}: ${proc.command}
   Status: ${proc.status}${proc.exitCode !== undefined ? ` (exit code: ${proc.exitCode})` : ""}
   Running for: ${elapsed}s
   Description: ${proc.description ?? "none"}`;
	});

	return {
		success: true,
		output: `# Background Processes\n\n${lines.join("\n\n")}`,
		metadata: { count: backgroundProcesses.size },
	};
}

async function readOutput(
	args: z.infer<typeof READ_OUTPUT_SCHEMA>,
	_ctx: ToolContext,
): Promise<ToolResult> {
	const { pid, lines = 100 } = args;
	const proc = backgroundProcesses.get(pid);

	if (!proc) {
		return {
			success: false,
			output: "",
			error: `No process found with PID ${pid}`,
		};
	}

	const stdoutLines = proc.output.slice(-lines);
	const stderrLines = proc.error.slice(-lines);

	let output = `# Process ${pid} Output\n\n`;
	output += `Status: ${proc.status}\n`;
	output += `Command: ${proc.command}\n\n`;

	if (stdoutLines.length > 0) {
		output += `## stdout\n\`\`\`\n${stdoutLines.join("\n")}\n\`\`\`\n\n`;
	}

	if (stderrLines.length > 0) {
		output += `## stderr\n\`\`\`\n${stderrLines.join("\n")}\n\`\`\`\n`;
	}

	if (stdoutLines.length === 0 && stderrLines.length === 0) {
		output += "No output available yet.";
	}

	return {
		success: true,
		output,
		metadata: {
			pid,
			status: proc.status,
			stdoutLines: proc.output.length,
			stderrLines: proc.error.length,
		},
	};
}

async function killProcess(
	args: z.infer<typeof KILL_PROCESS_SCHEMA>,
	_ctx: ToolContext,
): Promise<ToolResult> {
	const { pid, signal = "SIGTERM" } = args;
	const proc = backgroundProcesses.get(pid);

	if (!proc) {
		return {
			success: false,
			output: "",
			error: `No process found with PID ${pid}`,
		};
	}

	try {
		process.kill(-pid, signal);
		proc.status = "killed";

		return {
			success: true,
			output: `Sent ${signal} to process ${pid} (${proc.command})`,
			metadata: { pid, signal },
		};
	} catch (error) {
		return {
			success: false,
			output: "",
			error: `Failed to kill process: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

export const backgroundTools: ToolDefinition[] = [
	{
		name: "start_background",
		description:
			"Start a command in the background. Returns a PID that can be used to read output or kill the process.",
		parameters: START_BACKGROUND_SCHEMA,
		execute: startBackground as AnyToolExecutor,
		category: "bash",
		requiresPermission: true,
	},
	{
		name: "list_processes",
		description: "List all background processes started by Tehuti.",
		parameters: LIST_PROCESSES_SCHEMA,
		execute: listProcesses as AnyToolExecutor,
		category: "bash",
		requiresPermission: false,
	},
	{
		name: "read_output",
		description: "Read output from a background process by PID.",
		parameters: READ_OUTPUT_SCHEMA,
		execute: readOutput as AnyToolExecutor,
		category: "bash",
		requiresPermission: false,
	},
	{
		name: "kill_process",
		description: "Kill a background process by PID.",
		parameters: KILL_PROCESS_SCHEMA,
		execute: killProcess as AnyToolExecutor,
		category: "bash",
		requiresPermission: true,
	},
];

export function cleanupAllProcesses(): void {
	for (const [pid, proc] of backgroundProcesses) {
		if (proc.status === "running") {
			try {
				process.kill(-pid, "SIGTERM");
			} catch {}
		}
	}
	backgroundProcesses.clear();
}
