const { z } = require("zod");

const OpenRouterToolCallSchema = z
	.object({
		id: z.string().optional(),
		type: z.literal("function").optional(),
		function: z
			.object({
				name: z.string().optional(),
				arguments: z.string().optional(),
			})
			.optional(),
	})
	.passthrough();

const OpenRouterStreamChunkSchema = z
	.object({
		id: z.string().optional().default(""),
		choices: z.array(
			z
				.object({
					index: z.number().optional().default(0),
					delta: z
						.object({
							role: z.string().optional(),
							content: z.string().nullable().optional(),
							reasoning: z.string().nullable().optional(),
							thinking: z.string().nullable().optional(),
							tool_calls: z.array(OpenRouterToolCallSchema).optional(),
						})
						.passthrough()
						.optional()
						.default({}),
					finish_reason: z.string().nullable().optional(),
				})
				.passthrough(),
		).optional().default([]),
		usage: z
			.object({
				prompt_tokens: z.number(),
				completion_tokens: z.number(),
				total_tokens: z.number(),
				cache_read_input_tokens: z.number().optional(),
				cache_creation_input_tokens: z.number().optional(),
			})
			.passthrough()
			.optional(),
	})
	.passthrough();

const json1 = '{"choices": [{"index": 0, "finish_reason": "stop"}]}';
const parsed1 = JSON.parse(json1);
console.log("Test 1 (missing delta):", OpenRouterStreamChunkSchema.safeParse(parsed1).success);

const json2 = '{"id":"chatcmpl-123","object":"chat.completion.chunk","created":123,"model":"deepseek","usage":{"prompt_tokens":10,"completion_tokens":20,"total_tokens":30}}';
const parsed2 = JSON.parse(json2);
console.log("Test 2 (missing choices):", OpenRouterStreamChunkSchema.safeParse(parsed2).success);

const json3 = '{"error":{"message":"Rate limit","type":"invalid_request_error","param":null,"code":"rate_limit_exceeded"}}';
const parsed3 = JSON.parse(json3);
console.log("Test 3 (error chunk):", OpenRouterStreamChunkSchema.safeParse(parsed3).success);

