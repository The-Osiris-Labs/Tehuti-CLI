export interface ModelCapabilityInfo {
	id: string;
	name: string;
	provider: string;
	isReasoning: boolean;
	reasoningField: "reasoning" | "thinking" | "none";
}

export const REASONING_MODELS: ReadonlySet<string> = new Set([
	"giga-potato",
	"giga-potato-thinking",
	"z-ai/glm-4.5-air:free",
	"z-ai/glm-4.5-air",
	"z-ai/glm-5:free",
	"z-ai/glm-5",
	"z-ai/glm-4.5",
	"deepseek/deepseek-reasoner",
	"deepseek/deepseek-r1",
	"deepseek/deepseek-r1:free",
	"deepseek/deepseek-r1-distill-llama-70b",
	"deepseek/deepseek-r1-distill-qwen-32b",
	"openai/o1",
	"openai/o1-preview",
	"openai/o1-mini",
	"openai/o3-mini",
	"openai/o3",
	"openai/gpt-5",
	"anthropic/claude-3.7-sonnet",
	"anthropic/claude-sonnet-4.5",
	"anthropic/claude-opus-4.5",
	"google/gemini-2.5-pro",
	"google/gemini-2.5-flash",
	"google/gemini-3-pro-preview",
	"google/gemini-3-flash-preview",
	"x-ai/grok-3",
	"x-ai/grok-3-mini",
	"minimax/minimax-m2",
	"minimax/minimax-m2.1",
	"moonshot/kimi-k2-thinking",
	"moonshot/kimi-k2.5",
	"alibaba/qwen-qwq-32b",
	"alibaba/qwen-qwq-plus",
]);

export const REASONING_MODEL_PATTERNS: ReadonlyArray<RegExp> = [
	/^giga-potato/i,
	/^z-ai\/glm/i,
	/^deepseek\/.*r1/i,
	/^deepseek\/.*reasoner/i,
	/^openai\/o[13]/i,
	/^anthropic\/claude-3\.7/i,
	/^anthropic\/claude-sonnet-4\.5/i,
	/^anthropic\/claude-opus-4\.5/i,
	/^google\/gemini-2\.5/i,
	/^google\/gemini-3/i,
	/^x-ai\/grok/i,
	/^minimax\/minimax-m2/i,
	/^moonshot\/kimi-k2/i,
	/^alibaba\/qwen-qwq/i,
	/:thinking$/i,
];

export function isReasoningModel(modelId: string): boolean {
	if (REASONING_MODELS.has(modelId)) {
		return true;
	}
	for (const pattern of REASONING_MODEL_PATTERNS) {
		if (pattern.test(modelId)) {
			return true;
		}
	}
	return false;
}

export function getReasoningField(modelId: string): "reasoning" | "thinking" | "none" {
	if (!isReasoningModel(modelId)) {
		return "none";
	}
	return "reasoning";
}

export const MODEL_CAPABILITIES: ReadonlyMap<string, ModelCapabilityInfo> = new Map([
	[
		"giga-potato",
		{
			id: "giga-potato",
			name: "Giga Potato",
			provider: "Kilo",
			isReasoning: false,
			reasoningField: "none",
		},
	],
	[
		"giga-potato-thinking",
		{
			id: "giga-potato-thinking",
			name: "Giga Potato Thinking",
			provider: "Kilo",
			isReasoning: true,
			reasoningField: "reasoning",
		},
	],
	[
		"minimax/minimax-m2.5:free",
		{
			id: "minimax/minimax-m2.5:free",
			name: "MiniMax M2.5",
			provider: "MiniMax",
			isReasoning: true,
			reasoningField: "reasoning",
		},
	],
	[
		"arcee-ai/trinity-large-preview:free",
		{
			id: "arcee-ai/trinity-large-preview:free",
			name: "Arcee AI Trinity Large",
			provider: "Arcee AI",
			isReasoning: false,
			reasoningField: "none",
		},
	],
	[
		"z-ai/glm-4.5-air:free",
		{
			id: "z-ai/glm-4.5-air:free",
			name: "GLM 4.5 Air",
			provider: "Z.ai",
			isReasoning: true,
			reasoningField: "reasoning",
		},
	],
	[
		"z-ai/glm-5:free",
		{
			id: "z-ai/glm-5:free",
			name: "GLM 5",
			provider: "Z.ai",
			isReasoning: true,
			reasoningField: "reasoning",
		},
	],
	[
		"deepseek/deepseek-reasoner",
		{
			id: "deepseek/deepseek-reasoner",
			name: "DeepSeek Reasoner",
			provider: "DeepSeek",
			isReasoning: true,
			reasoningField: "reasoning",
		},
	],
	[
		"deepseek/deepseek-r1",
		{
			id: "deepseek/deepseek-r1",
			name: "DeepSeek R1",
			provider: "DeepSeek",
			isReasoning: true,
			reasoningField: "reasoning",
		},
	],
	[
		"openai/o1",
		{
			id: "openai/o1",
			name: "O1",
			provider: "OpenAI",
			isReasoning: true,
			reasoningField: "reasoning",
		},
	],
	[
		"openai/o3-mini",
		{
			id: "openai/o3-mini",
			name: "O3 Mini",
			provider: "OpenAI",
			isReasoning: true,
			reasoningField: "reasoning",
		},
	],
	[
		"anthropic/claude-3.7-sonnet",
		{
			id: "anthropic/claude-3.7-sonnet",
			name: "Claude 3.7 Sonnet",
			provider: "Anthropic",
			isReasoning: true,
			reasoningField: "reasoning",
		},
	],
	[
		"anthropic/claude-sonnet-4.5",
		{
			id: "anthropic/claude-sonnet-4.5",
			name: "Claude Sonnet 4.5",
			provider: "Anthropic",
			isReasoning: true,
			reasoningField: "reasoning",
		},
	],
]);

export function getModelCapabilities(modelId: string): ModelCapabilityInfo | undefined {
	if (MODEL_CAPABILITIES.has(modelId)) {
		return MODEL_CAPABILITIES.get(modelId);
	}
	if (isReasoningModel(modelId)) {
		return {
			id: modelId,
			name: modelId.split("/")[1] ?? modelId,
			provider: modelId.split("/")[0] ?? "Unknown",
			isReasoning: true,
			reasoningField: "reasoning",
		};
	}
	return undefined;
}
