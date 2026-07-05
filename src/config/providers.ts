export interface ProviderInfo {
	id: string;
	name: string;
	defaultBaseUrl?: string;
	isOpenAICompatible: boolean;
	authHeader: string; // 'Authorization' or 'x-api-key'
	modelListEndpoint: string; // usually /v1/models
	requiresApiKey: boolean;
	oauthSupported: boolean;
	notes?: string;
	modelTiers?: {
		fast: string;
		balanced: string;
		deep: string;
	};
}

export const KNOWN_PROVIDERS: ProviderInfo[] = [
	{
		id: "openrouter",
		name: "OpenRouter (Pay-per-use API aggregator)",
		defaultBaseUrl: "https://openrouter.ai/api/v1",
		isOpenAICompatible: true,
		authHeader: "Authorization",
		modelListEndpoint: "/v1/models",
		requiresApiKey: true,
		oauthSupported: true,
		notes: "Huge model selection, pay per use",
		modelTiers: {
			fast: "deepseek/deepseek-chat",
			balanced: "deepseek/deepseek-reasoner",
			deep: "anthropic/claude-sonnet-4",
		},
	},
	{
		id: "anthropic",
		name: "Anthropic (Claude models via API key or Claude Code)",
		defaultBaseUrl: "https://api.anthropic.com/v1",
		isOpenAICompatible: false, // uses different format, but we route via compatible where possible or note
		authHeader: "x-api-key",
		modelListEndpoint: "/v1/models", // may not be standard
		requiresApiKey: true,
		oauthSupported: true,
		notes:
			"Best for Claude. Direct or via OpenRouter recommended for compatibility",
	},
	{
		id: "openai",
		name: "OpenAI (Codex CLI or direct OpenAI API)",
		defaultBaseUrl: "https://api.openai.com/v1",
		isOpenAICompatible: true,
		authHeader: "Authorization",
		modelListEndpoint: "/v1/models",
		requiresApiKey: true,
		oauthSupported: false,
		notes: "GPT models",
	},
	{
		id: "xai",
		name: "xAI Grok (Direct API or SuperGrok / Premium+ OAuth)",
		defaultBaseUrl: "https://api.x.ai/v1",
		isOpenAICompatible: true,
		authHeader: "Authorization",
		modelListEndpoint: "/v1/models",
		requiresApiKey: true,
		oauthSupported: true,
		notes: "Grok models, currently highlighted",
	},
	{
		id: "ollama",
		name: "Ollama (localhost:11434/v1 or cloud)",
		defaultBaseUrl: "http://localhost:11434/v1",
		isOpenAICompatible: true,
		authHeader: "Authorization",
		modelListEndpoint: "/v1/models",
		requiresApiKey: false,
		oauthSupported: false,
		notes: "Local models",
	},
	{
		id: "lmstudio",
		name: "LM Studio (Local desktop app with built-in model server)",
		defaultBaseUrl: "http://localhost:1234/v1",
		isOpenAICompatible: true,
		authHeader: "Authorization",
		modelListEndpoint: "/v1/models",
		requiresApiKey: false,
		oauthSupported: false,
	},
	{
		id: "deepseek",
		name: "DeepSeek (V3, R1, coder, direct API)",
		defaultBaseUrl: "https://api.deepseek.com/v1",
		isOpenAICompatible: true,
		authHeader: "Authorization",
		modelListEndpoint: "/v1/models",
		requiresApiKey: true,
		oauthSupported: false,
	},
	{
		id: "google",
		name: "Google Gemini (AI Studio API or OAuth + Code Assist)",
		defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
		isOpenAICompatible: false,
		authHeader: "x-goog-api-key",
		modelListEndpoint: "/models",
		requiresApiKey: true,
		oauthSupported: true,
	},
	{
		id: "kilocode",
		name: "Kilo Code (Kilo Gateway API)",
		defaultBaseUrl: "https://api.kilo.ai/api/gateway",
		isOpenAICompatible: true,
		authHeader: "Authorization",
		modelListEndpoint: "/v1/models",
		requiresApiKey: true,
		oauthSupported: false,
	},
	{
		id: "opencode",
		name: "OpenCode Go (subscription)",
		defaultBaseUrl: "https://opencode.ai/zen/go/v1",
		isOpenAICompatible: true,
		authHeader: "Authorization",
		modelListEndpoint: "/models",
		requiresApiKey: true,
		oauthSupported: false,
		notes:
			"OpenCode Go. Default model minimax-m3. Low-cost subscription. Models include minimax-m3 and others.",
		modelTiers: {
			fast: "deepseek-v4-flash",
			balanced: "minimax-m3",
			deep: "deepseek-v4-flash",
		},
	},
	{
		id: "custom",
		name: "Custom endpoint (enter URL manually)",
		isOpenAICompatible: true,
		authHeader: "Authorization",
		modelListEndpoint: "/v1/models",
		requiresApiKey: false,
		oauthSupported: false,
	},
	{
		id: "novita",
		name: "NovitaAI (Cloud: Model API, Agent Sandbox, GPU Cloud)",
		defaultBaseUrl: "https://api.novita.ai/v3",
		isOpenAICompatible: true,
		authHeader: "Authorization",
		modelListEndpoint: "/v1/models",
		requiresApiKey: true,
		oauthSupported: false,
	},
	{
		id: "qwen",
		name: "Qwen Cloud / DashScope (Qwen + multi-provider)",
		defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
		isOpenAICompatible: true,
		authHeader: "Authorization",
		modelListEndpoint: "/v1/models",
		requiresApiKey: true,
		oauthSupported: true,
	},
	{
		id: "nvidia",
		name: "NVIDIA NIM (Nemotron models via build.nvidia.com or local NIM)",
		defaultBaseUrl: "https://integrate.api.nvidia.com/v1",
		isOpenAICompatible: true,
		authHeader: "Authorization",
		modelListEndpoint: "/v1/models",
		requiresApiKey: true,
		oauthSupported: false,
	},
	{
		id: "github",
		name: "GitHub Copilot (GitHub token API or copilot --acp process)",
		defaultBaseUrl: "https://api.githubcopilot.com",
		isOpenAICompatible: true,
		authHeader: "Authorization",
		modelListEndpoint: "/v1/models",
		requiresApiKey: true, // or token
		oauthSupported: true,
	},
	// Add more from list as needed, all use sensible defaults
	{
		id: "huggingface",
		name: "Hugging Face Inference Providers",
		defaultBaseUrl: "https://api-inference.huggingface.co/models",
		isOpenAICompatible: false,
		authHeader: "Authorization",
		modelListEndpoint: "",
		requiresApiKey: true,
		oauthSupported: true,
	},
	{
		id: "aws-bedrock",
		name: "AWS Bedrock (Claude, Nova, Llama, DeepSeek; IAM or API key)",
		defaultBaseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com",
		isOpenAICompatible: false,
		authHeader: "Authorization",
		modelListEndpoint: "",
		requiresApiKey: true,
		oauthSupported: false,
	},
	{
		id: "azure",
		name: "Azure Foundry (OpenAI-style or Anthropic-style endpoint)",
		defaultBaseUrl: "https://YOUR-RESOURCE.openai.azure.com/openai/deployments",
		isOpenAICompatible: false,
		authHeader: "api-key",
		modelListEndpoint: "/chat/completions?api-version=2024-02-15-preview", // example
		requiresApiKey: true,
		oauthSupported: false,
	},
];

function normalizeProviderId(id: string): string {
	return id.trim().toLowerCase();
}

function normalizeBaseUrl(baseUrl?: string): string | undefined {
	if (!baseUrl) return undefined;
	return baseUrl.trim().replace(/\/+$/, "");
}

export interface ProviderRuntimeContract {
	provider: string;
	info: ProviderInfo | undefined;
	known: boolean;
	runtimeSupported: boolean;
}

export function getProviderContract(
	providerId: string,
): ProviderRuntimeContract {
	const normalized = normalizeProviderId(providerId);
	const info = getProviderInfo(normalized);

	return {
		provider: normalized,
		info,
		known: Boolean(info),
		runtimeSupported: info?.isOpenAICompatible ?? false,
	};
}

export function getProviderInfo(id: string): ProviderInfo | undefined {
	const normalized = normalizeProviderId(id);
	return KNOWN_PROVIDERS.find(
		(provider) => normalizeProviderId(provider.id) === normalized,
	);
}

export function getAllProviders(): ProviderInfo[] {
	return [...KNOWN_PROVIDERS];
}

export function getDefaultBaseUrlForProvider(id: string): string | undefined {
	return normalizeBaseUrl(getProviderInfo(id)?.defaultBaseUrl);
}

export function getProviderForDefaultBaseUrl(
	baseUrl?: string,
): ProviderInfo | undefined {
	const normalized = normalizeBaseUrl(baseUrl);
	if (!normalized) return undefined;

	return KNOWN_PROVIDERS.find(
		(provider) => normalizeBaseUrl(provider.defaultBaseUrl) === normalized,
	);
}

export function resolveBaseUrlForProvider(
	providerId: string,
	baseUrl?: string,
): string | undefined {
	const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
	const providerDefault = getDefaultBaseUrlForProvider(providerId);

	if (!normalizedBaseUrl) {
		return providerDefault;
	}

	const defaultOwner = getProviderForDefaultBaseUrl(normalizedBaseUrl);
	if (
		defaultOwner &&
		normalizeProviderId(defaultOwner.id) !== normalizeProviderId(providerId)
	) {
		return providerDefault ?? normalizedBaseUrl;
	}

	return normalizedBaseUrl;
}

export function getProviderAuthHeaders(
	providerId: string,
	apiKey?: string,
	customHeaders?: Record<string, string>,
): Record<string, string> {
	if (!apiKey) {
		return {};
	}

	if (
		customHeaders &&
		Object.keys(customHeaders).some((key) => {
			const lowerKey = key.toLowerCase();
			return (
				lowerKey === "authorization" ||
				lowerKey === "api-key" ||
				lowerKey === "x-api-key" ||
				lowerKey === "x-goog-api-key"
			);
		})
	) {
		return {};
	}

	const info = getProviderInfo(providerId);
	const authHeader = info?.authHeader || "Authorization";

	if (authHeader.toLowerCase() === "authorization") {
		return {
			Authorization: apiKey.startsWith("Bearer ") ? apiKey : `Bearer ${apiKey}`,
		};
	}

	return {
		[authHeader]: apiKey,
	};
}

export function getProviderModelsUrl(
	providerId: string,
	baseUrl?: string,
): string | undefined {
	const normalizedProvider = normalizeProviderId(providerId);
	const info = getProviderInfo(normalizedProvider);
	const resolvedBaseUrl = resolveBaseUrlForProvider(
		normalizedProvider,
		baseUrl,
	);
	if (!resolvedBaseUrl) {
		return undefined;
	}

	const endpoint = info?.modelListEndpoint ?? "/models";
	let normalizedEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;

	if (resolvedBaseUrl.endsWith("/v1") && normalizedEndpoint.startsWith("/v1")) {
		normalizedEndpoint = normalizedEndpoint.slice(3) || "/";
	}

	return `${resolvedBaseUrl}${normalizedEndpoint}`;
}

export function getApiKeyEnvVarsForProvider(providerId: string): string[] {
	switch (normalizeProviderId(providerId)) {
		case "kilocode":
			return ["KILO_API_KEY", "TEHUTI_API_KEY"];
		case "openrouter":
			return ["OPENROUTER_API_KEY", "TEHUTI_API_KEY"];
		case "opencode":
			return ["OPENCODE_API_KEY", "TEHUTI_API_KEY", "OPENROUTER_API_KEY"];
		case "xai":
			return ["XAI_API_KEY", "GROK_API_KEY", "TEHUTI_API_KEY"];
		case "anthropic":
			return ["ANTHROPIC_API_KEY", "TEHUTI_API_KEY"];
		case "openai":
			return ["OPENAI_API_KEY", "TEHUTI_API_KEY"];
		case "deepseek":
			return ["DEEPSEEK_API_KEY", "TEHUTI_API_KEY"];
		case "google":
			return ["GOOGLE_API_KEY", "GEMINI_API_KEY", "TEHUTI_API_KEY"];
		case "qwen":
			return ["DASHSCOPE_API_KEY", "QWEN_API_KEY", "TEHUTI_API_KEY"];
		case "nvidia":
			return ["NVIDIA_API_KEY", "TEHUTI_API_KEY"];
		case "github":
			return ["GITHUB_TOKEN", "GITHUB_API_KEY", "TEHUTI_API_KEY"];
		case "custom":
			return ["CUSTOM_API_KEY", "TEHUTI_API_KEY"];
		default:
			return ["TEHUTI_API_KEY"];
	}
}

export function getEnvApiKeyForProvider(
	providerId: string,
): string | undefined {
	for (const envName of getApiKeyEnvVarsForProvider(providerId)) {
		const value = process.env[envName]?.trim();
		if (value) {
			return value;
		}
	}
	return undefined;
}

export function supportsOpenAICompatibleRuntime(providerId: string): boolean {
	const info = getProviderInfo(providerId);
	return info?.isOpenAICompatible ?? false;
}
