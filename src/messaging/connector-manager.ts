import { EventEmitter } from "node:events";
import { SessionResolver } from "./session-resolver.js";

export interface UnifiedMessageEvent {
	platform: "slack" | "discord" | "telegram" | "whatsapp";
	senderId: string;
	sessionId: string;
	content: string;
	rawPayload: unknown;
}

export interface MessagingCredentials {
	enabled?: boolean;
	historySize?: number;
	slackAppToken?: string;
	slackBotToken?: string;
	discordToken?: string;
	telegramBotToken?: string;
	telegramWebhookSecret?: string;
	whatsappToken?: string;
	whatsappWebhookSecret?: string;
	whatsappPhoneNumberId?: string;
}

export interface ConnectorConfig extends MessagingCredentials {
	messaging?: MessagingCredentials;
}

export class ConnectorManager extends EventEmitter {
	private config: ConnectorConfig;
	private sessionResolver = new SessionResolver();

	constructor(config: ConnectorConfig) {
		super();
		this.config = config;
	}

	/**
	 * Starts all messaging platform connectors, catching and logging any connection
	 * or implementation errors per-platform so remaining platforms can still connect.
	 */
	public async start(): Promise<void> {
		const platforms: Array<{ name: string; fn: () => Promise<void> }> = [
			{ name: "Slack", fn: () => this.initSlackSocketMode() },
			{ name: "Discord", fn: () => this.initDiscordGateway() },
			{ name: "Telegram", fn: () => this.registerTelegramWebhook() },
			{ name: "WhatsApp", fn: () => this.registerWhatsAppWebhook() },
		];

		for (const platform of platforms) {
			try {
				await platform.fn();
			} catch (error) {
				const errMessage =
					error instanceof Error ? error.message : String(error);
				console.error(
					`[${platform.name}] Failed to start connector: ${errMessage}`,
				);
			}
		}
	}

	/**
	 * Initializes WebSocket clients for Slack and Discord,
	 * and registers HTTP endpoints for Telegram and WhatsApp webhooks.
	 */
	public async initialize(): Promise<void> {
		await this.start();
	}

	/**
	 * Connects to a WebSocket-based service using an exponential backoff strategy
	 * with jitter to prevent reconnect storms.
	 *
	 * NOTE: Currently unused after the messaging refactor. Kept for the next
	 * iteration of `init*` methods that will replace their "throw new Error" stubs
	 * with real connection logic.
	 */
	// biome-ignore lint/correctness/noUnusedPrivateClassMembers: slated for use by next iteration of init* methods
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
				const errMessage =
					error instanceof Error ? error.message : String(error);

				if (attempt >= maxRetries) {
					console.error(
						`[${platform}] Exhausted max retries (${maxRetries}): ${errMessage}`,
					);
					if (this.listenerCount("error") > 0) {
						this.emit(
							"error",
							new Error(`Max retries reached for ${platform}`),
						);
					}
					return;
				}

				// Exponential backoff: baseDelay * 2^(attempt - 1)
				const delay = Math.min(maxDelay, baseDelay * 2 ** (attempt - 1));
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

	private async initSlackSocketMode(): Promise<void> {
		const slackAppToken =
			this.config.messaging?.slackAppToken ?? this.config.slackAppToken;
		const slackBotToken =
			this.config.messaging?.slackBotToken ?? this.config.slackBotToken;

		if (!slackAppToken || !slackBotToken) {
			console.warn(
				"[Slack] Missing required credentials (slackAppToken and/or slackBotToken). Skipping Slack connection.",
			);
			return;
		}

		console.log("[Slack] Connecting to Slack Socket Mode...");
		throw new Error("Not yet implemented: real Slack connection");
	}

	private async initDiscordGateway(): Promise<void> {
		const discordToken =
			this.config.messaging?.discordToken ?? this.config.discordToken;

		if (!discordToken) {
			console.warn(
				"[Discord] Missing required credentials (discordToken). Skipping Discord connection.",
			);
			return;
		}

		console.log("[Discord] Connecting to Discord Gateway...");
		throw new Error("Not yet implemented: real Discord connection");
	}

	private async registerTelegramWebhook(): Promise<void> {
		const telegramBotToken =
			this.config.messaging?.telegramBotToken ?? this.config.telegramBotToken;
		const telegramWebhookSecret =
			this.config.messaging?.telegramWebhookSecret ??
			this.config.telegramWebhookSecret;

		if (!telegramBotToken || !telegramWebhookSecret) {
			console.warn(
				"[Telegram] Missing required credentials (telegramBotToken and/or telegramWebhookSecret). Skipping Telegram connection.",
			);
			return;
		}

		console.log("[Telegram] Connecting to Telegram Webhook endpoint...");
		throw new Error("Not yet implemented: real Telegram connection");
	}

	private async registerWhatsAppWebhook(): Promise<void> {
		const whatsappToken =
			this.config.messaging?.whatsappToken ?? this.config.whatsappToken;
		const whatsappWebhookSecret =
			this.config.messaging?.whatsappWebhookSecret ??
			this.config.whatsappWebhookSecret;
		const whatsappPhoneNumberId =
			this.config.messaging?.whatsappPhoneNumberId ??
			this.config.whatsappPhoneNumberId;

		if (!whatsappToken || !whatsappWebhookSecret || !whatsappPhoneNumberId) {
			console.warn(
				"[WhatsApp] Missing required credentials (whatsappToken, whatsappWebhookSecret, and/or whatsappPhoneNumberId). Skipping WhatsApp connection.",
			);
			return;
		}

		console.log("[WhatsApp] Connecting to WhatsApp Webhook endpoint...");
		throw new Error("Not yet implemented: real WhatsApp connection");
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
			normalizedContent = normalizedContent.replace(
				/<@!?[A-Z0-9]+>/gi,
				"@Tehuti",
			);
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
