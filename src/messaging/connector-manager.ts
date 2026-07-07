import { EventEmitter } from "node:events";
import { SessionResolver } from "./session-resolver.js";

export interface UnifiedMessageEvent {
	platform: "slack" | "discord" | "telegram" | "whatsapp";
	senderId: string;
	sessionId: string;
	content: string;
	rawPayload: unknown;
}

export interface ConnectorConfig {
	slackAppToken?: string;
	discordToken?: string;
	telegramWebhookSecret?: string;
	whatsappWebhookSecret?: string;
}

export class ConnectorManager extends EventEmitter {
	private config: ConnectorConfig;
	private sessionResolver = new SessionResolver();

	constructor(config: ConnectorConfig) {
		super();
		this.config = config;
	}

	/**
	 * Initializes WebSocket clients for Slack and Discord,
	 * and registers HTTP endpoints for Telegram and WhatsApp webhooks.
	 */
	public async initialize(): Promise<void> {
		this.initSlackSocketMode();
		this.initDiscordGateway();
		this.registerTelegramWebhook();
		this.registerWhatsAppWebhook();
	}

	/**
	 * Connects to a WebSocket-based service using an exponential backoff strategy
	 * with jitter to prevent reconnect storms.
	 */
	private async connectWithBackoff(
		platform: string,
		connectFn: () => Promise<void>,
		maxRetries = 10,
	): Promise<void> {
		let attempt = 0;
		const baseDelay = 1000; // 1 second
		const maxDelay = 60000; // 1 minute max backoff

		while (attempt < maxRetries) {
			try {
				await connectFn();
				console.log(`[${platform}] Connected successfully.`);
				return;
			} catch (error) {
				attempt++;
				const errMessage = error instanceof Error ? error.message : String(error);

				if (attempt >= maxRetries) {
					console.error(`[${platform}] Exhausted max retries (${maxRetries}): ${errMessage}`);
					if (this.listenerCount("error") > 0) {
						this.emit("error", new Error(`Max retries reached for ${platform}`));
					}
					return;
				}

				// Exponential backoff: baseDelay * 2^(attempt - 1)
				const delay = Math.min(maxDelay, baseDelay * Math.pow(2, attempt - 1));
				// Add jitter: random between 0 and 500ms
				const jitter = Math.random() * 500;
				const sleepTime = delay + jitter;

				console.warn(
					`[${platform}] Connection failed: ${errMessage}. ` +
						`Retrying in ${Math.round(sleepTime)}ms (attempt ${attempt}/${maxRetries})...`,
				);

				await new Promise((resolve) => setTimeout(resolve, sleepTime));
			}
		}
	}

	private initSlackSocketMode(): void {
		if (!this.config.slackAppToken) return;

		const start = async () => {
			while (true) {
				await this.connectWithBackoff("Slack", async () => {
					console.log("Initializing Slack Socket Mode...");
					// In a real implementation, this would throw on connection failure
					// e.g. await slackClient.start();
				});
				await new Promise(resolve => setTimeout(resolve, 5000));
			}
		};
		start().catch((err) => {
			console.error("Slack backoff wrapper threw an unexpected error", err);
		});
	}

	private initDiscordGateway(): void {
		if (!this.config.discordToken) return;

		const start = async () => {
			while (true) {
				await this.connectWithBackoff("Discord", async () => {
					console.log("Initializing Discord Gateway...");
					// In a real implementation, this would throw on connection failure
					// e.g. await discordClient.login(this.config.discordToken);
				});
				await new Promise(resolve => setTimeout(resolve, 5000));
			}
		};
		start().catch((err) => {
			console.error("Discord backoff wrapper threw an unexpected error", err);
		});
	}

	private registerTelegramWebhook(): void {
		if (!this.config.telegramWebhookSecret) return;
		// Mock implementation for Telegram Webhook
		console.log("Registering Telegram Webhook endpoint...");
	}

	private registerWhatsAppWebhook(): void {
		if (!this.config.whatsappWebhookSecret) return;
		// Mock implementation for WhatsApp Webhook
		console.log("Registering WhatsApp Webhook endpoint...");
	}

	/**
	 * Resolves the inbound sender ID to a persistent session ID
	 * (e.g. from SQLite `messaging_sessions`).
	 */
	private async resolveSessionId(
		platform: string,
		senderId: string,
	): Promise<string> {
		return this.sessionResolver.resolveSession(`${platform}_${senderId}`);
	}

	/**
	 * Handles an incoming message from any platform, resolves the session,
	 * and emits a unified event.
	 */
	public async handleIncomingMessage(
		platform: "slack" | "discord" | "telegram" | "whatsapp",
		senderId: string,
		content: string,
		rawPayload: unknown,
	): Promise<void> {
		const sessionId = await this.resolveSessionId(platform, senderId);

		let normalizedContent = content;
		if (platform === "slack" || platform === "discord") {
			// Normalize platform-specific mention syntax (e.g., <@U12345>, <@!12345>) to a standard bot mention
			normalizedContent = normalizedContent.replace(/<@!?[A-Z0-9]+>/ig, "@Tehuti");
		}

		const event: UnifiedMessageEvent = {
			platform,
			senderId,
			sessionId,
			content: normalizedContent,
			rawPayload,
		};

		this.emit("message", event);
	}
}
