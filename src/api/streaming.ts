import { debug } from "../utils/debug.js";
import { isReasoningModel } from "./model-capabilities.js";

export interface StreamingState {
	content: string;
	thinking: string;
	contentChunks: string[];
	thinkingChunks: string[];
	toolCalls: Map<number, { id: string; name: string; arguments: string }>;
	finishReason: string | null;
	usage?: {
		promptTokens: number;
		completionTokens: number;
		totalTokens: number;
		cacheReadTokens?: number;
		cacheWriteTokens?: number;
	};
}

export function createStreamingState(modelId?: string): StreamingState {
	if (modelId && isReasoningModel(modelId)) {
		debug.log("streaming", `Reasoning model detected: ${modelId}`);
	}
	const contentChunks: string[] = [];
	const thinkingChunks: string[] = [];
	return {
		get content() { return contentChunks.join(""); },
		set content(v) { contentChunks.length = 0; contentChunks.push(v); },
		get thinking() { return thinkingChunks.join(""); },
		set thinking(v) { thinkingChunks.length = 0; thinkingChunks.push(v); },
		contentChunks,
		thinkingChunks,
		toolCalls: new Map(),
		finishReason: null,
	};
}

export function processStreamChunk(
	state: StreamingState,
	chunk: {
		choices: {
			delta: {
				content?: string;
				thinking?: string;
				reasoning?: string;
				tool_calls?: {
					index: number;
					id?: string;
					function?: { name?: string; arguments?: string };
				}[];
			};
			finish_reason: string | null;
		}[];
		usage?: {
			prompt_tokens: number;
			completion_tokens: number;
			total_tokens: number;
			cache_read_input_tokens?: number;
			cache_creation_input_tokens?: number;
		};
	},
	modelId?: string,
): {
	hasContent: boolean;
	newContent: string;
	hasThinking: boolean;
	newThinking: string;
} {
	if (!chunk || typeof chunk !== "object" || Object.keys(chunk).length === 0) {
		return {
			hasContent: false,
			newContent: "",
			hasThinking: false,
			newThinking: "",
		};
	}

	if (chunk.usage) {
		state.usage = {
			promptTokens: chunk.usage.prompt_tokens,
			completionTokens: chunk.usage.completion_tokens,
			totalTokens: chunk.usage.total_tokens,
			cacheReadTokens: chunk.usage.cache_read_input_tokens,
			cacheWriteTokens: chunk.usage.cache_creation_input_tokens,
		};
	}

	const choice = chunk.choices?.[0];
	if (!choice) {
		return {
			hasContent: false,
			newContent: "",
			hasThinking: false,
			newThinking: "",
		};
	}

	const delta = choice.delta;
	let hasContent = false;

	if (!delta) {
		if (choice.finish_reason) {
			state.finishReason = choice.finish_reason;
		}
		return {
			hasContent: false,
			newContent: "",
			hasThinking: false,
			newThinking: "",
		};
	}
	let newContent = "";
	let hasThinking = false;
	let newThinking = "";

	if (delta.content) {
		state.contentChunks.push(delta.content);
		newContent = delta.content;
		hasContent = true;
	}

	if (delta.reasoning) {
		state.thinkingChunks.push(delta.reasoning);
		newThinking = delta.reasoning;
		hasThinking = true;
		if (modelId && isReasoningModel(modelId)) {
			debug.log("streaming", `Processing reasoning output from ${modelId}`);
		}
	}

	if (delta.thinking) {
		state.thinkingChunks.push(delta.thinking);
		newThinking = delta.thinking;
		hasThinking = true;
	}

	if (delta.tool_calls) {
		for (const tc of delta.tool_calls) {
			const index = tc.index;
			const existing = state.toolCalls.get(index);

			const newArgs = tc.function?.arguments ?? "";
			const currentArgs = existing?.arguments ?? "";
			const mergedArgs = currentArgs + newArgs;

			if (tc.id) {
				state.toolCalls.set(index, {
					id: tc.id,
					name: tc.function?.name ?? existing?.name ?? "",
					arguments: mergedArgs,
				});
			} else if (tc.function?.name) {
				state.toolCalls.set(index, {
					id: existing?.id ?? "",
					name: tc.function.name,
					arguments: mergedArgs,
				});
			} else if (tc.function?.arguments) {
				if (existing) {
					existing.arguments += tc.function.arguments;
				} else {
					state.toolCalls.set(index, {
						id: "",
						name: "",
						arguments: tc.function.arguments,
					});
				}
			}
		}
	}

	if (choice.finish_reason) {
		state.finishReason = choice.finish_reason;
	}

	return { hasContent, newContent, hasThinking, newThinking };
}

export function getToolCallsFromState(state: StreamingState): {
	id: string;
	type: "function";
	function: { name: string; arguments: string };
}[] {
	const entries = Array.from(state.toolCalls.entries());
	entries.sort((a, b) => a[0] - b[0]);
	return entries.map(([, tc]) => ({
		id: tc.id,
		type: "function" as const,
		function: {
			name: tc.name,
			arguments: tc.arguments,
		},
	}));
}

export async function* processStreamAsync(
	stream: AsyncIterable<{
		choices: {
			delta: { content?: string; reasoning?: string; tool_calls?: unknown[] };
			finish_reason: string | null;
		}[];
		usage?: unknown;
	}>,
	yieldThresholdMs: number = 16,
): AsyncGenerator<
	{
		hasContent: boolean;
		newContent: string;
		hasThinking: boolean;
		newThinking: string;
		content: string;
		reasoning: string;
		toolCalls: any[];
		chunk: any;
	},
	void,
	unknown
> {
	const state = createStreamingState();
	let lastYield = Date.now();

	for await (const chunk of stream) {
		const result = processStreamChunk(
			state,
			chunk as Parameters<typeof processStreamChunk>[1],
		);
		yield {
			...result,
			content: state.content,
			reasoning: state.thinking,
			toolCalls: getToolCallsFromState(state),
			chunk,
		};

		// HTTP/3 Backpressure-Aware SSE concepts:
		// Yielding to the event loop when processing a fast stream prevents buffer bloat
		// and allows underlying HTTP/3 / TCP stack to manage flow control (backpressure).
		const now = Date.now();
		if (now - lastYield > yieldThresholdMs) {
			await new Promise((resolve) => setImmediate(resolve));
			lastYield = now;
		}
	}
}
