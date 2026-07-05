import { resolveBaseUrlForProvider } from "../config/providers.js";
import type { TehutiConfig } from "../config/schema.js";
import { debug } from "../utils/debug.js";
import { APIError } from "../utils/errors.js";
import { BaseAPIClient } from "./base-client.js";

// KiloCode specific features
export interface KiloCodeOptions {
	memoryBank?: {
		enabled?: boolean;
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

export class KiloCodeClient extends BaseAPIClient {
	private options: KiloCodeOptions;

	private static instance: KiloCodeClient | null = null;
	private static lastConfigKey: string | null = null;

	static getInstance(config: TehutiConfig): KiloCodeClient {
		const configKey = [
			config.provider || "kilocode",
			config.apiKey || "",
			config.model,
			config.requestTimeout ?? "",
			JSON.stringify(config.kilocode ?? {}),
		].join(":");
		if (
			!KiloCodeClient.instance ||
			KiloCodeClient.lastConfigKey !== configKey
		) {
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
		const providerId = "kilocode";
		const providerLabel = "KiloCode";
		const apiKey = config.apiKey ?? process.env.KILO_API_KEY ?? "";
		const baseUrl =
			resolveBaseUrlForProvider("kilocode", config.baseUrl) ??
			"https://api.kilo.ai/api/gateway";

		if (!apiKey) {
			throw new APIError(
				"KiloCode API key is required. Set KILO_API_KEY environment variable or configure in .tehuti.json",
			);
		}

		if (apiKey.length < 10) {
			throw new APIError("Invalid KiloCode API key format");
		}

		super({
			providerId,
			providerLabel,
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
			supportsCaching: false, // KiloCode doesn't mention prompt caching
		});

		this.options = {
			memoryBank: config.kilocode?.memoryBank,
			streamingOptions: config.kilocode?.streamingOptions,
			contextManagement: config.kilocode?.contextManagement,
		};
	}

	protected override buildHeaders(): Record<string, string> {
		return {
			Authorization: `Bearer ${this.apiKey}`,
			"Content-Type": "application/json",
		};
	}

	protected override getProviderErrorSubject(): string {
		return "KiloCode";
	}

	protected override getProviderAuthHints(): string[] {
		return [
			"Check KILO_API_KEY environment variable",
			"Check ~/.tehuti.json config file",
		];
	}

	protected override buildRequestBody(
		messages: import("./base-client.js").StandardMessage[],
		tools?: import("./base-client.js").StandardTool[],
		modelOverride?: string,
		isStream: boolean = true,
	): Record<string, unknown> {
		const body = super.buildRequestBody(messages, tools, modelOverride, isStream);

		if (this.options.memoryBank?.enabled) {
			body.memory = {
				session_id: this.options.memoryBank.sessionId,
			};
			debug.log(
				"api",
				"Memory bank enabled",
				this.options.memoryBank.sessionId,
			);
		}

		return body;
	}

	// KiloCode-specific methods
	configureMemoryBank(options: {
		enabled: boolean;
		sessionId?: string;
		persistence?: "memory" | "disk";
	}): void {
		this.options.memoryBank = options;
		debug.log("api", "Memory bank configured:", JSON.stringify(options));
	}

	configureStreaming(options: {
		thinking?: boolean;
		codeReviews?: boolean;
	}): void {
		this.options.streamingOptions = options;
		debug.log("api", "Streaming options configured:", JSON.stringify(options));
	}

	configureContextManagement(options: {
		autoSummarize?: boolean;
		maxContextLength?: number;
	}): void {
		this.options.contextManagement = options;
		debug.log("api", "Context management configured:", JSON.stringify(options));
	}

	clearMemory(): void {
		this.options.memoryBank = undefined;
		debug.log("api", "Memory cleared");
	}

	async reviewCode(
		code: string,
		_options?: {
			language?: string;
			reviewType?: "basic" | "advanced" | "security";
			guidelines?: string[];
		},
	): Promise<{
		summary: string;
		issues: Array<{
			type: "error" | "warning" | "suggestion";
			message: string;
			line?: number;
			column?: number;
		}>;
		improvements: string[];
	}> {
		const messages: import("./base-client.js").StandardMessage[] = [
			{
				role: "system",
				content:
					"You are an expert code reviewer. Analyze the provided code and provide detailed feedback on quality, security, and best practices.",
			},
			{
				role: "user",
				content: `Please review the following code:\n\n${code}`,
			},
		];

		const response = await this.completeChat(messages, undefined, this.model);
		const content =
			typeof response.choices[0].message.content === "string"
				? response.choices[0].message.content
				: response.choices[0].message.content
						.map((block: any) => block.text)
						.join("");
		return JSON.parse(content || "{}");
	}

	async summarizeContext(messages: import("./base-client.js").StandardMessage[]): Promise<{
		summary: string;
		keyPoints: string[];
		contextTokens: number;
	}> {
		const sysMsg: import("./base-client.js").StandardMessage = {
			role: "system",
			content:
				"You are a context summarization expert. Condense the conversation history into a concise summary with key points.",
		};
		const userMsg: import("./base-client.js").StandardMessage = {
			role: "user",
			content: `Please summarize the following conversation history:\n\n${JSON.stringify(messages)}`,
		};

		const response = await this.completeChat([sysMsg, userMsg], undefined, this.model);

		const content =
			typeof response.choices[0].message.content === "string"
				? response.choices[0].message.content
				: response.choices[0].message.content
						.map((block: any) => block.text)
						.join("");
		return JSON.parse(content || "{}");
	}
}
