import type { OpenRouterMessage } from "../api/openrouter.js";
import { getEncoding } from "js-tiktoken";

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
	messages: OpenRouterMessage[];
	removedCount: number;
	compressedCount: number;
	originalTokens: number;
	newTokens: number;
	savedTokens: number;
}

const DEFAULT_OPTIONS: CompressionOptions = {
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

function estimateTokens(messages: OpenRouterMessage[]): number {
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

function chunk<T>(array: T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let i = 0; i < array.length; i += size) {
		chunks.push(array.slice(i, i + size));
	}
	return chunks;
}

function calculateMessageImportance(
	msg: OpenRouterMessage,
	options: CompressionOptions = DEFAULT_OPTIONS
): number {
	let score = 0;

	// PIN system prompts
	if (msg.role === "system") {
		return Number.MAX_SAFE_INTEGER;
	}

	if (msg.role === "assistant") {
		score += options.weights.assistant;
		if (msg.tool_calls && msg.tool_calls.length > 0) {
			score += options.weights.toolCall * msg.tool_calls.length;
		}
	} else if (msg.role === "tool") {
		score += options.weights.toolResult;
	}

	let content = "";
	if (typeof msg.content === "string") {
		content = msg.content;
	} else if (msg.content !== undefined && msg.content !== null) {
		content = JSON.stringify(msg.content);
	}
	
	score -= Math.floor(content.length * options.weights.lengthPenalty);

	if (Array.isArray(msg.content)) {
		score += msg.content.length * 10;
	}

	return Math.max(-5000, score);
}

async function summarizeChunk(
	messages: OpenRouterMessage[],
	summarizer: (text: string) => Promise<string>,
): Promise<OpenRouterMessage> {
	const chunkText = messages
		.map((m) => {
			const content =
				typeof m.content === "string" ? m.content : JSON.stringify(m.content);
			return `${m.role}: ${content}`;
		})
		.join("\n\n");

	const summary = await summarizer(chunkText);

	return {
		role: "assistant",
		content: `[Previous Context Summary] ${summary}`,
	};
}

function summarizeWithoutLLM(
	messages: OpenRouterMessage[],
	options: CompressionOptions = DEFAULT_OPTIONS
): OpenRouterMessage[] {
	const summaries: OpenRouterMessage[] = [];

	for (const msg of messages) {
		const content =
			typeof msg.content === "string"
				? msg.content
				: JSON.stringify(msg.content);
		const importance = calculateMessageImportance(msg, options);

		if (importance >= 20) {
			summaries.push(msg);
			continue;
		}

		const truncated =
			content.length > 500 ? content.slice(0, 500) + "...[truncated]" : content;
		summaries.push({
			role: msg.role,
			content: `[Condensed] ${truncated}`,
		});
	}

	return summaries;
}

export async function compressContext(
	messages: OpenRouterMessage[],
	summarizer: (text: string) => Promise<string>,
	targetTokens: number,
	options: Partial<CompressionOptions> = {},
): Promise<OpenRouterMessage[]> {
	const opts = { ...DEFAULT_OPTIONS, ...options };

	if (messages.length <= opts.keepFirstN + opts.keepLastN) {
		return messages;
	}

	const currentTokens = estimateTokens(messages);

	if (currentTokens <= targetTokens) {
		return messages;
	}

	const keepFirst = messages.slice(0, opts.keepFirstN);
	const keepLast = messages.slice(-opts.keepLastN);
	const toCompress = messages.slice(opts.keepFirstN, -opts.keepLastN);

	if (toCompress.length === 0) {
		return messages;
	}

	// Separate system messages from items that will be chunk-summarized
	const systemMessages = toCompress.filter((m) => m.role === "system");
	const compressableMessages = toCompress.filter((m) => m.role !== "system");

	if (compressableMessages.length === 0) {
		return [...keepFirst, ...systemMessages, ...keepLast];
	}

	const chunks = chunk(compressableMessages, opts.chunkSize);
	const summaries: OpenRouterMessage[] = [];

	for (const chunkMessages of chunks) {
		try {
			const summary = await summarizeChunk(chunkMessages, summarizer);
			summaries.push(summary);
		} catch {
			const chunkSummaries = summarizeWithoutLLM(chunkMessages, opts);
			summaries.push(...chunkSummaries);
		}
	}

	const compressed = [...keepFirst, ...systemMessages, ...summaries, ...keepLast];

	return compressed;
}

export function compressContextWithMetrics(
	messages: OpenRouterMessage[],
	summarizer: (text: string) => Promise<string>,
	targetTokens: number,
	options: Partial<CompressionOptions> = {},
): Promise<CompressionResult> {
	const opts = { ...DEFAULT_OPTIONS, ...options };
	const originalTokens = estimateTokens(messages);

	return compressContext(messages, summarizer, targetTokens, opts).then((compressed) => {
		const newTokens = estimateTokens(compressed);
		return {
			messages: compressed,
			removedCount: messages.length - compressed.length,
			compressedCount: compressed.length,
			originalTokens,
			newTokens,
			savedTokens: originalTokens - newTokens,
		};
	});
}

export function identifyCriticalMessages(
	messages: OpenRouterMessage[],
	options: CompressionOptions = DEFAULT_OPTIONS
): number[] {
	const criticalIndices: number[] = [];

	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i];

		if (msg.role === "system" || msg.role === "user") {
			criticalIndices.push(i);
			continue;
		}

		const importance = calculateMessageImportance(msg, options);
		if (importance >= 100) {
			criticalIndices.push(i);
		}
	}

	return criticalIndices;
}

export function progressiveCompress(
	messages: OpenRouterMessage[],
	targetTokens: number,
	options: CompressionOptions = DEFAULT_OPTIONS
): OpenRouterMessage[] {
	let currentTokens = estimateTokens(messages);

	if (currentTokens <= targetTokens) {
		return messages;
	}

	// Pre-map static metadata once to avoid index shifts & redundant computations
	let annotated = messages.map((msg) => {
		const importance = calculateMessageImportance(msg, options);
		const isCritical = msg.role === "system" || msg.role === "user" || importance >= 100;
		return { msg, importance, isCritical };
	});

	while (currentTokens > targetTokens && annotated.length > 4) {
		const nonCritical = annotated
			.map((item, index) => ({ item, index }))
			.filter(({ item }) => !item.isCritical)
			.sort((a, b) => a.item.importance - b.item.importance);

		if (nonCritical.length === 0) break;

		const toRemove = Math.max(1, Math.floor(nonCritical.length / 4));
		const indicesToRemove = new Set(
			nonCritical.slice(0, toRemove).map((x) => x.index),
		);

		annotated = annotated.filter((_, index) => !indicesToRemove.has(index));
		currentTokens = estimateTokens(annotated.map((x) => x.msg));
	}

	return annotated.map((x) => x.msg);
}

export function createContextSummarizer(
	simpleModelCall: (prompt: string) => Promise<string>,
): (text: string) => Promise<string> {
	return async (text: string): Promise<string> => {
		const prompt = `Summarize the following conversation context in 2-3 sentences, preserving key decisions, outcomes, and any errors encountered:

${text.slice(0, 3000)}

Summary:`;

		try {
			const summary = await simpleModelCall(prompt);
			return summary.trim();
		} catch {
			return "Context was summarized but details are no longer available.";
		}
	};
}

export function createSmartSummarizer(
	modelCall: (prompt: string, systemPrompt?: string) => Promise<string>,
): (text: string, context?: string) => Promise<string> {
	const systemPrompt = `You are a context summarizer for an AI coding assistant. Your job is to create concise summaries that preserve:
1. Key decisions made and their reasoning
2. Important code patterns or structures discovered
3. Errors encountered and their resolutions
4. File paths and project structure information
5. Pending tasks or todos

Be extremely concise. Focus on information that would help continue the conversation without repetition.`;

	return async (text: string, context?: string): Promise<string> => {
		const contextHint = context ? `Context: ${context}\n\n` : "";
		const prompt = `${contextHint}Summarize the following:

${text.slice(0, 4000)}

Summary:`;

		try {
			const summary = await modelCall(prompt, systemPrompt);
			return summary.trim();
		} catch {
			return "Context summarized.";
		}
	};
}

export { estimateTokens };
