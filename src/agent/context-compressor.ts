import { getEncoding } from "js-tiktoken";
import type { StandardMessage } from "../api/base-client.js";

const tokenizer = getEncoding("cl100k_base");

export interface CompressionOptions {
	keepFirstN: number;
	keepLastN: number;
	chunkSize: number;
	weights: {
		assistant: number;
		toolCall: number;
		toolResult: number;
		lengthPenalty: number;
	};
}

export interface CompressionResult {
	messages: StandardMessage[];
	removedCount: number;
	compressedCount: number;
	originalTokens: number;
	newTokens: number;
	savedTokens: number;
}

const _DEFAULT_OPTIONS: CompressionOptions = {
	keepFirstN: 2,
	keepLastN: 10,
	chunkSize: 5,
	weights: {
		assistant: 50,
		toolCall: 500,
		toolResult: 15,
		lengthPenalty: 0.05,
	},
};

function encodeStringSafely(str: string): number {
	if (str.length <= 4000) {
		return tokenizer.encode(str).length;
	}
	const sample = str.slice(0, 4000);
	const sampleTokens = tokenizer.encode(sample).length;
	return Math.ceil((sampleTokens / 4000) * str.length);
}

function estimateTokens(messages: StandardMessage[]): number {
	let total = 0;
	for (const msg of messages) {
		let content = "";
		if (typeof msg.content === "string") {
			content = msg.content;
		} else if (Array.isArray(msg.content)) {
			content = msg.content
				.map((c) => (typeof c === "string" ? c : JSON.stringify(c)))
				.join("");
		} else if (msg.content !== undefined && msg.content !== null) {
			content = JSON.stringify(msg.content);
		}

		if (msg.tool_calls) {
			content += JSON.stringify(msg.tool_calls);
		}

		if (msg.name) {
			content += msg.name;
		}

		total += encodeStringSafely(content) + 10;
	}
	return total;
}

export function compressContext(
	messages: StandardMessage[],
	options: Partial<CompressionOptions> = {},
): CompressionResult {
	const opts = { ..._DEFAULT_OPTIONS, ...options };
	const originalTokens = estimateTokens(messages);

	const systemMessages = messages.filter((m) => m.role === "system");
	const nonSystemMessages = messages.filter((m) => m.role !== "system");

	if (nonSystemMessages.length <= opts.keepFirstN + opts.keepLastN) {
		return {
			messages,
			removedCount: 0,
			compressedCount: 0,
			originalTokens,
			newTokens: originalTokens,
			savedTokens: 0,
		};
	}

	const firstN = nonSystemMessages.slice(0, opts.keepFirstN);
	const recentMessages = nonSystemMessages.slice(-opts.keepLastN);
	const midMessages = nonSystemMessages.slice(opts.keepFirstN, -opts.keepLastN);

	let summaryContent = `[${midMessages.length} earlier messages compacted for context efficiency]\n\n`;

	for (const msg of midMessages) {
		let preview = "";
		if (typeof msg.content === "string") {
			// Safely respect reasoning block boundaries
			const c = msg.content.replace(
				/<(think|thinking|reasoning)>[\s\S]*?(?:<\/\1>|$)/g,
				"[Thought Process]",
			);

			// Never accidentally slice a JSON tool_call object mid-string during heavy compression
			const trimmed = c.trim();
			if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
				preview = "[JSON Payload]";
			} else {
				preview =
					c.substring(0, 100).replace(/\n/g, " ") +
					(c.length > 100 ? "..." : "");
			}
		} else if (Array.isArray(msg.content)) {
			preview = "[Multipart Content]";
		} else if (msg.content !== undefined && msg.content !== null) {
			preview = "[Object Content]";
		}

		if (msg.tool_calls) {
			const tools = msg.tool_calls
				.map((tc) => tc.function?.name)
				.filter(Boolean)
				.join(", ");
			preview += preview ? ` | Tool calls: ${tools}` : `Tool calls: ${tools}`;
		}

		if (msg.name) {
			preview = `[${msg.name}] ${preview}`;
		}

		summaryContent += `- ${msg.role}: ${preview || "[No content]"}\n`;
	}

	const compressedMessage: StandardMessage = {
		role: "user",
		content: summaryContent,
	};

	const newMessages = [
		...systemMessages,
		...firstN,
		compressedMessage,
		...recentMessages,
	];
	const newTokens = estimateTokens(newMessages);

	return {
		messages: newMessages,
		removedCount: midMessages.length,
		compressedCount: midMessages.length,
		originalTokens,
		newTokens,
		savedTokens: originalTokens - newTokens,
	};
}

export { estimateTokens };

export function identifyCriticalMessages(messages: any): number[] {
	const indices: number[] = [];
	messages.forEach((m: any, i: number) => {
		if (m.role === "system" || m.role === "user" || m.tool_calls || m.name) {
			indices.push(i);
		}
	});
	return indices;
}
export async function compressContextWithMetrics(
	messages: any,
	_summarizer: any,
	_target: number,
	_opts: any,
) {
	return { messages, tokensSaved: 0, compressionRatio: 1 };
}
export function progressiveCompress(messages: any, _target: number) {
	return messages;
}
export function createContextSummarizer() {
	return async () => "";
}
export function createSmartSummarizer() {
	return async () => "";
}
