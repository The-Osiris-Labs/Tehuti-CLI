export interface ModelCapabilityInfo {
	id: string;
	name: string;
	provider: string;
	isReasoning: boolean;
	reasoningField: "reasoning" | "thinking" | "none";
	contextLength?: number;
	maxOutputTokens?: number;
}

export function isReasoningModel(modelId: string): boolean {
	const lowerId = modelId.toLowerCase();
	const modelName = lowerId.split("/").pop() || lowerId;

	const tokens = modelName.split(/[^a-z0-9]/);
	const reasoningTokens = new Set([
		"reasoner",
		"thinking",
		"o1",
		"o3",
		"o4",
		"o5",
		"r1",
		"r2",
		"r3",
		"qwq",
	]);

	if (tokens.some((token) => reasoningTokens.has(token))) {
		return true;
	}

	if (modelName.endsWith("-thinking") || modelName.endsWith("-reasoner")) {
		return true;
	}

	return false;
}

export function supportsPromptCaching(modelId: string): boolean {
	const lowerId = modelId.toLowerCase();
	// Providers known to support native prompt caching
	if (
		lowerId.includes("anthropic") ||
		lowerId.includes("claude") ||
		lowerId.includes("gemini") ||
		lowerId.includes("deepseek") ||
		lowerId.includes("opencode")
	) {
		return true;
	}
	return false;
}

export function getReasoningField(
	modelId: string,
): "reasoning" | "thinking" | "none" {
	if (!isReasoningModel(modelId)) {
		return "none";
	}
	const lowerId = modelId.toLowerCase();
	if (lowerId.includes("claude") || lowerId.includes("anthropic")) {
		return "thinking";
	}
	return "reasoning";
}

export function getModelCapabilities(
	modelId: string,
): ModelCapabilityInfo | undefined {
	const isReasoning = isReasoningModel(modelId);
	const parts = modelId.split("/");
	const provider = parts.length > 1 ? parts[0] : "Unknown";
	const name = parts.length > 1 ? parts.slice(1).join("/") : modelId;

	return {
		id: modelId,
		name,
		provider,
		isReasoning,
		reasoningField: getReasoningField(modelId),
	};
}

/**
 * Resolve live model limits (contextLength, maxOutputTokens) from the provider
 * API. Fetches the model list and finds the selected model. Returns undefined
 * for any field the provider doesn't advertise.
 *
 * Falls back gracefully — returns an empty object on any error so callers can
 * safely destructure and apply their own defaults.
 */
export async function resolveModelCapabilities(
	modelId: string,
	provider: string,
	config: {
		apiKey?: string;
		baseUrl?: string;
	},
): Promise<{ contextLength?: number; maxOutputTokens?: number }> {
	try {
		const { listModelsForProvider, getLiveModelInfo } = await import(
			"./models.js"
		);
		const models = await listModelsForProvider(provider, config);
		const info = getLiveModelInfo(models, modelId);
		return {
			contextLength: info?.contextLength,
			maxOutputTokens: info?.maxOutputTokens,
		};
	} catch {
		// Graceful fallback — caller uses their own defaults
		return {};
	}
}
