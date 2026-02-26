import type { TehutiConfig } from "../config/schema.js";
import { debug } from "../utils/debug.js";
import { APIError } from "../utils/errors.js";
import type { OpenRouterMessage, OpenRouterResponse, OpenRouterStreamChunk, OpenRouterTool, OpenRouterToolCall } from "./openrouter.js";
import { APIResponseCache } from "./response-cache.js";

export class CustomProviderClient {
	private apiKey: string;
	private baseUrl: string;
	private model: string;
	private fallbackModel: string;
	private maxTokens: number;
	private temperature: number;
	private abortController: AbortController | null = null;
	private supportsCaching: boolean;
	private extendedThinking: boolean;
	private thinkingBudgetTokens?: number;
	private requestTimeout: number;
	private maxRetries: number;
	private lastRequestTime: number = 0;
	private minRequestInterval: number = 100;
	private customHeaders: Record<string, string>;
	private responseCache: APIResponseCache;

	private static instance: CustomProviderClient | null = null;
	private static lastConfigKey: string | null = null;

	static getInstance(config: TehutiConfig): CustomProviderClient {
		const configKey = `${config.customProvider?.name}:${config.apiKey}:${config.model}`;
		if (!CustomProviderClient.instance || CustomProviderClient.lastConfigKey !== configKey) {
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

		this.apiKey = config.apiKey ?? config.customProvider.apiKey ?? process.env.CUSTOM_API_KEY ?? "";
		this.baseUrl = config.customProvider.baseUrl;
		this.model = config.model;
		this.fallbackModel = config.fallbackModel ?? "anthropic/claude-sonnet-4.5";
		this.maxTokens = config.maxTokens ?? 4096;
		this.temperature = config.temperature ?? 0.7;
		this.supportsCaching = false;
		this.extendedThinking = config.extendedThinking ?? false;
		this.thinkingBudgetTokens = config.thinkingBudgetTokens;
		this.requestTimeout = this.validateTimeout(config.requestTimeout, 120000);
		this.maxRetries = config.maxRetries ?? 3;
		this.customHeaders = config.customProvider.headers ?? {};
		this.responseCache = APIResponseCache.getInstance();

		if (!this.apiKey) {
			throw new APIError(
				"API key is required. Set CUSTOM_API_KEY environment variable or configure in custom provider settings",
			);
		}

		if (this.apiKey.length < 10) {
			throw new APIError("Invalid API key format");
		}

		this.validateBaseUrl(this.baseUrl);
		this.validateModel(this.model);
		this.validateModel(this.fallbackModel);
		this.validateTemperature(this.temperature);
		this.validateMaxTokens(this.maxTokens);
	}

	private validateBaseUrl(url: string): void {
		try {
			const parsed = new URL(url);
			if (parsed.protocol !== "https:") {
				throw new APIError("baseUrl must use HTTPS protocol");
			}
		} catch (e) {
			throw new APIError("Invalid baseUrl format");
		}
	}

	private validateTimeout(timeout: number | undefined, defaultMs: number): number {
		if (timeout === undefined) return defaultMs;
		if (typeof timeout !== "number" || !Number.isFinite(timeout)) {
			throw new APIError("requestTimeout must be a valid number");
		}
		const MIN_TIMEOUT_MS = 5000;
		const MAX_TIMEOUT_MS = 600000;
		return Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, timeout));
	}

	private validateModel(model: string): void {
		const MAX_MODEL_NAME_LENGTH = 256;
		const VALID_MODEL_PATTERN = /^[a-zA-Z0-9_\-./:]+$/;
		
		if (!model || typeof model !== "string") {
			throw new APIError("Model name is required");
		}
		if (model.length > MAX_MODEL_NAME_LENGTH) {
			throw new APIError(
				`Model name exceeds maximum length of ${MAX_MODEL_NAME_LENGTH}`,
			);
		}
		if (!VALID_MODEL_PATTERN.test(model)) {
			throw new APIError("Model name contains invalid characters");
		}
	}

	private validateTemperature(temp: number): void {
		if (typeof temp !== "number" || !Number.isFinite(temp)) {
			throw new APIError("Temperature must be a valid number");
		}
		if (temp < 0 || temp > 2) {
			throw new APIError("Temperature must be between 0 and 2");
		}
	}

	private validateMaxTokens(tokens: number): void {
		if (typeof tokens !== "number" || !Number.isFinite(tokens)) {
			throw new APIError("maxTokens must be a valid number");
		}
		if (tokens < 1 || tokens > 1000000) {
			throw new APIError("maxTokens must be between 1 and 1000000");
		}
	}

	validateMessages(messages: OpenRouterMessage[]): void {
		const MAX_MESSAGES = 1000;
		const MAX_MESSAGE_LENGTH = 1000000;
		
		if (!Array.isArray(messages)) {
			throw new APIError("Messages must be an array");
		}
		if (messages.length === 0) {
			throw new APIError("Messages array cannot be empty");
		}
		if (messages.length > MAX_MESSAGES) {
			throw new APIError(`Too many messages (max ${MAX_MESSAGES})`);
		}

		for (let i = 0; i < messages.length; i++) {
			const msg = messages[i];
			if (!["system", "user", "assistant", "tool"].includes(msg.role)) {
				throw new APIError(`Invalid role at index ${i}`);
			}
			if (typeof msg.content === "string" && msg.content.length > MAX_MESSAGE_LENGTH) {
				throw new APIError(`Message at index ${i} is too long`);
			}
			if (msg.tool_calls && !Array.isArray(msg.tool_calls)) {
				throw new APIError(`Tool calls at index ${i} must be an array`);
			}
		}
	}

	private async sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	private async enforceRateLimit(): Promise<void> {
		const now = Date.now();
		const elapsed = now - this.lastRequestTime;
		if (elapsed < this.minRequestInterval) {
			await this.sleep(this.minRequestInterval - elapsed);
		}
		this.lastRequestTime = Date.now();
	}

	private async withRetry<T>(
		fn: () => Promise<T>,
		options?: { maxRetries?: number; isRetryable?: (error: Error) => boolean },
	): Promise<T> {
		const maxRetries = options?.maxRetries ?? this.maxRetries;
		const isRetryable =
			options?.isRetryable ?? this.defaultIsRetryable.bind(this);
		let lastError: Error | null = null;

		for (let attempt = 0; attempt < maxRetries; attempt++) {
			try {
				await this.enforceRateLimit();
				return await fn();
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));

				if (!isRetryable(lastError)) {
					throw lastError;
				}

				const retryAfter = this.calculateRetryDelay(attempt, lastError);
				debug.log(
					"api",
					`Retryable error, waiting ${retryAfter}ms before retry ${attempt + 1}/${maxRetries}`,
				);
				await this.sleep(retryAfter);
			}
		}

		throw lastError ?? new Error("Max retries exceeded");
	}

	private defaultIsRetryable(error: Error, isUserAbort: boolean = false): boolean {
		if (isUserAbort) {
			return false;
		}
		if (error instanceof APIError) {
			return (
				error.status === 429 ||
				(error.status !== undefined && error.status >= 500)
			);
		}
		if (error instanceof TypeError && error.message.includes("fetch")) {
			return true;
		}
		if (error.name === "TimeoutError" || error.message?.includes("timeout")) {
			return true;
		}
		if (error.name === "AbortError") {
			return false;
		}
		const msg = error.message.toLowerCase();
		if (msg.includes("econnrefused") || msg.includes("enotfound") || msg.includes("econnreset")) {
			return true;
		}
		return false;
	}

	private calculateRetryDelay(attempt: number, error: Error): number {
		const BASE_RETRY_DELAY_MS = 1000;
		const MAX_RETRY_DELAY_MS = 60000;
		
		if (error instanceof APIError && error.status === 429) {
			const baseDelay = BASE_RETRY_DELAY_MS * 2 ** attempt;
			return Math.min(baseDelay, MAX_RETRY_DELAY_MS);
		}
		const baseDelay = BASE_RETRY_DELAY_MS * 2 ** attempt;
		const jitter = Math.random() * 0.1 * baseDelay;
		return Math.min(baseDelay + jitter, MAX_RETRY_DELAY_MS);
	}

	async *streamChat(
		messages: OpenRouterMessage[],
		tools?: OpenRouterTool[],
		modelOverride?: string,
		signal?: AbortSignal,
	): AsyncGenerator<OpenRouterStreamChunk, void, unknown> {
		this.validateMessages(messages);

		const abortController = new AbortController();
		this.abortController = abortController;
		const model = modelOverride ?? this.model;

		debug.log("api", `Starting stream with model: ${model}`);
		debug.log("api", `Messages: ${messages.length}`);
		debug.log("api", `Caching enabled: ${this.supportsCaching}`);

		const body: Record<string, unknown> = {
			model,
			messages,
			max_tokens: this.maxTokens,
			temperature: this.temperature,
			stream: true,
		};

		if (tools && tools.length > 0) {
			body.tools = tools;
		}

		let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
		const timeoutSignal = AbortSignal.timeout(this.requestTimeout);
		const combinedSignal = signal
			? AbortSignal.any([signal, timeoutSignal])
			: timeoutSignal;

		try {
			const response: Response = await this.withRetry<Response>(
				(): Promise<Response> =>
					fetch(`${this.baseUrl}/chat/completions`, {
						method: "POST",
						headers: {
							Authorization: `Bearer ${this.apiKey}`,
							"Content-Type": "application/json",
							...this.customHeaders,
						},
						body: JSON.stringify(body),
						signal: combinedSignal,
					}),
				{ maxRetries: this.maxRetries },
			);

			if (!response.ok) {
				const errorText = await response.text();
				const sanitizedError = errorText
					.slice(0, 500)
					.replace(/sk-[a-zA-Z0-9_-]+/g, "[REDACTED]")
					.replace(/api[_-]?key['":\s]*['"]?[a-zA-Z0-9_-]{10,}/gi, "[REDACTED]");
				if (response.status === 401) {
					throw new APIError(
						`API key appears to be invalid or expired.\n\n` +
						`Suggestions:\n` +
						`  • Check CUSTOM_API_KEY environment variable\n` +
						`  • Check ~/.tehuti.json config file\n` +
						`  • Verify custom provider settings`,
						response.status,
					);
				}
				throw new APIError(
					`Custom provider API error (${response.status}): ${sanitizedError}`,
					response.status,
				);
			}

			const body = response.body;
			if (!body) {
				throw new APIError("No response body to stream");
			}
			reader = body.getReader() as unknown as ReadableStreamDefaultReader<Uint8Array>;

			const decoder = new TextDecoder();
			let buffer = "";

			while (true) {
				const { done, value } = await reader.read();
				
				if (done) {
					break;
				}

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";

				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed || !trimmed.startsWith("data: ")) {
						continue;
					}

					try {
						const data = JSON.parse(trimmed.slice(6));
						yield data;
					} catch (parseError) {
						debug.log("api", "Failed to parse SSE chunk:", parseError);
					}
				}
			}
		} catch (error) {
			if (error instanceof Error) {
				if (error.name === "AbortError") {
					debug.log("api", "Stream aborted by user");
					return;
				}
				if (error.name === "TimeoutError" || error.message?.includes("timeout")) {
					throw new APIError(
						`Request timed out after ${this.requestTimeout / 1000}s. ` +
						`Try increasing --timeout or using a faster model.`
					);
				}
			}
			throw error;
		} finally {
			if (reader) {
				try {
					reader.releaseLock();
				} catch {}
			}
			this.abortController = null;
		}
	}

	async completeChat(
		messages: OpenRouterMessage[],
		tools?: OpenRouterTool[],
		modelOverride?: string,
		signal?: AbortSignal,
	): Promise<OpenRouterResponse> {
		this.validateMessages(messages);

		const model = modelOverride ?? this.model;

		debug.log("api", `Completing with model: ${model}`);

		// Check cache first
		const cachedResponse = await this.responseCache.get(messages, {
			model,
			temperature: this.temperature,
			maxTokens: this.maxTokens,
		});
		
		if (cachedResponse) {
			debug.log("api", "Using cached API response");
			return cachedResponse;
		}

		const body: Record<string, unknown> = {
			model,
			messages,
			max_tokens: this.maxTokens,
			temperature: this.temperature,
			stream: false,
		};

		if (tools && tools.length > 0) {
			body.tools = tools;
		}

		const timeoutSignal = AbortSignal.timeout(this.requestTimeout);
		const combinedSignal = signal
			? AbortSignal.any([signal, timeoutSignal])
			: timeoutSignal;

		const response = await this.withRetry(
			() =>
				fetch(`${this.baseUrl}/chat/completions`, {
					method: "POST",
					headers: {
						Authorization: `Bearer ${this.apiKey}`,
						"Content-Type": "application/json",
						...this.customHeaders,
					},
					body: JSON.stringify(body),
					signal: combinedSignal,
				}),
			{ maxRetries: this.maxRetries },
		);

		if (!response.ok) {
			const errorText = await response.text();
			const sanitizedError = errorText
				.slice(0, 500)
				.replace(/sk-[a-zA-Z0-9_-]+/g, "[REDACTED]")
				.replace(/api[_-]?key['":\s]*['"]?[a-zA-Z0-9_-]{10,}/gi, "[REDACTED]");
			if (response.status === 401) {
				throw new APIError(
					`API key appears to be invalid or expired.\n\n` +
					`Suggestions:\n` +
					`  • Check CUSTOM_API_KEY environment variable\n` +
					`  • Check ~/.tehuti.json config file\n` +
					`  • Verify custom provider settings`,
					response.status,
				);
			}
			throw new APIError(
				`Custom provider API error (${response.status}): ${sanitizedError}`,
				response.status,
			);
		}

		const apiResponse = await response.json() as OpenRouterResponse;
		
		// Cache the response
		await this.responseCache.set(messages, apiResponse, {
			model,
			temperature: this.temperature,
			maxTokens: this.maxTokens,
		});

		return apiResponse;
	}

	abort(): void {
		this.abortController?.abort();
	}

	setModel(model: string): void {
		this.validateModel(model);
		this.model = model;
	}

	checkCachingSupport(_model: string): boolean {
		return false;
	}

	getCustomHeaders(): Record<string, string> {
		return { ...this.customHeaders };
	}

	setCustomHeader(key: string, value: string): void {
		this.customHeaders[key] = value;
	}

	removeCustomHeader(key: string): void {
		delete this.customHeaders[key];
	}
}
