export interface ModelPricing {
	input: number;
	output: number;
	cacheRead?: number;
	cacheWrite?: number;
}

// Static MODEL_PRICING kept ONLY as ultra-last-resort fallback.
// Primary source must be live fetched data from the provider's model list (context, pricing).
// We hate hardcodes too. Live data wins when a model is selected/listed.
export const MODEL_PRICING: Record<string, ModelPricing> = {
	"minimax-m3": { input: 0, output: 0 },
	"anthropic/claude-sonnet-4": {
		input: 3,
		output: 15,
		cacheRead: 0.3,
		cacheWrite: 3.75,
	},
	"claude-sonnet-4": {
		input: 3,
		output: 15,
		cacheRead: 0.3,
		cacheWrite: 3.75,
	},
	"openai/gpt-4o": { input: 2.5, output: 10 },
	"gpt-4o": { input: 2.5, output: 10 },
	"google/gemini-pro-1.5": { input: 1.25, output: 5 },
	"gemini-pro-1.5": { input: 1.25, output: 5 },
	"deepseek/deepseek-chat": { input: 0.14, output: 0.28 },
	"deepseek-chat": { input: 0.14, output: 0.28 },
	"deepseek/deepseek-reasoner": { input: 0.55, output: 2.19 },
	"deepseek-reasoner": { input: 0.55, output: 2.19 },
	"openai/o1": { input: 15, output: 60 },
	o1: { input: 15, output: 60 },
	"openai/o3-mini": { input: 1.1, output: 4.4 },
	"o3-mini": { input: 1.1, output: 4.4 },
};

const DEFAULT_PRICING: ModelPricing = { input: 0, output: 0 };

let liveModelPricing: Partial<ModelPricing> | null = null;
export function setLiveModelPricing(p: Partial<ModelPricing> | null) {
	liveModelPricing = p;
}
export function getLiveModelPricing() {
	return liveModelPricing;
}

export function getModelPricing(
	modelId: string,
	livePricing?: Partial<ModelPricing>,
): ModelPricing {
	const lp = livePricing || liveModelPricing;
	if (lp && (lp.input != null || lp.output != null)) {
		return {
			input: lp.input ?? 0,
			output: lp.output ?? 0,
			cacheRead: lp.cacheRead,
			cacheWrite: lp.cacheWrite,
		};
	}
	for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
		if (!key) continue;
		const subPart = modelId.split("/")[1]?.split(":")[0];
		if (
			modelId?.includes(key) ||
			(subPart && subPart.trim() !== "" && key.includes(subPart))
		) {
			return pricing;
		}
	}
	return DEFAULT_PRICING;
}

export interface UsageMetrics {
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
}

export interface CostBreakdown {
	inputCost: number;
	outputCost: number;
	cacheReadCost: number;
	cacheWriteCost: number;
	totalCost: number;
}

export interface SessionCostTracker {
	totalPromptTokens: number;
	totalCompletionTokens: number;
	totalCacheReadTokens: number;
	totalCacheWriteTokens: number;
	totalCost: number;
	requestCount: number;
}

export class CostTracker {
	private session: SessionCostTracker = {
		totalPromptTokens: 0,
		totalCompletionTokens: 0,
		totalCacheReadTokens: 0,
		totalCacheWriteTokens: 0,
		totalCost: 0,
		requestCount: 0,
	};

	calculateCost(
		modelId: string,
		usage: UsageMetrics,
		livePricing?: Partial<ModelPricing>,
	): CostBreakdown {
		const pricing = getModelPricing(modelId, livePricing);

		const uncachedInputTokens = Math.max(
			0,
			usage.promptTokens -
				(usage.cacheReadTokens ?? 0) -
				(usage.cacheWriteTokens ?? 0),
		);
		const inputCost = (uncachedInputTokens / 1_000_000) * (pricing.input || 0);
		const outputCost =
			(usage.completionTokens / 1_000_000) * (pricing.output || 0);
		const cacheReadCost =
			((usage.cacheReadTokens ?? 0) / 1_000_000) *
			(pricing.cacheRead ?? (pricing.input || 0) * 0.1);
		const cacheWriteCost =
			((usage.cacheWriteTokens ?? 0) / 1_000_000) *
			(pricing.cacheWrite ?? (pricing.input || 0) * 1.25);

		const totalCost = inputCost + outputCost + cacheReadCost + cacheWriteCost;

		return {
			inputCost,
			outputCost,
			cacheReadCost,
			cacheWriteCost,
			totalCost,
		};
	}

	trackRequest(
		modelId: string,
		usage: UsageMetrics,
		livePricing?: Partial<ModelPricing>,
	): CostBreakdown {
		const cost = this.calculateCost(modelId, usage, livePricing);

		this.session.totalPromptTokens += usage.promptTokens;
		this.session.totalCompletionTokens += usage.completionTokens;
		this.session.totalCacheReadTokens += usage.cacheReadTokens ?? 0;
		this.session.totalCacheWriteTokens += usage.cacheWriteTokens ?? 0;
		this.session.totalCost += cost.totalCost;
		this.session.requestCount++;

		return cost;
	}

	getSessionStats(): SessionCostTracker {
		return { ...this.session };
	}

	formatCost(cost: number): string {
		if (cost < 0.01) {
			return `${(cost * 100).toFixed(4)}¢`;
		}
		return `$${cost.toFixed(4)}`;
	}

	getSessionSummary(): string {
		const savings =
			this.session.totalCacheReadTokens > 0
				? `\n  𓏛 Cache: ${this.formatCost(this.session.totalCacheReadTokens * 0.000001)} saved (${this.session.totalCacheReadTokens.toLocaleString()} tokens)`
				: "";

		return `𓆣 Session Summary:
  𓊖 Requests: ${this.session.requestCount} 𓍋 Tokens: ${(this.session.totalPromptTokens + this.session.totalCompletionTokens).toLocaleString()} 𓂝 Cost: ${this.formatCost(this.session.totalCost)}${savings}`;
	}

	reset(): void {
		this.session = {
			totalPromptTokens: 0,
			totalCompletionTokens: 0,
			totalCacheReadTokens: 0,
			totalCacheWriteTokens: 0,
			totalCost: 0,
			requestCount: 0,
		};
	}
}

export const costTracker = new CostTracker();
export default costTracker;

export function createCostScope(): CostTracker {
	return new CostTracker();
}
