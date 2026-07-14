export type LocalProviderSourceId = "ollama-local" | "lmstudio-local";

export type LocalProviderProbeStatus =
	| "reachable"
	| "unreachable"
	| "invalid-response"
	| "unsupported-source";

export interface LocalProviderProbeResult {
	sourceId: string;
	status: LocalProviderProbeStatus;
	endpoint?: "ollama-default" | "lmstudio-default";
	models: string[];
	error?:
		| "connection-failed"
		| "request-timeout"
		| "http-error"
		| "invalid-response";
}

type ProbeResponse = Pick<Response, "ok" | "json">;
type ProbeFetch = (input: string, init: RequestInit) => Promise<ProbeResponse>;

type LocalProviderDefinition = {
	sourceId: LocalProviderSourceId;
	endpoint: "ollama-default" | "lmstudio-default";
	url: string;
	readModels: (body: unknown) => string[] | undefined;
};

const MAX_MODELS = 100;
const MAX_MODEL_NAME_LENGTH = 256;
const PROBE_TIMEOUT_MS = 1_500;

function stringModels(values: unknown): string[] | undefined {
	if (!Array.isArray(values)) return undefined;
	return values
		.flatMap((value) => (typeof value === "string" ? [value] : []))
		.map((model) => model.trim())
		.filter(Boolean)
		.slice(0, MAX_MODELS)
		.map((model) => model.slice(0, MAX_MODEL_NAME_LENGTH));
}

const LOCAL_PROVIDERS: readonly LocalProviderDefinition[] = [
	{
		sourceId: "ollama-local",
		endpoint: "ollama-default",
		url: "http://127.0.0.1:11434/api/tags",
		readModels: (body) => {
			if (!body || typeof body !== "object") return undefined;
			const models = (body as { models?: unknown }).models;
			if (!Array.isArray(models)) return undefined;
			return stringModels(
				models.map((model) =>
					model && typeof model === "object"
						? (model as { name?: unknown }).name
						: undefined,
				),
			);
		},
	},
	{
		sourceId: "lmstudio-local",
		endpoint: "lmstudio-default",
		url: "http://127.0.0.1:1234/v1/models",
		readModels: (body) => {
			if (!body || typeof body !== "object") return undefined;
			const models = (body as { data?: unknown }).data;
			if (!Array.isArray(models)) return undefined;
			return stringModels(
				models.map((model) =>
					model && typeof model === "object"
						? (model as { id?: unknown }).id
						: undefined,
				),
			);
		},
	},
];

function isAbortError(error: unknown): boolean {
	return error instanceof Error && error.name === "AbortError";
}

/**
 * Opt-in local model discovery. This only probes fixed loopback endpoints;
 * it never accepts an arbitrary URL, scans a network, follows redirects, or
 * sends credentials.
 */
export async function probeLocalProvider(
	sourceId: string,
	options: { fetchImpl?: ProbeFetch } = {},
): Promise<LocalProviderProbeResult> {
	const provider = LOCAL_PROVIDERS.find(
		(candidate) => candidate.sourceId === sourceId,
	);
	if (!provider) {
		return { sourceId, status: "unsupported-source", models: [] };
	}

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
	const fetchImpl = options.fetchImpl ?? fetch;

	try {
		const response = await fetchImpl(provider.url, {
			method: "GET",
			redirect: "error",
			signal: controller.signal,
			headers: { Accept: "application/json" },
		});
		if (!response.ok) {
			return {
				sourceId,
				endpoint: provider.endpoint,
				status: "unreachable",
				models: [],
				error: "http-error",
			};
		}

		let body: unknown;
		try {
			body = await response.json();
		} catch {
			return {
				sourceId,
				endpoint: provider.endpoint,
				status: "invalid-response",
				models: [],
				error: "invalid-response",
			};
		}

		const models = provider.readModels(body);
		if (!models) {
			return {
				sourceId,
				endpoint: provider.endpoint,
				status: "invalid-response",
				models: [],
				error: "invalid-response",
			};
		}

		return {
			sourceId,
			endpoint: provider.endpoint,
			status: "reachable",
			models,
		};
	} catch (error) {
		return {
			sourceId,
			endpoint: provider.endpoint,
			status: "unreachable",
			models: [],
			error: isAbortError(error) ? "request-timeout" : "connection-failed",
		};
	} finally {
		clearTimeout(timeout);
	}
}
