import fs from "node:fs";
import path from "node:path";
import { confirm, input, search, select } from "@inquirer/prompts";
import { listModelsForProvider, type LiveModelInfo } from "../api/models.js";
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
const CODE_BG = "\x1b[48;5;236m";

const IBIS = "\u{131A3}";
const ANKH = "\u{13269}";
const EYE = "\u{13075}";

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

/** Detect the best provider from environment variables. */
function detectProviderFromEnv(): { provider: string; apiKey: string } | null {
	const checks: Array<{ envVar: string; provider: string }> = [
		{ envVar: "OPENROUTER_API_KEY", provider: "openrouter" },
		{ envVar: "ANTHROPIC_API_KEY", provider: "anthropic" },
		{ envVar: "OPENAI_API_KEY", provider: "openai" },
		{ envVar: "GEMINI_API_KEY", provider: "google" },
		{ envVar: "GOOGLE_API_KEY", provider: "google" },
	];
	for (const { envVar, provider } of checks) {
		const value = process.env[envVar]?.trim();
		if (value) {
			return { provider, apiKey: value };
		}
	}
	return null;
}

/** Recommended default model per provider. */
const RECOMMENDED_MODELS: Record<string, string> = {
	openrouter: "anthropic/claude-sonnet-4",
	openai: "gpt-4o",
	anthropic: "claude-sonnet-4-20250514",
	google: "gemini-2.5-pro",
};

const PROVIDER_CHOICES = [
	{
		name: "⚡ Quick Start (auto-detect provider from environment variables)",
		value: "quickstart",
	},
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

/** Format a LiveModelInfo into a display label with context/pricing/modality metadata. */
function formatModelLabel(m: LiveModelInfo): string {
	const parts: string[] = [m.name ?? m.id];

	// Context window
	if (m.contextLength != null) {
		const ctx = m.contextLength;
		const ctxStr =
			ctx >= 1_000_000
				? `${(ctx / 1_000_000).toFixed(ctx % 1_000_000 === 0 ? 0 : 1).replace(/\.0$/, "")}M ctx`
				: ctx >= 1_000
					? `${(ctx / 1_000).toFixed(ctx % 1_000 === 0 ? 0 : 1).replace(/\.0$/, "")}K ctx`
					: `${ctx} ctx`;
		parts.push(ctxStr);
	}

	// Pricing per million tokens
	if (m.pricing) {
		if (m.pricing.input != null && m.pricing.input > 0) {
			parts.push(`$${m.pricing.input.toFixed(2)}/M in`);
		}
		if (m.pricing.output != null && m.pricing.output > 0) {
			parts.push(`$${m.pricing.output.toFixed(2)}/M out`);
		}
	}

	// Modalities — derive from raw API data (architecture.modality, description) and model id
	const mods: string[] = [];
	const raw = m.raw as Record<string, unknown> | undefined;
	const modality = (raw?.architecture as Record<string, unknown> | undefined)
		?.modality as string | undefined;
	if (modality) {
		if (modality.includes("image") || modality.includes("vision"))
			mods.push("vision");
		if (modality.includes("audio")) mods.push("audio");
		if (modality.includes("video")) mods.push("video");
	}
	const desc = (
		(raw?.description as string | undefined) ?? ""
	).toLowerCase();
	if (
		desc.includes("reasoning") ||
		m.id.toLowerCase().includes("reasoner") ||
		m.id.toLowerCase().includes("reasoning")
	) {
		if (!mods.includes("reasoning")) mods.push("reasoning");
	}
	if (mods.length > 0) {
		parts.push(mods.join(", "));
	}

	return parts.join("  ");
}

/** Show a live theme preview using the terminal color palette */
function showThemePreview(model: string, provider: string): void {
	console.log();
	console.log(
		`  ${GOLD}┌─ Preview ─────────────────────────────────────────┐${RESET}`,
	);
	console.log(
		`  ${GOLD}│${RESET}  ${IBIS} ${GOLD}Tehuti${RESET} ${DIM}v1.2.1${RESET}                                    ${GOLD}│${RESET}`,
	);

	const mpLine = `  ${SAND}Model: ${model}${RESET}  ${SAND}Provider: ${provider}${RESET}`;
	const mpVisibleLen =
		`  Model: ${model}  Provider: ${provider}`.length;
	const mpPadding = Math.max(1, 48 - mpVisibleLen);
	console.log(
		`  ${GOLD}│${RESET}${mpLine}${" ".repeat(mpPadding)}${GOLD}│${RESET}`,
	);

	console.log(
		`  ${GOLD}│${RESET}  ${DIM}┌──────────────────────────────────────────┐${RESET}  ${GOLD}│${RESET}`,
	);
	console.log(
		`  ${GOLD}│${RESET}  ${DIM}│${RESET}${CODE_BG}  ${SAND}code block with syntax highlighting${RESET}  ${DIM}│${RESET}  ${GOLD}│${RESET}`,
	);
	console.log(
		`  ${GOLD}│${RESET}  ${DIM}└──────────────────────────────────────────┘${RESET}  ${GOLD}│${RESET}`,
	);
	console.log(
		`  ${GOLD}│${RESET}  ${GREEN}✓ Tool completed${RESET}  ${DIM}·${RESET}  ${RED}✗ Error state${RESET}                ${GOLD}│${RESET}`,
	);
	console.log(
		`  ${GOLD}└──────────────────────────────────────────────────────────┘${RESET}`,
	);
	console.log();
}

const SUGGESTED_MODELS: Record<
	string,
	Array<{ name: string; value: string }>
> = {
	openrouter: [
		{
			name: "anthropic/claude-sonnet-4  200K ctx  $3.00/M in  vision  ★ recommended",
			value: "anthropic/claude-sonnet-4",
		},
		{
			name: "google/gemini-2.5-flash  1M ctx  $0.15/M in  reasoning",
			value: "google/gemini-2.5-flash",
		},
		{
			name: "deepseek/deepseek-chat  128K ctx  $0.27/M in  reasoning",
			value: "deepseek/deepseek-chat",
		},
		{
			name: "anthropic/claude-3.5-sonnet  200K ctx  $3.00/M in  vision",
			value: "anthropic/claude-3.5-sonnet",
		},
	],
	opencode: [{ name: "minimax-m3 (Default)  1M ctx  subscription", value: "minimax-m3" }],
	ollama: [
		{
			name: "qwen2.5-coder:7b  32K ctx  Excellent for local coding",
			value: "qwen2.5-coder:7b",
		},
		{ name: "llama3  8K ctx  General capability", value: "llama3" },
		{ name: "mistral  32K ctx  Balanced local model", value: "mistral" },
	],
	lmstudio: [
		{ name: "Use whatever model is loaded in LM Studio", value: "default" },
	],
	google: [
		{ name: "gemini-2.5-pro  1M ctx  paid tier  ★ recommended", value: "gemini-2.5-pro" },
		{ name: "gemini-2.5-flash  1M ctx  free", value: "gemini-2.5-flash" },
	],
	anthropic: [
		{
			name: "claude-sonnet-4-20250514  200K ctx  $3.00/M in  vision  ★ recommended",
			value: "claude-sonnet-4-20250514",
		},
		{
			name: "claude-3-5-sonnet-latest  200K ctx  $3.00/M in  vision",
			value: "claude-3-5-sonnet-latest",
		},
		{
			name: "claude-3-5-haiku-latest  200K ctx  $0.80/M in  vision",
			value: "claude-3-5-haiku-latest",
		},
	],
	openai: [
		{ name: "gpt-4o  128K ctx  $2.50/M in  vision", value: "gpt-4o" },
		{ name: "gpt-4o-mini  128K ctx  $0.15/M in  vision", value: "gpt-4o-mini" },
		{ name: "o3-mini  200K ctx  $1.10/M in  reasoning", value: "o3-mini" },
	],
	deepseek: [
		{ name: "deepseek-chat  128K ctx  $0.27/M in  reasoning", value: "deepseek-chat" },
		{ name: "deepseek-reasoner  128K ctx  $0.55/M in  reasoning", value: "deepseek-reasoner" },
	],
	xai: [{ name: "grok-2-1212  128K ctx  $2.00/M in", value: "grok-2-1212" }],
};

export async function runSetupWizard(): Promise<TehutiConfig> {
	console.clear();
	console.log();
	console.log(c.gold(`  ${IBIS} Welcome to Tehuti CLI`));
	await sleep(600);
	console.log(c.sand("  Ma'at balance of local and cloud scribes"));
	console.log();
	await sleep(400);

	const detected = detectProviderFromEnv();
	const defaultProvider = detected ? detected.provider : "opencode";

	let provider = await select({
		message: `Select your AI provider:`,
		choices: PROVIDER_CHOICES,
		default: detected ? "quickstart" : defaultProvider,
		theme: egyptianTheme,
	});

	let apiKey: string | undefined;
	let resolvedModel: string | undefined;

	if (provider === "quickstart") {
		if (!detected) {
			console.log(
				c.coral("  ⚠ No API key detected in environment variables."),
			);
			console.log(
				c.dim("    Set OPENROUTER_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY,"),
			);
			console.log(c.dim("    or pick a provider manually below.\n"));
			provider = await select({
				message: `Select your AI provider:`,
				choices: PROVIDER_CHOICES.filter((c) => c.value !== "quickstart"),
				default: "opencode",
				theme: egyptianTheme,
			});
		} else {
			provider = detected.provider;
			apiKey = detected.apiKey;
			resolvedModel = RECOMMENDED_MODELS[provider];
			const providerName = getProviderInfo(provider)?.name ?? provider;
			console.log(
				c.green(`\n  ✓ Quick Start: auto-configured ${providerName}`),
			);
			console.log(
				c.dim(`    API key from environment (ends in ...${apiKey.slice(-4)})`),
			);
			if (resolvedModel) {
				console.log(c.dim(`    Recommended model: ${resolvedModel}`));
			}
			console.log();
		}
	}

	const info = getProviderInfo(provider);
	const requiresKey = info ? info.requiresApiKey : true;
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

	let model: string;

	if (resolvedModel) {
		// Quick Start: use the recommended model directly
		model = resolvedModel;
		console.log(
			c.dim(`  Using recommended model: ${model}`),
		);
	} else {
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
				modelChoices = liveModels.map((m) => ({ name: formatModelLabel(m), value: m.id }));
			}
		} catch {
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

		model = selectedModel;
		if (selectedModel === "__custom__") {
			model = await input({
				message: "Type your model ID:",
				validate: (value) =>
					value.length > 0 ? true : "Model ID cannot be empty",
				theme: egyptianTheme,
			});
		}
	}

	showThemePreview(model, provider);
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

	console.log();
	console.log(c.cyan("  [Glyph Mode]"));

	const glyphMode = await select<"nerd" | "unicode" | "ascii">({
		message: "Choose how glyphs and symbols should render in your terminal:",
		default: "nerd",
		theme: egyptianTheme,
		choices: [
			{
				name: `Nerd Font        (rich icons, best if Nerd Font is installed)`,
				value: "nerd",
			},
			{
				name: `Unicode    ☰ ⎇ ✕ ✓ ✓ ☑   (good fallback for any terminal)`,
				value: "unicode",
			},
			{
				name: `ASCII      [T] [*] [!] [OK]  (minimum, best for basic terminals)`,
				value: "ascii",
			},
		],
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
						branding: {
							glyphMode,
						},
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
				branding: { glyphMode },
			});
		} else {
			saveGlobalConfig({
				provider: provider as any,
				apiKey: apiKey || null,
				baseUrl: baseUrl || null,
				model,
				branding: { glyphMode },
			});
		}
	} else {
		saveGlobalConfig({
			provider: provider as any,
			apiKey: apiKey || null,
			baseUrl: baseUrl || null,
			model,
			branding: { glyphMode },
		});
	}

	console.log();
	console.log(
		c.green(ANKH) +
			c.dim(` Configuration successfully written to ${configTarget}`),
	);
	console.log(c.dim(`  Provider: ${info?.name ?? provider}`));
	console.log(c.dim(`  Model: ${model}`));
	console.log(c.dim(`  Glyph Mode: ${glyphMode}`));
	console.log();

	return {
		...DEFAULT_CONFIG,
		provider: provider as any,
		apiKey,
		baseUrl,
		branding: {
			name: "Tehuti",
			tagline: "Scribe of Code Transformations",
			symbol: "𓆣",
			glyphMode,
		},
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
