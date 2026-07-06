export type Platform = "slack" | "discord" | "telegram" | "whatsapp";

/**
 * Standard inbound message from any messaging platform.
 */
export interface InboundMessage {
	/** Unique message identifier from the platform */
	id: string;
	/** The platform the message originated from */
	platform: Platform;
	/** Unique identifier for the sender/user */
	senderId: string;
	/** Unique identifier for the channel/thread */
	channelId: string;
	/** The raw text content of the message */
	content: string;
	/** When the message was sent */
	timestamp: Date;
	/** Any platform-specific raw data */
	metadata?: Record<string, unknown>;
}

/**
 * Standard outbound message to any messaging platform.
 */
export interface OutboundMessage {
	/** The platform to send the message to */
	platform: Platform;
	/** Unique identifier for the recipient/channel */
	recipientId: string;
	/** The formatted content to send (could be chunked for some platforms) */
	content: string | string[];
	/** Any platform-specific instructions or raw data */
	metadata?: Record<string, unknown>;
}
