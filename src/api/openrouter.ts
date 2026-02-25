import type { TehutiConfig } from "../config/schema.js";
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

	private static instance: OpenRouterClient | null = null;
	private static lastConfigKey: string | null = null;

	static getInstance(config: TehutiConfig): OpenRouterClient {
		const configKey = `${config.apiKey}:${config.model}`;
		if (!OpenRouterClient.instance || OpenRouterClient.lastConfigKey !== configKey) {
			OpenRouterClient.instance = new OpenRouterClient(config);
			OpenRouterClient.lastConfigKey = configKey;
		}
		return OpenRouterClient.instance;
	}

	static resetInstance(): void {
		OpenRouterClient.instance = null;
		OpenRouterClient.lastConfigKey = null;
	}

	private validateBaseUrl(url: string): void {
		try {
			const parsed = new URL(url);
			if (parsed.protocol !== "https:") {
				throw new APIError("baseUrl must use HTTPS protocol");
			}
			const hostname = parsed.hostname;
			if (
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
				hostname.endsWith(".localhost")
			) {
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
		this.apiKey = config.apiKey ?? process.env.OPENROUTER_API_KEY ?? "";
		this.baseUrl = config.baseUrl ?? "https://openrouter.ai/api/v1";
		this.model = config.model;
		this.fallbackModel = config.fallbackModel ?? "anthropic/claude-3-haiku";
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

		if (!this.apiKey) {
			throw new APIError(
				"OpenRouter API key is required. Set OPENROUTER_API_KEY environment variable or configure in .tehuti.json",
			);
		}

		if (this.apiKey.length < 10 || !this.apiKey.startsWith("sk-or-")) {
			throw new APIError("Invalid API key format");
		}

		this.validateBaseUrl(this.baseUrl);
		this.validateModel(this.model);
		this.validateModel(this.fallbackModel);
		this.validateTemperature(this.temperature);
		this.validateMaxTokens(this.maxTokens);
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
			"anthropic/claude-sonnet-4",
			"anthropic/claude-sonnet-4.5",
			"anthropic/claude-haiku-4.5",
			"anthropic/claude-haiku-3.5",
			"anthropic/claude-opus-4",
			"anthropic/claude-opus-4.5",
			"claude-sonnet-4",
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
				() =>
					fetch(`${this.baseUrl}/chat/completions`, {
						method: "POST",
						headers: {
							Authorization: `Bearer ${this.apiKey}`,
							"Content-Type": "application/json",
							"HTTP-Referer": "https://tehuti.dev",
							"X-Title": "Tehuti CLI",
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
					.replace(
						/api[_-]?key['":\s]*['"]?[a-zA-Z0-9_-]{10,}/gi,
						"[REDACTED]",
					);
				if (response.status === 401) {
					throw new APIError(
						`API key appears to be invalid or expired.\n\n` +
						`Suggestions:\n` +
						`  • Check OPENROUTER_API_KEY environment variable\n` +
						`  • Check ~/.tehuti.json config file\n` +
						`  • Run 'tehuti init' to reconfigure`,
						response.status,
					);
				}
				if (response.status === 429) {
					const retryAfter = response.headers.get("Retry-After");
					const retryMessage = retryAfter
						? `Retry after ${retryAfter} seconds.`
						: "Please wait before making more requests.";
					throw new APIError(
						`Rate limit exceeded. ${retryMessage}`,
						response.status,
					);
				}
				throw new APIError(
					`OpenRouter API error (${response.status}): ${sanitizedError}`,
					response.status,
				);
			}

			if (!response.body) {
				throw new APIError("No response body from OpenRouter");
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
						"HTTP-Referer": "https://tehuti.dev",
						"X-Title": "Tehuti CLI",
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
					`  • Check OPENROUTER_API_KEY environment variable\n` +
					`  • Check ~/.tehuti.json config file\n` +
					`  • Run 'tehuti init' to reconfigure`,
					response.status,
				);
			}
			throw new APIError(
				`OpenRouter API error (${response.status}): ${sanitizedError}`,
				response.status,
			);
		}

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
	): Promise<{ id: string; name: string; context_length: number }[]> {
		const timeoutSignal = AbortSignal.timeout(30000);
		const combinedSignal = signal
			? AbortSignal.any([signal, timeoutSignal])
			: timeoutSignal;

		const response = await this.withRetry(
			() =>
				fetch(`${this.baseUrl}/models`, {
					headers: {
						Authorization: `Bearer ${this.apiKey}`,
					},
					signal: combinedSignal,
				}),
			{ maxRetries: this.maxRetries },
		);

		if (!response.ok) {
			throw new APIError(`Failed to list models: ${response.status}`);
		}

		const data = (await response.json()) as {
			data: { id: string; name: string; context_length: number }[];
		};
		return data.data.sort((a, b) => a.id.localeCompare(b.id));
	}

	async validateApiKey(): Promise<{ valid: boolean; error?: string }> {
		const timeoutSignal = AbortSignal.timeout(10000);

		try {
			const response = await fetch(`${this.baseUrl}/models`, {
				headers: {
					Authorization: `Bearer ${this.apiKey}`,
				},
				signal: timeoutSignal,
			});

			if (response.status === 401) {
				return {
					valid: false,
					error:
						`API key appears to be invalid or expired.\n\n` +
						`Suggestions:\n` +
						`  • Check OPENROUTER_API_KEY environment variable\n` +
						`  • Check ~/.tehuti.json config file\n` +
						`  • Run 'tehuti init' to reconfigure`,
				};
			}

			if (response.status === 403) {
				return {
					valid: false,
					error: "API key is forbidden. Please check your OpenRouter account.",
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
				error: "Could not connect to OpenRouter. Please check your connection.",
			};
		}
	}
}
