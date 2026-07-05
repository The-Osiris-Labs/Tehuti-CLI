import os from "node:os";
import path from "node:path";
import Conf from "conf";
import { cosmiconfig } from "cosmiconfig";
import { consola } from "../utils/logger.js";
import {
	getApiKeyEnvVarsForProvider,
	resolveBaseUrlForProvider,
} from "./providers.js";
import {
	DEFAULT_CONFIG,
	TEHUTI_CONFIG_SCHEMA,
	type TehutiConfig,
} from "./schema.js";

const MODULE_NAME = "tehuti";
export const configWarnings: string[] = [];
const CONFIG_CWD =
	process.env.TEHUTI_CONFIG_DIR ||
	(process.env.VITEST
		? path.join(os.tmpdir(), "tehuti-vitest-config")
		: undefined);

const globalConfig = new Conf<{
	apiKey?: string;
	model?: string;
	provider?: string;
	baseUrl?: string;
	customProvider?: Record<string, unknown>;
	temperature?: number;
	maxTokens?: number;
	initialized?: boolean;
	recentCommands?: string[];
}>({
	projectName: MODULE_NAME,
	...(CONFIG_CWD ? { cwd: CONFIG_CWD } : {}),
	defaults: {
		initialized: false,
		recentCommands: [],
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
			throw new Error(
				"YAML config files require 'yaml' package. Install it or use .tehuti.json instead.",
			);
		},
		".yml": (_path: string, content: string) => {
			const parser = getYamlParser();
			if (parser) return parser(content);
			throw new Error(
				"YAML config files require 'yaml' package. Install it or use .tehuti.json instead.",
			);
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

	const envModel = process.env.TEHUTI_MODEL;
	const envBaseUrl = process.env.TEHUTI_BASE_URL?.trim();
	const envDebug = process.env.TEHUTI_DEBUG === "true";
	const envProvider = process.env.TEHUTI_PROVIDER?.trim();
	const envCustomProvider = process.env.TEHUTI_CUSTOM_PROVIDER;
	const resolvedFileConfig = resolveConfigEnvVars(fileConfig);
	const fileProvider =
		typeof resolvedFileConfig.provider === "string"
			? resolvedFileConfig.provider.trim()
			: undefined;
	const persistedProvider = globalConfig.get("provider")?.trim();
	const providerSource = envProvider
		? "env"
		: fileProvider
			? "file"
			: persistedProvider
				? "global"
				: "default";

	const provider = (envProvider ||
		fileProvider ||
		persistedProvider ||
		DEFAULT_CONFIG.provider) as string;

	let parsedEnvCustomProvider: unknown;
	if (envCustomProvider) {
		try {
			parsedEnvCustomProvider = JSON.parse(envCustomProvider);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			consola.warn(`Ignoring invalid TEHUTI_CUSTOM_PROVIDER JSON: ${message}`);
		}
	}

	const mergedConfig: Record<string, unknown> = {
		...DEFAULT_CONFIG,
		...(globalConfig.get("model") && { model: globalConfig.get("model") }),
		...(globalConfig.get("provider") && {
			provider: globalConfig.get("provider"),
		}),
		...(globalConfig.get("baseUrl") && {
			baseUrl: globalConfig.get("baseUrl"),
		}),
		...(globalConfig.get("customProvider") && {
			customProvider: globalConfig.get("customProvider"),
		}),
		...(globalConfig.get("temperature") !== undefined && {
			temperature: globalConfig.get("temperature"),
		}),
		...(globalConfig.get("maxTokens") !== undefined && {
			maxTokens: globalConfig.get("maxTokens"),
		}),
		...resolvedFileConfig,
		...(envModel && { model: envModel }),
		provider,
		...(parsedEnvCustomProvider !== undefined && {
			customProvider: parsedEnvCustomProvider,
		}),
		...(envDebug && { debug: true }),
	};

	const fileBaseUrl =
		typeof resolvedFileConfig.baseUrl === "string"
			? resolvedFileConfig.baseUrl
			: undefined;
	const persistedBaseUrl = globalConfig.get("baseUrl");
	const pairedBaseUrl =
		providerSource === "file"
			? fileBaseUrl
			: providerSource === "global"
				? persistedBaseUrl
				: undefined;
	mergedConfig.baseUrl = envBaseUrl
		? envBaseUrl.replace(/\/+$/, "")
		: resolveBaseUrlForProvider(provider, pairedBaseUrl);

	// Handle API key - provider-specific env vars take precedence over
	// unrelated provider keys, while local config remains valid fallback.
	const currentProvider = mergedConfig.provider as string;
	const configuredApiKey =
		(typeof resolvedFileConfig.apiKey === "string"
			? resolvedFileConfig.apiKey
			: undefined) ?? globalConfig.get("apiKey");

	const envVars = getApiKeyEnvVarsForProvider(currentProvider);
	const directEnvVar = envVars[0];
	const highPriorityKey =
		process.env.TEHUTI_API_KEY ||
		(directEnvVar ? process.env[directEnvVar] : undefined);
	const lowPriorityKey = envVars
		.slice(1)
		.reduce<string | undefined>((acc, key) => {
			if (acc) return acc;
			if (key === "TEHUTI_API_KEY") return undefined;
			return process.env[key];
		}, undefined);

	mergedConfig.apiKey = highPriorityKey || configuredApiKey || lowPriorityKey;

	if (
		highPriorityKey &&
		configuredApiKey &&
		highPriorityKey !== configuredApiKey
	) {
		const overriddenBy = process.env.TEHUTI_API_KEY
			? "TEHUTI_API_KEY"
			: directEnvVar || "provider env var";
		const msg = `Using ${overriddenBy} from environment, which overrides the configured API key in ~/.tehuti.json.`;
		consola.warn(msg);
		configWarnings.push(msg);
	}

	const result = TEHUTI_CONFIG_SCHEMA.safeParse(mergedConfig);
	if (result.success) {
		return result.data;
	}

	consola.warn(
		"Config validation errors. Falling back to defaults for invalid fields:",
		result.error.errors
			.map((e) => `${e.path.join(".")}: ${e.message}`)
			.join(", "),
	);

	const salvagedConfig = { ...mergedConfig };
	for (const err of result.error.errors) {
		if (err.path.length > 0) {
			const key = err.path[0] as keyof TehutiConfig;
			salvagedConfig[key] = DEFAULT_CONFIG[key];
		}
	}

	const fallbackResult = TEHUTI_CONFIG_SCHEMA.safeParse(salvagedConfig);
	return fallbackResult.success ? fallbackResult.data : DEFAULT_CONFIG;
}

export function saveGlobalConfig(updates: {
	apiKey?: string | null;
	model?: string | null;
	provider?: string | null;
	baseUrl?: string | null;
	customProvider?: Record<string, unknown> | null;
	temperature?: number | null;
	maxTokens?: number | null;
}): void {
	if ("apiKey" in updates) {
		if (updates.apiKey) {
			globalConfig.set("apiKey", updates.apiKey);
		} else {
			globalConfig.delete("apiKey");
		}
	}
	if ("model" in updates) {
		if (updates.model) {
			globalConfig.set("model", updates.model);
		} else {
			globalConfig.delete("model");
		}
	}
	if ("temperature" in updates) {
		if (
			typeof updates.temperature === "number" &&
			updates.temperature >= 0 &&
			updates.temperature <= 2
		) {
			globalConfig.set("temperature", updates.temperature);
		} else {
			globalConfig.delete("temperature");
		}
	}
	if ("maxTokens" in updates) {
		if (typeof updates.maxTokens === "number" && updates.maxTokens > 0) {
			globalConfig.set("maxTokens", updates.maxTokens);
		} else {
			globalConfig.delete("maxTokens");
		}
	}
	if ("provider" in updates) {
		if (updates.provider) {
			globalConfig.set("provider", updates.provider);
		} else {
			globalConfig.delete("provider");
		}
	}
	if ("baseUrl" in updates) {
		if (updates.baseUrl) {
			globalConfig.set("baseUrl", updates.baseUrl.replace(/\/+$/, ""));
		} else {
			globalConfig.delete("baseUrl");
		}
	}
	if ("customProvider" in updates) {
		if (updates.customProvider) {
			globalConfig.set("customProvider", updates.customProvider);
		} else {
			globalConfig.delete("customProvider");
		}
	}
	globalConfig.set("initialized", true);
}

export function getGlobalConfig(): {
	apiKey?: string;
	model?: string;
	provider?: string;
	baseUrl?: string;
	customProvider?: Record<string, unknown>;
	temperature?: number;
	maxTokens?: number;
	initialized?: boolean;
} {
	return {
		apiKey: globalConfig.get("apiKey"),
		model: globalConfig.get("model"),
		provider: globalConfig.get("provider"),
		baseUrl: globalConfig.get("baseUrl"),
		customProvider: globalConfig.get("customProvider"),
		temperature: globalConfig.get("temperature"),
		maxTokens: globalConfig.get("maxTokens"),
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
