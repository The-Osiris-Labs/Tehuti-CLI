import { confirm } from "@inquirer/prompts";
import type { PermissionsConfig } from "../config/schema.js";
import { debug } from "../utils/debug.js";

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

const SAFE_TOOLS = [
	"read",
	"glob",
	"grep",
	"web_fetch",
	"web_search",
	"file_info",
	"list_dir",
	"todo_write",
	"task",
];

const DANGEROUS_ARGS: Record<string, (args: unknown) => boolean> = {
	bash: (args) => {
		const cmd = (args as { command: string }).command ?? "";
		const dangerousPatterns = [
			/rm\s+-rf/,
			/DROP\s+TABLE/i,
			/DROP\s+DATABASE/i,
			/DELETE\s+FROM/i,
			/TRUNCATE/i,
			/git\s+push\s+.*--force/,
			/git\s+push\s+.*-f\s/,
			/>\s*\/dev\/sd/,
			/mkfs/,
			/dd\s+if=/,
		];
		return dangerousPatterns.some((p) => p.test(cmd));
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

	if (config.alwaysAllow.includes(toolName)) {
		return { allowed: true, reason: "Tool in always-allow list" };
	}

	if (config.alwaysDeny.includes(toolName)) {
		return { allowed: false, reason: "Tool in always-deny list" };
	}

	if (SAFE_TOOLS.includes(toolName)) {
		return { allowed: true, reason: "Safe tool" };
	}

	if (config.defaultMode === "readonly") {
		const writeTools = [
			"write",
			"edit",
			"delete_file",
			"delete_dir",
			"move",
			"bash",
		];
		if (writeTools.includes(toolName)) {
			return { allowed: false, reason: "Read-only mode" };
		}
	}

	if (config.defaultMode === "trust") {
		return { allowed: true, reason: "Trust mode" };
	}

	const checkDangerous = DANGEROUS_ARGS[toolName];
	const isDangerous = checkDangerous ? checkDangerous(args) : false;

	return interactivePrompt(request, isDangerous);
}

async function interactivePrompt(
	request: PermissionRequest,
	isDangerous: boolean,
): Promise<PermissionResult> {
	const { toolName, args, reason } = request;

	const dangerWarning = isDangerous
		? "\n⚠️  WARNING: This operation appears to be potentially destructive!"
		: "";

	const argsPreview = formatArgsPreview(args);

	const message = `Allow Tehuti to use ${toolName}?${dangerWarning}\n\n${argsPreview}\n\nAllow?`;

	try {
		const allowed = await confirm({
			message,
			default: !isDangerous,
		});

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
}

function formatArgsPreview(args: unknown): string {
	if (typeof args !== "object" || args === null) {
		return String(args);
	}

	const entries = Object.entries(args as Record<string, unknown>);
	const lines = entries.map(([key, value]) => {
		const val =
			typeof value === "string" && value.length > 100
				? `${value.slice(0, 100)}...`
				: value;
		return `  ${key}: ${JSON.stringify(val)}`;
	});

	return lines.join("\n");
}

export function createPermissionFilter(config: PermissionsConfig) {
	return async (toolName: string, args: unknown): Promise<boolean> => {
		const result = await checkPermission({ toolName, args }, config);
		return result.allowed;
	};
}
