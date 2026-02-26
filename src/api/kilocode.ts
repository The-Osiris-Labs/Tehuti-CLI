import type { TehutiConfig } from "../config/schema.js";
import { debug } from "../utils/debug.js";
import { APIError } from "../utils/errors.js";
import type { OpenRouterMessage, OpenRouterResponse, OpenRouterStreamChunk, OpenRouterTool, OpenRouterToolCall } from "./openrouter.js";

// KiloCode specific features
export interface KiloCodeOptions {
	memoryBank?: {
		enabled: boolean;
		sessionId?: string;
		persistence?: "memory" | "disk";
	};
	streamingOptions?: {
		thinking?: boolean;
		codeReviews?: boolean;
	};
	contextManagement?: {
		autoSummarize?: boolean;
		maxContextLength?: number;
	};
}

import { APIResponseCache } from "./response-cache.js";

export class KiloCodeClient {
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
	private options: KiloCodeOptions;
	private responseCache: APIResponseCache;

	private static instance: KiloCodeClient | null = null;
	private static lastConfigKey: string | null = null;

	static getInstance(config: TehutiConfig): KiloCodeClient {
		const configKey = `${config.apiKey}:${config.model}`;
		if (!KiloCodeClient.instance || KiloCodeClient.lastConfigKey !== configKey) {
			KiloCodeClient.instance = new KiloCodeClient(config);
			KiloCodeClient.lastConfigKey = configKey;
		}
		return KiloCodeClient.instance;
	}

	static resetInstance(): void {
		KiloCodeClient.instance = null;
		KiloCodeClient.lastConfigKey = null;
	}

	constructor(config: TehutiConfig) {
		this.apiKey = config.apiKey ?? process.env.KILO_API_KEY ?? "";
		this.baseUrl = "https://api.kilo.ai/api/gateway";
		this.model = config.model;
		this.fallbackModel = config.fallbackModel ?? "anthropic/claude-sonnet-4";
		this.maxTokens = config.maxTokens ?? 4096;
		this.temperature = config.temperature ?? 0.7;
		this.supportsCaching = false; // KiloCode doesn't mention prompt caching
		this.extendedThinking = config.extendedThinking ?? false;
		this.thinkingBudgetTokens = config.thinkingBudgetTokens;
		this.requestTimeout = this.validateTimeout(config.requestTimeout, 120000);
		this.maxRetries = config.maxRetries ?? 3;
		this.options = {
			memoryBank: config.kilocode?.memoryBank,
			streamingOptions: config.kilocode?.streamingOptions,
			contextManagement: config.kilocode?.contextManagement,
		};
		this.responseCache = APIResponseCache.getInstance();

		if (!this.apiKey) {
			throw new APIError(
				"KiloCode API key is required. Set KILO_API_KEY environment variable or configure in .tehuti.json",
			);
		}

		if (this.apiKey.length < 10) {
			throw new APIError("Invalid KiloCode API key format");
		}

		this.validateModel(this.model);
		this.validateModel(this.fallbackModel);
		this.validateTemperature(this.temperature);
		this.validateMaxTokens(this.maxTokens);
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

		// Add KiloCode specific features
		if (this.options.memoryBank?.enabled) {
			body.memory = {
				session_id: this.options.memoryBank.sessionId,
			};
			debug.log("api", "Memory bank enabled", this.options.memoryBank.sessionId);
		}

		if (this.options.streamingOptions?.thinking) {
			body.thinking = true;
			debug.log("api", "Thinking streaming enabled");
		}

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
						`  • Check KILO_API_KEY environment variable\n` +
						`  • Check ~/.tehuti.json config file\n` +
						`  • Run 'tehuti init' to reconfigure`,
						response.status,
					);
				}
				throw new APIError(
					`KiloCode API error (${response.status}): ${sanitizedError}`,
					response.status,
				);
			}

			const responseBody = response.body;
			if (!responseBody) {
				throw new APIError("No response body to stream");
			}
			reader = responseBody.getReader() as unknown as ReadableStreamDefaultReader<Uint8Array>;

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

		// Add KiloCode specific features
		if (this.options.memoryBank?.enabled) {
			body.memory = {
				session_id: this.options.memoryBank.sessionId,
			};
			debug.log("api", "Memory bank enabled", this.options.memoryBank.sessionId);
		}

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
					`  • Check KILO_API_KEY environment variable\n` +
					`  • Check ~/.tehuti.json config file\n` +
					`  • Run 'tehuti init' to reconfigure`,
					response.status,
				);
			}
			throw new APIError(
				`KiloCode API error (${response.status}): ${sanitizedError}`,
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

	// KiloCode-specific methods
	configureMemoryBank(options: { enabled: boolean; sessionId?: string; persistence?: "memory" | "disk" }): void {
		this.options.memoryBank = options;
		debug.log("api", "Memory bank configured:", JSON.stringify(options));
	}

	configureStreaming(options: { thinking?: boolean; codeReviews?: boolean }): void {
		this.options.streamingOptions = options;
		debug.log("api", "Streaming options configured:", JSON.stringify(options));
	}

	configureContextManagement(options: { autoSummarize?: boolean; maxContextLength?: number }): void {
		this.options.contextManagement = options;
		debug.log("api", "Context management configured:", JSON.stringify(options));
	}

	clearMemory(): void {
		this.options.memoryBank = undefined;
		debug.log("api", "Memory cleared");
	}

	async reviewCode(code: string, options?: {
		language?: string;
		reviewType?: "basic" | "advanced" | "security";
		guidelines?: string[];
	}): Promise<{
		summary: string;
		issues: Array<{
			type: "error" | "warning" | "suggestion";
			message: string;
			line?: number;
			column?: number;
		}>;
		improvements: string[];
	}> {
		const body: Record<string, unknown> = {
			model: this.model,
			messages: [
				{
					role: "system",
					content: "You are an expert code reviewer. Analyze the provided code and provide detailed feedback on quality, security, and best practices.",
				},
				{
					role: "user",
					content: `Please review the following code:\n\n${code}`,
				},
			],
			max_tokens: this.maxTokens,
			temperature: this.temperature,
			stream: false,
		};

		if (this.options.memoryBank?.enabled) {
			body.memory = {
				session_id: this.options.memoryBank.sessionId,
			};
		}

		const response = await this.withRetry(
			() =>
				fetch(`${this.baseUrl}/chat/completions`, {
					method: "POST",
					headers: {
						Authorization: `Bearer ${this.apiKey}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify(body),
				}),
			{ maxRetries: this.maxRetries },
		);

		if (!response.ok) {
			throw new APIError(`Code review failed: ${response.status}`);
		}

		const apiResponse = await response.json() as OpenRouterResponse;
		const content = typeof apiResponse.choices[0].message.content === "string" 
			? apiResponse.choices[0].message.content 
			: apiResponse.choices[0].message.content.map((block: any) => block.text).join("");
		return JSON.parse(content || "{}");
	}

	async summarizeContext(messages: OpenRouterMessage[]): Promise<{
		summary: string;
		keyPoints: string[];
		contextTokens: number;
	}> {
		const body: Record<string, unknown> = {
			model: this.model,
			messages: [
				{
					role: "system",
					content: "You are a context summarization expert. Condense the conversation history into a concise summary with key points.",
				},
				{
					role: "user",
					content: `Please summarize the following conversation history:\n\n${JSON.stringify(messages)}`,
				},
			],
			max_tokens: this.maxTokens,
			temperature: this.temperature,
			stream: false,
		};

		if (this.options.memoryBank?.enabled) {
			body.memory = {
				session_id: this.options.memoryBank.sessionId,
			};
		}

		const response = await this.withRetry(
			() =>
				fetch(`${this.baseUrl}/chat/completions`, {
					method: "POST",
					headers: {
						Authorization: `Bearer ${this.apiKey}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify(body),
				}),
			{ maxRetries: this.maxRetries },
		);

		if (!response.ok) {
			throw new APIError(`Context summarization failed: ${response.status}`);
		}

		const apiResponse = await response.json() as OpenRouterResponse;
		const content = typeof apiResponse.choices[0].message.content === "string" 
			? apiResponse.choices[0].message.content 
			: apiResponse.choices[0].message.content.map((block: any) => block.text).join("");
		return JSON.parse(content || "{}");
	}
}