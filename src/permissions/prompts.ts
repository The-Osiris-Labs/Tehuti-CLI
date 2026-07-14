import { Mutex } from "async-mutex";
import chalk from "chalk";
import { getTool } from "../agent/tools/registry.js";
import type { PermissionsConfig } from "../config/schema.js";
import { debug } from "../utils/debug.js";
import { matchesPattern, permissionManager } from "./rules.js";

export interface PermissionRequest {
	toolName: string;
	args: unknown;
	reason?: string;
}

export interface PermissionResult {
	allowed: boolean;
	reason?: string;
	remember?: boolean;
}

let permissionResolver:
	| ((request: PermissionRequest, isDangerous: boolean) => Promise<boolean>)
	| null = null;

const promptMutex = new Mutex();

export function setPermissionResolver(
	resolver: (
		request: PermissionRequest,
		isDangerous: boolean,
	) => Promise<boolean>,
): void {
	permissionResolver = resolver;
}

function hasDangerousCommandPattern(cmd: string): boolean {
	const trimmed = cmd.trim();
	const dangerousPatterns = [
		/\brm\s+(-[rfvR]+\s+)*(\/|~|\*)/,
		/\brm\s+-rf\b/,
		/\brm\s+-[rR]\s+-f\b/,
		/\brm\s+-f\s+-[rR]\b/,
		/\bmkfs\b/,
		/\bdd\s+if=/,
		/>\s*\/dev\/sd/,
		/:\(\)\{\s*:\|:\s*\}\s*;/, // fork bomb
		/\bcurl\b.*\|\s*(\/\w+\/)*(bash|sh|zsh|dash|ksh)\b/,
		/\bwget\b.*\|\s*(\/\w+\/)*(bash|sh|zsh|dash|ksh)\b/,
		/\bchmod\s+(-R\s+)?777\s+(\/|~)/,
		/\bgit\s+push\s+.*(--force|-f)\b/,
		/\bDROP\s+(TABLE|DATABASE|SCHEMA)\b/i,
		/\bTRUNCATE\s+(TABLE)?\s/i,
		/\bDELETE\s+FROM\b/i,
		/\beval\b/,
		/\bexec\b/,
		/>\s*\/etc\//,
		/>\s*~\/\.ssh\//,
		/\bshutdown\b/,
		/\breboot\b/,
	];

	if (dangerousPatterns.some((p) => p.test(trimmed))) {
		return true;
	}

	// Subshell execution check
	if (/\$\([^)]+\)|`[^`]+`/.test(trimmed)) {
		return true;
	}

	// Command chaining check
	if (/;|\|\||&&|\n|\r/.test(trimmed)) {
		const parts = trimmed.split(/;|\|\||&&|\n|\r/);
		for (const part of parts) {
			const trimmedPart = part.trim();
			if (!trimmedPart) continue;
			if (dangerousPatterns.some((p) => p.test(trimmedPart))) {
				return true;
			}
		}
	}

	return false;
}

const DANGEROUS_ARGS: Record<string, (args: unknown) => boolean> = {
	bash: (args) => {
		const cmd = (args as { command: string }).command ?? "";
		return hasDangerousCommandPattern(cmd);
	},
	start_background: (args) => {
		const cmd = (args as { command: string }).command ?? "";
		return hasDangerousCommandPattern(cmd);
	},
	write: () => true,
	edit: () => true,
	delete_file: () => true,
	delete_dir: () => true,
	move: () => true,
};

export async function checkPermission(
	request: PermissionRequest,
	config: PermissionsConfig,
): Promise<PermissionResult> {
	const { toolName, args } = request;

	debug.log("permissions", `Checking permission for: ${toolName}`);

	if (config.trustedMode) {
		return { allowed: true, reason: "Trusted mode enabled" };
	}

	// 0. Check ephemeral capabilities first
	if (
		permissionManager.consumeCapability(
			toolName,
			(args ?? {}) as Record<string, unknown>,
		)
	) {
		return { allowed: true, reason: "Allowed by JIT capability" };
	}

	// 1. Consult PermissionManager first (session/persistent decisions)
	const managerDecision = permissionManager.check(
		toolName,
		(args ?? {}) as Record<string, unknown>,
	);
	if (managerDecision === "allow") {
		return { allowed: true, reason: "Allowed by permission rule" };
	}
	if (managerDecision === "deny") {
		return { allowed: false, reason: "Denied by permission rule" };
	}

	// 2. Check alwaysDeny with wildcard pattern support
	if (config.alwaysDeny?.some((pattern) => matchesPattern(toolName, pattern))) {
		return { allowed: false, reason: "Tool in always-deny list" };
	}

	// 3. Check alwaysAllow with wildcard pattern support
	if (
		config.alwaysAllow?.some((pattern) => matchesPattern(toolName, pattern))
	) {
		return { allowed: true, reason: "Tool in always-allow list" };
	}

	// 4. Command verification for allowedCommands / deniedCommands
	const isCommandTool = ["bash", "start_background"].includes(toolName);
	if (isCommandTool && typeof args === "object" && args !== null) {
		const cmd = ((args as Record<string, unknown>).command as string) ?? "";
		const trimmedCmd = cmd.trim();

		// Check deniedCommands first
		if (
			config.deniedCommands?.some((pattern) =>
				matchesPattern(trimmedCmd, pattern),
			)
		) {
			return { allowed: false, reason: "Command in denied-commands list" };
		}

		// Check allowedCommands
		if (
			config.allowedCommands?.some((pattern) =>
				matchesPattern(trimmedCmd, pattern),
			)
		) {
			return { allowed: true, reason: "Command in allowed-commands list" };
		}
	}

	// 5. Check Intent-Based Access Control (IBAC)
	const toolDef = getTool(toolName);
	if (toolDef?.intent === "read-only") {
		return { allowed: true, reason: "Safe read-only tool" };
	}

	// 6. Check readonly mode
	if (config.defaultMode === "readonly") {
		return { allowed: false, reason: "Read-only mode" };
	}

	// 7. Check trust mode
	if (config.defaultMode === "trust") {
		return { allowed: true, reason: "Trust mode" };
	}

	let isDangerousArgs = false;
	const checkDangerous = DANGEROUS_ARGS[toolName];
	if (checkDangerous) {
		isDangerousArgs = checkDangerous(args);
	} else if (
		toolName.includes("shell") ||
		toolName.includes("execute") ||
		toolName.includes("bash")
	) {
		const argsRecord = args as Record<string, unknown>;
		const cmd =
			(argsRecord?.command as string) || (argsRecord?.script as string) || "";
		if (cmd) {
			isDangerousArgs = hasDangerousCommandPattern(cmd);
		}
	}

	const isDangerous =
		isDangerousArgs || toolDef?.intent === "destructive" || !toolDef;

	return interactivePrompt(request, isDangerous);
}

export function buildPromptMessage(
	toolName: string,
	args: unknown,
	isDangerous: boolean,
): string {
	const gold = chalk.hex("#D4AF37");
	const coral = chalk.hex("#FF6B35");
	const sand = chalk.hex("#C2B280");
	const blue = chalk.hex("#3B82F6");

	const borderChar = {
		tl: "╭",
		tr: "╮",
		bl: "╰",
		br: "╯",
		h: "─",
		v: "│",
		joinL: "├",
		joinR: "┤",
	};

	const width = 60;
	const hr = borderChar.h.repeat(width - 2);

	const title = "  𓆣  Tehuti Permission Request  ";
	const titlePadding = " ".repeat(Math.max(0, width - 4 - title.length));
	const headerLine = `${borderChar.v} ${gold.bold(title)}${titlePadding} ${borderChar.v}`;

	const rawToolLabel = `Tool: ${toolName}`;
	const styledToolLabel = `Tool: ${blue.bold(toolName)}`;
	const toolPadding = " ".repeat(Math.max(0, width - 4 - rawToolLabel.length));
	const toolLine = `${borderChar.v} ${styledToolLabel}${toolPadding} ${borderChar.v}`;

	const lines: string[] = [];
	lines.push(gold(`${borderChar.tl}${hr}${borderChar.tr}`));
	lines.push(headerLine);
	lines.push(gold(`${borderChar.joinL}${hr}${borderChar.joinR}`));
	lines.push(toolLine);
	lines.push(`${borderChar.v}${" ".repeat(width - 2)}${borderChar.v}`);

	// Arguments header
	const argsHeader = "Arguments:";
	const argsHeaderPadding = " ".repeat(width - 4 - argsHeader.length);
	lines.push(
		`${borderChar.v} ${sand(argsHeader)}${argsHeaderPadding} ${borderChar.v}`,
	);

	// Format arguments
	if (args && typeof args === "object") {
		const entries = Object.entries(args as Record<string, unknown>);
		for (const [key, value] of entries) {
			let valStr = typeof value === "string" ? value : JSON.stringify(value);
			valStr = valStr.replace(/\r?\n/g, " ");
			if (valStr.length > 40) {
				valStr = `${valStr.slice(0, 37)}...`;
			}
			const rawLine = `  ${key}: ${valStr}`;
			const styledLine = `  ${chalk.cyan(key)}: ${valStr}`;
			const argPadding = " ".repeat(Math.max(0, width - 4 - rawLine.length));
			lines.push(`${borderChar.v} ${styledLine}${argPadding} ${borderChar.v}`);
		}
	} else {
		let valStr = String(args).replace(/\r?\n/g, " ");
		if (valStr.length > 50) {
			valStr = `${valStr.slice(0, 47)}...`;
		}
		const argLine = `  ${valStr}`;
		const argPadding = " ".repeat(Math.max(0, width - 4 - argLine.length));
		lines.push(`${borderChar.v} ${argLine}${argPadding} ${borderChar.v}`);
	}

	if (isDangerous) {
		lines.push(`${borderChar.v}${" ".repeat(width - 2)}${borderChar.v}`);
		const styledWarning = `${coral.bold("𓂀")}  ${coral.bold("WARNING: Potentially destructive operation!")}`;
		const warningPadding = " ".repeat(Math.max(0, width - 4 - 44));
		lines.push(
			`${borderChar.v} ${styledWarning}${warningPadding} ${borderChar.v}`,
		);
	}

	lines.push(gold(`${borderChar.bl}${hr}${borderChar.br}`));
	return `${lines.join("\n")}\n\nAllow execution?`;
}

async function interactivePrompt(
	request: PermissionRequest,
	isDangerous: boolean,
): Promise<PermissionResult> {
	const { toolName, args } = request;

	if (!permissionResolver) {
		// Fallback if no UI resolver is mounted: deny dangerous, allow safe
		return {
			allowed: !isDangerous,
			reason: !isDangerous
				? "Auto-allowed safe tool (no UI)"
				: "Auto-denied dangerous tool (no UI)",
		};
	}

	return await promptMutex.runExclusive(async () => {
		try {
			const allowed = await permissionResolver!(request, isDangerous);

			permissionManager.recordDecision(
				toolName,
				(args ?? {}) as Record<string, unknown>,
				allowed,
			);

			return {
				allowed,
				reason: allowed ? "User approved" : "User denied",
			};
		} catch (_error) {
			return {
				allowed: false,
				reason: "Prompt cancelled",
			};
		}
	});
}

export function createPermissionFilter(config: PermissionsConfig) {
	return async (toolName: string, args: unknown): Promise<boolean> => {
		const result = await checkPermission({ toolName, args }, config);
		return result.allowed;
	};
}
