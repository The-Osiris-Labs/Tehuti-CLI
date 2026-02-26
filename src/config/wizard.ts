import { confirm, input, select } from "@inquirer/prompts";
import { isInitialized, saveGlobalConfig } from "./loader.js";
import type { TehutiConfig } from "./schema.js";
import { DEFAULT_CONFIG } from "./schema.js";

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

	const AVAILABLE_MODELS = [
	{
		name: "Giga Potato (Free, Highly Capable)",
		value: "giga-potato",
		description: "Free model optimized for agentic programming with visual understanding",
	},
	{
		name: "Giga Potato Thinking (Free, Reasoning)",
		value: "giga-potato-thinking",
		description: "Free model with enhanced reasoning capabilities",
	},
	{
		name: "MiniMax M2.5 (Free, Productivity)",
		value: "minimax/minimax-m2.5:free",
		description: "Free model specialized for real-world productivity tasks",
	},
	{
		name: "Trinity Large (Free, Research)",
		value: "arcee-ai/trinity-large-preview:free",
		description: "Free large-scale model with advanced capabilities",
	},
	{
		name: "Claude Sonnet 4",
		value: "anthropic/claude-sonnet-4",
		description: "Best balance of speed and intelligence",
	},
	{
		name: "Claude Opus 4",
		value: "anthropic/claude-opus-4",
		description: "Most capable, higher cost",
	},
	{
		name: "GPT-4o",
		value: "openai/gpt-4o",
		description: "GPT-4 optimized",
	},
	{
		name: "Gemini 2.5 Pro",
		value: "google/gemini-2.5-pro",
		description: "Google's flagship model",
	},
	{
		name: "DeepSeek V3",
		value: "deepseek/deepseek-v3",
		description: "Cost-effective alternative",
	},
];

export async function runSetupWizard(): Promise<TehutiConfig> {
	console.log();
	console.log(c.gold(`  ${IBIS} Tehuti CLI`));
	console.log(c.sand("  Scribe of Code Transformations"));
	console.log();

	const hasApiKey =
		process.env.OPENROUTER_API_KEY || process.env.TEHUTI_API_KEY;

	if (!hasApiKey) {
		const apiKey = await input({
			message: `${SCROLL} Enter your OpenRouter API key:`,
			validate: (value) => (value.length > 0 ? true : "API key is required"),
		});

		process.env.OPENROUTER_API_KEY = apiKey;
	}

	const model = await select({
		message: `${EYE} Choose your default model:`,
		choices: AVAILABLE_MODELS,
		default: "giga-potato",
	});

	const enableMCP = await confirm({
		message: "Enable MCP (Model Context Protocol) server support?",
		default: true,
	});

	const trustedMode = await confirm({
		message:
			"Enable trusted mode (skip permission prompts for safe operations)?",
		default: false,
	});

	saveGlobalConfig({
		apiKey: process.env.OPENROUTER_API_KEY || process.env.TEHUTI_API_KEY,
		model,
	});

	console.log();
	console.log(c.green(ANKH) + c.dim(" Configuration saved"));
	console.log(c.dim(`  Model: ${model}`));
	console.log();

	return {
		...DEFAULT_CONFIG,
		model,
		apiKey: process.env.OPENROUTER_API_KEY || process.env.TEHUTI_API_KEY,
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
	const { loadConfig } = await import("./loader.js");

	if (!isInitialized()) {
		return runSetupWizard();
	}

	return loadConfig();
}
