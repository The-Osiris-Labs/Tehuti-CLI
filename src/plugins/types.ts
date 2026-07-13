/**
 * Tehuti Plugin System Types
 *
 * Defines the contract for plugins that can extend Tehuti CLI functionality.
 * Plugins can add tools, commands, hooks, themes, and providers.
 */

/**
 * Plugin lifecycle phases
 */
export type PluginPhase = "install" | "load" | "activate" | "deactivate" | "unload" | "uninstall";

/**
 * Plugin metadata declared in package.json or plugin manifest
 */
export interface PluginManifest {
	/** Unique plugin identifier (e.g., "tehuti-plugin-docker") */
	name: string;
	/** Human-readable display name */
	displayName: string;
	/** Semantic version */
	version: string;
	/** Short description */
	description: string;
	/** Plugin author */
	author?: string;
	/** Plugin homepage URL */
	homepage?: string;
	/** Plugin repository URL */
	repository?: string;
	/** Minimum Tehuti version required */
	minTehutiVersion?: string;
	/** Plugin entry point (relative to plugin root) */
	main?: string;
	/** Plugin keywords/tags */
	keywords?: string[];
	/** Plugin dependencies (other plugins) */
	dependencies?: string[];
	/** Plugin configuration schema (JSON Schema) */
	configSchema?: Record<string, unknown>;
	/** Whether this plugin is enabled by default */
	enabledByDefault?: boolean;
}

/**
 * Tool definition provided by a plugin
 */
export interface PluginTool {
	/** Tool name (must be unique across all plugins and built-in tools) */
	name: string;
	/** Tool description for the AI agent */
	description: string;
	/** JSON Schema for tool parameters */
	parameters: Record<string, unknown>;
	/** Tool execution function */
	execute: (args: Record<string, unknown>, context: PluginToolContext) => Promise<PluginToolResult>;
}

/**
 * Context provided to plugin tools during execution
 */
export interface PluginToolContext {
	/** Current working directory */
	cwd: string;
	/** Abort signal for cancellation */
	abortSignal?: AbortSignal;
	/** Logger for plugin-specific output */
	logger: PluginLogger;
	/** Access to other tools (read-only) */
	callTool: (name: string, args: Record<string, unknown>) => Promise<PluginToolResult>;
	/** Configuration for this plugin */
	config: Record<string, unknown>;
}

/**
 * Result from a plugin tool execution
 */
export interface PluginToolResult {
	/** Whether the tool execution succeeded */
	success: boolean;
	/** Output content */
	output?: string;
	/** Error message if failed */
	error?: string;
	/** Additional metadata */
	metadata?: Record<string, unknown>;
}

/**
 * Logger interface for plugins
 */
export interface PluginLogger {
	info: (message: string, ...args: unknown[]) => void;
	warn: (message: string, ...args: unknown[]) => void;
	error: (message: string, ...args: unknown[]) => void;
	debug: (message: string, ...args: unknown[]) => void;
}

/**
 * Command definition provided by a plugin
 */
export interface PluginCommand {
	/** Command name (used as subcommand) */
	name: string;
	/** Command description */
	description: string;
	/** Command aliases */
	aliases?: string[];
	/** Command options */
	options?: PluginCommandOption[];
	/** Command arguments */
	arguments?: PluginCommandArgument[];
	/** Command action handler */
	action: (args: Record<string, unknown>, options: Record<string, unknown>) => Promise<void>;
}

/**
 * Command option definition
 */
export interface PluginCommandOption {
	flags: string;
	description: string;
	defaultValue?: unknown;
	required?: boolean;
}

/**
 * Command argument definition
 */
export interface PluginCommandArgument {
	name: string;
	description: string;
	required?: boolean;
	defaultValue?: unknown;
}

/**
 * Hook definition for plugin lifecycle events
 */
export interface PluginHook {
	/** Hook name */
	name: string;
	/** When to execute: before/after a specific event */
	when: "before" | "after";
	/** Event to hook into */
	event: HookEvent;
	/** Hook handler */
	handler: (context: HookContext) => Promise<void> | void;
}

/**
 * Events that plugins can hook into
 */
export type HookEvent =
	| "agent:start"
	| "agent:stop"
	| "agent:message"
	| "agent:tool_call"
	| "agent:tool_result"
	| "session:start"
	| "session:end"
	| "config:load"
	| "config:save";

/**
 * Context provided to hook handlers
 */
export interface HookContext {
	/** Event name */
	event: HookEvent;
	/** Event data (varies by event) */
	data: unknown;
	/** Mutable state that hooks can modify */
	state: Record<string, unknown>;
	/** Plugin configuration */
	config: Record<string, unknown>;
}

/**
 * Theme definition provided by a plugin
 */
export interface PluginTheme {
	/** Theme name */
	name: string;
	/** Theme colors */
	colors: {
		primary?: string;
		secondary?: string;
		accent?: string;
		background?: string;
		foreground?: string;
		success?: string;
		warning?: string;
		error?: string;
		info?: string;
	};
}

/**
 * Custom provider definition from a plugin
 */
export interface PluginProvider {
	/** Provider name */
	name: string;
	/** Display name */
	displayName: string;
	/** Base URL for the API */
	baseUrl: string;
	/** Whether an API key is required */
	requiresApiKey: boolean;
	/** Available models */
	models: Array<{
		name: string;
		displayName: string;
		contextWindow: number;
	}>;
}

/**
 * The main plugin interface that all Tehuti plugins must implement
 */
export interface TehutiPlugin {
	/** Plugin manifest/metadata */
	manifest: PluginManifest;

	/**
	 * Called when the plugin is loaded.
	 * Use this to initialize resources.
	 */
	onLoad?: (api: PluginAPI) => Promise<void> | void;

	/**
	 * Called when the plugin is activated.
	 * Return any tools, commands, hooks, themes, or providers.
	 */
	onActivate?: (api: PluginAPI) => PluginContributions | Promise<PluginContributions>;

	/**
	 * Called when the plugin is deactivated.
	 * Clean up any resources here.
	 */
	onDeactivate?: () => Promise<void> | void;

	/**
	 * Called when the plugin is unloaded.
	 * Final cleanup before removal.
	 */
	onUnload?: () => Promise<void> | void;
}

/**
 * Contributions returned by a plugin on activation
 */
export interface PluginContributions {
	/** Tools provided by the plugin */
	tools?: PluginTool[];
	/** CLI commands provided by the plugin */
	commands?: PluginCommand[];
	/** Event hooks */
	hooks?: PluginHook[];
	/** UI themes */
	themes?: PluginTheme[];
	/** API providers */
	providers?: PluginProvider[];
}

/**
 * API provided to plugins for interacting with Tehuti
 */
export interface PluginAPI {
	/** Tehuti version */
	version: string;
	/** Register a tool */
	registerTool: (tool: PluginTool) => void;
	/** Register a command */
	registerCommand: (command: PluginCommand) => void;
	/** Register a hook */
	registerHook: (hook: PluginHook) => void;
	/** Register a theme */
	registerTheme: (theme: PluginTheme) => void;
	/** Register a provider */
	registerProvider: (provider: PluginProvider) => void;
	/** Get plugin configuration */
	getConfig: <T = Record<string, unknown>>(key?: string) => T;
	/** Set plugin configuration */
	setConfig: (key: string, value: unknown) => void;
	/** Logger for the plugin */
	logger: PluginLogger;
	/** Current working directory */
	cwd: string;
	/** Check if a tool exists */
	hasTool: (name: string) => boolean;
	/** Call another tool */
	callTool: (name: string, args: Record<string, unknown>) => Promise<PluginToolResult>;
	/** Get session ID */
	getSessionId: () => string;
}

/**
 * Plugin state in the registry
 */
export interface PluginState {
	/** Plugin manifest */
	manifest: PluginManifest;
	/** Current lifecycle phase */
	phase: PluginPhase;
	/** Whether the plugin is enabled */
	enabled: boolean;
	/** Plugin instance */
	instance: TehutiPlugin | null;
	/** Contributions from the plugin */
	contributions: PluginContributions | null;
	/** Load error if any */
	error: string | null;
	/** Load time in milliseconds */
	loadTimeMs: number;
}
