import { getProviderInfo } from "../config/providers.js";
import type { ModelSelectionMode } from "../config/schema.js";
import type { AgentContext } from "./context.js";
import { getTool } from "./tools/registry.js";

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
		modelId: "google/gemini-3.1-flash",
		description: "Fast and free - best for simple reads and listings",
		maxTokens: 8192,
		supportsTools: true,
		supportsVision: true,
		costPer1kPrompt: 0,
		costPer1kCompletion: 0,
	},
	balanced: {
		tier: "balanced",
		modelId: "google/gemini-3.1-pro",
		description: "Balanced performance with reasoning - good for most tasks",
		maxTokens: 16384,
		supportsTools: true,
		supportsVision: true,
		costPer1kPrompt: 0,
		costPer1kCompletion: 0,
	},
	deep: {
		tier: "deep",
		modelId: "anthropic/claude-4",
		description: "Deep reasoning - best for complex tasks",
		maxTokens: 32768,
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
		const allSafeParallel = pendingTools.every(
			(t) => getTool(t.name)?.intent === "read-only",
		);

		if (allSafeParallel) {
			return {
				tier: "fast",
				reason: "All pending tools are read-only operations",
				confidence: 0.9,
			};
		}

		const hasWrites = pendingTools.some(
			(t) => getTool(t.name)?.intent === "destructive",
		);

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

	const deepKeywordMatches = DEEP_KEYWORDS.filter((k) =>
		new RegExp(`\\b${k}\\b`, "i").test(messageLower),
	);
	const fastKeywordMatches = FAST_KEYWORDS.filter((k) =>
		new RegExp(`\\b${k}\\b`, "i").test(messageLower),
	);

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

export function getModelTiersForConfig(
	providerId: string,
	configTiers?: { fast?: string; balanced?: string; deep?: string },
): Record<ModelTier, string> {
	const info = getProviderInfo(providerId);
	return {
		fast:
			configTiers?.fast || info?.modelTiers?.fast || MODEL_TIERS.fast.modelId,
		balanced:
			configTiers?.balanced ||
			info?.modelTiers?.balanced ||
			MODEL_TIERS.balanced.modelId,
		deep:
			configTiers?.deep || info?.modelTiers?.deep || MODEL_TIERS.deep.modelId,
	};
}

export function selectModelForClassification(
	classification: TaskClassification,
	providerId: string,
	config?: {
		preferredTier?: ModelTier;
		manualModel?: string;
		modelSelection?: ModelSelectionMode;
		modelTiers?: { fast?: string; balanced?: string; deep?: string };
	},
): string {
	const tiers = getModelTiersForConfig(providerId, config?.modelTiers);

	// Always respect manual model selection first
	if (config?.manualModel) {
		// If manual model is specified, use it regardless of other settings
		// unless explicitly in cost-optimized or speed-optimized mode
		if (config.modelSelection === "cost-optimized") {
			return tiers.fast;
		}
		if (config.modelSelection === "speed-optimized") {
			return tiers.fast;
		}
		return config.manualModel;
	}

	if (config?.modelSelection === "cost-optimized") {
		return tiers.fast;
	}

	if (config?.modelSelection === "speed-optimized") {
		return tiers.fast;
	}

	if (config?.preferredTier) {
		return tiers[config.preferredTier];
	}

	return tiers[classification.tier];
}

export function getModelConfig(modelId: string): ModelConfig | undefined {
	for (const config of Object.values(MODEL_TIERS)) {
		if (config.modelId === modelId) {
			return config;
		}
	}
	return {
		tier: "balanced",
		modelId,
		description: "Custom model configuration",
		maxTokens: 32000,
		supportsTools: true,
		supportsVision: false,
		costPer1kPrompt: 0,
		costPer1kCompletion: 0,
	};
}

export function getTierForModel(modelId: string): ModelTier | undefined {
	for (const [tier, config] of Object.entries(MODEL_TIERS)) {
		if (config.modelId === modelId) {
			return tier as ModelTier;
		}
	}
	return "balanced";
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
