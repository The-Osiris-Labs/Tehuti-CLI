import { z } from "zod";
import { debug } from "../utils/debug.js";
import { APIError } from "../utils/errors.js";

export interface CacheControl {
	type: "ephemeral";
	ttl?: "1h";
}

export interface TextBlock {
	type: "text";
	text: string;
	cache_control?: CacheControl;
	timestamp?: number;
	internalId?: string;
}

export interface ImageUrlBlock {
	type: "image_url";
	image_url: {
		url: string;
	};
	cache_control?: CacheControl;
	timestamp?: number;
	internalId?: string;
}

export type ContentBlock = TextBlock | ImageUrlBlock;

export interface StandardMessage {
	role: "system" | "user" | "assistant" | "tool";
	content: string | ContentBlock[];
	name?: string;
	tool_call_id?: string;
	tool_calls?: StandardToolCall[];
	cache_control?: CacheControl;
	timestamp?: number;
	internalId?: string;
}

export interface StandardToolCall {
	id: string;
	type: "function";
	function: {
		name: string;
		arguments: string;
	};
}

export interface StandardTool {
	type: "function";
	function: {
		name: string;
		description: string;
		parameters: Record<string, unknown>;
	};
}

export interface StandardStreamChunk {
	id: string;
	choices: {
		index: number;
		delta: {
			role?: string;
			content?: string;
			reasoning?: string;
			thinking?: string;
			tool_calls?: Partial<StandardToolCall>[];
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

export const StandardToolCallSchema = z
	.object({
		id: z.string().optional(),
		type: z.literal("function").optional(),
		function: z
			.object({
				name: z.string().optional(),
				arguments: z.string().optional(),
			})
			.optional(),
	})
	.passthrough();

export const StandardStreamChunkSchema = z
	.object({
		id: z.string().optional().default(""),
		choices: z
			.array(
				z
					.object({
						index: z.number().optional().default(0),
						delta: z
							.object({
								role: z.string().optional(),
								content: z.string().nullable().optional(),
								reasoning: z.string().nullable().optional(),
								thinking: z.string().nullable().optional(),
								tool_calls: z.array(StandardToolCallSchema).optional(),
							})
							.passthrough()
							.optional()
							.default({}),
						finish_reason: z.string().nullable().optional(),
					})
					.passthrough(),
			)
			.optional()
			.default([]),
		usage: z
			.object({
				prompt_tokens: z.number(),
				completion_tokens: z.number(),
				total_tokens: z.number(),
				cache_read_input_tokens: z.number().optional(),
				cache_creation_input_tokens: z.number().optional(),
			})
			.passthrough()
			.nullable()
			.optional(),
	})
	.passthrough();

export interface StandardResponse {
	id: string;
	choices: {
		index: number;
		message: StandardMessage;
		finish_reason: string | null;
	}[];
	usage: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
	};
}

export const MAX_MESSAGE_LENGTH = 1000000;
export const MAX_MESSAGES = 1000;
export const MAX_MODEL_NAME_LENGTH = 256;
export const VALID_MODEL_PATTERN = /^[a-zA-Z0-9_\-./:]+$/;
export const MIN_TIMEOUT_MS = 5000;
export const MAX_TIMEOUT_MS = 600000;
export const MAX_RETRY_DELAY_MS = 60000;
export const BASE_RETRY_DELAY_MS = 1000;

export abstract class BaseAPIClient {
	protected apiKey: string;
	protected baseUrl: string;
	protected model: string;
	protected providerId: string;
	protected fallbackModel: string;
	protected providerLabel: string;
	protected maxTokens: number;
	protected temperature: number;
	protected abortController: AbortController | null = null;
	protected supportsCaching: boolean;
	protected extendedThinking: boolean;
	protected thinkingBudgetTokens?: number;
	protected requestTimeout: number;
	protected maxRetries: number;
	private lastRequestTime: number = 0;
	private minRequestInterval: number = 100;

	constructor(config: {
		providerId: string;
		providerLabel: string;
		apiKey: string;
		baseUrl: string;
		model: string;
		fallbackModel?: string;
		maxTokens?: number;
		temperature?: number;
		supportsCaching?: boolean;
		extendedThinking?: boolean;
		thinkingBudgetTokens?: number;
		requestTimeout?: number;
		maxRetries?: number;
	}) {
		this.providerId = config.providerId;
		this.providerLabel = config.providerLabel;
		this.apiKey = config.apiKey;
		this.baseUrl = config.baseUrl;
		this.model = config.model;
		this.fallbackModel = config.fallbackModel || config.model;
		this.maxTokens = config.maxTokens ?? 32000;
		this.temperature = config.temperature ?? 0.7;
		this.supportsCaching = config.supportsCaching ?? false;
		this.extendedThinking = config.extendedThinking ?? false;
		this.thinkingBudgetTokens = config.thinkingBudgetTokens;
		this.requestTimeout = this.validateTimeout(config.requestTimeout, 120000);
		this.maxRetries = config.maxRetries ?? 3;

		this.validateModel(this.model);
		this.validateModel(this.fallbackModel);
		this.validateTemperature(this.temperature);
		this.validateMaxTokens(this.maxTokens);
	}

	protected abstract buildHeaders(): Promise<Record<string, string>>;
	protected abstract getProviderErrorSubject(): string;
	protected abstract getProviderAuthHints(): string[];

	protected getChatCompletionsUrl(): string {
		return `${this.baseUrl}/chat/completions`;
	}

	protected getModelsUrl(): string {
		return `${this.baseUrl}/models`;
	}

	protected validateTimeout(
		timeout: number | undefined,
		defaultMs: number,
	): number {
		if (timeout === undefined) return defaultMs;
		if (typeof timeout !== "number" || !Number.isFinite(timeout)) {
			throw new APIError("requestTimeout must be a valid number");
		}
		return Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, timeout));
	}

	protected validateModel(model: string): void {
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

	protected validateTemperature(temp: number): void {
		if (typeof temp !== "number" || !Number.isFinite(temp)) {
			throw new APIError("Temperature must be a valid number");
		}
		if (temp < 0 || temp > 2) {
			throw new APIError("Temperature must be between 0 and 2");
		}
	}

	protected validateMaxTokens(tokens: number): void {
		if (typeof tokens !== "number" || !Number.isFinite(tokens)) {
			throw new APIError("maxTokens must be a valid number");
		}
		if (tokens < 1 || tokens > 1000000) {
			throw new APIError("maxTokens must be between 1 and 1000000");
		}
	}

	/**
	 * Runtime override for maxTokens, typically called after model resolution
	 * to inject the real maxOutputTokens from live model capabilities.
	 */
	public setMaxTokens(n: number): void {
		this.validateMaxTokens(n);
		this.maxTokens = n;
	}

	public validateMessages(messages: StandardMessage[]): void {
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
					.filter((c): c is TextBlock => c.type === "text")
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

	protected async enforceRateLimit(): Promise<void> {
		const now = Date.now();
		const elapsed = now - this.lastRequestTime;
		if (elapsed < this.minRequestInterval) {
			await this.sleep(this.minRequestInterval - elapsed);
		}
		this.lastRequestTime = Date.now();
	}

	protected prepareMessagesWithCaching(
		messages: StandardMessage[],
		_tools?: StandardTool[],
	): StandardMessage[] {
		if (!this.supportsCaching) {
			return messages;
		}

		const processedMessages: StandardMessage[] = [];

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
						: (msg.content as ContentBlock[])
								.filter((c): c is TextBlock => c.type === "text")
								.map((c) => c.text)
								.join("");

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

	protected prepareToolsWithCaching(
		tools?: StandardTool[],
	): (StandardTool & { cache_control?: CacheControl })[] | undefined {
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

	protected async sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	protected async withRetry<T>(
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
			msg.includes("socket hang up") ||
			msg.includes("terminated") ||
			msg.includes("err_http3_") ||
			msg.includes("err_quic_") ||
			msg.includes("nghttp3") ||
			msg.includes("und_err_") ||
			msg.includes("h3_") ||
			msg.includes("protocol error")
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

	protected handleResponseError(
		response: Response,
		errorText: string,
	): APIError {
		const sanitizedError = errorText
			.slice(0, 500)
			.replace(/sk-[a-zA-Z0-9_-]+/g, "[REDACTED]")
			.replace(/api[_-]?key['":\s]*['"]?[a-zA-Z0-9_-]{10,}/gi, "[REDACTED]");

		let apiError: APIError;
		if (response.status === 401) {
			apiError = new APIError(
				`API key appears to be invalid or expired for ${this.getProviderErrorSubject()}.`,
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
			if (!Number.isNaN(parsedSeconds)) {
				(apiError as any).retryAfter = parsedSeconds * 1000;
			} else {
				const parsedDate = Date.parse(retryAfterHeader);
				if (!Number.isNaN(parsedDate)) {
					(apiError as any).retryAfter = Math.max(0, parsedDate - Date.now());
				}
			}
		}

		return apiError;
	}

	protected buildRequestBody(
		messages: StandardMessage[],
		tools?: StandardTool[],
		modelOverride?: string,
		isStream: boolean = true,
	): Record<string, unknown> {
		const model = modelOverride ?? this.model;
		const cachedMessages = this.prepareMessagesWithCaching(messages, tools);
		const cachedTools = this.prepareToolsWithCaching(tools);

		const strippedMessages = cachedMessages.map((msg) => {
			const { timestamp, internalId, ...rest } = msg;
			return rest;
		});

		const body: Record<string, unknown> = {
			model,
			messages: strippedMessages,
			max_tokens: this.maxTokens,
			temperature: this.temperature,
			stream: isStream,
		};

		if (cachedTools && cachedTools.length > 0) {
			body.tools = cachedTools;
		}

		return body;
	}

	async *streamChat(
		messages: StandardMessage[],
		tools?: StandardTool[],
		modelOverride?: string,
		signal?: AbortSignal,
	): AsyncGenerator<StandardStreamChunk, void, unknown> {
		this.validateMessages(messages);

		const abortController = new AbortController();
		this.abortController = abortController;
		const model = modelOverride ?? this.model;

		debug.log("api", `Starting stream with model: ${model}`);
		debug.log("api", `Messages: ${messages.length}`);
		debug.log("api", `Caching enabled: ${this.supportsCaching}`);

		const body = this.buildRequestBody(messages, tools, model, true);

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
						headers: await this.buildHeaders(),
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
				throw new APIError(
					`No response body from ${this.getProviderErrorSubject()}`,
				);
			}

			reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";

			while (true) {
				const { done, value } = await reader.read();

				if (value) {
					buffer += decoder.decode(value, { stream: !done });
				} else if (done) {
					buffer += decoder.decode(new Uint8Array(), { stream: false });
				}

				if (done && buffer.trim() && !buffer.endsWith("\n")) {
					buffer += "\n";
				}

				let newlineIndex: number;
				while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
					const line = buffer.slice(0, newlineIndex);
					buffer = buffer.slice(newlineIndex + 1);

					const trimmed = line.trim();
					if (!trimmed || trimmed === "data: [DONE]") continue;
					if (!trimmed.startsWith("data:")) continue;

					try {
						const json = trimmed.startsWith("data: ")
							? trimmed.slice(6)
							: trimmed.slice(5);
						const parsedJson = JSON.parse(json);

						if (parsedJson.error) {
							const errMsg =
								parsedJson.error.message || JSON.stringify(parsedJson.error);
							throw new APIError(`API Error in stream: ${errMsg}`);
						}

						const result = StandardStreamChunkSchema.safeParse(parsedJson);
						if (!result.success) {
							throw new Error(`Zod validation failed: ${result.error.message}`);
						}
						yield result.data as unknown as StandardStreamChunk;
					} catch (e) {
						if (e instanceof APIError) throw e;

						parseErrorCount++;
						debug.log(
							"stream",
							`Failed to parse chunk (${parseErrorCount}/${MAX_PARSE_ERRORS}): ${trimmed.slice(0, 100)} - Error: ${e instanceof Error ? e.message : String(e)}`,
						);
						if (parseErrorCount >= MAX_PARSE_ERRORS) {
							throw new APIError(
								`Too many stream parse errors (${parseErrorCount}), aborting (502 stream interruption)`,
							);
						}
					}
				}

				if (done) break;
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
					await reader.cancel().catch(() => {});
					reader.releaseLock();
				} catch {}
			}
			this.abortController = null;
		}
	}

	async completeChat(
		messages: StandardMessage[],
		tools?: StandardTool[],
		modelOverride?: string,
		signal?: AbortSignal,
	): Promise<StandardResponse> {
		this.validateMessages(messages);

		const model = modelOverride ?? this.model;

		debug.log("api", `Completing with model: ${model}`);

		const body = this.buildRequestBody(messages, tools, model, false);

		const timeoutSignal = AbortSignal.timeout(this.requestTimeout);
		const combinedSignal = signal
			? AbortSignal.any([signal, timeoutSignal])
			: timeoutSignal;

		const response = await this.withRetry(
			async () => {
				const res = await fetch(this.getChatCompletionsUrl(), {
					method: "POST",
					headers: await this.buildHeaders(),
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

		return response.json() as Promise<StandardResponse>;
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

	async listModels(signal?: AbortSignal): Promise<
		Array<{
			id: string;
			name?: string;
			context_length?: number;
			pricing?: any;
			[k: string]: any;
		}>
	> {
		const timeoutSignal = AbortSignal.timeout(30000);
		const combinedSignal = signal
			? AbortSignal.any([signal, timeoutSignal])
			: timeoutSignal;
		const modelsUrl = this.getModelsUrl();

		const response = await this.withRetry(
			async () => {
				const res = await fetch(modelsUrl, {
					headers: await this.buildHeaders(),
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
		const list = (data?.data || data || []).sort((a: any, b: any) =>
			(a.id || "").localeCompare(b.id || ""),
		);
		return list;
	}

	async validateApiKey(): Promise<{ valid: boolean; error?: string }> {
		const timeoutSignal = AbortSignal.timeout(10000);
		const validateUrl = this.getModelsUrl();

		try {
			const response = await fetch(validateUrl, {
				headers: await this.buildHeaders(),
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
