import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { configureHooks, initializeAgent } from "../agent/index.js";
import type { StandardMessage } from "../api/base-client.js";
import { updateHttpAgentConfig } from "../api/http-agent.js";
import { StandardAPIClient } from "../api/standard-client.js";

import {
	DEFAULT_CONFIG,
	getGlobalConfig,
	loadConfig,
	resetGlobalConfig,
	runSetupWizard,
} from "../config/index.js";
import {
	getEnvApiKeyForProvider,
	getProviderInfo,
} from "../config/providers.js";
import type { TehutiConfig } from "../config/schema.js";
import { mcpManager } from "../mcp/index.js";
import { debug } from "../utils/debug.js";
import { setupErrorHandlers } from "../utils/errors.js";
import { setDebugMode } from "../utils/logger.js";
import { getTelemetry } from "../utils/telemetry.js";

const CONFIG_PATH = path.join(os.homedir(), ".tehuti.json");

interface GlobalConfig {
	apiKey?: string;
	model?: string;
	initialized?: boolean;
	provider?: string;
	baseUrl?: string;
}

export function loadTehutiConfig(): GlobalConfig {
	const persisted = getGlobalConfig();
	return {
		apiKey: persisted.apiKey,
		model: persisted.model,
		initialized: persisted.initialized,
		provider: persisted.provider,
		baseUrl: persisted.baseUrl,
	};
}

export interface BootstrapResult {
	cfg: TehutiConfig;
	apiKey: string;
	model: string;
	diffPreview?: { showPreview: boolean; autoConfirm?: boolean };
}

export interface BootstrapOptions {
	debug?: boolean;
	resetKey?: boolean;
	provider?: string;
	model?: string;
	diff?: boolean;
	diffAuto?: boolean;
	noMcp?: boolean;
}

export async function bootstrapCLI(
	prompt: string | undefined,
	opts: BootstrapOptions,
): Promise<BootstrapResult> {
	if (opts.debug) {
		setDebugMode(true);
		debug.enable();
	}
	setupErrorHandlers(opts.debug);

	let cfg = await loadConfig();
	getTelemetry().setEnabled(cfg.telemetry ?? false);
	if (cfg.http) {
		await updateHttpAgentConfig(cfg.http);
	}
	let tehuti = loadTehutiConfig();

	if (opts.resetKey) {
		fs.rmSync(CONFIG_PATH, { force: true });
		resetGlobalConfig();
		console.log("\x1b[38;5;214m  Config reset\x1b[0m\n");
		cfg = await loadConfig();
		tehuti = loadTehutiConfig();
	}

	let provider =
		opts.provider ||
		process.env.TEHUTI_PROVIDER ||
		cfg.provider ||
		tehuti.provider ||
		"openrouter";

	const envApiKey = getEnvApiKeyForProvider(provider);
	const envModel = process.env.TEHUTI_MODEL;

	let apiKey = envApiKey || cfg.apiKey || tehuti.apiKey;
	let model =
		opts.model || envModel || cfg.model || tehuti.model || DEFAULT_CONFIG.model;

	const info = getProviderInfo(provider);
	const needsKey = info ? info.requiresApiKey : true;

	if (!tehuti.initialized || (needsKey && !apiKey)) {
		if (prompt || !process.stdout.isTTY) {
			// In one-shot mode or non-interactive terminal, do not prompt for key.
			// Let the API client throw the missing API key error.
		} else {
			const wizardResult = await runSetupWizard();
			apiKey = wizardResult.apiKey;
			model = wizardResult.model;
			provider = wizardResult.provider;
			if (wizardResult.permissions) {
				cfg.permissions = wizardResult.permissions;
			}
			if (wizardResult.mcp) {
				cfg.mcp = wizardResult.mcp;
			}
		}
	}

	cfg.apiKey = apiKey;
	cfg.model = model;
	cfg.provider = provider;
	configureHooks(cfg);
	initializeAgent();

	const diffPreview = opts.diff
		? { showPreview: true, autoConfirm: false }
		: opts.diffAuto
			? { showPreview: true, autoConfirm: true }
			: undefined;

	if (cfg.mcp?.enabled && !opts.noMcp) {
		mcpManager.setSamplingHandler(async (request: unknown) => {
			const req = request as any;
			const client = StandardAPIClient.getInstance(cfg);

			const messages: StandardMessage[] = req.messages.map((m: any) => {
				const textContent = Array.isArray(m.content)
					? m.content.find((c: any) => c.type === "text")?.text || ""
					: m.content.type === "text"
						? m.content.text
						: "";

				return {
					role: m.role,
					content: textContent,
				};
			});

			if (req.systemPrompt) {
				messages.unshift({ role: "system", content: req.systemPrompt });
			}

			const response = await client.completeChat(
				messages,
				undefined,
				undefined,
			);

			const responseContent = response.choices[0]?.message.content || "";
			const text =
				typeof responseContent === "string"
					? responseContent
					: JSON.stringify(responseContent);

			return {
				model:
					req.modelPreferences?.hints?.[0]?.name ||
					cfg.model ||
					"deepseek-v4-flash",
				role: "assistant",
				content: {
					type: "text",
					text,
				},
			};
		});
		await mcpManager.connectAll(cfg);
	}

	return {
		cfg,
		apiKey: apiKey || "",
		model: model || "deepseek-v4-flash",
		diffPreview,
	};
}
