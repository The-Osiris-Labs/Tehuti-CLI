import fs from "node:fs";
import path from "node:path";
import { confirm, input, search, select } from "@inquirer/prompts";
import { listModelsForProvider } from "../api/models.js";
import { loadConfig, saveGlobalConfig } from "./loader.js";
import {
	getApiKeyEnvVarsForProvider,
	getEnvApiKeyForProvider,
	getProviderInfo,
} from "./providers.js";
import type { TehutiConfig } from "./schema.js";
import { DEFAULT_CONFIG } from "./schema.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const GOLD = "\x1b[38;5;178m";
const CORAL = "\x1b[38;5;174m";
const SAND = "\x1b[38;5;137m";
const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const NILE = "\x1b[38;5;27m";
const RED = "\x1b[31m";

const IBIS = "\u{131A3}";
const ANKH = "\u{13269}";
const EYE = "\u{13075}";
const _SCROLL = "\u{1331B}";

const c = {
	gold: (text: string) => `${GOLD}${text}${RESET}`,
	coral: (text: string) => `${CORAL}${text}${RESET}`,
	sand: (text: string) => `${SAND}${text}${RESET}`,
	dim: (text: string) => `${DIM}${text}${RESET}`,
	green: (text: string) => `${GREEN}${text}${RESET}`,
	cyan: (text: string) => `\x1b[36m${text}${RESET}`,
	nile: (text: string) => `${NILE}${text}${RESET}`,
	red: (text: string) => `${RED}${text}${RESET}`,
};

const egyptianTheme = {
	prefix: c.coral(EYE),
	style: {
		answer: (text: string) => c.gold(text),
		message: (text: string) => c.sand(text),
		highlight: (text: string) => c.gold(text),
	},
};

const PROVIDER_CHOICES = [
	{
		name: "OpenCode Go (Recommended - abundant context window & up-to-date models)",
		value: "opencode",
	},
	{ name: "OpenRouter (Pay-per-use, 200+ models)", value: "openrouter" },
	{ name: "Ollama (Local, keyless, runs offline)", value: "ollama" },
	{ name: "LM Studio (Local, keyless, desktop app server)", value: "lmstudio" },
	{ name: "Google Gemini (Direct AI Studio API key)", value: "google" },
	{ name: "Anthropic Claude (Direct API key)", value: "anthropic" },
	{ name: "OpenAI (Direct API key)", value: "openai" },
	{ name: "DeepSeek (Direct V3/R1 API key)", value: "deepseek" },
	{ name: "xAI Grok (Direct API key)", value: "xai" },
	{ name: "Custom OpenAI-compatible endpoint", value: "custom" },
];

const SUGGESTED_MODELS: Record<
	string,
	Array<{ name: string; value: string }>
> = {
	openrouter: [
		{
			name: "google/gemini-2.5-flash (Fast, cost-efficient)",
			value: "google/gemini-2.5-flash",
		},
		{
			name: "deepseek/deepseek-chat (DeepSeek V3)",
			value: "deepseek/deepseek-chat",
		},
		{
			name: "anthropic/claude-3.5-sonnet (Highly capable coding model)",
			value: "anthropic/claude-3.5-sonnet",
		},
	],
	opencode: [{ name: "minimax-m3 (Default)", value: "minimax-m3" }],
	ollama: [
		{
			name: "qwen2.5-coder:7b (Excellent for local coding)",
			value: "qwen2.5-coder:7b",
		},
		{ name: "llama3 (General capability)", value: "llama3" },
		{ name: "mistral (Balanced local model)", value: "mistral" },
	],
	lmstudio: [
		{ name: "Use whatever model is loaded in LM Studio", value: "default" },
	],
	google: [
		{ name: "gemini-2.5-flash", value: "gemini-2.5-flash" },
		{ name: "gemini-2.5-pro", value: "gemini-2.5-pro" },
	],
	anthropic: [
		{ name: "claude-3-5-sonnet-latest", value: "claude-3-5-sonnet-latest" },
		{ name: "claude-3-5-haiku-latest", value: "claude-3-5-haiku-latest" },
	],
	openai: [
		{ name: "gpt-4o", value: "gpt-4o" },
		{ name: "gpt-4o-mini", value: "gpt-4o-mini" },
		{ name: "o3-mini (Reasoning model)", value: "o3-mini" },
	],
	deepseek: [
		{ name: "deepseek-chat (V3)", value: "deepseek-chat" },
		{ name: "deepseek-reasoner (R1)", value: "deepseek-reasoner" },
	],
	xai: [{ name: "grok-2-1212", value: "grok-2-1212" }],
};

export async function runSetupWizard(): Promise<TehutiConfig> {
	console.clear();
	console.log();
	console.log(c.gold(`  ${IBIS} Welcome to Tehuti CLI`));
	await sleep(600);
	console.log(c.sand("  Ma'at balance of local and cloud scribes"));
	console.log();
	await sleep(400);

	const provider = await select({
		message: `Select your AI provider:`,
		choices: PROVIDER_CHOICES,
		default: "opencode",
		theme: egyptianTheme,
	});

	const info = getProviderInfo(provider);
	const requiresKey = info ? info.requiresApiKey : true;
	let apiKey: string | undefined;

	if (provider === "google") {
		const authMethod = await select({
			message: `How do you want to authenticate with Google Gemini?`,
			choices: [
				{
					name: "Log in with Google (OAuth 2.0 - Recommended)",
					value: "oauth",
				},
				{ name: "Enter API Key (AI Studio / Legacy)", value: "apikey" },
			],
			theme: egyptianTheme,
		});

		if (authMethod === "oauth") {
			const { authenticateGoogleOAuth } = await import("../api/oauth.js");
			try {
				console.log(
					c.nile("\n  Launching browser for Google Authentication...\n"),
				);
				await authenticateGoogleOAuth();
				apiKey = undefined;
			} catch (err) {
				console.log(
					c.red(
						`  OAuth failed: ${err instanceof Error ? err.message : String(err)}`,
					),
				);
				const fallback = await confirm({
					message: "Do you want to enter an API key instead?",
					default: true,
					theme: egyptianTheme,
				});
				if (!fallback) throw err;
			}
		}
	}

	const currentConfig = await loadConfig();
	if (
		requiresKey &&
		apiKey === undefined &&
		(provider !== "google" ||
			(provider === "google" && !currentConfig?.oauth?.google?.refreshToken))
	) {
		const envKey = getEnvApiKeyForProvider(provider);
		if (envKey) {
			const useEnv = await confirm({
				message: `Found API key in environment variables (ends in ...${envKey.slice(-4)}). Do you want to use it?`,
				default: true,
				theme: egyptianTheme,
			});
			if (useEnv) {
				apiKey = envKey;
			} else {
				const envVars = getApiKeyEnvVarsForProvider(provider);
				const hint =
					provider === "openrouter"
						? " (Get a key at: https://openrouter.ai/keys)"
						: "";
				apiKey = await input({
					message: `Enter your API key for ${info?.name ?? provider}${hint}:`,
					validate: (value) =>
						value.length > 0
							? true
							: `API key is required. Alternatively set env var ${envVars.join(" or ")}`,
					theme: egyptianTheme,
				});
			}
		} else {
			const envVars = getApiKeyEnvVarsForProvider(provider);
			const hint =
				provider === "openrouter"
					? " (Get a key at: https://openrouter.ai/keys)"
					: "";
			apiKey = await input({
				message: `Enter your API key for ${info?.name ?? provider}${hint}:`,
				validate: (value) =>
					value.length > 0
						? true
						: `API key is required. Alternatively set env var ${envVars.join(" or ")}`,
				theme: egyptianTheme,
			});
		}
	}

	let baseUrl: string | undefined;
	if (provider === "custom") {
		baseUrl = await input({
			message: `Enter the custom provider base URL:`,
			default: "https://api.example.com/v1",
			validate: (value) =>
				value.startsWith("http") ? true : "Must be a valid HTTP/HTTPS URL",
			theme: egyptianTheme,
		});
	}

	let modelChoices = SUGGESTED_MODELS[provider] || [];
	if (!modelChoices || modelChoices.length === 0) {
		modelChoices = [];
	}

	// Attempt to fetch models dynamically
	console.log(
		c.dim(`  Fetching available models from ${info?.name ?? provider}...`),
	);
	try {
		const liveModels = await listModelsForProvider(provider, {
			apiKey,
			baseUrl,
		});
		if (liveModels && liveModels.length > 0) {
			modelChoices = liveModels.map((m) => ({ name: m.id, value: m.id }));
		}
	} catch (_e) {
		console.log(
			c.dim(`  Failed to fetch models dynamically. Using suggested models.`),
		);
	}

	modelChoices.push({ name: "Enter a custom model ID", value: "__custom__" });

	const selectedModel = await search({
		message: `Choose a default model (type to search):`,
		theme: egyptianTheme,
		source: async (term) => {
			if (!term) return modelChoices;
			const termLower = term.toLowerCase();
			return modelChoices.filter(
				(c) =>
					c.name.toLowerCase().includes(termLower) ||
					c.value.toLowerCase().includes(termLower),
			);
		},
	});

	let model = selectedModel;
	if (selectedModel === "__custom__") {
		model = await input({
			message: "Type your model ID:",
			validate: (value) =>
				value.length > 0 ? true : "Model ID cannot be empty",
			theme: egyptianTheme,
		});
	}

	console.log();
	console.log(c.cyan("  [Advanced Features]"));

	const enableMCP = await confirm({
		message:
			"Enable MCP (Model Context Protocol) to allow tools and integrations?",
		default: true,
		theme: egyptianTheme,
	});

	const trustedMode = await confirm({
		message:
			"Enable trusted mode? (Skips safety permission prompts for read-only/non-destructive tools)",
		default: false,
		theme: egyptianTheme,
	});

	const enableDaemon = await confirm({
		message:
			"Enable Background Daemon? (Allows background file watching, subagent swarms, and messaging connectors)",
		default: true,
		theme: egyptianTheme,
	});

	const localConfigPath = path.join(process.cwd(), ".tehuti.json");
	let configTarget = "global configuration";

	if (fs.existsSync(localConfigPath)) {
		console.log();
		console.log(
			c.gold("𓁹 Notice:") +
				c.dim(" Found a local .tehuti.json in the current directory."),
		);
		console.log(
			c.dim("   A local configuration file will override any global settings."),
		);

		const action = await select({
			message: "How would you like to handle this local configuration file?",
			theme: egyptianTheme,
			choices: [
				{
					name: "Update the local .tehuti.json with these new settings (Recommended)",
					value: "update",
				},
				{
					name: "Delete the local .tehuti.json and save globally",
					value: "delete",
				},
				{
					name: "Keep the local .tehuti.json unchanged and save globally anyway",
					value: "ignore",
				},
			],
		});

		if (action === "update") {
			const existingConfig = JSON.parse(
				fs.readFileSync(localConfigPath, "utf-8"),
			);
			fs.writeFileSync(
				localConfigPath,
				JSON.stringify(
					{
						...existingConfig,
						provider,
						apiKey: apiKey || existingConfig.apiKey || null,
						baseUrl: baseUrl || existingConfig.baseUrl || null,
						model,
						initialized: true,
					},
					null,
					2,
				),
			);
			configTarget = "local .tehuti.json";
		} else if (action === "delete") {
			fs.unlinkSync(localConfigPath);
			console.log(c.green(ANKH) + c.dim(" Stale local .tehuti.json deleted."));
			saveGlobalConfig({
				provider: provider as any,
				apiKey: apiKey || null,
				baseUrl: baseUrl || null,
				model,
			});
		} else {
			saveGlobalConfig({
				provider: provider as any,
				apiKey: apiKey || null,
				baseUrl: baseUrl || null,
				model,
			});
		}
	} else {
		saveGlobalConfig({
			provider: provider as any,
			apiKey: apiKey || null,
			baseUrl: baseUrl || null,
			model,
		});
	}

	console.log();
	console.log(
		c.green(ANKH) +
			c.dim(` Configuration successfully written to ${configTarget}`),
	);
	console.log(c.dim(`  Provider: ${info?.name ?? provider}`));
	console.log(c.dim(`  Model: ${model}`));
	console.log();

	return {
		...DEFAULT_CONFIG,
		provider: provider as any,
		apiKey,
		baseUrl,
		model,
		mcp: {
			enabled: enableMCP,
			servers: {},
		},
		daemon: {
			...DEFAULT_CONFIG.daemon,
			enabled: enableDaemon,
		},
		permissions: {
			...DEFAULT_CONFIG.permissions,
			defaultMode: trustedMode ? "trust" : "interactive",
			trustedMode,
		},
	};
}

export async function ensureInitialized(): Promise<TehutiConfig> {
	const { loadConfig, isInitialized } = await import("./loader.js");

	if (!isInitialized()) {
		return runSetupWizard();
	}

	return loadConfig();
}
