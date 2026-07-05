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

export { estimateTokens };
