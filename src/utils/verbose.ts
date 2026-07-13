import { Command } from "commander";
import { setDebugMode } from "./logger.js";
import { debug } from "./debug.js";

export type VerboseLevel = "silent" | "normal" | "verbose" | "debug" | "trace";

interface VerboseConfig {
	level: VerboseLevel;
	timestamps: boolean;
	showToolArgs: boolean;
	showToolResults: boolean;
	showHttpTraffic: boolean;
	showTokenCounts: boolean;
	showMemoryUsage: boolean;
}

const VERBOSE_CONFIGS: Record<VerboseLevel, Partial<VerboseConfig>> = {
	silent: {
		timestamps: false,
		showToolArgs: false,
		showToolResults: false,
		showHttpTraffic: false,
		showTokenCounts: false,
		showMemoryUsage: false,
	},
	normal: {
		timestamps: false,
		showToolArgs: false,
		showToolResults: false,
		showHttpTraffic: false,
		showTokenCounts: false,
		showMemoryUsage: false,
	},
	verbose: {
		timestamps: true,
		showToolArgs: true,
		showToolResults: true,
		showHttpTraffic: false,
		showTokenCounts: true,
		showMemoryUsage: false,
	},
	debug: {
		timestamps: true,
		showToolArgs: true,
		showToolResults: true,
		showHttpTraffic: true,
		showTokenCounts: true,
		showMemoryUsage: true,
	},
	trace: {
		timestamps: true,
		showToolArgs: true,
		showToolResults: true,
		showHttpTraffic: true,
		showTokenCounts: true,
		showMemoryUsage: true,
	},
};

let currentConfig: VerboseConfig = {
	level: "normal",
	timestamps: false,
	showToolArgs: false,
	showToolResults: false,
	showHttpTraffic: false,
	showTokenCounts: false,
	showMemoryUsage: false,
};

export function setVerboseLevel(level: VerboseLevel): void {
	currentConfig.level = level;
	const overrides = VERBOSE_CONFIGS[level];
	currentConfig = { ...currentConfig, ...overrides };

	// Enable debug module for debug/trace levels
	if (level === "debug" || level === "trace") {
		setDebugMode(true);
		debug.enable();
	}
}

export function getVerboseConfig(): Readonly<VerboseConfig> {
	return currentConfig;
}

export function isVerboseEnabled(): boolean {
	return currentConfig.level !== "silent" && currentConfig.level !== "normal";
}

export function isDebugEnabled(): boolean {
	return currentConfig.level === "debug" || currentConfig.level === "trace";
}

/**
 * Log a verbose message (only shown at verbose level or above)
 */
export function verboseLog(message: string, ...args: unknown[]): void {
	if (currentConfig.level === "silent" || currentConfig.level === "normal") {
		return;
	}

	const prefix = currentConfig.timestamps
		? `[${new Date().toISOString().split("T")[1].slice(0, 12)}] `
		: "";
	console.log(`${prefix}[verbose] ${message}`, ...args);
}

/**
 * Log a tool invocation (shown at verbose level or above)
 */
export function verboseToolCall(toolName: string, args: unknown): void {
	if (!currentConfig.showToolArgs) return;

	const prefix = currentConfig.timestamps
		? `[${new Date().toISOString().split("T")[1].slice(0, 12)}] `
		: "";

	const argsStr =
		typeof args === "object" && args !== null
			? JSON.stringify(args, null, 2).slice(0, 200)
			: String(args);

	console.log(`${prefix}[tool:${toolName}] args: ${argsStr}`);
}

/**
 * Log a tool result (shown at verbose level or above)
 */
export function verboseToolResult(
	toolName: string,
	result: unknown,
	durationMs: number,
): void {
	if (!currentConfig.showToolResults) return;

	const prefix = currentConfig.timestamps
		? `[${new Date().toISOString().split("T")[1].slice(0, 12)}] `
		: "";

	const resultStr =
		typeof result === "object" && result !== null
			? JSON.stringify(result).slice(0, 100)
			: String(result).slice(0, 100);

	console.log(
		`${prefix}[tool:${toolName}] result (${durationMs}ms): ${resultStr}...`,
	);
}

/**
 * Log HTTP traffic (shown at debug level or above)
 */
export function verboseHttp(
	method: string,
	url: string,
	status?: number,
	durationMs?: number,
): void {
	if (!currentConfig.showHttpTraffic) return;

	const prefix = currentConfig.timestamps
		? `[${new Date().toISOString().split("T")[1].slice(0, 12)}] `
		: "";

	const statusStr = status !== undefined ? ` → ${status}` : "";
	const timeStr = durationMs !== undefined ? ` (${durationMs}ms)` : "";

	console.log(`${prefix}[http] ${method} ${url}${statusStr}${timeStr}`);
}

/**
 * Log token count information
 */
export function verboseTokenCount(
	label: string,
	count: number,
	maxTokens?: number,
): void {
	if (!currentConfig.showTokenCounts) return;

	const maxStr = maxTokens ? ` / ${maxTokens}` : "";
	const pct = maxTokens ? ` (${((count / maxTokens) * 100).toFixed(1)}%)` : "";

	console.log(`[tokens] ${label}: ${count}${maxStr}${pct}`);
}

/**
 * Log memory usage
 */
export function verboseMemoryUsage(label: string): void {
	if (!currentConfig.showMemoryUsage) return;

	const usage = process.memoryUsage();
	const heapMB = (usage.heapUsed / 1024 / 1024).toFixed(1);
	const rssMB = (usage.rss / 1024 / 1024).toFixed(1);

	console.log(`[memory] ${label}: heap=${heapMB}MB rss=${rssMB}MB`);
}

/**
 * Add verbose flag options to a Commander command
 */
export function addVerboseOptions(command: Command): Command {
	return command
		.option(
			"--verbose",
			"Enable verbose output (tool args, results, timing)",
			false,
		)
		.option(
			"-V, --verbose-level <level>",
			"Verbose level: silent, normal, verbose, debug, trace",
			"normal",
		);
}

/**
 * Initialize verbose from CLI options
 */
export function initializeVerbose(options: {
	verbose?: boolean;
	verboseLevel?: string;
	debug?: boolean;
}): void {
	if (options.debug) {
		setVerboseLevel("debug");
		return;
	}

	if (options.verboseLevel && options.verboseLevel !== "normal") {
		setVerboseLevel(options.verboseLevel as VerboseLevel);
		return;
	}

	if (options.verbose) {
		setVerboseLevel("verbose");
		return;
	}
}
