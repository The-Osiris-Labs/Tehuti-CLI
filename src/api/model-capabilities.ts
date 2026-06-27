export interface ModelCapabilityInfo {
	id: string;
	name: string;
	provider: string;
	isReasoning: boolean;
	reasoningField: "reasoning" | "thinking" | "none";
}

export function isReasoningModel(modelId: string): boolean {
	const lowerId = modelId.toLowerCase();
	const modelName = lowerId.split("/").pop() || lowerId;
	
	const tokens = modelName.split(/[^a-z0-9]/);
	const reasoningTokens = new Set(["reasoner", "thinking", "o1", "o3", "o4", "o5", "r1", "r2", "r3", "qwq"]);
	
	if (tokens.some(token => reasoningTokens.has(token))) {
		return true;
	}
	
	if (modelName.endsWith("-thinking") || modelName.endsWith("-reasoner")) {
		return true;
	}
	
	return false;
}

export function getReasoningField(
	modelId: string,
): "reasoning" | "thinking" | "none" {
	return isReasoningModel(modelId) ? "reasoning" : "none";
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
		reasoningField: isReasoning ? "reasoning" : "none",
	};
}
