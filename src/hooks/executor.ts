import { spawn } from "node:child_process";
import fs from "fs-extra";
import type { ToolResult } from "../agent/tools/registry.js";
import { debug } from "../utils/debug.js";

export type HookEvent =
	| "PreToolUse"
	| "PostToolUse"
	| "PreCommit"
	| "Notification";

export interface HookConfig {
	type: "command";
	command: string;
	timeout?: number;
}

export interface HookMatcher {
	matcher: string;
	hooks: HookConfig[];
}

export interface HooksConfig {
	PreToolUse?: HookMatcher[];
	PostToolUse?: HookMatcher[];
	PreCommit?: HookMatcher[];
	Notification?: HookMatcher[];
}

interface HookContext {
	toolName: string;
	args: unknown;
	result?: ToolResult;
	filePath?: string;
	cwd: string;
	env: Record<string, string>;
}

const DANGEROUS_ENV_VARS = [
	"LD_PRELOAD",
	"LD_LIBRARY_PATH",
	"LD_AUDIT",
	"GLIBC_TUNABLES",
	"DYLD_INSERT_LIBRARIES",
	"DYLD_FORCE_FLAT_NAMESPACE",
	"DYLD_LIBRARY_PATH",
	"DYLD_FALLBACK_LIBRARY_PATH",
	"DYLD_FRAMEWORK_PATH",
	"DYLD_FALLBACK_FRAMEWORK_PATH",
	"BASH_ENV",
	"ENV",
	"PS4",
	"PERL5OPT",
	"PERL5LIB",
	"PYTHONPATH",
	"PYTHONINSPECT",
	"NODE_OPTIONS",
	"NODE_PATH",
	"RCFILE",
	"IFS",
	"JAVA_TOOL_OPTIONS",
	"_JAVA_OPTIONS",
	"MAVEN_OPTS",
	"RUBYOPT",
	"RUBYLIB",
	"HISTFILE",
	"HISTCONTROL",
	"PYTHONSTARTUP",
	"PROMPT_COMMAND",
	"TERMINFO",
	"TERMINFO_DIRS",
	"GCONV_PATH",
	"GETCONF_DIR",
	"HOSTALIASES",
	"RESOLV_HOST_CONF",
];

function filterDangerousEnvVars(
	env: Record<string, string>,
): Record<string, string> {
	const filtered: Record<string, string> = {};
	for (const [key, value] of Object.entries(env)) {
		const upperKey = key.toUpperCase();
		let isDangerous = false;
		for (const dangerous of DANGEROUS_ENV_VARS) {
			if (upperKey === dangerous || upperKey.startsWith(`${dangerous}_`)) {
				isDangerous = true;
				break;
			}
		}
		if (!isDangerous) {
			filtered[key] = value;
		}
	}
	return filtered;
}

function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

class HookExecutor {
	private config: HooksConfig = {};

	loadConfig(config: HooksConfig): void {
		this.config = config;
		debug.log("hooks", `Loaded ${Object.keys(config).length} hook types`);
	}

	async loadFromFile(configPath: string): Promise<void> {
		if (await fs.pathExists(configPath)) {
			const config = await fs.readJson(configPath);
			this.loadConfig(config.hooks ?? {});
		}
	}

	private matchesMatcher(toolName: string, matcher: string): boolean {
		if (matcher === "*") return true;

		const patterns = matcher.split("|").map((p) => p.trim());
		for (const pattern of patterns) {
			if (pattern.endsWith("*")) {
				if (toolName.startsWith(pattern.slice(0, -1))) return true;
			} else if (pattern.startsWith("*")) {
				if (toolName.endsWith(pattern.slice(1))) return true;
			} else if (toolName === pattern) {
				return true;
			} else {
				const escapedPattern = escapeRegex(pattern);
				const regex = new RegExp(`^${escapedPattern.replace(/\\\*/g, ".*")}$`);
				if (regex.test(toolName)) return true;
			}
		}
		return false;
	}

	async executeHook(
		event: HookEvent,
		context: HookContext,
	): Promise<{ proceed: boolean; error?: string }> {
		const hooks = this.config[event];
		if (!hooks || hooks.length === 0) {
			return { proceed: true };
		}

		for (const hookMatcher of hooks) {
			if (!this.matchesMatcher(context.toolName, hookMatcher.matcher)) {
				continue;
			}

			for (const hook of hookMatcher.hooks) {
				if (hook.type !== "command") continue;

				try {
					const result = await this.executeCommand(hook, context);
					if (!result.success && event === "PreToolUse") {
						return { proceed: false, error: result.error };
					}
				} catch (error) {
					const errorMsg =
						error instanceof Error ? error.message : String(error);
					debug.log("hooks", `Hook failed: ${errorMsg}`);

					if (event === "PreToolUse") {
						return { proceed: false, error: errorMsg };
					}
				}
			}
		}

		return { proceed: true };
	}

	private async executeCommand(
		hook: HookConfig,
		context: HookContext,
	): Promise<{ success: boolean; output?: string; error?: string }> {
		return new Promise((resolve) => {
			let command = hook.command;

			const env: Record<string, string> = filterDangerousEnvVars({
				...process.env,
				...context.env,
				TEHUTI_TOOL_NAME: context.toolName,
				TEHUTI_FILE_PATH: context.filePath ?? "",
				TEHUTI_CWD: context.cwd,
			});

			if (context.result) {
				env.TEHUTI_RESULT = JSON.stringify(context.result);
			}

			command = command.replace(/\$TOOL_NAME/g, "$TEHUTI_TOOL_NAME");
			command = command.replace(/\$FILE_PATH/g, "$TEHUTI_FILE_PATH");
			command = command.replace(/\$CWD/g, "$TEHUTI_CWD");
			command = command.replace(/\$RESULT/g, "$TEHUTI_RESULT");

			debug.log("hooks", `Executing hook for tool: ${context.toolName}`);

			const timeout =
				typeof hook.timeout === "number" &&
				hook.timeout > 0 &&
				hook.timeout <= 300000
					? hook.timeout
					: 30000;
			let timeoutId: NodeJS.Timeout | null = null;
			let resolved = false;

			const proc = spawn("bash", ["-c", command], {
				cwd: context.cwd,
				env,
				timeout,
			});

			const cleanup = () => {
				if (timeoutId) {
					clearTimeout(timeoutId);
					timeoutId = null;
				}
			};

			let stdout = "";
			let stderr = "";

			proc.stdout.on("data", (data) => {
				stdout += data.toString();
			});

			proc.stderr.on("data", (data) => {
				stderr += data.toString();
			});

			proc.on("close", (code) => {
				if (resolved) return;
				cleanup();
				resolved = true;
				if (code === 0) {
					resolve({ success: true, output: stdout });
				} else {
					resolve({
						success: false,
						error: stderr || `Hook exited with code ${code}`,
						output: stdout,
					});
				}
			});

			proc.on("error", (error) => {
				if (resolved) return;
				cleanup();
				resolved = true;
				resolve({ success: false, error: error.message });
			});

			timeoutId = setTimeout(() => {
				if (resolved) return;
				cleanup();
				resolved = true;
				try {
					proc.kill("SIGKILL");
				} catch {}
				resolve({ success: false, error: `Hook timed out after ${timeout}ms` });
			}, timeout);
		});
	}
}

export const hookExecutor = new HookExecutor();

export function parseHooksConfig(config: unknown): HooksConfig {
	if (!config || typeof config !== "object") {
		return {};
	}

	const hooks: HooksConfig = {};
	const cfg = config as Record<string, unknown>;

	for (const event of [
		"PreToolUse",
		"PostToolUse",
		"PreCommit",
		"Notification",
	] as HookEvent[]) {
		if (Array.isArray(cfg[event])) {
			hooks[event] = (cfg[event] as Array<unknown>).map((matcher) => {
				const m = matcher as Record<string, unknown>;
				return {
					matcher: String(m.matcher ?? "*"),
					hooks: (Array.isArray(m.hooks) ? m.hooks : []).map((h: unknown) => {
						const hook = h as Record<string, unknown>;
						return {
							type: "command" as const,
							command: String(hook.command ?? ""),
							timeout: typeof hook.timeout === "number" ? hook.timeout : 30000,
						};
					}),
				};
			});
		}
	}

	return hooks;
}
