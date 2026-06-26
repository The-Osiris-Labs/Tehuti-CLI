import { confirm, input, select } from "@inquirer/prompts";
import { isInitialized, saveGlobalConfig } from "./loader.js";
import type { TehutiConfig } from "./schema.js";
import { DEFAULT_CONFIG } from "./schema.js";
import {
	getProviderInfo,
	getEnvApiKeyForProvider,
	getApiKeyEnvVarsForProvider,
} from "./providers.js";

const GOLD = "\x1b[38;5;178m";
const CORAL = "\x1b[38;5;174m";
const SAND = "\x1b[38;5;137m";
const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";

const IBIS = "\u{131A3}";
const ANKH = "\u{13269}";
const EYE = "\u{13075}";
const SCROLL = "\u{1331B}";

const c = {
	gold: (text: string) => `${GOLD}${text}${RESET}`,
	coral: (text: string) => `${CORAL}${text}${RESET}`,
	sand: (text: string) => `${SAND}${text}${RESET}`,
	dim: (text: string) => `${DIM}${text}${RESET}`,
	green: (text: string) => `${GREEN}${text}${RESET}`,
};

const PROVIDER_CHOICES = [
	{ name: "OpenRouter (Recommended - 200+ models, pay-per-use)", value: "openrouter" },
	{ name: "OpenCode Go (Subscription model)", value: "opencode" },
	{ name: "Ollama (Local, keyless, runs offline)", value: "ollama" },
	{ name: "LM Studio (Local, keyless, desktop app server)", value: "lmstudio" },
	{ name: "Google Gemini (Direct AI Studio API key)", value: "google" },
	{ name: "Anthropic Claude (Direct API key)", value: "anthropic" },
	{ name: "OpenAI (Direct API key)", value: "openai" },
	{ name: "DeepSeek (Direct V3/R1 API key)", value: "deepseek" },
	{ name: "xAI Grok (Direct API key)", value: "xai" },
	{ name: "Custom OpenAI-compatible endpoint", value: "custom" },
];

const SUGGESTED_MODELS: Record<string, Array<{ name: string; value: string }>> = {
	openrouter: [
		{ name: "google/gemini-2.5-flash (Fast, cost-efficient)", value: "google/gemini-2.5-flash" },
		{ name: "deepseek/deepseek-chat (DeepSeek V3)", value: "deepseek/deepseek-chat" },
		{ name: "anthropic/claude-3.5-sonnet (Highly capable coding model)", value: "anthropic/claude-3.5-sonnet" },
	],
	opencode: [
		{ name: "minimax-m3 (Default)", value: "minimax-m3" },
	],
	ollama: [
		{ name: "qwen2.5-coder:7b (Excellent for local coding)", value: "qwen2.5-coder:7b" },
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
	xai: [
		{ name: "grok-2-1212", value: "grok-2-1212" },
	],
};

export async function runSetupWizard(): Promise<TehutiConfig> {
	console.log();
	console.log(c.gold(`  ${IBIS} Tehuti CLI Setup Wizard`));
	console.log(c.sand("  Ma'at balance of local and cloud scribes"));
	console.log();

	const provider = await select({
		message: `${EYE} Select your AI provider:`,
		choices: PROVIDER_CHOICES,
		default: "openrouter",
	});

	const info = getProviderInfo(provider);
	const requiresKey = info ? info.requiresApiKey : true;
	let apiKey: string | undefined;

	if (requiresKey) {
		const envKey = getEnvApiKeyForProvider(provider);
		if (envKey) {
			console.log(c.green("  ✓ Found API key in environment variables."));
			apiKey = envKey;
		} else {
			const envVars = getApiKeyEnvVarsForProvider(provider);
			const hint = provider === "openrouter" ? " (Get a key at: https://openrouter.ai/keys)" : "";
			apiKey = await input({
				message: `${SCROLL} Enter your API key for ${info?.name ?? provider}${hint}:`,
				validate: (value) => (value.length > 0 ? true : `API key is required. Alternatively set env var ${envVars.join(" or ")}`),
			});
		}
	}

	let baseUrl: string | undefined;
	if (provider === "custom") {
		baseUrl = await input({
			message: `${SCROLL} Enter the custom provider base URL:`,
			default: "https://api.example.com/v1",
			validate: (value) => (value.startsWith("http") ? true : "Must be a valid HTTP/HTTPS URL"),
		});
	}

	const modelChoices = SUGGESTED_MODELS[provider] || [];
	modelChoices.push({ name: "Enter a custom model ID", value: "__custom__" });

	const selectedModel = await select({
		message: `${EYE} Choose a default model:`,
		choices: modelChoices,
		default: modelChoices[0]?.value ?? "minimax-m3",
	});

	let model = selectedModel;
	if (selectedModel === "__custom__") {
		model = await input({
			message: "Type your model ID:",
			validate: (value) => (value.length > 0 ? true : "Model ID cannot be empty"),
		});
	}

	const enableMCP = await confirm({
		message: "Enable MCP (Model Context Protocol) server support?",
		default: true,
	});

	const trustedMode = await confirm({
		message: "Enable trusted mode (skip safety permission prompts for read-only/non-destructive operations)?",
		default: false,
	});

	saveGlobalConfig({
		provider: provider as any,
		apiKey: apiKey || null,
		baseUrl: baseUrl || null,
		model,
	});

	console.log();
	console.log(c.green(ANKH) + c.dim(" Configuration successfully written to ~/.tehuti.json"));
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
