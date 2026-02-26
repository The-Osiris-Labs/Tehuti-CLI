import Conf from "conf";
import { cosmiconfig } from "cosmiconfig";
import { z } from "zod";
import { consola } from "../utils/logger.js";
import {
	DEFAULT_CONFIG,
	TEHUTI_CONFIG_SCHEMA,
	type TehutiConfig,
} from "./schema.js";

const MODULE_NAME = "tehuti";

const globalConfig = new Conf<{
	apiKey?: string;
	model?: string;
	initialized?: boolean;
}>({
	projectName: MODULE_NAME,
	defaults: {
		initialized: false,
	},
});

let yamlParser: ((content: string) => unknown) | null = null;

function getYamlParser(): ((content: string) => unknown) | null {
	if (yamlParser) return yamlParser;
	try {
		yamlParser = require("yaml").parse;
		return yamlParser;
	} catch {
		return null;
	}
}

const explorer = cosmiconfig(MODULE_NAME, {
	searchPlaces: [
		".tehuti.json",
		".tehuti.yaml",
		".tehuti.yml",
		".tehuti.js",
		".tehuti.mjs",
		".tehuti.cjs",
		"package.json",
	],
	loaders: {
		".json": (_path: string, content: string) => JSON.parse(content),
		".yaml": (_path: string, content: string) => {
			const parser = getYamlParser();
			if (parser) return parser(content);
			throw new Error("YAML config files require 'yaml' package. Install it or use .tehuti.json instead.");
		},
		".yml": (_path: string, content: string) => {
			const parser = getYamlParser();
			if (parser) return parser(content);
			throw new Error("YAML config files require 'yaml' package. Install it or use .tehuti.json instead.");
		},
		".js": (_path: string, content: string) => content,
		".mjs": (_path: string, content: string) => content,
		".cjs": (_path: string, content: string) => content,
	},
});

function resolveEnvVars(value: string): string {
	if (value.startsWith("${") && value.endsWith("}")) {
		const inner = value.slice(2, -1);
		const colonIndex = inner.indexOf(":-");
		if (colonIndex !== -1) {
			const varName = inner.slice(0, colonIndex);
			const defaultValue = inner.slice(colonIndex + 2);
			return process.env[varName] || defaultValue;
		}
		return process.env[inner] || value;
	}
	if (value.startsWith("$") && !value.startsWith("${")) {
		const varName = value.slice(1);
		return process.env[varName] || value;
	}
	return value;
}

function resolveConfigEnvVars(
	config: Record<string, unknown>,
): Record<string, unknown> {
	const resolved: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(config)) {
		if (typeof value === "string") {
			resolved[key] = resolveEnvVars(value);
		} else if (
			typeof value === "object" &&
			value !== null &&
			!Array.isArray(value)
		) {
			resolved[key] = resolveConfigEnvVars(value as Record<string, unknown>);
		} else {
			resolved[key] = value;
		}
	}

	return resolved;
}

export async function loadConfig(
	cwd: string = process.cwd(),
): Promise<TehutiConfig> {
	let fileConfig: Record<string, unknown> = {};

	try {
		const result = await explorer.search(cwd);
		if (result?.config) {
			fileConfig = result.config;
			consola.debug(`Loaded config from: ${result.filepath}`);
		}
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		consola.warn(`Failed to load config file: ${errorMessage}`);
	}

	const envApiKey =
		process.env.OPENROUTER_API_KEY || process.env.TEHUTI_API_KEY || process.env.KILO_API_KEY;
	const envModel = process.env.TEHUTI_MODEL;
	const envDebug = process.env.TEHUTI_DEBUG === "true";

	const mergedConfig: Record<string, unknown> = {
		...DEFAULT_CONFIG,
		...resolveConfigEnvVars(fileConfig),
		...(globalConfig.get("model") && { model: globalConfig.get("model") }),
		...(envModel && { model: envModel }),
		...(envDebug && { debug: true }),
	};
	
 	// Handle API key with provider-specific logic
 	const provider = mergedConfig.provider as string;
 	if (provider === "kilocode") {
 		const kiloApiKey = process.env.KILO_API_KEY || process.env.OPENROUTER_API_KEY || process.env.TEHUTI_API_KEY;
 		if (kiloApiKey) {
 			mergedConfig.apiKey = kiloApiKey;
 		} else if (fileConfig.apiKey) {
 			mergedConfig.apiKey = fileConfig.apiKey;
 		} else {
 			mergedConfig.apiKey = globalConfig.get("apiKey");
 		}
 	} else {
 		// For other providers, use standard API key logic
 		mergedConfig.apiKey = envApiKey ?? fileConfig.apiKey ?? globalConfig.get("apiKey");
 	}

	try {
		const parsed = TEHUTI_CONFIG_SCHEMA.parse(mergedConfig);
		return parsed;
	} catch (error) {
		if (error instanceof z.ZodError) {
			consola.warn(
				"Config validation errors:",
				error.errors.map((e) => e.message).join(", "),
			);
		}
		return DEFAULT_CONFIG;
	}
}

export function saveGlobalConfig(updates: {
	apiKey?: string;
	model?: string;
}): void {
	if (updates.apiKey) {
		globalConfig.set("apiKey", updates.apiKey);
	}
	if (updates.model) {
		globalConfig.set("model", updates.model);
	}
	globalConfig.set("initialized", true);
}

export function getGlobalConfig(): {
	apiKey?: string;
	model?: string;
	initialized?: boolean;
} {
	return {
		apiKey: globalConfig.get("apiKey"),
		model: globalConfig.get("model"),
		initialized: globalConfig.get("initialized"),
	};
}

export function isInitialized(): boolean {
	return globalConfig.get("initialized") ?? false;
}

export function resetGlobalConfig(): void {
	globalConfig.clear();
}

export { globalConfig };
