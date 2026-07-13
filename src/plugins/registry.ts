/**
 * Tehuti Plugin Registry
 *
 * Manages plugin lifecycle, activation, and contribution aggregation.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type {
	PluginState,
	PluginTool,
	PluginCommand,
	PluginHook,
	PluginTheme,
	PluginProvider,
	PluginAPI,
	PluginLogger,
	PluginToolResult,
} from "./types.js";
import { PluginLoader } from "./loader.js";
import { logger } from "../utils/logger.js";

export class PluginRegistry {
	private plugins = new Map<string, PluginState>();
	private tehutiVersion: string;
	private cwd: string;
	private sessionId: string;
	private configStore = new Map<string, Record<string, unknown>>();
	private toolCallHandler?: (
		name: string,
		args: Record<string, unknown>,
	) => Promise<PluginToolResult>;

	constructor(tehutiVersion: string, cwd: string, sessionId: string) {
		this.tehutiVersion = tehutiVersion;
		this.cwd = cwd;
		this.sessionId = sessionId;
	}

	/**
	 * Set the tool call handler for plugin-to-plugin tool calls
	 */
	setToolCallHandler(
		handler: (
			name: string,
			args: Record<string, unknown>,
		) => Promise<PluginToolResult>,
	): void {
		this.toolCallHandler = handler;
	}

	/**
	 * Discover and load all plugins from the plugins directory
	 */
	async discoverAndLoad(pluginsDir?: string): Promise<void> {
		const dir =
			pluginsDir || path.join(os.homedir(), ".tehuti", "plugins");

		const pluginPaths = await PluginLoader.discoverPlugins(dir);

		for (const pluginPath of pluginPaths) {
			const state = await PluginLoader.loadPlugin({
				pluginPath,
				tehutiVersion: this.tehutiVersion,
				cwd: this.cwd,
			});

			this.plugins.set(state.manifest.name, state);
		}
	}

	/**
	 * Load a specific plugin from path
	 */
	async loadPlugin(pluginPath: string): Promise<PluginState> {
		const state = await PluginLoader.loadPlugin({
			pluginPath,
			tehutiVersion: this.tehutiVersion,
			cwd: this.cwd,
		});

		this.plugins.set(state.manifest.name, state);
		return state;
	}

	/**
	 * Activate a plugin by name
	 */
	async activate(pluginName: string): Promise<void> {
		const state = this.plugins.get(pluginName);
		if (!state) {
			throw new Error(`Plugin not found: ${pluginName}`);
		}

		if (!state.instance) {
			throw new Error(`Plugin ${pluginName} failed to load: ${state.error}`);
		}

		if (!state.enabled) {
			throw new Error(`Plugin ${pluginName} is disabled`);
		}

		try {
			// Call onLoad if defined
			if (state.instance.onLoad) {
				const api = this.createPluginAPI(pluginName);
				await state.instance.onLoad(api);
			}

			// Call onActivate if defined
			if (state.instance.onActivate) {
				const api = this.createPluginAPI(pluginName);
				const contributions = await state.instance.onActivate(api);

				// Validate contributions
				const warnings =
					PluginLoader.validateContributions(contributions);
				for (const warning of warnings) {
					logger.warn(`Plugin ${pluginName}: ${warning}`);
				}

				state.contributions = contributions;
			}

			state.phase = "activate";
			logger.success(`Plugin activated: ${pluginName}`);
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			state.error = errorMessage;
			logger.error(`Failed to activate plugin ${pluginName}: ${errorMessage}`);
			throw error;
		}
	}

	/**
	 * Deactivate a plugin by name
	 */
	async deactivate(pluginName: string): Promise<void> {
		const state = this.plugins.get(pluginName);
		if (!state) {
			throw new Error(`Plugin not found: ${pluginName}`);
		}

		if (!state.instance) {
			return;
		}

		try {
			if (state.instance.onDeactivate) {
				await state.instance.onDeactivate();
			}

			state.contributions = null;
			state.phase = "deactivate";
			logger.info(`Plugin deactivated: ${pluginName}`);
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			logger.error(
				`Failed to deactivate plugin ${pluginName}: ${errorMessage}`,
			);
			throw error;
		}
	}

	/**
	 * Unload a plugin by name
	 */
	async unload(pluginName: string): Promise<void> {
		const state = this.plugins.get(pluginName);
		if (!state) {
			return;
		}

		// Deactivate first if active
		if (state.phase === "activate") {
			await this.deactivate(pluginName);
		}

		if (state.instance?.onUnload) {
			await state.instance.onUnload();
		}

		this.plugins.delete(pluginName);
		logger.info(`Plugin unloaded: ${pluginName}`);
	}

	/**
	 * Enable a plugin
	 */
	enable(pluginName: string): void {
		const state = this.plugins.get(pluginName);
		if (!state) {
			throw new Error(`Plugin not found: ${pluginName}`);
		}
		state.enabled = true;
	}

	/**
	 * Disable a plugin
	 */
	disable(pluginName: string): void {
		const state = this.plugins.get(pluginName);
		if (!state) {
			throw new Error(`Plugin not found: ${pluginName}`);
		}
		state.enabled = false;
	}

	/**
	 * Get all registered tools from active plugins
	 */
	getAllTools(): PluginTool[] {
		const tools: PluginTool[] = [];

		for (const state of this.plugins.values()) {
			if (state.phase === "activate" && state.contributions?.tools) {
				tools.push(...state.contributions.tools);
			}
		}

		return tools;
	}

	/**
	 * Get all registered commands from active plugins
	 */
	getAllCommands(): PluginCommand[] {
		const commands: PluginCommand[] = [];

		for (const state of this.plugins.values()) {
			if (state.phase === "activate" && state.contributions?.commands) {
				commands.push(...state.contributions.commands);
			}
		}

		return commands;
	}

	/**
	 * Get all registered hooks from active plugins
	 */
	getAllHooks(): PluginHook[] {
		const hooks: PluginHook[] = [];

		for (const state of this.plugins.values()) {
			if (state.phase === "activate" && state.contributions?.hooks) {
				hooks.push(...state.contributions.hooks);
			}
		}

		return hooks;
	}

	/**
	 * Get all registered themes from active plugins
	 */
	getAllThemes(): PluginTheme[] {
		const themes: PluginTheme[] = [];

		for (const state of this.plugins.values()) {
			if (state.phase === "activate" && state.contributions?.themes) {
				themes.push(...state.contributions.themes);
			}
		}

		return themes;
	}

	/**
	 * Get all registered providers from active plugins
	 */
	getAllProviders(): PluginProvider[] {
		const providers: PluginProvider[] = [];

		for (const state of this.plugins.values()) {
			if (state.phase === "activate" && state.contributions?.providers) {
				providers.push(...state.contributions.providers);
			}
		}

		return providers;
	}

	/**
	 * Get plugin state by name
	 */
	getPlugin(pluginName: string): PluginState | undefined {
		return this.plugins.get(pluginName);
	}

	/**
	 * Get all plugins
	 */
	getAllPlugins(): PluginState[] {
		return Array.from(this.plugins.values());
	}

	/**
	 * Get active plugins only
	 */
	getActivePlugins(): PluginState[] {
		return Array.from(this.plugins.values()).filter(
			(p) => p.phase === "activate" && p.enabled,
		);
	}

	/**
	 * Check if a tool exists in any active plugin
	 */
	hasTool(toolName: string): boolean {
		return this.getAllTools().some((t) => t.name === toolName);
	}

	/**
	 * Call a tool by name
	 */
	async callTool(
		toolName: string,
		args: Record<string, unknown>,
	): Promise<PluginToolResult> {
		const tool = this.getAllTools().find((t) => t.name === toolName);
		if (!tool) {
			return {
				success: false,
				error: `Tool not found: ${toolName}`,
			};
		}

		if (!this.toolCallHandler) {
			return {
				success: false,
				error: "Tool call handler not configured",
			};
		}

		return this.toolCallHandler(toolName, args);
	}

	/**
	 * Create a plugin API instance for a specific plugin
	 */
	private createPluginAPI(pluginName: string): PluginAPI {
		const pluginConfig =
			this.configStore.get(pluginName) ||
			({} as Record<string, unknown>);

		const pluginLogger: PluginLogger = {
			info: (msg: string, ...args: unknown[]) =>
				logger.info(`[${pluginName}] ${msg}`, ...args),
			warn: (msg: string, ...args: unknown[]) =>
				logger.warn(`[${pluginName}] ${msg}`, ...args),
			error: (msg: string, ...args: unknown[]) =>
				logger.error(`[${pluginName}] ${msg}`, ...args),
			debug: (msg: string, ...args: unknown[]) =>
				logger.debug(`[${pluginName}] ${msg}`, ...args),
		};

		return {
			version: this.tehutiVersion,
			registerTool: (tool: PluginTool) => {
				const state = this.plugins.get(pluginName);
				if (state && state.contributions) {
					state.contributions.tools = state.contributions.tools || [];
					state.contributions.tools.push(tool);
				}
			},
			registerCommand: (command: PluginCommand) => {
				const state = this.plugins.get(pluginName);
				if (state && state.contributions) {
					state.contributions.commands =
						state.contributions.commands || [];
					state.contributions.commands.push(command);
				}
			},
			registerHook: (hook: PluginHook) => {
				const state = this.plugins.get(pluginName);
				if (state && state.contributions) {
					state.contributions.hooks =
						state.contributions.hooks || [];
					state.contributions.hooks.push(hook);
				}
			},
			registerTheme: (theme: PluginTheme) => {
				const state = this.plugins.get(pluginName);
				if (state && state.contributions) {
					state.contributions.themes =
						state.contributions.themes || [];
					state.contributions.themes.push(theme);
				}
			},
			registerProvider: (provider: PluginProvider) => {
				const state = this.plugins.get(pluginName);
				if (state && state.contributions) {
					state.contributions.providers =
						state.contributions.providers || [];
					state.contributions.providers.push(provider);
				}
			},
			getConfig: <T = Record<string, unknown>>(key?: string): T => {
				if (key) {
					return pluginConfig[key] as T;
				}
				return pluginConfig as T;
			},
			setConfig: (key: string, value: unknown) => {
				pluginConfig[key] = value;
				this.configStore.set(pluginName, pluginConfig);
			},
			logger: pluginLogger,
			cwd: this.cwd,
			hasTool: (name: string) => this.hasTool(name),
			callTool: (name: string, args: Record<string, unknown>) =>
				this.callTool(name, args),
			getSessionId: () => this.sessionId,
		};
	}

	/**
	 * Save plugin configuration to disk
	 */
	saveConfig(): void {
		const configDir = path.join(os.homedir(), ".tehuti");
		if (!fs.existsSync(configDir)) {
			fs.mkdirSync(configDir, { recursive: true });
		}

		const configPath = path.join(configDir, "plugins.config.json");
		const config = Object.fromEntries(this.configStore);
		fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
	}

	/**
	 * Load plugin configuration from disk
	 */
	loadConfig(): void {
		const configPath = path.join(
			os.homedir(),
			".tehuti",
			"plugins.config.json",
		);

		if (fs.existsSync(configPath)) {
			const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
			for (const [key, value] of Object.entries(config)) {
				this.configStore.set(
					key,
					value as Record<string, unknown>,
				);
			}
		}
	}
}
