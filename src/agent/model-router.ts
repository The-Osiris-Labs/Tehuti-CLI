import type { AgentContext } from "./context.js";
import type { ModelSelectionMode } from "../config/schema.js";
import { SAFE_PARALLEL_TOOLS, WRITE_TOOLS } from "./parallel-executor.js";

export type ModelTier = "fast" | "balanced" | "deep";

export interface ModelConfig {
	tier: ModelTier;
	modelId: string;
	description: string;
	maxTokens: number;
	supportsTools: boolean;
	supportsVision: boolean;
	costPer1kPrompt: number;
	costPer1kCompletion: number;
}

export const MODEL_TIERS: Record<ModelTier, ModelConfig> = {
	fast: {
		tier: "fast",
		modelId: "z-ai/glm-4.5-air:free",
		description: "Fast and free - best for simple reads and listings",
		maxTokens: 4096,
		supportsTools: true,
		supportsVision: false,
		costPer1kPrompt: 0,
		costPer1kCompletion: 0,
	},
	balanced: {
		tier: "balanced",
		modelId: "z-ai/glm-5:free",
		description: "Balanced performance - good for most tasks",
		maxTokens: 8192,
		supportsTools: true,
		supportsVision: false,
		costPer1kPrompt: 0,
		costPer1kCompletion: 0,
	},
	deep: {
		tier: "deep",
		modelId: "anthropic/claude-sonnet-4",
		description: "Deep reasoning - best for complex tasks",
		maxTokens: 16384,
		supportsTools: true,
		supportsVision: true,
		costPer1kPrompt: 0.003,
		costPer1kCompletion: 0.015,
	},
};

const DEEP_KEYWORDS = [
	"plan",
	"architect",
	"design",
	"refactor",
	"analyze",
	"investigate",
	"troubleshoot",
	"debug",
	"optimize",
	"improve",
	"explain",
	"comprehensive",
	"thorough",
	"detailed",
	"complex",
];

const FAST_KEYWORDS = [
	"read",
	"show",
	"list",
	"display",
	"print",
	"get",
	"fetch",
	"check",
	"what",
	"where",
	"which",
];

export interface TaskClassification {
	tier: ModelTier;
	reason: string;
	confidence: number;
}

export function classifyTask(
	userMessage: string,
	context: AgentContext,
	pendingTools: Array<{ name: string; args: unknown }> = [],
): TaskClassification {
	const messageLower = userMessage.toLowerCase();

	if (pendingTools.length > 0) {
		const allSafeParallel = pendingTools.every((t) => SAFE_PARALLEL_TOOLS.has(t.name));

		if (allSafeParallel) {
			return {
				tier: "fast",
				reason: "All pending tools are read-only operations",
				confidence: 0.9,
			};
		}

		const hasWrites = pendingTools.some((t) => WRITE_TOOLS.has(t.name));

		if (hasWrites && pendingTools.length === 1) {
			return {
				tier: "balanced",
				reason: "Single write operation",
				confidence: 0.8,
			};
		}

		if (hasWrites && pendingTools.length > 1) {
			return {
				tier: "deep",
				reason: "Multiple operations including writes",
				confidence: 0.7,
			};
		}
	}

	const deepKeywordMatches = DEEP_KEYWORDS.filter((k) => messageLower.includes(k));
	const fastKeywordMatches = FAST_KEYWORDS.filter((k) => messageLower.includes(k));

	if (deepKeywordMatches.length >= 2) {
		return {
			tier: "deep",
			reason: `Complex task keywords: ${deepKeywordMatches.join(", ")}`,
			confidence: 0.85,
		};
	}

	if (fastKeywordMatches.length >= 2 && deepKeywordMatches.length === 0) {
		return {
			tier: "fast",
			reason: `Simple task keywords: ${fastKeywordMatches.join(", ")}`,
			confidence: 0.8,
		};
	}

	if (deepKeywordMatches.length === 1) {
		return {
			tier: "deep",
			reason: `Complex task keyword: ${deepKeywordMatches[0]}`,
			confidence: 0.6,
		};
	}

	const messageLength = userMessage.length;
	const sentenceCount = (userMessage.match(/[.!?]+/g) || []).length;

	if (messageLength > 500 || sentenceCount > 5) {
		return {
			tier: "deep",
			reason: "Complex request with multiple parts",
			confidence: 0.7,
		};
	}

	if (context.messages.length > 20) {
		return {
			tier: "balanced",
			reason: "Session has significant context",
			confidence: 0.6,
		};
	}

	return {
		tier: "balanced",
		reason: "Default balanced tier",
		confidence: 0.5,
	};
}

export function selectModelForClassification(
	classification: TaskClassification,
	config?: { 
		preferredTier?: ModelTier; 
		manualModel?: string;
		modelSelection?: ModelSelectionMode;
	},
): string {
	if (config?.modelSelection === "manual" && config?.manualModel) {
		return config.manualModel;
	}

	if (config?.modelSelection === "cost-optimized") {
		return MODEL_TIERS.fast.modelId;
	}

	if (config?.modelSelection === "speed-optimized") {
		return MODEL_TIERS.fast.modelId;
	}

	if (config?.manualModel) {
		return config.manualModel;
	}

	if (config?.preferredTier) {
		return MODEL_TIERS[config.preferredTier].modelId;
	}

	return MODEL_TIERS[classification.tier].modelId;
}

export function getModelConfig(modelId: string): ModelConfig | undefined {
	for (const config of Object.values(MODEL_TIERS)) {
		if (config.modelId === modelId) {
			return config;
		}
	}
	return undefined;
}

export function getTierForModel(modelId: string): ModelTier | undefined {
	for (const [tier, config] of Object.entries(MODEL_TIERS)) {
		if (config.modelId === modelId) {
			return tier as ModelTier;
		}
	}
	return undefined;
}

export function estimateCost(
	modelId: string,
	promptTokens: number,
	completionTokens: number,
): number {
	const config = getModelConfig(modelId);
	if (!config) return 0;

	return (
		(promptTokens / 1000) * config.costPer1kPrompt +
		(completionTokens / 1000) * config.costPer1kCompletion
	);
}

export function getCheaperAlternative(modelId: string): string | null {
	const currentTier = getTierForModel(modelId);

	if (currentTier === "deep") {
		return MODEL_TIERS.balanced.modelId;
	}
	if (currentTier === "balanced") {
		return MODEL_TIERS.fast.modelId;
	}

	return null;
}
