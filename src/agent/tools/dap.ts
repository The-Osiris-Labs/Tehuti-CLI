import { spawn } from "node:child_process";
import { z } from "zod";
import type {
	ToolContext,
	ToolDefinition,
	ToolResult,
} from "./registry.js";

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

export const dapTools: ToolDefinition[] = [
	{
		name: "debug",
		description:
			"Debug a program using DAP (Debug Adapter Protocol). Detects available debuggers and provides setup instructions.",
		parameters: z.object({
			program: z
				.string()
				.describe("Path to the program or script to debug"),
			args: z
				.array(z.string())
				.optional()
				.describe("Command-line arguments"),
			cwd: z.string().optional().describe("Working directory"),
		}),
		category: "development",
		requiresPermission: true,
	execute: async (_args, _ctx: ToolContext): Promise<ToolResult> => {
			const debuggers = await checkDebuggers();
			const available = debuggers.filter((d) => d.available);
			if (available.length === 0) {
				return {
					success: true,
					output:
						"No debuggers found. Install debugpy (Python), lldb (Rust/C++), or delve (Go).",
				};
			}
			const info = available[0];
			return {
				success: true,
				output: `Found ${info.name} (${info.version ?? "unknown"}). Language: ${info.language}.\nSetup: ${info.setupHint}\n\nNote: Full DAP integration is not yet implemented. Use the built-in debugger in your IDE for interactive debugging.`,
			};
		},
	},
];
