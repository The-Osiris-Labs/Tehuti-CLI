/**
 * Tehuti Plugin System
 *
 * Provides a complete plugin architecture for extending Tehuti CLI.
 * Plugins can add tools, commands, hooks, themes, and providers.
 */

export type {
	PluginPhase,
	PluginManifest,
	PluginTool,
	PluginToolContext,
	PluginToolResult,
	PluginLogger,
	PluginCommand,
	PluginCommandOption,
	PluginCommandArgument,
	PluginHook,
	HookEvent,
	HookContext,
	PluginTheme,
	PluginProvider,
	TehutiPlugin,
	PluginContributions,
	PluginAPI,
	PluginState,
} from "./types.js";

export { PluginLoader } from "./loader.js";
export { PluginRegistry } from "./registry.js";

// Singleton registry instance
let globalRegistry: PluginRegistry | null = null;

/**
 * Initialize the global plugin registry
 */
export function initializePlugins(
	tehutiVersion: string,
	cwd: string,
	sessionId: string,
): PluginRegistry {
	if (!globalRegistry) {
		globalRegistry = new PluginRegistry(tehutiVersion, cwd, sessionId);
	}
	return globalRegistry;
}

/**
 * Get the global plugin registry
 */
export function getPluginRegistry(): PluginRegistry | null {
	return globalRegistry;
}
