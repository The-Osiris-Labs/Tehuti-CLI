import { z } from "zod";

export const MCPTransportTypeSchema = z.enum([
	"stdio",
	"http",
	"sse",
	"websocket",
]);

export const MCP_SERVER_CONFIG_SCHEMA = z.object({
	command: z.string().optional(),
	args: z.array(z.string()).optional().default([]),
	env: z.record(z.string()).optional().default({}),
	disabled: z.boolean().optional().default(false),
	transport: MCPTransportTypeSchema.optional().default("stdio"),
	url: z.string().url().optional(),
	headers: z.record(z.string()).optional().default({}),
	timeout: z.number().int().positive().optional().default(30000),
	reconnect: z
		.object({
			enabled: z.boolean().default(true),
			maxAttempts: z.number().int().min(0).max(10).default(3),
			delayMs: z.number().int().positive().default(1000),
			backoff: z.enum(["linear", "exponential"]).default("exponential"),
		})
		.optional()
		.default({
			enabled: true,
			maxAttempts: 3,
			delayMs: 1000,
			backoff: "exponential",
		}),
	healthCheck: z
		.object({
			enabled: z.boolean().default(true),
			intervalMs: z.number().int().positive().default(30000),
			timeoutMs: z.number().int().positive().default(5000),
		})
		.optional()
		.default({ enabled: true, intervalMs: 30000, timeoutMs: 5000 }),
	toolFilter: z
		.object({
			allowlist: z.array(z.string()).optional(),
			denylist: z.array(z.string()).optional(),
		})
		.optional(),
	capabilities: z
		.object({
			sampling: z.boolean().optional().default(false),
			elicitation: z.boolean().optional().default(false),
		})
		.optional()
		.default({ sampling: false, elicitation: false }),
});

export const PERMISSIONS_CONFIG_SCHEMA = z.object({
	defaultMode: z
		.enum(["interactive", "trust", "readonly"])
		.default("interactive"),
	alwaysAllow: z
		.array(z.string())
		.default(["read", "glob", "grep", "web_fetch", "web_search"]),
	alwaysDeny: z.array(z.string()).default([]),
	trustedMode: z.boolean().default(false),
	allowedCommands: z.array(z.string()).optional(),
	deniedCommands: z.array(z.string()).optional(),
});

export const BRANDING_CONFIG_SCHEMA = z.object({
	name: z.string().default("Tehuti"),
	tagline: z.string().default("Scribe of Code Transformations"),
	symbol: z.string().default("𓆣"),
	colors: z
		.object({
			primary: z.string().default("#D4AF37"),
			secondary: z.string().default("#1A1A2E"),
			accent: z.string().default("#C9A227"),
		})
		.optional(),
});

export const MODEL_SELECTION_SCHEMA = z.enum([
	"auto",
	"manual",
	"cost-optimized",
	"speed-optimized",
]);

export const PROVIDER_SCHEMA = z.string().min(1).default("opencode");

export const CUSTOM_PROVIDER_SCHEMA = z.object({
	name: z.string().min(1).describe("Name of custom provider"),
	baseUrl: z.string().url().describe("API endpoint base URL"),
	apiKey: z.string().min(1).optional().describe("API key for custom provider"),
	headers: z
		.record(z.string())
		.optional()
		.describe("Additional headers to send with requests"),
});

export const KILOCODE_ADVANCED_SCHEMA = z.object({
	memoryBank: z
		.object({
			enabled: z.boolean().default(false),
			sessionId: z.string().optional(),
			persistence: z.enum(["memory", "disk"]).default("memory"),
		})
		.optional(),
	streamingOptions: z
		.object({
			thinking: z.boolean().default(true),
			codeReviews: z.boolean().default(false),
		})
		.optional(),
	contextManagement: z
		.object({
			autoSummarize: z.boolean().default(true),
			maxContextLength: z.number().int().positive().default(32000),
		})
		.optional(),
});

export const GREPAI_ADVANCED_SCHEMA = z.object({
	memoryBank: z
		.object({
			enabled: z.boolean().default(false),
			path: z.string().optional(),
			compression: z.boolean().default(true),
		})
		.optional(),
	indexing: z
		.object({
			parallel: z.boolean().default(false),
			maxWorkers: z.number().int().positive().default(4),
		})
		.optional(),
});

export const COLLABORATION_SCHEMA = z.object({
	enabled: z.boolean().default(false),
	sessionId: z.string().optional(),
	peers: z.array(z.string()).optional(),
	realTime: z.boolean().default(true),
});

export const DAEMON_CONFIG_SCHEMA = z.object({
	enabled: z.boolean().default(false),
	port: z.number().int().positive().default(9090),
});

export const MESSAGING_CONFIG_SCHEMA = z.object({
	enabled: z.boolean().default(true),
	historySize: z.number().int().positive().default(100),
});

export const SELF_HEALING_CONFIG_SCHEMA = z.object({
	enabled: z.boolean().default(true),
	maxRetries: z.number().int().min(0).max(10).default(3),
});

export const PERSONALITY_CONFIG_SCHEMA = z.object({
	style: z.enum(["professional", "casual", "strict", "helpful"]).default("helpful"),
	verbosity: z.enum(["low", "medium", "high"]).default("medium"),
});

export const HTTP_CONFIG_SCHEMA = z.object({
	keepAliveTimeout: z.number().int().positive().default(60000),
	keepAliveMaxTimeout: z.number().int().positive().default(600000),
	keepAliveTimeoutThreshold: z.number().int().positive().default(1000),
	connections: z.number().int().positive().default(50),
	pipelining: z.number().int().positive().default(1),
	connectTimeout: z.number().int().positive().default(10000),
	tcpKeepAlive: z.boolean().default(true),
	tcpKeepAliveInitialDelay: z.number().int().positive().default(30000),
});

export const HOOK_CONFIG_SCHEMA = z.object({
	type: z.literal("command").default("command"),
	command: z.string(),
	timeout: z.number().int().positive().optional().default(30000),
});

export const HOOK_MATCHER_SCHEMA = z.object({
	matcher: z.string().default("*"),
	hooks: z.array(HOOK_CONFIG_SCHEMA),
});

export const HOOKS_CONFIG_SCHEMA = z.object({
	PreToolUse: z.array(HOOK_MATCHER_SCHEMA).optional(),
	PostToolUse: z.array(HOOK_MATCHER_SCHEMA).optional(),
	PreCommit: z.array(HOOK_MATCHER_SCHEMA).optional(),
	Notification: z.array(HOOK_MATCHER_SCHEMA).optional(),
});

export const TEHUTI_CONFIG_SCHEMA = z.object({
	$schema: z.string().optional(),
	model: z.string().min(1).default("deepseek-v4-flash"),
	fallbackModel: z.string().min(1).default("deepseek-v4-flash"),
	apiKey: z.string().min(1).optional(),
	baseUrl: z.string().url().optional(),
	provider: PROVIDER_SCHEMA,
	customProvider: CUSTOM_PROVIDER_SCHEMA.optional(),
	oauth: z
		.object({
			google: z
				.object({
					accessToken: z.string().optional(),
					refreshToken: z.string().optional(),
					expiry: z.number().optional(),
				})
				.optional(),
		})
		.optional()
		.default({}),
	maxTokens: z.number().int().positive().default(32000),
	maxIterations: z.number().int().positive().default(50),
	temperature: z.number().min(0).max(2).default(0.7),
	extendedThinking: z.boolean().default(false),
	thinkingBudgetTokens: z.number().int().min(1024).max(100000).optional(),
	requestTimeout: z.number().int().min(5000).max(600000).default(120000),
	maxRetries: z.number().int().min(0).max(10).default(3),
	modelSelection: MODEL_SELECTION_SCHEMA.default("auto"),
	modelTiers: z
		.object({
			fast: z.string().optional(),
			balanced: z.string().optional(),
			deep: z.string().optional(),
		})
		.optional(),
	permissions: PERMISSIONS_CONFIG_SCHEMA.default({}),
	mcp: z
		.object({
			enabled: z.boolean().default(true),
			servers: z.record(MCP_SERVER_CONFIG_SCHEMA).optional().default({}),
		})
		.optional()
		.default({ enabled: true, servers: {} }),
	branding: BRANDING_CONFIG_SCHEMA.optional(),
	debug: z.boolean().default(false),
	telemetry: z.boolean().default(false),
	hooks: HOOKS_CONFIG_SCHEMA.optional().default({}),
	// Advanced features
	kilocode: KILOCODE_ADVANCED_SCHEMA.optional(),
	grepai: GREPAI_ADVANCED_SCHEMA.optional(),
	collaboration: COLLABORATION_SCHEMA.optional(),
	http: HTTP_CONFIG_SCHEMA.optional().default({}),
	daemon: DAEMON_CONFIG_SCHEMA.optional(),
	messaging: MESSAGING_CONFIG_SCHEMA.optional(),
	selfHealing: SELF_HEALING_CONFIG_SCHEMA.optional(),
	personality: PERSONALITY_CONFIG_SCHEMA.optional(),
});

export type TehutiConfig = z.infer<typeof TEHUTI_CONFIG_SCHEMA>;
export type PermissionsConfig = z.infer<typeof PERMISSIONS_CONFIG_SCHEMA>;
export type MCPServerConfig = z.infer<typeof MCP_SERVER_CONFIG_SCHEMA>;
export type MCPTransportType = z.infer<typeof MCPTransportTypeSchema>;
export type BrandingConfig = z.infer<typeof BRANDING_CONFIG_SCHEMA>;
export type ModelSelectionMode = z.infer<typeof MODEL_SELECTION_SCHEMA>;
export type HttpConfig = z.infer<typeof HTTP_CONFIG_SCHEMA>;

export const DEFAULT_CONFIG: TehutiConfig = {
	model: "deepseek-v4-flash",
	fallbackModel: "deepseek-v4-flash",
	apiKey: undefined,
	baseUrl: undefined,
	provider: "opencode",
	maxTokens: 32000,
	maxIterations: 50,
	temperature: 0.7,
	extendedThinking: false,
	requestTimeout: 120000,
	maxRetries: 3,
	modelSelection: "auto",
	modelTiers: undefined,
	permissions: {
		defaultMode: "interactive",
		alwaysAllow: ["read", "glob", "grep", "web_fetch", "web_search"],
		alwaysDeny: [],
		trustedMode: false,
	},
	mcp: {
		enabled: true,
		servers: {},
	},
	oauth: {},
	branding: undefined,
	debug: false,
	telemetry: false,
	hooks: {},
	kilocode: {
		memoryBank: {
			enabled: false,
			sessionId: "default",
			persistence: "memory",
		},
		streamingOptions: {
			thinking: true,
			codeReviews: false,
		},
		contextManagement: {
			autoSummarize: true,
			maxContextLength: 200000,
		},
	},
	grepai: {
		memoryBank: {
			enabled: false,
			path: ".grepai",
			compression: true,
		},
		indexing: {
			parallel: false,
			maxWorkers: 4,
		},
	},
	collaboration: {
		enabled: false,
		sessionId: "default",
		peers: [],
		realTime: true,
	},
	customProvider: undefined,
	http: {
		keepAliveTimeout: 60000,
		keepAliveMaxTimeout: 600000,
		keepAliveTimeoutThreshold: 1000,
		connections: 50,
		pipelining: 1,
		connectTimeout: 10000,
		tcpKeepAlive: true,
		tcpKeepAliveInitialDelay: 30000,
	},
	daemon: {
		enabled: false,
		port: 9090,
	},
	messaging: {
		enabled: true,
		historySize: 100,
	},
	selfHealing: {
		enabled: true,
		maxRetries: 3,
	},
	personality: {
		style: "helpful",
		verbosity: "medium",
	},
};
