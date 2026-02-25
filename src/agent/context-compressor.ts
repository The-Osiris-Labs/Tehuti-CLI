import type { OpenRouterMessage } from "../api/openrouter.js";

export interface CompressionOptions {
	targetTokens: number;
	keepFirstN: number;
	keepLastN: number;
	chunkSize: number;
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
	targetTokens: 80000,
	keepFirstN: 2,
	keepLastN: 10,
	chunkSize: 5,
};

const CRITICAL_PATTERNS = [
	/error/i,
	/failed/i,
	/exception/i,
	/important/i,
	/critical/i,
	/todo/i,
	/fixme/i,
	/decision/i,
	/confirmed/i,
	/completed/i,
];

const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g;

function estimateTokens(messages: OpenRouterMessage[]): number {
	let total = 0;
	for (const msg of messages) {
		const content =
			typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
		total += Math.ceil(content.length / 4);
		total += 10;
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

function extractCodeBlocks(text: string): string[] {
	const blocks: string[] = [];
	let match;
	while ((match = CODE_BLOCK_PATTERN.exec(text)) !== null) {
		blocks.push(match[0]);
	}
	return blocks;
}

function calculateMessageImportance(msg: OpenRouterMessage): number {
	const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);

	let score = 0;

	for (const pattern of CRITICAL_PATTERNS) {
		if (pattern.test(content)) {
			score += 10;
		}
	}

	const codeBlocks = extractCodeBlocks(content);
	score += codeBlocks.length * 5;

	if (msg.role === "system") {
		score += 100;
	}

	if (msg.role === "tool") {
		score += 15;
	}

	const hasFileReferences = /(?:file|path|directory|folder)[:\s]+['"`]?([\/.][^'"`\s]+)/i.test(content);
	if (hasFileReferences) {
		score += 5;
	}

	return score;
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

function summarizeWithoutLLM(messages: OpenRouterMessage[]): OpenRouterMessage[] {
	const summaries: OpenRouterMessage[] = [];

	for (const msg of messages) {
		const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
		const importance = calculateMessageImportance(msg);

		if (importance >= 20) {
			summaries.push(msg);
			continue;
		}

		const truncated = content.length > 500 ? content.slice(0, 500) + "...[truncated]" : content;
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
	options: Partial<CompressionOptions> = {},
): Promise<OpenRouterMessage[]> {
	const opts = { ...DEFAULT_OPTIONS, ...options };

	if (messages.length <= opts.keepFirstN + opts.keepLastN) {
		return messages;
	}

	const currentTokens = estimateTokens(messages);

	if (currentTokens <= opts.targetTokens) {
		return messages;
	}

	const keepFirst = messages.slice(0, opts.keepFirstN);
	const keepLast = messages.slice(-opts.keepLastN);
	const toCompress = messages.slice(opts.keepFirstN, -opts.keepLastN);

	if (toCompress.length === 0) {
		return messages;
	}

	const chunks = chunk(toCompress, opts.chunkSize);
	const summaries: OpenRouterMessage[] = [];

	for (const chunkMessages of chunks) {
		try {
			const summary = await summarizeChunk(chunkMessages, summarizer);
			summaries.push(summary);
		} catch {
			const chunkSummaries = summarizeWithoutLLM(chunkMessages);
			summaries.push(...chunkSummaries);
		}
	}

	const compressed = [...keepFirst, ...summaries, ...keepLast];

	return compressed;
}

export function compressContextWithMetrics(
	messages: OpenRouterMessage[],
	summarizer: (text: string) => Promise<string>,
	options: Partial<CompressionOptions> = {},
): Promise<CompressionResult> {
	const opts = { ...DEFAULT_OPTIONS, ...options };
	const originalTokens = estimateTokens(messages);

	return compressContext(messages, summarizer, opts).then((compressed) => {
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

export function identifyCriticalMessages(messages: OpenRouterMessage[]): number[] {
	const criticalIndices: number[] = [];

	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i];

		if (msg.role === "system") {
			criticalIndices.push(i);
			continue;
		}

		const importance = calculateMessageImportance(msg);
		if (importance >= 20) {
			criticalIndices.push(i);
		}
	}

	return criticalIndices;
}

export function progressiveCompress(
	messages: OpenRouterMessage[],
	targetTokens: number,
): OpenRouterMessage[] {
	let currentTokens = estimateTokens(messages);

	if (currentTokens <= targetTokens) {
		return messages;
	}

	let compressed = [...messages];
	const criticalIndices = new Set(identifyCriticalMessages(messages));

	while (currentTokens > targetTokens && compressed.length > 4) {
		const nonCritical = compressed
			.map((m, i) => ({ msg: m, originalIndex: i, importance: calculateMessageImportance(m) }))
			.filter((_, i) => !criticalIndices.has(i))
			.sort((a, b) => a.importance - b.importance);

		if (nonCritical.length === 0) break;

		const toRemove = Math.max(1, Math.floor(nonCritical.length / 4));
		const indicesToRemove = new Set(nonCritical.slice(0, toRemove).map((x) => x.originalIndex));

		compressed = compressed.filter((_, i) => !indicesToRemove.has(i));
		currentTokens = estimateTokens(compressed);
	}

	return compressed;
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
