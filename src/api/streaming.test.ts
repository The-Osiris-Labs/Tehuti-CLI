import { describe, expect, it } from "vitest";
import {
	createStreamingState,
	getToolCallsFromState,
	processStreamAsync,
	processStreamChunk,
} from "./streaming.js";

describe("Streaming", () => {
	describe("createStreamingState", () => {
		it("should create initial state with empty content", () => {
			const state = createStreamingState();
			expect(state.content).toBe("");
			expect(state.thinking).toBe("");
			expect(state.toolCalls.size).toBe(0);
			expect(state.finishReason).toBeNull();
		});

		it("should not have usage by default", () => {
			const state = createStreamingState();
			expect(state.usage).toBeUndefined();
		});
	});

	describe("processStreamChunk", () => {
		it("should extract content from chunk", () => {
			const state = createStreamingState();
			const chunk = {
				choices: [
					{
						delta: { content: "Hello" },
						finish_reason: null,
					},
				],
			};

			const result = processStreamChunk(state, chunk);

			expect(result.hasContent).toBe(true);
			expect(result.newContent).toBe("Hello");
			expect(state.content).toBe("Hello");
		});

		it("should extract thinking from chunk", () => {
			const state = createStreamingState();
			const chunk = {
				choices: [
					{
						delta: { thinking: "Let me think..." },
						finish_reason: null,
					},
				],
			};

			const result = processStreamChunk(state, chunk);

			expect(result.hasThinking).toBe(true);
			expect(result.newThinking).toBe("Let me think...");
			expect(state.thinking).toBe("Let me think...");
		});

	it("should extract reasoning from chunk into thinking", () => {
		const state = createStreamingState();
		const chunk = {
			choices: [
				{
					delta: { reasoning: "Step 1: Analyze the problem..." },
					finish_reason: null,
				},
			],
		};

		const result = processStreamChunk(state, chunk);

		expect(result.hasThinking).toBe(true);
		expect(result.newThinking).toBe("Step 1: Analyze the problem...");
		expect(state.thinking).toBe("Step 1: Analyze the problem...");
		expect(state.content).toBe("");
	});

		it("should handle empty choices", () => {
			const state = createStreamingState();
			const chunk = { choices: [] };

			const result = processStreamChunk(state, chunk as any);

			expect(result.hasContent).toBe(false);
			expect(result.hasThinking).toBe(false);
		});

		it("should capture finish reason", () => {
			const state = createStreamingState();
			const chunk = {
				choices: [
					{
						delta: {},
						finish_reason: "stop",
					},
				],
			};

			processStreamChunk(state, chunk);

			expect(state.finishReason).toBe("stop");
		});

		it("should capture tool call start", () => {
			const state = createStreamingState();
			const chunk = {
				choices: [
					{
						delta: {
							tool_calls: [
								{
									index: 0,
									id: "call_1",
									function: { name: "test_tool" },
								},
							],
						},
						finish_reason: null,
					},
				],
			};

			processStreamChunk(state, chunk);

			expect(state.toolCalls.size).toBe(1);
			const toolCall = state.toolCalls.get(0);
			expect(toolCall?.id).toBe("call_1");
			expect(toolCall?.name).toBe("test_tool");
		});

		it("should accumulate tool call arguments", () => {
			const state = createStreamingState();

			processStreamChunk(state, {
				choices: [
					{
						delta: {
							tool_calls: [
								{
									index: 0,
									id: "call_1",
									function: { name: "test_tool" },
								},
							],
						},
						finish_reason: null,
					},
				],
			});

			processStreamChunk(state, {
				choices: [
					{
						delta: {
							tool_calls: [
								{
									index: 0,
									function: { arguments: '{"key":' },
								},
							],
						},
						finish_reason: null,
					},
				],
			});

			processStreamChunk(state, {
				choices: [
					{
						delta: {
							tool_calls: [
								{
									index: 0,
									function: { arguments: ' "value"}' },
								},
							],
						},
						finish_reason: null,
					},
				],
			});

			const toolCall = state.toolCalls.get(0);
			expect(toolCall?.arguments).toBe('{"key": "value"}');
		});

		it("should capture usage statistics", () => {
			const state = createStreamingState();
			const chunk = {
				choices: [
					{
						delta: {},
						finish_reason: null,
					},
				],
				usage: {
					prompt_tokens: 100,
					completion_tokens: 50,
					total_tokens: 150,
					cache_read_input_tokens: 20,
					cache_creation_input_tokens: 10,
				},
			};

			processStreamChunk(state, chunk);

			expect(state.usage).toBeDefined();
			expect(state.usage?.promptTokens).toBe(100);
			expect(state.usage?.completionTokens).toBe(50);
			expect(state.usage?.totalTokens).toBe(150);
			expect(state.usage?.cacheReadTokens).toBe(20);
			expect(state.usage?.cacheWriteTokens).toBe(10);
		});

		it("should accumulate content across chunks", () => {
			const state = createStreamingState();

			processStreamChunk(state, {
				choices: [{ delta: { content: "Hello" }, finish_reason: null }],
			});
			processStreamChunk(state, {
				choices: [{ delta: { content: " world" }, finish_reason: null }],
			});

			expect(state.content).toBe("Hello world");
		});

		it("should accumulate thinking across chunks", () => {
			const state = createStreamingState();

			processStreamChunk(state, {
				choices: [{ delta: { thinking: "Let me" }, finish_reason: null }],
			});
			processStreamChunk(state, {
				choices: [{ delta: { thinking: " think..." }, finish_reason: null }],
			});

			expect(state.thinking).toBe("Let me think...");
		});

	it("should accumulate reasoning across chunks into thinking", () => {
		const state = createStreamingState();

		processStreamChunk(state, {
			choices: [{ delta: { reasoning: "Step 1: " }, finish_reason: null }],
		});
		processStreamChunk(state, {
			choices: [{ delta: { reasoning: "Analyze..." }, finish_reason: null }],
		});

		expect(state.thinking).toBe("Step 1: Analyze...");
		expect(state.content).toBe("");
	});

	it("should keep reasoning separate from content", () => {
		const state = createStreamingState();

		processStreamChunk(state, {
			choices: [{ delta: { reasoning: "Thinking..." }, finish_reason: null }],
		});
		processStreamChunk(state, {
			choices: [{ delta: { content: "Answer: " }, finish_reason: null }],
		});
		processStreamChunk(state, {
			choices: [{ delta: { content: "42" }, finish_reason: null }],
		});

		expect(state.thinking).toBe("Thinking...");
		expect(state.content).toBe("Answer: 42");
	});
	});

	describe("getToolCallsFromState", () => {
		it("should return empty array for no tool calls", () => {
			const state = createStreamingState();
			const toolCalls = getToolCallsFromState(state);
			expect(toolCalls).toEqual([]);
		});

		it("should convert tool calls to correct format", () => {
			const state = createStreamingState();

			state.toolCalls.set(0, {
				id: "call_1",
				name: "test_tool",
				arguments: '{"key": "value"}',
			});
			state.toolCalls.set(1, {
				id: "call_2",
				name: "another_tool",
				arguments: "{}",
			});

			const toolCalls = getToolCallsFromState(state);

			expect(toolCalls.length).toBe(2);
			expect(toolCalls[0]).toEqual({
				id: "call_1",
				type: "function",
				function: {
					name: "test_tool",
					arguments: '{"key": "value"}',
				},
			});
			expect(toolCalls[1]).toEqual({
				id: "call_2",
				type: "function",
				function: {
					name: "another_tool",
					arguments: "{}",
				},
			});
		});

		it("should sort tool calls by index", () => {
			const state = createStreamingState();

			state.toolCalls.set(2, {
				id: "call_3",
				name: "third",
				arguments: "{}",
			});
			state.toolCalls.set(0, {
				id: "call_1",
				name: "first",
				arguments: "{}",
			});
			state.toolCalls.set(1, {
				id: "call_2",
				name: "second",
				arguments: "{}",
			});

			const toolCalls = getToolCallsFromState(state);

			expect(toolCalls[0].function.name).toBe("first");
			expect(toolCalls[1].function.name).toBe("second");
			expect(toolCalls[2].function.name).toBe("third");
		});
	});

	describe("processStreamAsync", () => {
		it("should yield content from stream", async () => {
			async function* mockStream() {
				yield {
					choices: [{ delta: { content: "Hello" }, finish_reason: null }],
				};
				yield {
					choices: [{ delta: { content: " world" }, finish_reason: null }],
				};
				yield {
					choices: [{ delta: {}, finish_reason: "stop" }],
				};
			}

			const tokens: string[] = [];
			for await (const token of processStreamAsync(mockStream())) {
				tokens.push(token);
			}

			expect(tokens).toEqual(["Hello", " world"]);
		});

	it("should not yield reasoning as content from stream", async () => {
		async function* mockStream() {
			yield {
				choices: [{ delta: { reasoning: "Thinking..." }, finish_reason: null }],
			};
			yield {
				choices: [{ delta: { content: "Answer" }, finish_reason: null }],
			};
		}

		const tokens: string[] = [];
		for await (const token of processStreamAsync(mockStream())) {
			tokens.push(token);
		}

		expect(tokens).toEqual(["Answer"]);
	});

		it("should handle empty stream", async () => {
			async function* mockStream() {
				// Empty
			}

			const tokens: string[] = [];
			for await (const token of processStreamAsync(mockStream())) {
				tokens.push(token);
			}

			expect(tokens).toEqual([]);
		});
	});
});
