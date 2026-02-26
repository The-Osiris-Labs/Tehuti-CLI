export const AVAILABLE_MODELS = {
	"giga-potato": {
		name: "Giga Potato (free)",
		provider: "Kilo",
		contextLength: 256000,
		pricing: { input: 0, output: 0 },
		capabilities: ["chat", "tools", "vision"] as string[],
		recommended: true,
	},
	"giga-potato-thinking": {
		name: "Giga Potato Thinking (free)",
		provider: "Kilo",
		contextLength: 256000,
		pricing: { input: 0, output: 0 },
		capabilities: ["chat", "tools", "vision"] as string[],
		recommended: false,
	},
	"minimax/minimax-m2.5:free": {
		name: "MiniMax M2.5 (free)",
		provider: "MiniMax",
		contextLength: 204800,
		pricing: { input: 0, output: 0 },
		capabilities: ["chat", "tools"] as string[],
		recommended: false,
	},
	"arcee-ai/trinity-large-preview:free": {
		name: "Arcee AI Trinity Large Preview (free)",
		provider: "Arcee",
		contextLength: 131000,
		pricing: { input: 0, output: 0 },
		capabilities: ["chat", "tools"] as string[],
		recommended: false,
	},
	"anthropic/claude-opus-4": {
		name: "Claude Opus 4",
		provider: "Anthropic",
		contextLength: 200000,
		pricing: { input: 15, output: 75 },
		capabilities: ["chat", "tools", "vision"] as string[],
		recommended: false,
	},
	"anthropic/claude-sonnet-4": {
		name: "Claude Sonnet 4",
		provider: "Anthropic",
		contextLength: 200000,
		pricing: { input: 3, output: 15 },
		capabilities: ["chat", "tools", "vision"] as string[],
		recommended: false,
	},
	"anthropic/claude-haiku-4": {
		name: "Claude Haiku 4",
		provider: "Anthropic",
		contextLength: 200000,
		pricing: { input: 0.25, output: 1.25 },
		capabilities: ["chat", "tools", "vision"] as string[],
		recommended: false,
	},
	"openai/gpt-5": {
		name: "GPT-5",
		provider: "OpenAI",
		contextLength: 128000,
		pricing: { input: 5, output: 15 },
		capabilities: ["chat", "tools", "vision"] as string[],
		recommended: false,
	},
	"openai/gpt-4o": {
		name: "GPT-4o",
		provider: "OpenAI",
		contextLength: 128000,
		pricing: { input: 2.5, output: 10 },
		capabilities: ["chat", "tools", "vision"] as string[],
		recommended: false,
	},
	"openai/gpt-4o-mini": {
		name: "GPT-4o Mini",
		provider: "OpenAI",
		contextLength: 128000,
		pricing: { input: 0.15, output: 0.6 },
		capabilities: ["chat", "tools", "vision"] as string[],
		recommended: false,
	},
	"google/gemini-2.5-pro": {
		name: "Gemini 2.5 Pro",
		provider: "Google",
		contextLength: 1000000,
		pricing: { input: 1.25, output: 5 },
		capabilities: ["chat", "tools", "vision"] as string[],
		recommended: false,
	},
	"google/gemini-2.5-flash": {
		name: "Gemini 2.5 Flash",
		provider: "Google",
		contextLength: 1000000,
		pricing: { input: 0.075, output: 0.3 },
		capabilities: ["chat", "tools", "vision"] as string[],
		recommended: false,
	},
	"deepseek/deepseek-v3": {
		name: "DeepSeek V3",
		provider: "DeepSeek",
		contextLength: 64000,
		pricing: { input: 0.27, output: 1.1 },
		capabilities: ["chat", "tools"] as string[],
		recommended: false,
	},
	"meta-llama/llama-3.3-70b-instruct": {
		name: "Llama 3.3 70B",
		provider: "Meta",
		contextLength: 128000,
		pricing: { input: 0.6, output: 0.6 },
		capabilities: ["chat", "tools"] as string[],
		recommended: false,
	},
	"mistralai/mistral-large-2": {
		name: "Mistral Large 2",
		provider: "Mistral",
		contextLength: 128000,
		pricing: { input: 2, output: 6 },
		capabilities: ["chat", "tools"] as string[],
		recommended: false,
	},
};

export type ModelId = keyof typeof AVAILABLE_MODELS;

export interface ModelInfo {
	id: string;
	name: string;
	provider: string;
	contextLength: number;
	pricing: { input: number; output: number };
	capabilities: string[];
	recommended: boolean;
}

export function getModelInfo(modelId: string): ModelInfo | undefined {
	const model = AVAILABLE_MODELS[modelId as ModelId];
	if (!model) return undefined;

	return {
		id: modelId,
		name: model.name,
		provider: model.provider,
		contextLength: model.contextLength,
		pricing: model.pricing,
		capabilities: [...model.capabilities],
		recommended: model.recommended,
	};
}

export function getRecommendedModels(): ModelInfo[] {
	return Object.entries(AVAILABLE_MODELS)
		.filter(([, info]) => info.recommended)
		.map(([id, info]) => ({
			id,
			name: info.name,
			provider: info.provider,
			contextLength: info.contextLength,
			pricing: info.pricing,
			capabilities: [...info.capabilities],
			recommended: info.recommended,
		}));
}

export function getModelsByProvider(provider: string): ModelInfo[] {
	return Object.entries(AVAILABLE_MODELS)
		.filter(
			([, info]) => info.provider.toLowerCase() === provider.toLowerCase(),
		)
		.map(([id, info]) => ({
			id,
			name: info.name,
			provider: info.provider,
			contextLength: info.contextLength,
			pricing: info.pricing,
			capabilities: [...info.capabilities],
			recommended: info.recommended,
		}));
}

export function getModelsWithCapability(capability: string): ModelInfo[] {
	return Object.entries(AVAILABLE_MODELS)
		.filter(([, info]) => info.capabilities.includes(capability))
		.map(([id, info]) => ({
			id,
			name: info.name,
			provider: info.provider,
			contextLength: info.contextLength,
			pricing: info.pricing,
			capabilities: [...info.capabilities],
			recommended: info.recommended,
		}));
}
