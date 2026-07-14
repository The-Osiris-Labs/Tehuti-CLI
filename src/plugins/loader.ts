/**
 * Tehuti Plugin Loader
 *
 * Responsible for discovering, loading, and validating plugins.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type {
	PluginManifest,
	TehutiPlugin,
	PluginState,
	PluginContributions,
} from "./types.js";
import { debug } from "../utils/debug.js";
import { logger } from "../utils/logger.js";
import { TehutiError } from "../utils/errors.js";

/** Default timeout for plugin initialization (10 seconds) */
const PLUGIN_INIT_TIMEOUT_MS = 10_000;

/**
 * Error thrown when a plugin fails to load.
 * Carries the plugin name and a structured error code for programmatic handling.
 */
export class PluginLoadError extends TehutiError {
	constructor(
		message: string,
		public pluginName: string,
		code = "PLUGIN_LOAD_ERROR",
	) {
		super(message, code, 1, false);
		this.name = "PluginLoadError";
	}
}

export interface PluginLoadOptions {
	/** Plugin directory path */
	pluginPath: string;
	/** Tehuti version for compatibility check */
	tehutiVersion: string;
	/** Current working directory */
	cwd: string;
}

export class PluginLoader {
	/**
	 * Discover plugins in a directory
	 */
	static async discoverPlugins(pluginsDir: string): Promise<string[]> {
		const plugins: string[] = [];

		if (!fs.existsSync(pluginsDir)) {
			return plugins;
		}

		const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });

		for (const entry of entries) {
			if (entry.isDirectory()) {
				const pluginPath = path.join(pluginsDir, entry.name);
				const manifestPath = path.join(pluginPath, "package.json");

				if (fs.existsSync(manifestPath)) {
					plugins.push(pluginPath);
				}
			}
		}

		return plugins;
	}

	/**
	 * Load and validate a plugin manifest
	 */
	static async loadManifest(pluginPath: string): Promise<PluginManifest> {
		const pluginName = path.basename(pluginPath);
		const manifestPath = path.join(pluginPath, "package.json");

		if (!fs.existsSync(manifestPath)) {
			throw new PluginLoadError(
				`Plugin manifest not found at: ${manifestPath}`,
				pluginName,
				"PLUGIN_MANIFEST_MISSING",
			);
		}

		let manifestJson: string;
		try {
			manifestJson = fs.readFileSync(manifestPath, "utf-8");
		} catch (error) {
			const err = error as NodeJS.ErrnoException;
			if (err.code === "EACCES") {
				throw new PluginLoadError(
					`Permission denied reading plugin manifest: ${manifestPath}`,
					pluginName,
					"PLUGIN_MANIFEST_PERMISSION_DENIED",
				);
			}
			throw new PluginLoadError(
				`Failed to read plugin manifest: ${err.message}`,
				pluginName,
				"PLUGIN_MANIFEST_READ_ERROR",
			);
		}

		let manifest: unknown;
		try {
			manifest = JSON.parse(manifestJson);
		} catch (error) {
			const err = error as SyntaxError;
			throw new PluginLoadError(
				`Invalid JSON in plugin manifest ${manifestPath}: ${err.message}`,
				pluginName,
				"PLUGIN_MANIFEST_PARSE_ERROR",
			);
		}

		if (typeof manifest !== "object" || manifest === null) {
			throw new PluginLoadError(
				`Plugin manifest must be a JSON object: ${manifestPath}`,
				pluginName,
				"PLUGIN_MANIFEST_INVALID",
			);
		}
		const m = manifest as Record<string, unknown>;

		// Validate required fields
		if (!m.name) {
			throw new PluginLoadError(
				`Plugin manifest missing required field "name": ${manifestPath}`,
				pluginName,
				"PLUGIN_MANIFEST_INVALID",
			);
		}
		if (!m.version) {
			throw new PluginLoadError(
				`Plugin manifest missing required field "version": ${manifestPath}`,
				pluginName,
				"PLUGIN_MANIFEST_INVALID",
			);
		}
		if (!m.description) {
			throw new PluginLoadError(
				`Plugin manifest missing required field "description": ${manifestPath}`,
				pluginName,
				"PLUGIN_MANIFEST_INVALID",
			);
		}

		return manifest as PluginManifest;
	}

	/**
	 * Load a plugin module
	 */
	static async loadPlugin(options: PluginLoadOptions): Promise<PluginState> {
		const startTime = Date.now();
		const { pluginPath, tehutiVersion } = options;
		const pluginName = path.basename(pluginPath);

		try {
			// Load manifest
			const manifest = await this.loadManifest(pluginPath);

			// Check version compatibility
			if (manifest.minTehutiVersion) {
				if (manifest.minTehutiVersion > tehutiVersion) {
					throw new PluginLoadError(
						`Plugin "${manifest.name}" requires Tehuti >= ${manifest.minTehutiVersion}, but running ${tehutiVersion}`,
						manifest.name,
						"PLUGIN_VERSION_MISMATCH",
					);
				}
			}

			// Validate plugin dependencies
			if (manifest.dependencies?.length) {
				for (const dep of manifest.dependencies) {
					const depPath = path.join(path.dirname(pluginPath), dep);
					if (!fs.existsSync(depPath)) {
						throw new PluginLoadError(
							`Plugin "${manifest.name}" requires missing dependency: "${dep}"`,
							manifest.name,
							"PLUGIN_MISSING_DEPENDENCY",
						);
					}
				}
			}

			// Load plugin entry point
			const entryPoint = manifest.main || "index.js";
			const entryPath = path.join(pluginPath, entryPoint);

			if (!fs.existsSync(entryPath)) {
				throw new PluginLoadError(
					`Plugin "${manifest.name}" entry point not found: ${entryPath}`,
					manifest.name,
					"PLUGIN_ENTRY_MISSING",
				);
			}

			// Dynamic import — runtime-selected plugin path (exception to static-import rule)
			let module: Record<string, unknown>;
			try {
				module = await import(entryPath);
			} catch (error) {
				const err = error as NodeJS.ErrnoException & { code?: string };
				const pluginNameForError = manifest.name;
				if (
					err.code === "MODULE_NOT_FOUND" ||
					err.code === "ERR_MODULE_NOT_FOUND"
				) {
					throw new PluginLoadError(
						`Plugin "${pluginNameForError}" requires missing dependency: ${err.message}`,
						pluginNameForError,
						"PLUGIN_MISSING_DEPENDENCY",
					);
				}
				throw new PluginLoadError(
					`Plugin "${pluginNameForError}" failed to import module: ${err.message}`,
					pluginNameForError,
					"PLUGIN_IMPORT_ERROR",
				);
			}

			const plugin = (module.default ?? module) as TehutiPlugin;

			// Validate plugin structure
			if (!plugin.manifest) {
				throw new PluginLoadError(
					`Plugin "${manifest.name}" does not export a valid manifest`,
					manifest.name,
					"PLUGIN_INVALID_EXPORT",
				);
			}

			// Call onLoad with timeout
			if (plugin.onLoad) {
				const initPromise = plugin.onLoad({} as never);
				const timeoutPromise = new Promise<never>((_, reject) =>
					setTimeout(
						() =>
							reject(
								new PluginLoadError(
									`Plugin "${manifest.name}" activation timed out after ${PLUGIN_INIT_TIMEOUT_MS / 1000}s`,
									manifest.name,
									"PLUGIN_ACTIVATION_TIMEOUT",
								),
							),
						PLUGIN_INIT_TIMEOUT_MS,
					),
				);
				await Promise.race([Promise.resolve(initPromise), timeoutPromise]);
			}

			const loadTimeMs = Date.now() - startTime;

			debug.log("agent", `Loaded plugin ${manifest.name} in ${loadTimeMs}ms`);

			return {
				manifest,
				phase: "load",
				enabled: manifest.enabledByDefault !== false,
				instance: plugin,
				contributions: null,
				error: null,
				loadTimeMs,
			};
		} catch (error) {
			const loadTimeMs = Date.now() - startTime;

			// PluginLoadError already has structured info — preserve it
			if (error instanceof PluginLoadError) {
				logger.error(`Failed to load plugin: ${error.message}`);
				return {
					manifest: {
						name: error.pluginName || pluginName,
						displayName: error.pluginName || pluginName,
						version: "0.0.0",
						description: "Failed to load",
					},
					phase: "load",
					enabled: false,
					instance: null,
					contributions: null,
					error: error.message,
					loadTimeMs,
				};
			}

			// Unexpected error — wrap it
			const errorMessage = error instanceof Error ? error.message : String(error);
			const wrappedError = new PluginLoadError(
				`Plugin "${pluginName}" failed to load: ${errorMessage}`,
				pluginName,
				"PLUGIN_LOAD_ERROR",
			);
			logger.error(`Failed to load plugin: ${wrappedError.message}`);

			return {
				manifest: {
					name: pluginName,
					displayName: pluginName,
					version: "0.0.0",
					description: "Failed to load",
				},
				phase: "load",
				enabled: false,
				instance: null,
				contributions: null,
				error: wrappedError.message,
				loadTimeMs,
			};
		}
	}

	/**
	 * Validate a plugin's contributions
	 */
	static validateContributions(
		contributions: PluginContributions,
	): string[] {
		const warnings: string[] = [];

		// Check for tool name conflicts
		if (contributions.tools) {
			const toolNames = new Set<string>();
			for (const tool of contributions.tools) {
				if (toolNames.has(tool.name)) {
					warnings.push(`Duplicate tool name: ${tool.name}`);
				}
				toolNames.add(tool.name);

				if (!tool.description) {
					warnings.push(`Tool ${tool.name} missing description`);
				}
				if (!tool.parameters) {
					warnings.push(`Tool ${tool.name} missing parameters schema`);
				}
			}
		}

		// Check for command name conflicts
		if (contributions.commands) {
			const commandNames = new Set<string>();
			for (const cmd of contributions.commands) {
				if (commandNames.has(cmd.name)) {
					warnings.push(`Duplicate command name: ${cmd.name}`);
				}
				commandNames.add(cmd.name);
			}
		}

		return warnings;
	}
}
