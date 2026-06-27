import type { TehutiConfig } from "../config/schema.js";
import fs from "fs";
import {
	getApiKeyEnvVarsForProvider,
	getProviderAuthHeaders,
	getProviderInfo,
	getProviderModelsUrl,
	resolveBaseUrlForProvider,
} from "../config/providers.js";
import { debug } from "../utils/debug.js";
import { APIError } from "../utils/errors.js";

export interface CacheControl {
	type: "ephemeral";
	ttl?: "1h";
}

export interface ContentBlock {
	type: "text";
	text: string;
	cache_control?: CacheControl;
}

export interface OpenRouterMessage {
	role: "system" | "user" | "assistant" | "tool";
	content: string | ContentBlock[];
	name?: string;
	tool_call_id?: string;
	tool_calls?: OpenRouterToolCall[];
	cache_control?: CacheControl;
}

export interface OpenRouterToolCall {
	id: string;
	type: "function";
	function: {
		name: string;
		arguments: string;
	};
}

export interface OpenRouterTool {
	type: "function";
	function: {
		name: string;
		description: string;
		parameters: Record<string, unknown>;
	};
}

export interface OpenRouterStreamChunk {
	id: string;
	choices: {
		index: number;
		delta: {
			role?: string;
			content?: string;
			reasoning?: string;
			thinking?: string;
			tool_calls?: Partial<OpenRouterToolCall>[];
		};
		finish_reason: string | null;
	}[];
	usage?: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
		cache_read_input_tokens?: number;
		cache_creation_input_tokens?: number;
	};
}

export interface OpenRouterResponse {
	id: string;
	choices: {
		index: number;
		message: OpenRouterMessage;
		finish_reason: string | null;
	}[];
	usage: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
	};
}

const MAX_MESSAGE_LENGTH = 1000000;
const MAX_MESSAGES = 1000;
const MAX_MODEL_NAME_LENGTH = 256;
const VALID_MODEL_PATTERN = /^[a-zA-Z0-9_\-./:]+$/;
const MIN_TIMEOUT_MS = 5000;
const MAX_TIMEOUT_MS = 600000;
const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_MAX_RETRIES = 3;
const MAX_RETRY_DELAY_MS = 60000;
const BASE_RETRY_DELAY_MS = 1000;

export class OpenRouterClient {
	private apiKey: string;
	private baseUrl: string;
	private model: string;
	private providerId: string;
	private requiresApiKey: boolean;
	private fallbackModel: string;
	private providerLabel: string;
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

	private static instance: OpenRouterClient | null = null;
	private static lastConfigKey: string | null = null;

	static getInstance(config: TehutiConfig): OpenRouterClient {
		const resolvedBaseUrl =
			resolveBaseUrlForProvider(config.provider || "openrouter", config.baseUrl) || "";
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

	private validateBaseUrl(url: string, allowLocalHttp: boolean): void {
		try {
			const parsed = new URL(url);
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
				hostname.startsWith("172.17.") ||
				hostname.startsWith("172.18.") ||
				hostname.startsWith("172.19.") ||
				hostname.startsWith("172.20.") ||
				hostname.startsWith("172.21.") ||
				hostname.startsWith("172.22.") ||
				hostname.startsWith("172.23.") ||
				hostname.startsWith("172.24.") ||
				hostname.startsWith("172.25.") ||
				hostname.startsWith("172.26.") ||
				hostname.startsWith("172.27.") ||
				hostname.startsWith("172.28.") ||
				hostname.startsWith("172.29.") ||
				hostname.startsWith("172.30.") ||
				hostname.startsWith("172.31.") ||
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
	}

	constructor(config: TehutiConfig) {
		const providerInfo = getProviderInfo(config.provider || "openrouter");
		this.providerId = config.provider || "openrouter";
		this.providerLabel = providerInfo?.name || this.providerId;
		this.requiresApiKey = providerInfo?.requiresApiKey ?? true;
		this.apiKey = config.apiKey ?? "";
		// Only fall back to env vars when the caller did NOT explicitly supply an apiKey.
		// An explicit empty string means "no key provided" and should trigger the missing-key error.
		if (config.apiKey === undefined && !this.apiKey) {
			const providerEnvVars = getApiKeyEnvVarsForProvider(this.providerId);
			for (const envVar of providerEnvVars) {
				const envValue = process.env[envVar];
				if (envValue && envValue.trim()) {
					this.apiKey = envValue.trim();
					break;
				}
			}
		}
		this.baseUrl =
			resolveBaseUrlForProvider(this.providerId, config.baseUrl) ??
			"https://openrouter.ai/api/v1";
		this.model = config.model;
		this.fallbackModel = config.fallbackModel ?? config.model ?? "minimax-m3";
		this.maxTokens = config.maxTokens ?? 4096;
		this.temperature = config.temperature ?? 0.7;
		this.supportsCaching = this.checkCachingSupport(config.model);
		this.extendedThinking = config.extendedThinking ?? false;
		this.thinkingBudgetTokens = config.thinkingBudgetTokens;
		this.requestTimeout = this.validateTimeout(
			config.requestTimeout,
			DEFAULT_TIMEOUT_MS,
		);
		this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;

		if (this.requiresApiKey && !this.apiKey) {
			const preferredEnvVar =
				getApiKeyEnvVarsForProvider(this.providerId)[0] || "TEHUTI_API_KEY";
			const providerLabel = providerInfo?.name ?? this.providerId;
			throw new APIError(
				`${providerLabel} API key is required. Set ${preferredEnvVar} or configure apiKey in .tehuti.json`,
			);
		}

		const isStrictOpenRouter = !config.provider || config.provider === "openrouter";
		if (this.apiKey && this.apiKey.length < 10) {
			throw new APIError("Invalid API key format");
		}
		if (isStrictOpenRouter && !this.apiKey.startsWith("sk-or-")) {
			// Non-OpenRouter providers (opencode go sk-..., deepseek, xai, ollama etc) use different prefixes
			// Allow but warn at construction time is too noisy; defer real validation to first call.
		}

		const allowLocalHttp =
			this.providerId === "ollama" || this.providerId === "lmstudio";
		this.validateBaseUrl(this.baseUrl, allowLocalHttp);
		this.validateModel(this.model);
		this.validateModel(this.fallbackModel);
		this.validateTemperature(this.temperature);
		this.validateMaxTokens(this.maxTokens);

	}

	private buildHeaders(): Record<string, string> {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};

		if (this.providerId === "openrouter") {
			headers["HTTP-Referer"] = "https://tehuti.dev";
			headers["X-Title"] = "Tehuti CLI";
		}

		Object.assign(headers, getProviderAuthHeaders(this.providerId, this.apiKey));

		return headers;
	}

	private getChatCompletionsUrl(): string {
		return `${this.baseUrl}/chat/completions`;
	}

	private getModelsUrl(): string {
		return getProviderModelsUrl(this.providerId, this.baseUrl) ||
			`${this.baseUrl}/models`;
	}

	private getProviderErrorSubject(): string {
		return this.providerLabel || this.providerId;
	}

	private getProviderAuthHints(): string[] {
		const envVars = getApiKeyEnvVarsForProvider(this.providerId);
		const envHint = envVars.length > 0 ? envVars.join(" or ") : "TEHUTI_API_KEY";
		return [`Check ${envHint} environment variable`, "Check ~/.tehuti.json config file"];
	}

	private buildInvalidKeyMessage(): string {
		const subject = this.getProviderErrorSubject();
		return `API key appears to be invalid or expired for ${subject}.`;
	}

	private validateTimeout(
		timeout: number | undefined,
		defaultMs: number,
	): number {
		if (timeout === undefined) return defaultMs;
		if (typeof timeout !== "number" || !Number.isFinite(timeout)) {
			throw new APIError("requestTimeout must be a valid number");
		}
		return Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, timeout));
	}

	private validateModel(model: string): void {
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
			if (!msg || typeof msg !== "object") {
				throw new APIError(`Invalid message at index ${i}`);
			}
			if (!["system", "user", "assistant", "tool"].includes(msg.role)) {
				throw new APIError(`Invalid role at index ${i}: ${msg.role}`);
			}

			const content = msg.content;
			if (typeof content === "string") {
				if (content.length > MAX_MESSAGE_LENGTH) {
					throw new APIError(
						`Message content at index ${i} exceeds maximum length`,
					);
				}
			} else if (Array.isArray(content)) {
				const totalLength = content
					.filter((c): c is ContentBlock => c.type === "text")
					.reduce((sum, c) => sum + (c.text?.length ?? 0), 0);
				if (totalLength > MAX_MESSAGE_LENGTH) {
					throw new APIError(
						`Message content at index ${i} exceeds maximum length`,
					);
				}
			} else {
				throw new APIError(`Invalid content type at index ${i}`);
			}
		}
	}

	private async enforceRateLimit(): Promise<void> {
		const now = Date.now();
		const elapsed = now - this.lastRequestTime;
		if (elapsed < this.minRequestInterval) {
			await this.sleep(this.minRequestInterval - elapsed);
		}
		this.lastRequestTime = Date.now();
	}

	private checkCachingSupport(model: string): boolean {
		const cachingModels = [
			// live data preferred; these are loose hints only
			"claude", "sonnet", "opus", "haiku", "gemini", "gpt", "minimax", "qwen", "deepseek",
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

	prepareMessagesWithCaching(
		messages: OpenRouterMessage[],
		_tools?: OpenRouterTool[],
	): OpenRouterMessage[] {
		if (!this.supportsCaching) {
			return messages;
		}

		const processedMessages: OpenRouterMessage[] = [];

		for (let i = 0; i < messages.length; i++) {
			const msg = messages[i];

			if (msg.role === "system") {
				processedMessages.push({
					role: "system",
					content: [
						{
							type: "text",
							text: typeof msg.content === "string" ? msg.content : "",
							cache_control: { type: "ephemeral" },
						},
					],
				});
			} else if (msg.role === "user" && i === messages.length - 1) {
				const textContent =
					typeof msg.content === "string"
						? msg.content
						: (msg.content as ContentBlock[]).map((c) => c.text).join("");

				processedMessages.push({
					role: "user",
					content: [
						{
							type: "text",
							text: textContent,
						},
					],
				});
			} else {
				processedMessages.push(msg);
			}
		}

		return processedMessages;
	}

	prepareToolsWithCaching(
		tools?: OpenRouterTool[],
	): (OpenRouterTool & { cache_control?: CacheControl })[] | undefined {
		if (!this.supportsCaching || !tools || tools.length === 0) {
			return tools;
		}

		return tools.map((tool, index) => {
			if (index === tools.length - 1) {
				return {
					...tool,
					cache_control: { type: "ephemeral" },
				};
			}
			return tool;
		});
	}

	private async sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	private async withRetry<T>(
		fn: () => Promise<T>,
		options?: { maxRetries?: number; isRetryable?: (error: Error) => boolean },
	): Promise<T> {
		const maxRetries = options?.maxRetries ?? this.maxRetries;
		const isRetryable =
			options?.isRetryable ?? this.defaultIsRetryable.bind(this);
		let lastError: Error | null = null;
		const totalAttempts = maxRetries + 1;

		for (let attempt = 0; attempt < totalAttempts; attempt++) {
			try {
				await this.enforceRateLimit();
				return await fn();
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));

				if (attempt === totalAttempts - 1) {
					throw lastError;
				}

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

	private defaultIsRetryable(
		error: Error,
		isUserAbort: boolean = false,
	): boolean {
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
		if (
			msg.includes("econnrefused") ||
			msg.includes("enotfound") ||
			msg.includes("econnreset") ||
			msg.includes("etimedout") ||
			msg.includes("epipe") ||
			msg.includes("eaddrinuse") ||
			msg.includes("connection closed") ||
			msg.includes("socket closed") ||
			msg.includes("terminated")
		) {
			return true;
		}
		return false;
	}

	private calculateRetryDelay(attempt: number, error: Error): number {
		if (error && typeof (error as any).retryAfter === "number") {
			return (error as any).retryAfter;
		}
		if (error instanceof APIError && error.status === 429) {
			const baseDelay = BASE_RETRY_DELAY_MS * 2 ** attempt;
			return Math.min(baseDelay, MAX_RETRY_DELAY_MS);
		}
		const baseDelay = BASE_RETRY_DELAY_MS * 2 ** attempt;
		const jitter = Math.random() * 0.1 * baseDelay;
		return Math.min(baseDelay + jitter, MAX_RETRY_DELAY_MS);
	}

	private handleResponseError(response: Response, errorText: string): APIError {
		const sanitizedError = errorText
			.slice(0, 500)
			.replace(/sk-[a-zA-Z0-9_-]+/g, "[REDACTED]")
			.replace(/api[_-]?key['":\s]*['"]?[a-zA-Z0-9_-]{10,}/gi, "[REDACTED]");

		let apiError: APIError;
		if (response.status === 401) {
			apiError = new APIError(
				this.buildInvalidKeyMessage(),
				response.status,
				this.getProviderAuthHints(),
			);
		} else if (response.status === 429) {
			const retryAfter = response.headers.get("Retry-After");
			const retryMessage = retryAfter
				? `Retry after ${retryAfter} seconds.`
				: "Please wait before making more requests.";
			apiError = new APIError(
				`Rate limit exceeded. ${retryMessage}`,
				response.status,
				[
					"Wait a few minutes before making more requests",
					"Try a different model with --model <model-id>",
					"Consider upgrading to a paid plan for higher rate limits",
				],
			);
		} else if (response.status === 403) {
			apiError = new APIError(
				`Access forbidden. Your API key may not have the necessary permissions for ${this.getProviderErrorSubject()}.`,
				response.status,
				[
					"Check your provider account/subscription status",
					"Verify your API key has correct permissions",
					"Try generating a new API key",
				],
			);
		} else if (response.status === 404) {
			apiError = new APIError(
				`Model not found. The specified model may not exist or be available.`,
				response.status,
				[
					"Check the model ID is correct",
					"Use /models command to see available models",
					"Try a different model",
				],
			);
		} else if (response.status >= 500) {
			apiError = new APIError(
				`${this.getProviderErrorSubject()} server error (${response.status}): ${sanitizedError}`,
				response.status,
				[
					`Check ${this.getProviderErrorSubject()} service status`,
					"Try again later",
					"Use a different model",
				],
			);
		} else {
			apiError = new APIError(
				`${this.getProviderErrorSubject()} API error (${response.status}): ${sanitizedError}`,
				response.status,
				[
					"Check your internet connection",
					"Try again later",
					"Run with --debug for more details",
				],
			);
		}

		const retryAfterHeader = response.headers.get("Retry-After");
		if (retryAfterHeader) {
			const parsedSeconds = parseInt(retryAfterHeader, 10);
			if (!isNaN(parsedSeconds)) {
				(apiError as any).retryAfter = parsedSeconds * 1000;
			} else {
				const parsedDate = Date.parse(retryAfterHeader);
				if (!isNaN(parsedDate)) {
					(apiError as any).retryAfter = Math.max(0, parsedDate - Date.now());
				}
			}
		}

		return apiError;
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

		const cachedMessages = this.prepareMessagesWithCaching(messages, tools);
		const cachedTools = this.prepareToolsWithCaching(tools);

		const body: Record<string, unknown> = {
			model,
			messages: cachedMessages,
			max_tokens: this.maxTokens,
			temperature: this.temperature,
			stream: true,
		};

		if (this.extendedThinking && this.supportsExtendedThinking(model)) {
			body.thinking = {
				type: "enabled",
				budget_tokens: this.thinkingBudgetTokens ?? 10000,
			};
			debug.log(
				"api",
				`Extended thinking enabled with budget: ${this.thinkingBudgetTokens ?? 10000}`,
			);
		}

		if (cachedTools && cachedTools.length > 0) {
			body.tools = cachedTools;
		}

		let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
		const timeoutSignal = AbortSignal.timeout(this.requestTimeout);
		const combinedSignal = signal
			? AbortSignal.any([abortController.signal, signal, timeoutSignal])
			: AbortSignal.any([abortController.signal, timeoutSignal]);

		let parseErrorCount = 0;
		const MAX_PARSE_ERRORS = 10;

		try {
			const response = await this.withRetry(
				async () => {
					const res = await fetch(this.getChatCompletionsUrl(), {
						method: "POST",
						headers: this.buildHeaders(),
						body: JSON.stringify(body),
						signal: combinedSignal,
					});
					if (!res.ok) {
						const errorText = await res.text();
						throw this.handleResponseError(res, errorText);
					}
					return res;
				},
				{ maxRetries: this.maxRetries },
			);

			if (!response.body) {
				throw new APIError(`No response body from ${this.getProviderErrorSubject()}`);
			}

			reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";

			while (true) {
				const { done, value } = await reader.read();

				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";

				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed || trimmed === "data: [DONE]") continue;
					if (!trimmed.startsWith("data: ")) continue;

					try {
						const json = trimmed.slice(6);
						const chunk = JSON.parse(json) as OpenRouterStreamChunk;
						yield chunk;
					} catch (_e) {
						parseErrorCount++;
						debug.log(
							"stream",
							`Failed to parse chunk (${parseErrorCount}/${MAX_PARSE_ERRORS}): ${trimmed.slice(0, 100)}`,
						);
						if (parseErrorCount >= MAX_PARSE_ERRORS) {
							throw new APIError(
								`Too many stream parse errors (${parseErrorCount}), aborting`,
							);
						}
					}
				}
			}
		} catch (error) {
			if (error instanceof Error) {
				if (error.name === "AbortError") {
					debug.log("api", "Stream aborted by user");
					return;
				}
				if (
					error.name === "TimeoutError" ||
					error.message?.includes("timeout")
				) {
					throw new APIError(
						`Request timed out after ${this.requestTimeout / 1000}s. ` +
							`Try increasing --timeout or using a faster model.`,
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
			async () => {
				const res = await fetch(this.getChatCompletionsUrl(), {
					method: "POST",
					headers: this.buildHeaders(),
					body: JSON.stringify(body),
					signal: combinedSignal,
				});
				if (!res.ok) {
					const errorText = await res.text();
					throw this.handleResponseError(res, errorText);
				}
				return res;
			},
			{ maxRetries: this.maxRetries },
		);

		return response.json() as Promise<OpenRouterResponse>;
	}

	abort(): void {
		this.abortController?.abort();
	}

	setModel(model: string): void {
		this.model = model;
	}

	getModel(): string {
		return this.model;
	}

	async listModels(
		signal?: AbortSignal,
	): Promise<Array<{ id: string; name?: string; context_length?: number; pricing?: any; [k: string]: any }>> {
		const timeoutSignal = AbortSignal.timeout(30000);
		const combinedSignal = signal
			? AbortSignal.any([signal, timeoutSignal])
			: timeoutSignal;
		const modelsUrl = this.getModelsUrl();

		const response = await this.withRetry(
			async () => {
				const res = await fetch(modelsUrl, {
					headers: this.buildHeaders(),
					signal: combinedSignal,
				});
				if (!res.ok) {
					const errorText = await res.text();
					throw this.handleResponseError(res, errorText);
				}
				return res;
			},
			{ maxRetries: this.maxRetries },
		);

		const data = (await response.json()) as any;
		const list = (data?.data || data || []).sort((a: any, b: any) => (a.id || "").localeCompare(b.id || ""));
		return list;
	}

	async validateApiKey(): Promise<{ valid: boolean; error?: string }> {
		const timeoutSignal = AbortSignal.timeout(10000);
		const validateUrl = this.getModelsUrl();

		try {
			const response = await fetch(validateUrl, {
				headers: this.buildHeaders(),
				signal: timeoutSignal,
			});

				if (response.status === 401) {
					return {
						valid: false,
						error:
							`API key appears to be invalid or expired.\n\n` +
							`Suggestions:\n` +
							this.getProviderAuthHints()
								.map((hint) => `  • ${hint}`)
								.join("\n") +
							`\n` +
							`  • Check ~/.tehuti.json config file\n` +
							`  • Run 'tehuti init' to reconfigure`,
						};
					}

				if (response.status === 403) {
					return {
						valid: false,
						error: `API key is forbidden. Please check your ${this.getProviderErrorSubject()} account status.`,
					};
				}

			if (!response.ok) {
				return {
					valid: false,
					error: `API validation failed (${response.status}). Please try again.`,
				};
			}

			return { valid: true };
			} catch (error) {
			if (error instanceof Error && error.name === "AbortError") {
				return {
					valid: false,
					error: "API validation timed out. Please check your connection.",
				};
			}
				return {
					valid: false,
					error: `Could not connect to ${this.getProviderErrorSubject()}. Please check your connection.`,
				};
			}
	}
}
