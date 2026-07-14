import { z } from "zod";
import {
	getProviderAuthHeaders,
	getProviderInfo,
	getProviderModelsUrl,
	resolveBaseUrlForProvider,
} from "../config/providers.js";

/**
 * Live model info fetched from provider /models (or client listModels).
 * NO reliance on static data for primary path. Accurate numbers when the endpoint provides them.
 */
export interface LiveModelInfo {
	id: string;
	name?: string;
	contextLength?: number; // total conversation window (preferred live value)
	maxOutputTokens?: number; // max generation length if advertised
	pricing?: {
		input?: number; // per million tokens, normalized number
		output?: number;
		[key: string]: any;
	};
	ownedBy?: string;
	raw?: any; // original payload for debugging/ext
}

// Static fallbacks ONLY as last resort when provider gives zero info.
// Prefer live data always. These are minimal and may be outdated.
export const AVAILABLE_MODELS: Record<string, any> = {
	// EXTREMELY MINIMAL static fallback only.
	// Primary source of model info (context, pricing, max tokens) is ALWAYS the live fetch
	// performed when you select/list models for the current provider.
	// We keep almost nothing hardcoded.
	"minimax-m3": {
		name: "minimax-m3",
		provider: "OpenCode Go",
		contextLength: 1000000,
		pricing: { input: 0, output: 0 }, // subscription model
		capabilities: ["chat", "tools"] as string[],
		recommended: true,
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

/**
 * Live fetch rich model catalog.
 * Returns LiveModelInfo[] with whatever the provider actually advertises (context_length, pricing, etc).
 * Tries hard to extract from common shapes (OpenRouter rich, standard OpenAI, others).
 * Real fetch, zero hard-coded per-model facts here.
 */
export async function listModelsForProvider(
	provider: string,
	config: {
		apiKey?: string;
		baseUrl?: string;
		headers?: Record<string, string>;
	},
): Promise<LiveModelInfo[]> {
	const info = getProviderInfo(provider);
	// Provider explicitly opted out of model listing (modelListEndpoint === '')
	if (info && info.modelListEndpoint === "") {
		return [];
	}
	const resolvedBase =
		resolveBaseUrlForProvider(provider, config.baseUrl) ||
		"https://openrouter.ai/api/v1";
	const base = resolvedBase.replace(/\/+$/, "");
	const url = getProviderModelsUrl(provider, base) || `${base}/models`;
	const key = config.apiKey;
	const customHeaders = config.headers;

	try {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			...(await getProviderAuthHeaders(provider, key, customHeaders)),
		};

		let res = await fetch(url, { headers });
		if (
			!res.ok &&
			res.status === 404 &&
			info?.modelListEndpoint !== "/models"
		) {
			res = await fetch(`${base}/models`, { headers });
		}
		if (!res.ok) return [];

		interface RawModel {
			id?: string;
			name?: string;
			model?: string;
			slug?: string;
			context_length?: number;
			contextLength?: number;
			context_window?: number;
			max_completion_tokens?: number;
			max_tokens?: number;
			max_output_tokens?: number;
			top_provider?: { context_length?: number; max_completion_tokens?: number };
			architecture?: { context_length?: number };
			pricing?: { prompt?: unknown; input?: unknown; completion?: unknown; output?: unknown; [k: string]: unknown };
			owned_by?: string;
			ownedBy?: string;
			[k: string]: unknown;
		}
		const RawModelSchema = z.object({}).passthrough();
		const ModelListSchema = z.object({
			data: z.array(RawModelSchema).optional(),
		}).or(z.array(RawModelSchema));
		const parsed = ModelListSchema.parse(await res.json());
		const rawModels: RawModel[] = Array.isArray(parsed)
			? (parsed as RawModel[])
			: ((parsed.data ?? []) as RawModel[]);

		const normalized: LiveModelInfo[] = rawModels
		.map((m: RawModel) => {
				const id = m.id || m.name || m.model || m.slug || String(m);
				if (!id || typeof id !== "string") return null;

				// Extract live numbers - whatever the endpoint gives us
				const contextLength =
					m.context_length ??
					m.contextLength ??
					m.context_window ??
					m.top_provider?.context_length ??
					m.architecture?.context_length ??
					undefined;

				const maxOutput =
					m.max_completion_tokens ??
					m.top_provider?.max_completion_tokens ??
					m.max_tokens ??
					m.max_output_tokens ??
					undefined;

			let pricing: { input?: number; output?: number; [key: string]: unknown } | undefined;
			if (m.pricing) {
					const rawPricing = m.pricing as Record<string, unknown>;
					pricing = {
						...rawPricing,
						input: toPerMillion(
							rawPricing.prompt ?? rawPricing.input ?? rawPricing?.prompt,
						),
						output: toPerMillion(
							rawPricing.completion ?? rawPricing.output ?? rawPricing?.completion,
						),
					};
				}

				return {
					id,
					name: m.name || m.id,
					contextLength: contextLength ? Number(contextLength) : undefined,
					maxOutputTokens: maxOutput ? Number(maxOutput) : undefined,
					pricing,
					ownedBy: m.owned_by || m.ownedBy,
					raw: m,
				} as LiveModelInfo;
			})
			.filter(Boolean) as LiveModelInfo[];

		return normalized.slice(0, 200);
	} catch {
		return [];
	}
}

function toPerMillion(val: unknown): number | undefined {
	if (val == null) return undefined;
	const n = typeof val === "string" ? parseFloat(val) : Number(val);
	if (!Number.isFinite(n)) return undefined;
	// OpenRouter etc often give per-token (e.g. 0.0000005 = $0.50 / M). If < 1 treat as per-token.
	if (n > 0 && n < 1) return n * 1_000_000;
	return n;
}

/** Convenience: fetch and return string ids (back-compat for old callers) */
export async function listModelIdsForProvider(
	provider: string,
	config: { apiKey?: string; baseUrl?: string },
): Promise<string[]> {
	const rich = await listModelsForProvider(provider, config);
	return rich.map((m) => m.id).slice(0, 100);
}

// Legacy re-exports point at live where possible (old static remains as fallback only)
export const getLiveModelInfo = (models: LiveModelInfo[], id: string) =>
	models.find((m) => m.id === id || m.id.includes(id) || id.includes(m.id));
