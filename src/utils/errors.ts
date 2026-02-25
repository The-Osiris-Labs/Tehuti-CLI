import cleanStack from "clean-stack";
import { serializeError } from "serialize-error";
import { consola } from "./logger.js";

const GOLD = "\x1b[38;5;178m";
const RESET = "\x1b[0m";
const EYE_OF_HORUS = "\u{13080}";
const IBIS = "\u{131A3}";

export class TehutiError extends Error {
	constructor(
		message: string,
		public code: string = "TEHUTI_ERROR",
		public exitCode: number = 1,
		public showStack: boolean = false,
	) {
		super(message);
		this.name = "TehutiError";
	}
}

export class ConfigError extends TehutiError {
	constructor(message: string) {
		super(message, "CONFIG_ERROR", 2, false);
		this.name = "ConfigError";
	}
}

export class APIError extends TehutiError {
	constructor(
		message: string,
		public statusCode?: number,
	) {
		super(message, "API_ERROR", 3, false);
		this.name = "APIError";
	}

	get status(): number | undefined {
		return this.statusCode;
	}
}

export class PermissionError extends TehutiError {
	constructor(message: string) {
		super(message, "PERMISSION_ERROR", 4, false);
		this.name = "PermissionError";
	}
}

export class ToolError extends TehutiError {
	constructor(
		message: string,
		public toolName?: string,
	) {
		super(message, "TOOL_ERROR", 5, false);
		this.name = "ToolError";
	}
}

export enum MCPErrorCode {
	TIMEOUT = "MCP_TIMEOUT",
	CONNECTION_FAILED = "MCP_CONNECTION_FAILED",
	SERVER_NOT_CONNECTED = "MCP_SERVER_NOT_CONNECTED",
	CONFIG_ERROR = "MCP_CONFIG_ERROR",
	CAPABILITY_NOT_SUPPORTED = "MCP_CAPABILITY_NOT_SUPPORTED",
	TOOL_DENIED = "MCP_TOOL_DENIED",
	TOOL_NOT_ALLOWED = "MCP_TOOL_NOT_ALLOWED",
	TOOL_EXECUTION_FAILED = "MCP_TOOL_EXECUTION_FAILED",
	RESOURCE_READ_FAILED = "MCP_RESOURCE_READ_FAILED",
	PROMPT_RETRIEVAL_FAILED = "MCP_PROMPT_RETRIEVAL_FAILED",
	SAMPLING_FAILED = "MCP_SAMPLING_FAILED",
	HEALTH_CHECK_FAILED = "MCP_HEALTH_CHECK_FAILED",
}

export class MCPError extends TehutiError {
	constructor(
		message: string,
		public code: MCPErrorCode = MCPErrorCode.CONNECTION_FAILED,
		public serverName?: string,
	) {
		super(message, code, 6, false);
		this.name = "MCPError";
	}
}

export function createMCPError(
	message: string,
	code: MCPErrorCode,
	serverName?: string,
): MCPError {
	return new MCPError(message, code, serverName);
}

export function formatError(error: unknown, showStack = false): string {
	const prefix = `${GOLD}${EYE_OF_HORUS}${RESET}`;

	if (error instanceof TehutiError) {
		const parts = [`${prefix} ${error.name}: ${error.message}`];
		if (showStack && error.stack) {
			const cleaned = cleanStack(error.stack, { pretty: true });
			parts.push(`\n${cleaned}`);
		}
		return parts.join("\n");
	}

	if (error instanceof Error) {
		const parts = [`${prefix} ${error.message}`];
		if (showStack && error.stack) {
			const cleaned = cleanStack(error.stack, { pretty: true });
			parts.push(`\n${cleaned}`);
		}
		return parts.join("\n");
	}

	return `${prefix} ${String(error)}`;
}

export function handleError(error: unknown, debug = false): never {
	const formatted = formatError(error, debug);
	consola.error(formatted);

	if (error instanceof TehutiError) {
		process.exit(error.exitCode);
	}

	process.exit(1);
}

export function toJSON(error: unknown): Record<string, unknown> {
	const serialized = serializeError(error);
	if (typeof serialized === "object" && serialized !== null) {
		return serialized as Record<string, unknown>;
	}
	return { error: String(error) };
}

function restoreTerminal(): void {
	if (process.stdin.isTTY && process.stdin.setRawMode) {
		try {
			process.stdin.setRawMode(false);
		} catch {}
	}
	if (process.stdout.isTTY) {
		try {
			process.stdout.write("\x1b[?25h");
			process.stdout.write("\x1b[0m");
		} catch {}
	}
}

let handlersSetup = false;

export function setupErrorHandlers(debug = false): void {
	if (handlersSetup) {
		return;
	}
	handlersSetup = true;

	process.on("uncaughtException", (error) => {
		restoreTerminal();
		consola.error(formatError(error, debug));
		process.exit(1);
	});

	process.on("unhandledRejection", (reason) => {
		restoreTerminal();
		const error = reason instanceof Error ? reason : new Error(String(reason));
		consola.error(formatError(error, debug));
		process.exit(1);
	});

	process.on("SIGINT", () => {
		restoreTerminal();
		process.exit(130);
	});

	process.on("SIGTERM", () => {
		restoreTerminal();
		process.exit(143);
	});

	process.on("SIGQUIT", () => {
		restoreTerminal();
		consola.info("\nReceived SIGQUIT - exiting...");
		process.exit(131);
	});
}
