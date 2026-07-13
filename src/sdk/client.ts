/**
 * Tehuti TypeScript SDK
 *
 * Type-safe client for the Tehuti public API.
 * Can be used programmatically to interact with a running Tehuti instance.
 */

export interface TehutiSDKConfig {
	/** Base URL of the Tehuti API server */
	baseUrl: string;
	/** API key for authentication */
	apiKey?: string;
	/** Request timeout in milliseconds */
	timeout?: number;
}

export interface ChatMessage {
	role: "user" | "assistant" | "system";
	content: string;
}

export interface ChatOptions {
	/** Model to use */
	model?: string;
	/** Provider to use */
	provider?: string;
	/** Whether to use streaming */
	stream?: boolean;
	/** Temperature (0-2) */
	temperature?: number;
	/** Maximum tokens to generate */
	maxTokens?: number;
	/** Stop sequences */
	stop?: string[];
}

export interface ChatResponse {
	/** Response content */
	content: string;
	/** Finish reason */
	finishReason: "stop" | "length" | "tool_calls" | "error" | "unknown";
	/** Token usage */
	usage: {
		promptTokens: number;
		completionTokens: number;
		totalTokens: number;
	};
	/** Tool calls made during the response */
	toolCalls?: Array<{
		name: string;
		args: Record<string, unknown>;
	}>;
}

export interface SessionInfo {
	sessionId: string;
	startedAt: number;
	model: string;
	provider: string;
}

export interface ConfigInfo {
	provider: string;
	model: string;
	apiKey: string;
	baseUrl: string;
}

export interface HealthStatus {
	status: "ok" | "degraded" | "error";
	timestamp: number;
	version?: string;
}

export interface ToolInfo {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
	provider: "built-in" | "mcp" | "plugin";
}

export class TehutiSDK {
	private baseUrl: string;
	private apiKey?: string;
	private timeout: number;

	constructor(config: TehutiSDKConfig) {
		this.baseUrl = config.baseUrl.replace(/\/$/, "");
		this.apiKey = config.apiKey;
		this.timeout = config.timeout || 30000;
	}

	/**
	 * Make an HTTP request to the Tehuti API
	 */
	private async request<T>(
		method: string,
		path: string,
		body?: unknown,
	): Promise<T> {
		const url = `${this.baseUrl}${path}`;
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};

		if (this.apiKey) {
			headers["Authorization"] = `Bearer ${this.apiKey}`;
		}

		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), this.timeout);

		try {
			const response = await fetch(url, {
				method,
				headers,
				body: body ? JSON.stringify(body) : undefined,
				signal: controller.signal,
			});

			if (!response.ok) {
				const errorBody = await response.text();
				throw new TehutiAPIError(
					response.status,
					response.statusText,
					errorBody,
				);
			}

			return (await response.json()) as T;
		} finally {
			clearTimeout(timeoutId);
		}
	}

	/**
	 * Check server health
	 */
	async health(): Promise<HealthStatus> {
		return this.request<HealthStatus>("GET", "/health");
	}

	/**
	 * Get current session information
	 */
	async getSession(): Promise<SessionInfo> {
		return this.request<SessionInfo>("GET", "/session");
	}

	/**
	 * Send a chat message and get a response
	 */
	async chat(
		message: string,
		options?: ChatOptions,
	): Promise<ChatResponse> {
		return this.request<ChatResponse>("POST", "/chat", {
			message,
			...options,
		});
	}

	/**
	 * Send multiple messages in a conversation
	 */
	async chatMessages(
		messages: ChatMessage[],
		options?: ChatOptions,
	): Promise<ChatResponse> {
		return this.request<ChatResponse>("POST", "/chat", {
			messages,
			...options,
		});
	}

	/**
	 * Get configuration
	 */
	async getConfig(): Promise<ConfigInfo> {
		return this.request<ConfigInfo>("GET", "/config");
	}

	/**
	 * List available tools
	 */
	async listTools(): Promise<ToolInfo[]> {
		return this.request<ToolInfo[]>("GET", "/tools");
	}

	/**
	 * Create a new session
	 */
	async createSession(options?: { model?: string; provider?: string }): Promise<SessionInfo> {
		return this.request<SessionInfo>("POST", "/sessions", options);
	}

	/**
	 * List active sessions
	 */
	async listSessions(): Promise<SessionInfo[]> {
		return this.request<SessionInfo[]>("GET", "/sessions");
	}
}

/**
 * Error class for Tehuti API errors
 */
export class TehutiAPIError extends Error {
	public statusCode: number;
	public statusText: string;
	public responseBody: string;

	constructor(statusCode: number, statusText: string, responseBody: string) {
		super(`Tehuti API Error ${statusCode}: ${statusText}`);
		this.name = "TehutiAPIError";
		this.statusCode = statusCode;
		this.statusText = statusText;
		this.responseBody = responseBody;
	}
}

/**
 * Create a new Tehuti SDK instance
 */
export function createTehutiSDK(config: TehutiSDKConfig): TehutiSDK {
	return new TehutiSDK(config);
}

export default TehutiSDK;
