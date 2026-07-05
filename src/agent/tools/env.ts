import os from "node:os";
import { execSync } from "node:child_process";
import { z } from "zod";
import {
	detectBestGraphicsProtocol,
	getCapabilities,
} from "../../terminal/capabilities.js";
import type {
	AnyToolExecutor,
	ToolContext,
	ToolDefinition,
	ToolResult,
} from "./registry.js";

/**
 * Categorized lists of "interesting" env vars to surface in `env_inspect`.
 * These are the keys that meaningfully describe the runtime, AI provider
 * availability, project context, and shell environment.
 */
const INTERESTING_ENV_GROUPS: Record<string, string[]> = {
	"AI Provider Keys": [
		"OPENAI_API_KEY",
		"ANTHROPIC_API_KEY",
		"OPENROUTER_API_KEY",
		"OPENCODE_API_KEY",
		"GROQ_API_KEY",
		"GOOGLE_API_KEY",
		"GEMINI_API_KEY",
		"DASHSCOPE_API_KEY",
		"BAILIAN_API_KEY",
		"ALIBABA_ACCESS_KEY_ID",
	],
	"Tehuti Runtime": [
		"TEHUTI_MODEL",
		"TEHUTI_PROVIDER",
		"TEHUTI_BASE_URL",
		"TEHUTI_API_KEY",
		"TEHUTI_DEBUG",
		"TEHUTI_CUSTOM_PROVIDER",
	],
	"Shell & Editor": [
		"SHELL",
		"EDITOR",
		"VISUAL",
		"TERM",
		"TERM_PROGRAM",
		"TERM_PROGRAM_VERSION",
		"COLORTERM",
		"LANG",
	],
	"Path & Workspace": ["HOME", "PWD", "OLDPWD", "TMPDIR", "PATH"],
};

/**
 * Redacts a secret value to a short fingerprint, so the model can verify
 * presence without leaking the key into prompts or logs.
 */
function redact(value: string | undefined): string {
	if (!value) return "(unset)";
	if (value.length <= 8) return "***";
	return `${value.slice(0, 4)}…${value.slice(-4)} (${value.length} chars)`;
}

function safeExec(
	cmd: string,
	opts: { timeout?: number; cwd?: string } = {},
): string | null {
	try {
		return execSync(cmd, {
			stdio: ["ignore", "pipe", "ignore"],
			timeout: opts.timeout ?? 5000,
			cwd: opts.cwd,
			encoding: "utf8",
		}).trim();
	} catch {
		return null;
	}
}

function formatBytes(bytes: number): string {
	if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
	if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
	if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${bytes} B`;
}

const ENV_INSPECT_SCHEMA = z.object({
	section: z
		.enum([
			"all",
			"os",
			"env",
			"shell",
			"terminal",
			"network",
			"tools",
			"cwd",
		])
		.optional()
		.describe("Limit the report to one section (default: all)"),
	show_secret_values: z
		.boolean()
		.optional()
		.describe(
			"Include redacted env values for API keys (default: false, presence only).",
		),
});

async function envInspect(
	args: z.infer<typeof ENV_INSPECT_SCHEMA>,
	_ctx: ToolContext,
): Promise<ToolResult> {
	const section = args.section ?? "all";
	const showValues = args.show_secret_values ?? false;
	const caps = getCapabilities();
	const sections: string[] = [];

	// ── OS / Hardware ───────────────────────────────────────────────────────
	if (section === "all" || section === "os") {
		const totalMem = os.totalmem();
		const freeMem = os.freemem();
		const cpus = os.cpus();
		const arch = os.arch();
		const release = safeExec("uname -r") ?? os.release();
		const productName = safeExec("sw_vers -productName 2>/dev/null");
		const productVersion = safeExec("sw_vers -productVersion 2>/dev/null");
		const disk = safeExec("df -h / | tail -1 | awk '{print $2\" used \"$3\" avail (\"$5\" used)\"}'");

		const lines: string[] = [];
		lines.push(`## OS & Hardware`);
		if (productName) {
			lines.push(`- System: ${productName} ${productVersion ?? ""}`.trim());
		}
		lines.push(`- Platform: ${os.platform()} (${arch})`);
		lines.push(`- Kernel: ${release}`);
		lines.push(`- Hostname: ${os.hostname()}`);
		lines.push(`- CPUs: ${cpus.length} cores (${cpus[0]?.model ?? "unknown"})`);
		lines.push(
			`- Memory: ${formatBytes(totalMem - freeMem)} used / ${formatBytes(totalMem)} total`,
		);
		if (disk) lines.push(`- Disk /: ${disk}`);
		lines.push(`- Uptime: ${(os.uptime() / 3600).toFixed(1)}h`);
		lines.push(`- User: ${os.userInfo().username}`);
		sections.push(lines.join("\n"));
	}

	// ── Working Directory ───────────────────────────────────────────────────
	if (section === "all" || section === "cwd") {
		const cwd = process.cwd();
		const gitHead = safeExec("git rev-parse --abbrev-ref HEAD 2>/dev/null", {
			cwd,
		});
		const gitRoot = safeExec("git rev-parse --show-toplevel 2>/dev/null", {
			cwd,
		});
		const inGit = gitRoot !== null;
		const lines: string[] = [`## Working Directory`];
		lines.push(`- CWD: ${cwd}`);
		if (inGit) {
			lines.push(`- Git root: ${gitRoot}`);
			lines.push(`- Branch: ${gitHead ?? "(detached)"}`);
		} else {
			lines.push(`- Not a git repository`);
		}
		sections.push(lines.join("\n"));
	}

	// ── Terminal ────────────────────────────────────────────────────────────
	if (section === "all" || section === "terminal") {
		const graphics = caps.graphics;
		const best = detectBestGraphicsProtocol();
		const lines: string[] = [`## Terminal`];
		lines.push(`- Emulator: ${caps.emulator}`);
		lines.push(`- TERM: ${process.env.TERM ?? "(unset)"}`);
		lines.push(`- COLORTERM: ${caps.colorterm || "(unset)"}`);
		lines.push(
			`- Colors: ${caps.colors.supported ? `yes (level ${caps.colors.level}, ${caps.colors.has16m ? "TrueColor" : caps.colors.has256 ? "256" : caps.colors.hasBasic ? "16" : "unknown"})` : "no"}`,
		);
		lines.push(`- Unicode: ${caps.unicode ? "yes" : "no"}`);
		lines.push(`- Hyperlinks: ${caps.hyperlinks ? "yes" : "no"}`);
		lines.push(
			`- Graphics: Sixel=${graphics.sixel ? "✓" : "✗"}  Kitty=${graphics.kitty ? "✓" : "✗"}  iTerm2=${graphics.iterm ? "✓" : "✗"}${best ? ` (best: ${best})` : ""}`,
		);
		lines.push(`- TTY: ${caps.tty ? "yes" : "no"}`);
		lines.push(`- Interactive: ${caps.interactive ? "yes" : "no"} (CI=${caps.ci})`);
		lines.push(`- Size: ${caps.size.columns}×${caps.size.rows}`);
		lines.push(`- Shell: ${caps.shell}`);
		lines.push(`- Locale: ${caps.lang}`);
		sections.push(lines.join("\n"));
	}

	// ── Network ─────────────────────────────────────────────────────────────
	if (section === "all" || section === "network") {
		const interfaces = os.networkInterfaces();
		const ipv4Addrs: string[] = [];
		for (const [name, addrs] of Object.entries(interfaces)) {
			if (!addrs) continue;
			for (const a of addrs) {
				if (a.family === "IPv4" && !a.internal) {
					ipv4Addrs.push(`${a.address} (${name})`);
				}
			}
		}
		const externalIp = safeExec("curl -s --max-time 3 ifconfig.me 2>/dev/null");
		const lines: string[] = [`## Network`];
		lines.push(`- Hostname: ${os.hostname()}`);
		if (ipv4Addrs.length > 0) {
			lines.push(`- IPv4: ${ipv4Addrs.join(", ")}`);
		} else {
			lines.push(`- IPv4: (none discovered)`);
		}
		if (externalIp) lines.push(`- External IP: ${externalIp}`);
		lines.push(
			`- DNS: ${safeExec("scutil --dns 2>/dev/null | grep nameserver | head -2 | awk '{print $3}' | xargs") || "system default"}`,
		);
		sections.push(lines.join("\n"));
	}

	// ── Tools / Runtimes ────────────────────────────────────────────────────
	if (section === "all" || section === "tools") {
		const probe = (cmd: string, label: string) => {
			const v = safeExec(`${cmd} --version 2>/dev/null | head -1`);
			return v ? `  - ${label}: ${v}` : null;
		};
		const probes: (string | null)[] = [
			probe("node", "Node.js"),
			probe("npm", "npm"),
			probe("pnpm", "pnpm"),
			probe("yarn", "yarn"),
			probe("bun", "Bun"),
			probe("deno", "Deno"),
			probe("python3", "Python"),
			probe("go", "Go"),
			probe("rustc", "Rust"),
			probe("cargo", "Cargo"),
			probe("docker", "Docker"),
			probe("kubectl", "kubectl"),
			probe("git", "Git"),
			probe("ssh", "SSH"),
			probe("curl", "curl"),
		];
		const found = probes.filter((l): l is string => l !== null);
		sections.push(`## Installed Tools\n${found.join("\n") || "(none detected)"}`);
	}

	// ── Environment Variables ──────────────────────────────────────────────
	if (section === "all" || section === "env" || section === "shell") {
		const lines: string[] = [`## Environment Variables`];
		for (const [group, keys] of Object.entries(INTERESTING_ENV_GROUPS)) {
			const present: string[] = [];
			for (const k of keys) {
				const v = process.env[k];
				if (v) {
					if (k.includes("KEY") || k.includes("TOKEN") || k.includes("SECRET")) {
						present.push(`  - ${k}: ${showValues ? redact(v) : "✓ set"}`);
					} else {
						present.push(`  - ${k}: ${v.length > 80 ? `${v.slice(0, 77)}…` : v}`);
					}
				}
			}
			if (present.length > 0) {
				lines.push(`\n### ${group}\n${present.join("\n")}`);
			}
		}
		sections.push(lines.join("\n"));
	}

	return {
		success: true,
		output: sections.join("\n\n"),
		metadata: {
			section,
			platform: os.platform(),
			emulator: caps.emulator,
		},
	};
}

export const envTools: ToolDefinition[] = [
	{
		name: "env_inspect",
		description: `Inspect the local environment: OS, hardware, working directory, git state, terminal capabilities (Sixel/Kitty/iTerm2), network, installed tools, and interesting environment variables (API keys shown only as presence/character-count, not full values, unless 'show_secret_values' is set). Use this instead of running a series of shell probes — it gives a structured, cross-platform report.`,
		parameters: ENV_INSPECT_SCHEMA,
		execute: envInspect as AnyToolExecutor,
		category: "system",
		requiresPermission: false,
		isReadonly: true,
	},
];
