/**
 * Public Plugin API for Third-Party Tehuti Plugins
 *
 * This module defines the typed interfaces that plugin authors use to extend
 * Tehuti CLI. It provides a simplified, stable surface separate from the
 * internal plugin system types.
 *
 * @example
 * ```typescript
 * import type { TehutiPluginAPI, PluginContext } from 'tehuti/sdk/plugin-api';
 *
 * export const plugin: TehutiPluginAPI = {
 *   name: 'my-plugin',
 *   version: '1.0.0',
 *   async onLoad(ctx: PluginContext) {
 *     ctx.log('info', 'Plugin loaded');
 *   },
 *   async onActivate(ctx: PluginContext) {
 *     ctx.registerTool({
 *       name: 'greet',
 *       description: 'Greet a user',
 *       parameters: { type: 'object', properties: { name: { type: 'string' } } },
 *       execute: async (args) => ({ content: [{ type: 'text', text: `Hello ${args.name}` }] }),
 *     });
 *   },
 * };
 * ```
 */

import type { ToolDefinition } from "../agent/tools/registry.js";

/**
 * A hook handler function. Hooks receive typed arguments and return a result.
 */
export type HookHandler = (args: unknown) => Promise<unknown>;

/**
 * Context provided to a plugin during lifecycle callbacks.
 * Offers controlled access to the host runtime.
 */
export interface PluginContext {
	/** Register a new tool with the host */
	registerTool(tool: ToolDefinition): void;

	/** Read the plugin's configuration (falls back to empty object) */
	getConfig(): Record<string, unknown>;

	/** Emit a structured log at the given severity */
	log(level: "info" | "warn" | "error", message: string): void;

	/** Emit an event that other plugins or the host can listen to */
	emit(event: string, data?: unknown): void;

	/** Subscribe to events emitted by the host or other plugins */
	on(event: string, handler: (data: unknown) => void): void;
}

/**
 * The public contract that every third-party Tehuti plugin must satisfy.
 *
 * Plugins declare metadata and optional lifecycle callbacks; the host
 * invokes them at the appropriate points in the plugin lifecycle.
 */
export interface TehutiPluginAPI {
	/** Unique plugin identifier (e.g. "tehuti-plugin-docker") */
	name: string;

	/** Semantic version string */
	version: string;

	/**
	 * Called once when the plugin is first loaded into memory.
	 * Use for one-time initialisation (resource acquisition, config parsing).
	 */
	onLoad?(ctx: PluginContext): Promise<void>;

	/**
	 * Called each time the plugin transitions to the active state.
	 * Register tools, hooks, and other contributions here.
	 */
	onActivate?(ctx: PluginContext): Promise<void>;

	/**
	 * Called when the plugin is being deactivated.
	 * Release resources and unsubscribe from events.
	 */
	onDeactivate?(): Promise<void>;

	/** Tools contributed by this plugin (may also be registered via ctx.registerTool) */
	tools?: ToolDefinition[];

	/** Named hook handlers keyed by hook identifier */
	hooks?: Record<string, HookHandler>;
}
