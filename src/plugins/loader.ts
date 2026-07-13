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
		const manifestPath = path.join(pluginPath, "package.json");

		if (!fs.existsSync(manifestPath)) {
			throw new Error(`Plugin manifest not found: ${manifestPath}`);
		}

		const manifestJson = fs.readFileSync(manifestPath, "utf-8");
		const manifest = JSON.parse(manifestJson);

		// Validate required fields
		if (!manifest.name) {
			throw new Error("Plugin manifest missing required field: name");
		}
		if (!manifest.version) {
			throw new Error("Plugin manifest missing required field: version");
		}
		if (!manifest.description) {
			throw new Error("Plugin manifest missing required field: description");
		}

		return manifest as PluginManifest;
	}

	/**
	 * Load a plugin module
	 */
	static async loadPlugin(options: PluginLoadOptions): Promise<PluginState> {
		const startTime = Date.now();
		const { pluginPath, tehutiVersion } = options;

		try {
			// Load manifest
			const manifest = await this.loadManifest(pluginPath);

			// Check version compatibility
			if (manifest.minTehutiVersion) {
				// Simple version check (could be enhanced with semver)
				if (manifest.minTehutiVersion > tehutiVersion) {
					throw new Error(
						`Plugin requires Tehuti >= ${manifest.minTehutiVersion}, but running ${tehutiVersion}`,
					);
				}
			}

			// Load plugin entry point
			const entryPoint = manifest.main || "index.js";
			const entryPath = path.join(pluginPath, entryPoint);

			if (!fs.existsSync(entryPath)) {
				throw new Error(`Plugin entry point not found: ${entryPath}`);
			}

			// Dynamic import
			const module = await import(entryPath);
			const plugin: TehutiPlugin = module.default || module;

			// Validate plugin structure
			if (!plugin.manifest) {
				throw new Error("Plugin does not export a valid manifest");
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
			const errorMessage = error instanceof Error ? error.message : String(error);

			logger.error(`Failed to load plugin: ${errorMessage}`);

			return {
				manifest: {
					name: path.basename(pluginPath),
					displayName: path.basename(pluginPath),
					version: "0.0.0",
					description: "Failed to load",
				},
				phase: "load",
				enabled: false,
				instance: null,
				contributions: null,
				error: errorMessage,
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
