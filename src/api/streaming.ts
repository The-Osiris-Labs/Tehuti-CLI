import { isReasoningModel } from "./model-capabilities.js";
import { debug } from "../utils/debug.js";

export interface StreamingState {
	content: string;
	thinking: string;
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
	return {
		content: "",
		thinking: "",
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
	const choice = chunk.choices[0];
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
	let newContent = "";
	let hasThinking = false;
	let newThinking = "";

	if (delta.content) {
		state.content += delta.content;
		newContent = delta.content;
		hasContent = true;
	}

	if (delta.reasoning) {
		state.thinking += delta.reasoning;
		newThinking = delta.reasoning;
		hasThinking = true;
		if (modelId && isReasoningModel(modelId)) {
			debug.log("streaming", `Processing reasoning output from ${modelId}`);
		}
	}

	if (delta.thinking) {
		state.thinking += delta.thinking;
		newThinking = delta.thinking;
		hasThinking = true;
	}

	if (delta.tool_calls) {
		for (const tc of delta.tool_calls) {
			const index = tc.index;
			const existing = state.toolCalls.get(index);

			if (tc.id) {
				state.toolCalls.set(index, {
					id: tc.id,
					name: tc.function?.name ?? existing?.name ?? "",
					arguments: tc.function?.arguments ?? existing?.arguments ?? "",
				});
			} else if (tc.function?.name) {
				state.toolCalls.set(index, {
					id: existing?.id ?? "",
					name: tc.function.name,
					arguments: tc.function.arguments ?? existing?.arguments ?? "",
				});
			} else if (tc.function?.arguments && existing) {
				existing.arguments += tc.function.arguments;
			}
		}
	}

	if (choice.finish_reason) {
		state.finishReason = choice.finish_reason;
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
): AsyncGenerator<string, void, unknown> {
	const state = createStreamingState();

	for await (const chunk of stream) {
		const { hasContent, newContent } = processStreamChunk(
			state,
			chunk as Parameters<typeof processStreamChunk>[1],
		);
		if (hasContent && newContent) {
			yield newContent;
		}
	}
}
