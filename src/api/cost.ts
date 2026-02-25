export interface ModelPricing {
	input: number;
	output: number;
	cacheRead?: number;
	cacheWrite?: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
	"anthropic/claude-opus-4": {
		input: 15,
		output: 75,
		cacheRead: 1.5,
		cacheWrite: 18.75,
	},
	"anthropic/claude-sonnet-4": {
		input: 3,
		output: 15,
		cacheRead: 0.3,
		cacheWrite: 3.75,
	},
	"anthropic/claude-haiku-4": {
		input: 0.8,
		output: 4,
		cacheRead: 0.08,
		cacheWrite: 1,
	},
	"anthropic/claude-3.5-sonnet": {
		input: 3,
		output: 15,
		cacheRead: 0.3,
		cacheWrite: 3.75,
	},
	"anthropic/claude-3-haiku": {
		input: 0.25,
		output: 1.25,
		cacheRead: 0.03,
		cacheWrite: 0.3,
	},
	"openai/gpt-4o": { input: 2.5, output: 10, cacheRead: 1.25 },
	"openai/gpt-4o-mini": { input: 0.15, output: 0.6, cacheRead: 0.075 },
	"openai/gpt-4-turbo": { input: 10, output: 30 },
	"openai/gpt-3.5-turbo": { input: 0.5, output: 1.5 },
	"google/gemini-pro-1.5": { input: 1.25, output: 5, cacheRead: 0.3125 },
	"google/gemini-flash-1.5": { input: 0.075, output: 0.3, cacheRead: 0.01875 },
	"meta-llama/llama-3.1-405b-instruct": { input: 2.7, output: 2.7 },
	"meta-llama/llama-3.1-70b-instruct": { input: 0.52, output: 0.75 },
	"deepseek/deepseek-chat": { input: 0.14, output: 0.28, cacheRead: 0.014 },
	"deepseek/deepseek-coder": { input: 0.14, output: 0.28, cacheRead: 0.014 },
	"mistralai/mistral-large": { input: 2, output: 6 },
	"mistralai/mistral-medium": { input: 2.7, output: 8.1 },
	"mistralai/mistral-small": { input: 0.2, output: 0.6 },
};

const DEFAULT_PRICING: ModelPricing = { input: 0, output: 0 };

export function getModelPricing(modelId: string): ModelPricing {
	for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
		if (
			modelId.includes(key) ||
			key.includes(modelId.split("/")[1]?.split(":")[0] ?? "")
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

class CostTracker {
	private session: SessionCostTracker = {
		totalPromptTokens: 0,
		totalCompletionTokens: 0,
		totalCacheReadTokens: 0,
		totalCacheWriteTokens: 0,
		totalCost: 0,
		requestCount: 0,
	};

	calculateCost(modelId: string, usage: UsageMetrics): CostBreakdown {
		const pricing = getModelPricing(modelId);

		const inputCost = (usage.promptTokens / 1_000_000) * pricing.input;
		const outputCost = (usage.completionTokens / 1_000_000) * pricing.output;
		const cacheReadCost =
			((usage.cacheReadTokens ?? 0) / 1_000_000) *
			(pricing.cacheRead ?? pricing.input * 0.1);
		const cacheWriteCost =
			((usage.cacheWriteTokens ?? 0) / 1_000_000) *
			(pricing.cacheWrite ?? pricing.input * 1.25);

		const totalCost = inputCost + outputCost + cacheReadCost + cacheWriteCost;

		return {
			inputCost,
			outputCost,
			cacheReadCost,
			cacheWriteCost,
			totalCost,
		};
	}

	trackRequest(modelId: string, usage: UsageMetrics): CostBreakdown {
		const cost = this.calculateCost(modelId, usage);

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
			return `$${(cost * 100).toFixed(4)}¢`;
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
