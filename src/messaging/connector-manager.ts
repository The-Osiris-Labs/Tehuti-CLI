import * as crypto from "node:crypto";
import { EventEmitter } from "node:events";
import * as http from "node:http";
import { SessionResolver } from "./session-resolver.js";

export interface UnifiedMessageEvent {
	platform: "slack" | "discord" | "telegram" | "whatsapp";
	senderId: string;
	sessionId: string;
	content: string;
	channelId?: string;
	threadId?: string;
	messageId?: string;
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
	private webhookServer: http.Server | null = null;

	constructor(config: ConnectorConfig) {
		super();
		this.config = config;
	}

	private ensureWebhookServer(port = 3333): http.Server {
		if (this.webhookServer) return this.webhookServer;
		this.webhookServer = http.createServer();
		this.webhookServer.listen(port, () => {
			console.log(`[Webhook] Server listening on port ${port}`);
		});
		return this.webhookServer;
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
	// @ts-expect-error TS6133/TS6192: Unused variable
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

	private async initSlackSocketMode(attempt = 0): Promise<void> {
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
		try {
			const res = await fetch("https://slack.com/api/apps.connections.open", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${slackAppToken}`,
					"Content-Type": "application/x-www-form-urlencoded",
				},
				signal: AbortSignal.timeout(10000),
			});
			const data = (await res.json()) as any;
			if (!data.ok) throw new Error(data.error || "Failed to get WSS URL");

			// Native WebSocket in Node >= 21 or v20 with flag
			const ws = new WebSocket(data.url);
			ws.onopen = () => {
				attempt = 0;
			};
			ws.onmessage = async (event: MessageEvent) => {
				const payload = JSON.parse(event.data as string);
				if (payload.type === "hello") return;

				if (payload.envelope_id) {
					ws.send(JSON.stringify({ envelope_id: payload.envelope_id }));
				}

				if (
					payload.payload?.event?.type === "message" &&
					!payload.payload.event.bot_id
				) {
					await this.handleIncomingMessage(
						"slack",
						payload.payload.event.user,
						payload.payload.event.text || "",
						payload,
						payload.payload.event.channel,
						payload.payload.event.thread_ts,
						payload.payload.event.ts,
					);
				}
			};

			ws.onclose = () => {
				const delay =
					Math.min(60000, 1000 * 2 ** attempt) + Math.random() * 500;
				console.log(
					`[Slack] Connection closed. Reconnecting in ${Math.round(delay)}ms...`,
				);
				setTimeout(() => this.initSlackSocketMode(attempt + 1), delay);
			};
		} catch (err) {
			const delay = Math.min(60000, 1000 * 2 ** attempt) + Math.random() * 500;
			console.error("[Slack] Connection error:", err);
			setTimeout(() => this.initSlackSocketMode(attempt + 1), delay);
		}
	}

	private async initDiscordGateway(attempt = 0): Promise<void> {
		const discordToken =
			this.config.messaging?.discordToken ?? this.config.discordToken;

		if (!discordToken) {
			console.warn(
				"[Discord] Missing required credentials (discordToken). Skipping Discord connection.",
			);
			return;
		}

		console.log("[Discord] Connecting to Discord Gateway...");
		let heartbeatInterval: any;
		try {
			const ws = new WebSocket("wss://gateway.discord.gg/?v=10&encoding=json");

			ws.onopen = () => {
				attempt = 0;
				ws.send(
					JSON.stringify({
						op: 2,
						d: {
							token: discordToken,
							intents: 512 + 32768 + 4096, // GUILDS, GUILD_MESSAGES, MESSAGE_CONTENT, DIRECT_MESSAGES
							properties: { os: "linux", browser: "tehuti", device: "tehuti" },
						},
					}),
				);
			};

			ws.onmessage = async (event: MessageEvent) => {
				const payload = JSON.parse(event.data as string);
				const { t, op, d } = payload;

				if (op === 10) {
					const interval = d.heartbeat_interval;
					heartbeatInterval = setInterval(() => {
						if (ws.readyState === WebSocket.OPEN) {
							ws.send(JSON.stringify({ op: 1, d: null }));
						}
					}, interval);
				}

				if (t === "MESSAGE_CREATE" && !d.author?.bot) {
					await this.handleIncomingMessage(
						"discord",
						d.author.id,
						d.content || "",
						payload,
						d.channel_id,
						undefined,
						d.id,
					);
				}
			};

			ws.onclose = () => {
				clearInterval(heartbeatInterval);
				const delay =
					Math.min(60000, 1000 * 2 ** attempt) + Math.random() * 500;
				console.log(
					`[Discord] Connection closed. Reconnecting in ${Math.round(delay)}ms...`,
				);
				setTimeout(() => this.initDiscordGateway(attempt + 1), delay);
			};
		} catch (err) {
			const delay = Math.min(60000, 1000 * 2 ** attempt) + Math.random() * 500;
			console.error("[Discord] Connection error:", err);
			setTimeout(() => this.initDiscordGateway(attempt + 1), delay);
		}
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
		const server = this.ensureWebhookServer();

		server.on("request", (req, res) => {
			if (
				req.method === "POST" &&
				req.url === `/telegram/${telegramBotToken}`
			) {
				let body = "";
				req.on("data", (chunk) => {
					body += chunk.toString();
				});
				req.on("end", async () => {
					try {
						const payload = JSON.parse(body);
						if (payload.message?.text && !payload.message.from?.is_bot) {
							await this.handleIncomingMessage(
								"telegram",
								payload.message.from.id.toString(),
								payload.message.text,
								payload,
								payload.message.chat.id.toString(),
								payload.message.reply_to_message?.message_id?.toString(),
								payload.message.message_id.toString(),
							);
						}
						res.writeHead(200);
						res.end("OK");
					} catch (err) {
						res.writeHead(500);
						res.end("Internal Server Error");
					}
				});
			}
		});
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
		const server = this.ensureWebhookServer();

		server.on("request", (req, res) => {
			// Webhook verification challenge
			if (req.method === "GET" && req.url?.startsWith("/whatsapp")) {
				const url = new URL(req.url, "http://localhost");
				const mode = url.searchParams.get("hub.mode");
				const token = url.searchParams.get("hub.verify_token");
				const challenge = url.searchParams.get("hub.challenge");

				if (mode === "subscribe" && token === whatsappWebhookSecret) {
					res.writeHead(200);
					res.end(challenge);
				} else {
					res.writeHead(403);
					res.end();
				}
				return;
			}

			// Webhook incoming message
			if (req.method === "POST" && req.url?.startsWith("/whatsapp")) {
				let body = "";
				req.on("data", (chunk) => {
					body += chunk.toString();
				});
				req.on("end", async () => {
					try {
						const signature = req.headers["x-hub-signature-256"] as string;
						const expected = `sha256=${crypto.createHmac("sha256", whatsappWebhookSecret).update(body).digest("hex")}`;
						if (signature !== expected) {
							res.writeHead(403);
							res.end("Invalid signature");
							return;
						}

						const payload = JSON.parse(body);
						if (payload.object === "whatsapp_business_account") {
							for (const entry of payload.entry) {
								for (const change of entry.changes) {
									if (change.value?.messages) {
										for (const msg of change.value.messages) {
											if (msg.type === "text") {
												await this.handleIncomingMessage(
													"whatsapp",
													msg.from,
													msg.text.body,
													payload,
													msg.from, // channelId is from
													msg.context?.id,
													msg.id,
												);
											}
										}
									}
								}
							}
						}
						res.writeHead(200);
						res.end("OK");
					} catch (err) {
						res.writeHead(500);
						res.end("Internal Server Error");
					}
				});
			}
		});
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
		channelId?: string,
		threadId?: string,
		messageId?: string,
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
			channelId,
			threadId,
			messageId,
			rawPayload,
		};

		this.emit("message", event);
	}

	public async sendMessage(
		platform: "slack" | "discord" | "telegram" | "whatsapp",
		channelId: string,
		content: string,
		threadId?: string,
	): Promise<void> {
		try {
			if (platform === "slack") {
				const slackBotToken =
					this.config.messaging?.slackBotToken ?? this.config.slackBotToken;
				if (!slackBotToken) throw new Error("Missing Slack Bot Token");
				const res = await fetch("https://slack.com/api/chat.postMessage", {
					method: "POST",
					headers: {
						Authorization: `Bearer ${slackBotToken}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						channel: channelId,
						text: content,
						thread_ts: threadId,
					}),
					signal: AbortSignal.timeout(10000),
				});
				const data = (await res.json()) as any;
				if (!data.ok) throw new Error(data.error);
			} else if (platform === "discord") {
				const discordToken =
					this.config.messaging?.discordToken ?? this.config.discordToken;
				if (!discordToken) throw new Error("Missing Discord Token");
				const res = await fetch(
					`https://discord.com/api/v10/channels/${channelId}/messages`,
					{
						method: "POST",
						headers: {
							Authorization: `Bot ${discordToken}`,
							"Content-Type": "application/json",
						},
						body: JSON.stringify({
							content: content,
							message_reference: threadId
								? { message_id: threadId }
								: undefined,
						}),
						signal: AbortSignal.timeout(10000),
					},
				);
				if (!res.ok) throw new Error(`Discord API Error: ${res.statusText}`);
			} else if (platform === "telegram") {
				const telegramBotToken =
					this.config.messaging?.telegramBotToken ??
					this.config.telegramBotToken;
				if (!telegramBotToken) throw new Error("Missing Telegram Bot Token");
				const res = await fetch(
					`https://api.telegram.org/bot${telegramBotToken}/sendMessage`,
					{
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							chat_id: channelId,
							text: content,
							reply_to_message_id: threadId
								? parseInt(threadId, 10)
								: undefined,
						}),
						signal: AbortSignal.timeout(10000),
					},
				);
				if (!res.ok) throw new Error(`Telegram API Error: ${res.statusText}`);
			} else if (platform === "whatsapp") {
				const whatsappToken =
					this.config.messaging?.whatsappToken ?? this.config.whatsappToken;
				const whatsappPhoneNumberId =
					this.config.messaging?.whatsappPhoneNumberId ??
					this.config.whatsappPhoneNumberId;
				if (!whatsappToken || !whatsappPhoneNumberId)
					throw new Error("Missing WhatsApp Credentials");
				const res = await fetch(
					`https://graph.facebook.com/v17.0/${whatsappPhoneNumberId}/messages`,
					{
						method: "POST",
						headers: {
							Authorization: `Bearer ${whatsappToken}`,
							"Content-Type": "application/json",
						},
						body: JSON.stringify({
							messaging_product: "whatsapp",
							to: channelId,
							text: { body: content },
							context: threadId ? { message_id: threadId } : undefined,
						}),
						signal: AbortSignal.timeout(10000),
					},
				);
				if (!res.ok) throw new Error(`WhatsApp API Error: ${res.statusText}`);
			} else {
				throw new Error(`Unsupported platform: ${platform}`);
			}
		} catch (error) {
			console.error(`[${platform}] Error sending message:`, error);
			throw error;
		}
	}

	public async stop(): Promise<void> {
		if (this.webhookServer) {
			await new Promise<void>((resolve) => {
				this.webhookServer?.close(() => {
					resolve();
				});
			});
			this.webhookServer = null;
		}
		this.removeAllListeners();
		console.log("[ConnectorManager] Stopped.");
	}
}
