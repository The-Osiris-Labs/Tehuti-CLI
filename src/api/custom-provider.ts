import type { TehutiConfig } from "../config/schema.js";
import { APIError } from "../utils/errors.js";
import { BaseAPIClient } from "./base-client.js";

export class CustomProviderClient extends BaseAPIClient {
	private customHeaders: Record<string, string>;

	private static instance: CustomProviderClient | null = null;
	private static lastConfigKey: string | null = null;

	static getInstance(config: TehutiConfig): CustomProviderClient {
		const customProvider = config.customProvider;
		const headers = customProvider?.headers;
		const normalizedHeaders = headers
			? JSON.stringify(
					Object.keys(headers)
						.sort()
						.reduce(
							(acc, key) => {
								const val = headers[key];
								if (val !== undefined) {
									acc[key] = val;
								}
								return acc;
							},
							{} as Record<string, string>,
						),
				)
			: "";
		const configKey = [
			config.customProvider?.name ?? "",
			config.customProvider?.baseUrl ?? "",
			config.customProvider?.apiKey ?? "",
			normalizedHeaders,
			config.apiKey ?? "",
			config.model,
		].join("|");
		if (
			!CustomProviderClient.instance ||
			CustomProviderClient.lastConfigKey !== configKey
		) {
			CustomProviderClient.instance = new CustomProviderClient(config);
			CustomProviderClient.lastConfigKey = configKey;
		}
		return CustomProviderClient.instance;
	}

	static resetInstance(): void {
		CustomProviderClient.instance = null;
		CustomProviderClient.lastConfigKey = null;
	}

	constructor(config: TehutiConfig) {
		if (!config.customProvider) {
			throw new APIError("Custom provider configuration is required");
		}

		const apiKey =
			config.apiKey ??
			config.customProvider.apiKey ??
			process.env.CUSTOM_API_KEY ??
			"";
		const baseUrl = config.customProvider.baseUrl;

		const customHeaders = config.customProvider.headers ?? {};
		const hasExplicitAuthHeader = Object.keys(customHeaders).some((key) =>
			CustomProviderClient.isAuthHeaderName(key),
		);

		if (!apiKey && !hasExplicitAuthHeader) {
			throw new APIError(
				"API key is required. Set CUSTOM_API_KEY environment variable or configure in custom provider settings",
			);
		}

		if (apiKey && apiKey.length < 10) {
			throw new APIError("Invalid API key format");
		}

		try {
			const parsed = new URL(baseUrl);
			const isLocal =
				parsed.hostname === "localhost" ||
				parsed.hostname === "127.0.0.1" ||
				parsed.hostname.match(
					/^10\.|^172\.(1[6-9]|2[0-9]|3[0-1])\.|^192\.168\./,
				);

			if (parsed.protocol !== "https:" && !isLocal) {
				throw new APIError(
					"baseUrl must use HTTPS protocol for remote connections",
				);
			}
		} catch (e) {
			throw new APIError(`Invalid baseUrl format: ${(e as Error).message}`);
		}

		super({
			providerId: "custom",
			providerLabel: config.customProvider.name || "Custom Provider",
			apiKey,
			baseUrl,
			model: config.model,
			fallbackModel: config.fallbackModel ?? "minimax-m3",
			maxTokens: config.maxTokens,
			temperature: config.temperature,
			extendedThinking: config.extendedThinking,
			thinkingBudgetTokens: config.thinkingBudgetTokens,
			requestTimeout: config.requestTimeout,
			maxRetries: config.maxRetries,
			supportsCaching: false,
		});

		this.customHeaders = customHeaders;
	}

	private static isAuthHeaderName(name: string): boolean {
		const normalized = name.toLowerCase();
		return (
			normalized === "authorization" ||
			normalized === "api-key" ||
			normalized === "x-api-key" ||
			normalized === "x-goog-api-key"
		);
	}

	private hasExplicitAuthHeader(): boolean {
		return Object.keys(this.customHeaders).some((key) =>
			CustomProviderClient.isAuthHeaderName(key),
		);
	}

	protected override async buildHeaders(): Promise<Record<string, string>> {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			...this.customHeaders,
		};

		if (!this.hasExplicitAuthHeader() && this.apiKey) {
			headers.Authorization = this.apiKey.startsWith("Bearer ")
				? this.apiKey
				: `Bearer ${this.apiKey}`;
		}

		return headers;
	}

	protected override getProviderErrorSubject(): string {
		return this.providerLabel;
	}

	protected override getProviderAuthHints(): string[] {
		return [
			"Check CUSTOM_API_KEY environment variable",
			"Check customProvider settings in ~/.tehuti.json",
		];
	}

	// Custom Provider specific methods
	setCustomHeader(key: string, value: string): void {
		this.customHeaders[key] = value;
	}

	removeCustomHeader(key: string): void {
		delete this.customHeaders[key];
	}

	getCustomHeaders(): Record<string, string> {
		return { ...this.customHeaders };
	}
}
