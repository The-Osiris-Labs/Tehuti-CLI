import { spawn } from "node:child_process";
import { z } from "zod";
import type {
	AnyToolExecutor,
	ToolContext,
	ToolDefinition,
	ToolResult,
} from "./registry.js";

const DAP_LAUNCH_SCHEMA = z.object({
	program: z
		.string()
		.describe("Path to the program or script to debug"),
	args: z
		.array(z.string())
		.optional()
		.describe("Command-line arguments for the program"),
	cwd: z
		.string()
		.optional()
		.describe("Working directory for the debug session"),
});

const DAP_SET_BREAKPOINT_SCHEMA = z.object({
	file: z.string().describe("Source file path"),
	line: z
		.number()
		.int()
		.positive()
		.describe("Line number for the breakpoint"),
	condition: z
		.string()
		.optional()
		.describe("Optional breakpoint condition expression"),
});

const DAP_CONTINUE_SCHEMA = z.object({
	threadId: z
		.number()
		.int()
		.optional()
		.describe("Thread ID to continue (defaults to all threads)"),
});

const DAP_STEP_SCHEMA = z.object({
	threadId: z
		.number()
		.int()
		.describe("Thread ID to step in"),
});

const DAP_STACK_TRACE_SCHEMA = z.object({
	threadId: z
		.number()
		.int()
		.describe("Thread ID to inspect"),
	levels: z
		.number()
		.int()
		.positive()
		.optional()
		.default(20)
		.describe("Number of stack frames to retrieve"),
});

const DAP_EVALUATE_SCHEMA = z.object({
	expression: z.string().describe("Expression to evaluate"),
	frameId: z
		.number()
		.int()
		.optional()
		.describe("Stack frame ID for context"),
});

interface DebuggerInfo {
	name: string;
	command: string;
	available: boolean;
	version?: string;
	language: string;
	setupHint: string;
}

async function checkDebuggers(): Promise<DebuggerInfo[]> {
	const candidates: Array<{
		name: string;
		command: string;
		args: string[];
		language: string;
		setupHint: string;
	}> = [
		{
			name: "debugpy",
			command: "python3",
			args: ["-m", "debugpy", "--help"],
			language: "Python",
			setupHint: "pip install debugpy",
		},
		{
			name: "LLDB",
			command: "lldb",
			args: ["--version"],
			language: "C/C++/Swift/ObjC",
			setupHint:
				"xcode-select --install (macOS) or apt install lldb (Linux)",
		},
		{
			name: "Delve",
			command: "dlv",
			args: ["version"],
			language: "Go",
			setupHint:
				"go install github.com/go-delve/delve/cmd/dlv@latest",
		},
		{
			name: "GDB",
			command: "gdb",
			args: ["--version"],
			language: "C/C++",
			setupHint:
				"brew install gdb (macOS) or apt install gdb (Linux)",
		},
	];

	const results = await Promise.all(
		candidates.map(async (c) => {
			try {
				const out = await new Promise<string>((resolve, reject) => {
					const proc = spawn(c.command, c.args, {
						timeout: 5000,
						stdio: ["ignore", "pipe", "pipe"],
					});
					let stdout = "";
					let stderr = "";
					proc.stdout.on("data", (d) => {
						stdout += d.toString();
					});
					proc.stderr.on("data", (d) => {
						stderr += d.toString();
					});
					proc.on("close", (code) => {
						if (code === 0) resolve(stdout.trim() || stderr.trim());
						else reject(new Error(`exit ${code}`));
					});
					proc.on("error", reject);
				});
				const version = out.split("\n")[0];
				return {
					name: c.name,
					command: c.command,
					available: true,
					version,
					language: c.language,
					setupHint: c.setupHint,
				};
			} catch {
				return {
					name: c.name,
					command: c.command,
					available: false,
					language: c.language,
					setupHint: c.setupHint,
				};
			}
		}),
	);

	return results;
}

const CONFIG_EXAMPLE: Record<string, unknown> = {
	dap: {
		python: {
			type: "python",
			adapter: "debugpy",
			program: "${file}",
			args: [],
		},
		go: {
			type: "go",
			adapter: "dlv",
			program: ".",
		},
		cpp: {
			type: "cpp",
			adapter: "lldb",
			program: "${workspaceFolder}/build/program",
		},
	},
};

function buildDiagnostic(
	tool: string,
	debuggers: DebuggerInfo[],
	extra: Record<string, unknown> = {},
): ToolResult {
	const available = debuggers.filter((d) => d.available);
	const unavailable = debuggers.filter((d) => !d.available);

	const meta: Record<string, unknown> = { tool };
	for (const d of debuggers) {
		meta[d.name] = d.available;
	}
	Object.assign(meta, extra);

	return {
		success: true,
		output: JSON.stringify(
			{
				status: available.length > 0 ? "debugger_available" : "no_debugger_found",
				message:
					available.length > 0
						? `${available.length} debugger(s) available. Configure one in .tehuti.json (dap section).`
						: "No supported debugger found. Install one and configure it in .tehuti.json.",
				availableDebuggers: available.map((d) => ({
					name: d.name,
					language: d.language,
					version: d.version,
				})),
				unavailableDebuggers: unavailable.map((d) => ({
					name: d.name,
					language: d.language,
					setup: d.setupHint,
				})),
				configExample: CONFIG_EXAMPLE,
				...extra,
			},
			null,
			2,
		),
		metadata: meta,
	};
}

async function dapLaunch(
	args: z.infer<typeof DAP_LAUNCH_SCHEMA>,
	_ctx: ToolContext,
): Promise<ToolResult> {
	const debuggers = await checkDebuggers();
	return buildDiagnostic("dap_launch", debuggers, {
		requestedProgram: args.program,
		requestedArgs: args.args,
		requestedCwd: args.cwd,
	});
}

async function dapSetBreakpoint(
	args: z.infer<typeof DAP_SET_BREAKPOINT_SCHEMA>,
	_ctx: ToolContext,
): Promise<ToolResult> {
	const debuggers = await checkDebuggers();
	return buildDiagnostic("dap_set_breakpoint", debuggers, {
		requestedFile: args.file,
		requestedLine: args.line,
		requestedCondition: args.condition,
		setupNote:
			"Set breakpoints after launching a debug session. Configure dap in .tehuti.json first.",
	});
}

async function dapContinue(
	_args: z.infer<typeof DAP_CONTINUE_SCHEMA>,
	_ctx: ToolContext,
): Promise<ToolResult> {
	const debuggers = await checkDebuggers();
	return buildDiagnostic("dap_continue", debuggers, {
		setupNote:
			"Debugger must be running before executing this command. Start a debug session via .tehuti.json dap configuration.",
	});
}

async function dapStepOver(
	_args: z.infer<typeof DAP_STEP_SCHEMA>,
	_ctx: ToolContext,
): Promise<ToolResult> {
	const debuggers = await checkDebuggers();
	return buildDiagnostic("dap_step_over", debuggers, {
		setupNote:
			"Debugger must be running and paused at a breakpoint. Configure dap in .tehuti.json to start debugging.",
	});
}

async function dapStepIn(
	_args: z.infer<typeof DAP_STEP_SCHEMA>,
	_ctx: ToolContext,
): Promise<ToolResult> {
	const debuggers = await checkDebuggers();
	return buildDiagnostic("dap_step_in", debuggers, {
		setupNote:
			"Debugger must be running and paused at a breakpoint. Configure dap in .tehuti.json to start debugging.",
	});
}

async function dapStepOut(
	_args: z.infer<typeof DAP_STEP_SCHEMA>,
	_ctx: ToolContext,
): Promise<ToolResult> {
	const debuggers = await checkDebuggers();
	return buildDiagnostic("dap_step_out", debuggers, {
		setupNote:
			"Debugger must be running and paused at a breakpoint. Configure dap in .tehuti.json to start debugging.",
	});
}

async function dapStackTrace(
	_args: z.infer<typeof DAP_STACK_TRACE_SCHEMA>,
	_ctx: ToolContext,
): Promise<ToolResult> {
	const debuggers = await checkDebuggers();
	return buildDiagnostic("dap_stack_trace", debuggers, {
		setupNote:
			"Debugger must be running and paused. Configure dap in .tehuti.json to start a debugging session.",
	});
}

async function dapEvaluate(
	_args: z.infer<typeof DAP_EVALUATE_SCHEMA>,
	_ctx: ToolContext,
): Promise<ToolResult> {
	const debuggers = await checkDebuggers();
	return buildDiagnostic("dap_evaluate", debuggers, {
		setupNote:
			"Debugger must be running and paused. Evaluate expressions after starting a debug session via .tehuti.json dap configuration.",
	});
}

export const dapTools: ToolDefinition[] = [
	{
		name: "dap_launch",
		description:
			"Check debugger availability and show setup instructions for DAP debugging",
		parameters: DAP_LAUNCH_SCHEMA,
		execute: dapLaunch as AnyToolExecutor,
		category: "development",
		requiresPermission: true,
	},
	{
		name: "dap_set_breakpoint",
		description:
			"Check debugger availability for setting breakpoints. Configure dap in .tehuti.json first.",
		parameters: DAP_SET_BREAKPOINT_SCHEMA,
		execute: dapSetBreakpoint as AnyToolExecutor,
		category: "development",
		requiresPermission: true,
	},
	{
		name: "dap_continue",
		description:
			"Check debugger availability for continue (resume execution). Debugger must be running.",
		parameters: DAP_CONTINUE_SCHEMA,
		execute: dapContinue as AnyToolExecutor,
		category: "development",
		requiresPermission: true,
	},
	{
		name: "dap_step_over",
		description:
			"Check debugger availability for step-over. Debugger must be running and paused.",
		parameters: DAP_STEP_SCHEMA,
		execute: dapStepOver as AnyToolExecutor,
		category: "development",
		requiresPermission: true,
	},
	{
		name: "dap_step_in",
		description:
			"Check debugger availability for step-in. Debugger must be running and paused.",
		parameters: DAP_STEP_SCHEMA,
		execute: dapStepIn as AnyToolExecutor,
		category: "development",
		requiresPermission: true,
	},
	{
		name: "dap_step_out",
		description:
			"Check debugger availability for step-out. Debugger must be running and paused.",
		parameters: DAP_STEP_SCHEMA,
		execute: dapStepOut as AnyToolExecutor,
		category: "development",
		requiresPermission: true,
	},
	{
		name: "dap_stack_trace",
		description:
			"Check debugger availability for stack trace inspection. Debugger must be running and paused.",
		parameters: DAP_STACK_TRACE_SCHEMA,
		execute: dapStackTrace as AnyToolExecutor,
		category: "development",
		requiresPermission: true,
		isReadonly: true,
	},
	{
		name: "dap_evaluate",
		description:
			"Check debugger availability for expression evaluation. Debugger must be running and paused.",
		parameters: DAP_EVALUATE_SCHEMA,
		execute: dapEvaluate as AnyToolExecutor,
		category: "development",
		requiresPermission: true,
	},
];
