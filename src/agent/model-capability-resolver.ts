import type { LiveModelInfo } from "../api/models.js";
import { listModelsForProvider } from "../api/models.js";
import { debug } from "../utils/debug.js";

// ── Public types ────────────────────────────────────────────────────────────

export interface ModelCapabilities {
	/** Total conversation window tokens (live from provider, or fallback) */
	contextLength: number;
	/** Max generation / completion tokens (live from provider, or fallback) */
	maxOutputTokens: number;
	/** Model can accept images/media alongside text */
	supportsVision: boolean;
	/** Model supports function / tool calling */
	supportsTools: boolean;
	/** Provider / model advertises prompt caching */
	supportsCaching: boolean;
}

// ── Provider-level known constants (used when live endpoint returns nothing) ─

const PROVIDER_FALLBACKS: Record<
	string,
	{ contextLength: number; maxOutputTokens: number }
> = {
	opencode: { contextLength: 1_000_000, maxOutputTokens: 32_000 },
	anthropic: { contextLength: 200_000, maxOutputTokens: 8_192 },
	openai: { contextLength: 128_000, maxOutputTokens: 16_384 },
	deepseek: { contextLength: 128_000, maxOutputTokens: 8_192 },
	xai: { contextLength: 1_000_000, maxOutputTokens: 32_000 },
	openrouter: { contextLength: 1_000_000, maxOutputTokens: 32_000 },
	google: { contextLength: 1_000_000, maxOutputTokens: 8_192 },
};

const UNKNOWN_FALLBACK = { contextLength: 128_000, maxOutputTokens: 16_384 };

// ── Per-model overrides for well-known model families ───────────────────────

const MODEL_OVERRIDES: Record<
	string,
	{ contextLength: number; maxOutputTokens: number }
> = {
	// OpenCode Go models
	"deepseek-v4-flash": { contextLength: 1_000_000, maxOutputTokens: 32_000 },
	"deepseek-v4-pro": { contextLength: 1_000_000, maxOutputTokens: 32_000 },
	"minimax-m3": { contextLength: 1_000_000, maxOutputTokens: 32_000 },
	// Anthropic models
	"claude-sonnet-4-20250514": {
		contextLength: 200_000,
		maxOutputTokens: 8_192,
	},
	"claude-opus-4-20250514": { contextLength: 200_000, maxOutputTokens: 8_192 },
	"claude-3-5-sonnet-20241022": {
		contextLength: 200_000,
		maxOutputTokens: 8_192,
	},
	"claude-3-opus-20240229": { contextLength: 200_000, maxOutputTokens: 4_096 },
	// OpenAI models
	"gpt-4o": { contextLength: 128_000, maxOutputTokens: 16_384 },
	"gpt-4o-mini": { contextLength: 128_000, maxOutputTokens: 16_384 },
	"gpt-4-turbo": { contextLength: 128_000, maxOutputTokens: 4_096 },
	o1: { contextLength: 200_000, maxOutputTokens: 100_000 },
	o3: { contextLength: 200_000, maxOutputTokens: 100_000 },
	// DeepSeek models
	"deepseek-chat": { contextLength: 128_000, maxOutputTokens: 8_192 },
	"deepseek-reasoner": { contextLength: 64_000, maxOutputTokens: 8_192 },
	// xAI models
	"grok-3": { contextLength: 1_000_000, maxOutputTokens: 32_000 },
	"grok-3-mini": { contextLength: 1_000_000, maxOutputTokens: 32_000 },
	"grok-2": { contextLength: 128_000, maxOutputTokens: 8_192 },
	// Google models
	"gemini-2.5-pro": { contextLength: 1_000_000, maxOutputTokens: 64_000 },
	"gemini-2.5-flash": { contextLength: 1_000_000, maxOutputTokens: 32_000 },
	"gemini-2.0-flash": { contextLength: 1_000_000, maxOutputTokens: 8_192 },
};

// ── Heuristic helpers for capabilities not surfaced by /models endpoints ────

function inferVisionSupport(modelId: string, provider: string): boolean {
	const lower = modelId.toLowerCase();
	// Vision-capable model name patterns
	if (
		lower.includes("vision") ||
		lower.includes("gpt-4o") || // gpt-4o has vision; gpt-4o-mini does too
		lower.includes("grok-vision") ||
		lower.includes("pixtral") ||
		lower.includes("llava") ||
		lower.includes("gemini") ||
		lower.includes("claude-3") ||
		lower.includes("claude-4") ||
		lower.includes("claude-sonnet") ||
		lower.includes("claude-opus") ||
		(lower.includes("llama-3.2") && lower.includes("vision"))
	) {
		return true;
	}
	// Provider-level: Anthropic and Google Gemini models all have vision
	if (provider === "anthropic" || provider === "google") {
		return true;
	}
	// Some opencode models route to vision-capable backends
	if (
		provider === "opencode" &&
		(lower.includes("minimax") || lower.includes("deepseek"))
	) {
		return true;
	}
	return false;
}

function inferToolSupport(modelId: string, provider: string): boolean {
	const lower = modelId.toLowerCase();
	// Most modern models support tools. Exceptions are very old / embedding / moderation.
	const noToolsPatterns = [
		"embedding",
		"moderation",
		"whisper",
		"tts",
		"dall-e",
		"davinci",
		"babbage",
		"curie",
		"ada",
		"gpt-3.5-turbo-0301",
	];
	if (noToolsPatterns.some((p) => lower.includes(p))) {
		return false;
	}
	// Ollama/LM Studio models may or may not support tools; lean conservative
	if (provider === "ollama" || provider === "lmstudio") {
		return lower.includes("tool") || lower.includes("function");
	}
	return true;
}

function inferCachingSupport(modelId: string, provider: string): boolean {
	const lower = modelId.toLowerCase();
	// Providers with known prompt caching support
	if (
		provider === "anthropic" ||
		provider === "deepseek" ||
		provider === "google" ||
		provider === "opencode"
	) {
		return true;
	}
	// OpenAI: only some models support the 'cached' prefix
	if (provider === "openai" && lower.includes("cached")) {
		return true;
	}
	// xAI grok-3+ supports caching in some configurations
	if (provider === "xai") {
		return lower.includes("grok-3");
	}
	return false;
}

// ── In-memory cache ─────────────────────────────────────────────────────────

const capabilityCache = new Map<string, ModelCapabilities>();

function cacheKey(provider: string, modelId: string): string {
	return `${provider}::${modelId}`;
}

// ── Main resolver ───────────────────────────────────────────────────────────

/**
 * Resolve accurate model capabilities by fetching live data from the provider's
 * /models endpoint (via `listModelsForProvider`), falling back to sensible
 * provider- and model-aware defaults when live data is unavailable.
 *
 * Results are cached in-memory for the lifetime of the process.
 */
export async function resolveModelCapabilities(
	provider: string,
	modelId: string,
	config: {
		apiKey?: string;
		baseUrl?: string;
		headers?: Record<string, string>;
	},
): Promise<ModelCapabilities> {
	const key = cacheKey(provider, modelId);
	const cached = capabilityCache.get(key);
	if (cached) return cached;

	let live: LiveModelInfo | undefined;

	// 1) Try live fetch
	try {
		const models = await listModelsForProvider(provider, config);
		live = models.find(
			(m) =>
				m.id === modelId ||
				m.id.endsWith(`/${modelId}`) ||
				m.id === modelId.split("/").pop(),
		);
		if (models.length > 0 && !live) {
			debug.log(
				"agent",
				`resolveModelCapabilities: model "${modelId}" not found in provider /models list (${models.length} models). Using fallbacks.`,
			);
		}
	} catch (err) {
		debug.log(
			"agent",
			`resolveModelCapabilities: live fetch failed for ${provider}/${modelId}: ${err}`,
		);
	}

	// 2) Determine contextLength and maxOutputTokens
	const normProvider = provider.toLowerCase();
	const normModel = modelId.toLowerCase();
	const modelShortName = normModel.split("/").pop() || normModel;

	let contextLength: number;
	let maxOutputTokens: number;

	if (live?.contextLength && live.contextLength > 0) {
		// Live data is the truth
		contextLength = live.contextLength;
	} else if (MODEL_OVERRIDES[modelShortName]) {
		contextLength = MODEL_OVERRIDES[modelShortName].contextLength;
	} else if (MODEL_OVERRIDES[modelId]) {
		contextLength = MODEL_OVERRIDES[modelId].contextLength;
	} else if (PROVIDER_FALLBACKS[normProvider]) {
		contextLength = PROVIDER_FALLBACKS[normProvider].contextLength;
	} else {
		contextLength = UNKNOWN_FALLBACK.contextLength;
	}

	if (live?.maxOutputTokens && live.maxOutputTokens > 0) {
		maxOutputTokens = live.maxOutputTokens;
	} else if (MODEL_OVERRIDES[modelShortName]) {
		maxOutputTokens = MODEL_OVERRIDES[modelShortName].maxOutputTokens;
	} else if (MODEL_OVERRIDES[modelId]) {
		maxOutputTokens = MODEL_OVERRIDES[modelId].maxOutputTokens;
	} else if (PROVIDER_FALLBACKS[normProvider]) {
		maxOutputTokens = PROVIDER_FALLBACKS[normProvider].maxOutputTokens;
	} else {
		maxOutputTokens = UNKNOWN_FALLBACK.maxOutputTokens;
	}

	// 3) Heuristic capabilities
	const supportsVision = inferVisionSupport(modelId, normProvider);
	const supportsTools = inferToolSupport(modelId, normProvider);
	const supportsCaching = inferCachingSupport(modelId, normProvider);

	const result: ModelCapabilities = {
		contextLength,
		maxOutputTokens,
		supportsVision,
		supportsTools,
		supportsCaching,
	};

	// Cache and return
	capabilityCache.set(key, result);

	debug.log(
		"agent",
		`resolveModelCapabilities: ${provider}/${modelId} => ctx=${contextLength} maxOut=${maxOutputTokens} vision=${supportsVision} tools=${supportsTools} cache=${supportsCaching}`,
	);

	return result;
}

/**
 * Clear the in-memory capability cache (useful in tests or when providers
 * change configuration mid-session).
 */
export function clearCapabilityCache(): void {
	capabilityCache.clear();
}

/**
 * Synchronous lookup (no live fetch) — returns cached capabilities or null.
 */
export function getCachedCapabilities(
	provider: string,
	modelId: string,
): ModelCapabilities | null {
	return capabilityCache.get(cacheKey(provider, modelId)) ?? null;
}
