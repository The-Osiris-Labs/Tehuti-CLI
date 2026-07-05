import {
	getApiKeyEnvVarsForProvider,
	getProviderAuthHeaders,
	getProviderInfo,
	resolveBaseUrlForProvider,
} from "../config/providers.js";
import type { TehutiConfig } from "../config/schema.js";
import { debug } from "../utils/debug.js";
import { APIError } from "../utils/errors.js";
import { BaseAPIClient } from "./base-client.js";

export class OpenRouterClient extends BaseAPIClient {
	private static instance: OpenRouterClient | null = null;
	private static lastConfigKey: string | null = null;

	private fallbackClient: OpenRouterClient | null = null;
	private originalConfig: TehutiConfig;

	static getInstance(config: TehutiConfig): OpenRouterClient {
		const resolvedBaseUrl =
			resolveBaseUrlForProvider(
				config.provider || "openrouter",
				config.baseUrl,
			) || "";
		const configKey = `${config.provider || "openrouter"}:${config.apiKey}:${resolvedBaseUrl}:${config.model}`;
		if (
			!OpenRouterClient.instance ||
			OpenRouterClient.lastConfigKey !== configKey
		) {
			OpenRouterClient.instance = new OpenRouterClient(config);
			OpenRouterClient.lastConfigKey = configKey;
		}
		return OpenRouterClient.instance;
	}

	static resetInstance(): void {
		OpenRouterClient.instance = null;
		OpenRouterClient.lastConfigKey = null;
	}

	constructor(config: TehutiConfig) {
		const providerId = config.provider || "openrouter";
		const providerInfo = getProviderInfo(providerId);
		const providerLabel = providerInfo?.name || providerId;
		const requiresApiKey = providerInfo?.requiresApiKey ?? true;

		let apiKey = config.apiKey ?? "";
		if (config.apiKey === undefined && !apiKey) {
			const providerEnvVars = getApiKeyEnvVarsForProvider(providerId);
			for (const envVar of providerEnvVars) {
				const envValue = process.env[envVar];
				if (envValue?.trim()) {
					apiKey = envValue.trim();
					break;
				}
			}
		}

		if (requiresApiKey && !apiKey) {
			const preferredEnvVar =
				getApiKeyEnvVarsForProvider(providerId)[0] || "TEHUTI_API_KEY";
			throw new APIError(
				`${providerLabel} API key is required. Set ${preferredEnvVar} or configure apiKey in .tehuti.json`,
			);
		}

		const isStrictOpenRouter =
			!config.provider || config.provider === "openrouter";
		if (apiKey && apiKey.length < 10) {
			throw new APIError("Invalid API key format");
		}
		if (isStrictOpenRouter && !apiKey.startsWith("sk-or-")) {
			// Specific openrouter prefix validation could be logged here.
		}

		const baseUrl =
			resolveBaseUrlForProvider(providerId, config.baseUrl) ??
			providerInfo?.defaultBaseUrl ??
			"https://openrouter.ai/api/v1";

		const allowLocalHttp = providerId === "ollama" || providerId === "lmstudio";
		try {
			const parsed = new URL(baseUrl);
			if (
				parsed.protocol !== "https:" &&
				!(allowLocalHttp && parsed.protocol === "http:")
			) {
				throw new APIError("baseUrl must use HTTPS protocol");
			}
			const hostname = parsed.hostname;
			const isPrivateHost =
				hostname === "localhost" ||
				hostname === "127.0.0.1" ||
				hostname.startsWith("192.168.") ||
				hostname.startsWith("10.") ||
				hostname.startsWith("172.16.") ||
				hostname.endsWith(".local") ||
				hostname.endsWith(".localhost");

			if (isPrivateHost && !allowLocalHttp) {
				throw new APIError(
					"baseUrl cannot point to internal/private addresses",
				);
			}
		} catch (e) {
			if (e instanceof APIError) throw e;
			throw new APIError("Invalid baseUrl format");
		}

		super({
			providerId,
			providerLabel,
			apiKey,
			baseUrl,
			model: config.model,
			fallbackModel: config.fallbackModel,
			maxTokens: config.maxTokens,
			temperature: config.temperature,
			extendedThinking: config.extendedThinking,
			thinkingBudgetTokens: config.thinkingBudgetTokens,
			requestTimeout: config.requestTimeout,
			maxRetries: config.maxRetries,
			supportsCaching: OpenRouterClient.checkCachingSupport(config.model),
		});

		this.originalConfig = config;
	}

	private static checkCachingSupport(model: string): boolean {
		const cachingModels = [
			"claude",
			"sonnet",
			"opus",
			"haiku",
			"gemini",
			"gpt",
			"minimax",
			"qwen",
			"deepseek",
			"claude-haiku",
			"claude-opus",
			"deepseek/deepseek",
			"google/gemini",
		];
		return cachingModels.some((m) => model.includes(m));
	}

	private supportsExtendedThinking(model: string): boolean {
		const thinkingModels = [
			"anthropic/claude-sonnet-4",
			"anthropic/claude-opus-4",
			"anthropic/claude-sonnet-4.5",
			"claude-sonnet-4",
			"claude-opus-4",
		];
		return thinkingModels.some((m) => model.includes(m));
	}

	private getFallbackClient(): OpenRouterClient {
		if (!this.fallbackClient) {
			const fallbackConfig = { ...this.originalConfig };
			fallbackConfig.provider = "opencode";
			// Clear custom URLs and keys to let the default opencode config take over
			fallbackConfig.baseUrl = undefined;
			fallbackConfig.apiKey = undefined;
			this.fallbackClient = new OpenRouterClient(fallbackConfig);
		}
		return this.fallbackClient;
	}

	override async *streamChat(
		messages: import("./base-client.js").StandardMessage[],
		tools?: import("./base-client.js").StandardTool[],
		modelOverride?: string,
		signal?: AbortSignal,
	): AsyncGenerator<
		import("./base-client.js").StandardStreamChunk,
		void,
		unknown
	> {
		try {
			yield* super.streamChat(messages, tools, modelOverride, signal);
		} catch (error) {
			if (
				error instanceof APIError &&
				(error.status === 429 || (error.status && error.status >= 500))
			) {
				if (this.providerId !== "opencode") {
					debug.log(
						"api",
						`Fallback triggered! Routing request to opencode due to ${error.status} error.`,
					);
					yield* this.getFallbackClient().streamChat(
						messages,
						tools,
						modelOverride,
						signal,
					);
					return;
				}
			}
			throw error;
		}
	}

	override async completeChat(
		messages: import("./base-client.js").StandardMessage[],
		tools?: import("./base-client.js").StandardTool[],
		modelOverride?: string,
		signal?: AbortSignal,
	): Promise<import("./base-client.js").StandardResponse> {
		try {
			return await super.completeChat(messages, tools, modelOverride, signal);
		} catch (error) {
			if (
				error instanceof APIError &&
				(error.status === 429 || (error.status && error.status >= 500))
			) {
				if (this.providerId !== "opencode") {
					debug.log(
						"api",
						`Fallback triggered! Routing request to opencode due to ${error.status} error.`,
					);
					return await this.getFallbackClient().completeChat(
						messages,
						tools,
						modelOverride,
						signal,
					);
				}
			}
			throw error;
		}
	}

	protected override async buildHeaders(): Promise<Record<string, string>> {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};

		if (this.providerId === "openrouter") {
			headers["HTTP-Referer"] = "https://tehuti.dev";
			headers["X-Title"] = "Tehuti CLI";
		}

		Object.assign(
			headers,
			await getProviderAuthHeaders(this.providerId, this.apiKey),
		);

		return headers;
	}

	protected override getProviderErrorSubject(): string {
		return this.providerLabel || this.providerId;
	}

	protected override getProviderAuthHints(): string[] {
		const envVars = getApiKeyEnvVarsForProvider(this.providerId);
		const envHint =
			envVars.length > 0 ? envVars.join(" or ") : "TEHUTI_API_KEY";
		return [
			`Check ${envHint} environment variable`,
			"Check ~/.tehuti.json config file",
		];
	}

	protected override buildRequestBody(
		messages: import("./base-client.js").StandardMessage[],
		tools?: import("./base-client.js").StandardTool[],
		modelOverride?: string,
		isStream: boolean = true,
	): Record<string, unknown> {
		const body = super.buildRequestBody(
			messages,
			tools,
			modelOverride,
			isStream,
		);

		const model = modelOverride ?? this.model;
		if (this.extendedThinking && this.supportsExtendedThinking(model)) {
			body.thinking = {
				type: "enabled",
				budget_tokens: this.thinkingBudgetTokens ?? 10000,
			};
		}

		return body;
	}
}
