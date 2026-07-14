import { z } from "zod";

export const MCPTransportTypeSchema = z
	.enum(["stdio", "http", "sse", "websocket"])
	.describe("MCP server transport type");

export const MCP_SERVER_CONFIG_SCHEMA = z.object({
	command: z.string().optional().describe("Command to run the MCP server"),
	args: z
		.array(z.string())
		.optional()
		.default([])
		.describe("Arguments to pass to the command"),
	env: z
		.record(z.string())
		.optional()
		.default({})
		.describe("Environment variables for the server process"),
	disabled: z
		.boolean()
		.optional()
		.default(false)
		.describe("Whether this server is disabled"),
	transport: MCPTransportTypeSchema.optional().default("stdio"),
	url: z
		.string()
		.url({ message: "MCP server URL must be a valid URL" })
		.optional()
		.describe("URL for HTTP/SSE/WebSocket transports"),
	headers: z
		.record(z.string())
		.optional()
		.default({})
		.describe("Custom headers for HTTP requests"),
	timeout: z
		.number()
		.int({ message: "Timeout must be an integer" })
		.positive({ message: "Timeout must be a positive number of milliseconds" })
		.optional()
		.default(30000)
		.describe("Connection/request timeout in milliseconds"),
	reconnect: z
		.object({
			enabled: z
				.boolean()
				.default(true)
				.describe("Enable automatic reconnection"),
			maxAttempts: z
				.number()
				.int()
				.min(0, { message: "maxAttempts cannot be negative" })
				.max(10, { message: "maxAttempts cannot exceed 10" })
				.default(3)
				.describe("Maximum number of reconnection attempts"),
			delayMs: z
				.number()
				.int()
				.positive({ message: "delayMs must be positive" })
				.default(1000)
				.describe("Delay between reconnection attempts in milliseconds"),
			backoff: z
				.enum(["linear", "exponential"])
				.default("exponential")
				.describe("Backoff strategy for reconnection"),
		})
		.optional()
		.default({
			enabled: true,
			maxAttempts: 3,
			delayMs: 1000,
			backoff: "exponential",
		})
		.describe("Reconnection policy"),
	healthCheck: z
		.object({
			enabled: z.boolean().default(true).describe("Enable health checks"),
			intervalMs: z
				.number()
				.int()
				.positive({ message: "intervalMs must be positive" })
				.default(30000)
				.describe("Interval between health checks in milliseconds"),
			timeoutMs: z
				.number()
				.int()
				.positive({ message: "timeoutMs must be positive" })
				.default(5000)
				.describe("Timeout for health checks in milliseconds"),
		})
		.optional()
		.default({ enabled: true, intervalMs: 30000, timeoutMs: 5000 })
		.describe("Health check configuration"),
	toolFilter: z
		.object({
			allowlist: z
				.array(z.string())
				.optional()
				.describe("List of allowed tool names"),
			denylist: z
				.array(z.string())
				.optional()
				.describe("List of denied tool names"),
		})
		.optional()
		.describe("Tool filtering configuration"),
	capabilities: z
		.object({
			sampling: z
				.boolean()
				.optional()
				.default(false)
				.describe("Support sampling capability"),
			elicitation: z
				.boolean()
				.optional()
				.default(false)
				.describe("Support elicitation capability"),
		})
		.optional()
		.default({ sampling: false, elicitation: false })
		.describe("MCP capabilities"),
});

export const PERMISSIONS_CONFIG_SCHEMA = z.object({
	defaultMode: z
		.enum(["interactive", "trust", "readonly"])
		.default("interactive")
		.describe("Default permission mode for tool execution"),
	alwaysAllow: z
		.array(z.string())
		.default(["read", "glob", "grep", "web_fetch", "web_search"])
		.describe("List of tools that never require user confirmation"),
	alwaysDeny: z
		.array(z.string())
		.default([])
		.describe("List of tools that are permanently denied"),
	trustedMode: z
		.boolean()
		.default(false)
		.describe("Enable trusted mode (legacy)"),
	allowedCommands: z
		.array(z.string())
		.optional()
		.describe("List of allowed terminal commands in sandboxed bash"),
	deniedCommands: z
		.array(z.string())
		.optional()
		.describe("List of denied terminal commands in sandboxed bash"),
});

export const BRANDING_CONFIG_SCHEMA = z.object({
	name: z
		.string()
		.min(1, { message: "Name cannot be empty" })
		.default("Tehuti")
		.describe("Custom name for the assistant"),
	tagline: z
		.string()
		.default("Scribe of Code Transformations")
		.describe("Custom tagline for the assistant"),
	symbol: z
		.string()
		.min(1, { message: "Symbol cannot be empty" })
		.default("𓆣")
		.describe("Custom symbol for the assistant"),
	colors: z
		.object({
			primary: z
				.string()
				.regex(/^#[0-9a-fA-F]{3,8}$/, {
					message: "Must be a valid hex color code",
				})
				.default("#D4AF37")
				.describe("Primary color (hex)"),
			secondary: z
				.string()
				.regex(/^#[0-9a-fA-F]{3,8}$/, {
					message: "Must be a valid hex color code",
				})
				.default("#1A1A2E")
				.describe("Secondary color (hex)"),
			accent: z
				.string()
				.regex(/^#[0-9a-fA-F]{3,8}$/, {
					message: "Must be a valid hex color code",
				})
				.default("#C9A227")
				.describe("Accent color (hex)"),
		})
		.optional()
		.describe("Custom terminal colors"),
	glyphMode: z
		.enum(["nerd", "unicode", "ascii"])
		.default("unicode")
		.describe("Glyph rendering mode for UI elements"),
});

export const MODEL_SELECTION_SCHEMA = z
	.enum(["auto", "manual", "cost-optimized", "speed-optimized"])
	.describe("Strategy for selecting models");

export const PROVIDER_SCHEMA = z
	.string()
	.min(1, { message: "Provider cannot be empty" })
	.default("opencode")
	.describe("Name of the primary LLM provider");

export const CUSTOM_PROVIDER_SCHEMA = z.object({
	name: z
		.string()
		.min(1, { message: "Custom provider name cannot be empty" })
		.describe("Name of custom provider"),
	baseUrl: z
		.string()
		.url({ message: "Custom provider baseUrl must be a valid URL" })
		.describe("API endpoint base URL"),
	apiKey: z
		.string()
		.min(1, { message: "Custom provider API key cannot be empty" })
		.optional()
		.describe("API key for custom provider"),
	headers: z
		.record(z.string())
		.optional()
		.describe("Additional headers to send with requests"),
});

export const KILOCODE_ADVANCED_SCHEMA = z.object({
	memoryBank: z
		.object({
			enabled: z
				.boolean()
				.default(false)
				.describe("Enable KiloCode memory bank"),
			sessionId: z
				.string()
				.min(1, { message: "Session ID cannot be empty" })
				.optional()
				.default("default")
				.describe("Session ID for memory grouping"),
			persistence: z
				.enum(["memory", "disk"])
				.default("memory")
				.describe("Where to persist memory"),
		})
		.optional()
		.default({}),
	streamingOptions: z
		.object({
			thinking: z.boolean().default(true).describe("Stream thinking tokens"),
			codeReviews: z
				.boolean()
				.default(false)
				.describe("Stream code reviews incrementally"),
		})
		.optional()
		.default({}),
	contextManagement: z
		.object({
			autoSummarize: z
				.boolean()
				.default(true)
				.describe("Automatically summarize old context"),
			maxContextLength: z
				.number()
				.int()
				.positive({ message: "maxContextLength must be positive" })
				.default(200000)
				.describe("Maximum tokens to keep in context window"),
		})
		.optional()
		.default({}),
});

export const GREPAI_ADVANCED_SCHEMA = z.object({
	memoryBank: z
		.object({
			enabled: z.boolean().default(false).describe("Enable GrepAI memory bank"),
			path: z
				.string()
				.min(1, { message: "Path cannot be empty" })
				.optional()
				.default(".grepai")
				.describe("Path to GrepAI index directory"),
			compression: z
				.boolean()
				.default(true)
				.describe("Enable index compression"),
		})
		.optional()
		.default({}),
	indexing: z
		.object({
			parallel: z.boolean().default(false).describe("Enable parallel indexing"),
			maxWorkers: z
				.number()
				.int()
				.positive({ message: "maxWorkers must be positive" })
				.default(4)
				.describe("Maximum number of background workers"),
		})
		.optional()
		.default({}),
});

export const COLLABORATION_SCHEMA = z.object({
	enabled: z.boolean().default(false).describe("Enable P2P collaboration"),
	sessionId: z
		.string()
		.min(1, { message: "Session ID cannot be empty" })
		.optional()
		.default("default")
		.describe("Collaboration session ID"),
	peers: z
		.array(z.string().url({ message: "Peer must be a valid URL" }))
		.optional()
		.default([])
		.describe("List of known peer endpoints"),
	realTime: z
		.boolean()
		.default(true)
		.describe("Enable real-time state synchronization"),
});

export const DAEMON_CONFIG_SCHEMA = z.object({
	enabled: z.boolean().default(false).describe("Enable background daemon"),
	restartPolicy: z
		.enum(["none", "always", "on-failure"])
		.default("on-failure")
		.describe("Daemon restart policy"),
	logLevel: z
		.enum(["debug", "info", "warn", "error"])
		.default("info")
		.describe("Daemon logging level"),
});

export const MESSAGING_CONFIG_SCHEMA = z.object({
	enabled: z.boolean().default(true).describe("Enable messaging connectors"),
	historySize: z
		.number()
		.int()
		.positive({ message: "historySize must be positive" })
		.default(100)
		.describe("Number of messages to retain in memory"),
	slackAppToken: z
		.string()
		.min(1, { message: "Slack app token cannot be empty" })
		.optional()
		.describe("Slack App-Level Token (xapp-)"),
	slackBotToken: z
		.string()
		.min(1, { message: "Slack bot token cannot be empty" })
		.optional()
		.describe("Slack Bot Token (xoxb-)"),
	discordToken: z
		.string()
		.min(1, { message: "Discord token cannot be empty" })
		.optional()
		.describe("Discord Bot Token"),
	telegramBotToken: z
		.string()
		.min(1, { message: "Telegram bot token cannot be empty" })
		.optional()
		.describe("Telegram Bot Token"),
	telegramWebhookSecret: z
		.string()
		.min(1, { message: "Telegram webhook secret cannot be empty" })
		.optional()
		.describe("Telegram Webhook Secret"),
	whatsappToken: z
		.string()
		.min(1, { message: "WhatsApp token cannot be empty" })
		.optional()
		.describe("WhatsApp API Token"),
	whatsappWebhookSecret: z
		.string()
		.min(1, { message: "WhatsApp webhook secret cannot be empty" })
		.optional()
		.describe("WhatsApp Webhook Secret"),
	whatsappPhoneNumberId: z
		.string()
		.min(1, { message: "WhatsApp phone number ID cannot be empty" })
		.optional()
		.describe("WhatsApp Phone Number ID"),
});

export const SELF_HEALING_CONFIG_SCHEMA = z.object({
	enabled: z
		.boolean()
		.default(true)
		.describe("Enable auto-healing of broken code"),
	maxRetries: z
		.number()
		.int()
		.min(0, { message: "maxRetries cannot be negative" })
		.max(10, { message: "maxRetries cannot exceed 10" })
		.default(3)
		.describe("Maximum healing attempts per issue"),
	command: z
		.string()
		.min(1, { message: "Validation command cannot be empty" })
		.default("npm test")
		.describe("Command used to validate code health"),
});

export const PERSONALITY_CONFIG_SCHEMA = z.object({
	style: z
		.enum(["professional", "casual", "strict", "helpful"])
		.default("helpful")
		.describe("Personality interaction style"),
	verbosity: z
		.enum(["low", "medium", "high"])
		.default("medium"),
	learningEnabled: z
		.boolean()
		.default(true)
		.describe("Enable user preference learning"),
	autoEnable: z
		.boolean()
		.default(false)
		.describe("Auto-detect whether to enable learning based on git repo and session count"),
	styleInjection: z
		.boolean()
		.default(true)
		.describe("Inject learned styles into system prompt"),
	analysisFrequency: z
		.number()
		.int()
		.positive({ message: "analysisFrequency must be positive" })
		.default(1)
		.describe("How often to run personality analysis (sessions)"),
});

export const MEMORY_CONFIG_SCHEMA = z.object({
	consolidationIntervalMs: z
		.number()
		.int()
		.positive({ message: "consolidationIntervalMs must be positive" })
		.default(15 * 60 * 1000)
		.describe("How frequently memory graph consolidates in milliseconds"),
});

export const HTTP_CONFIG_SCHEMA = z.object({
	keepAliveTimeout: z
		.number()
		.int()
		.positive()
		.default(60000)
		.describe("Keep-alive timeout in ms"),
	keepAliveMaxTimeout: z
		.number()
		.int()
		.positive()
		.default(600000)
		.describe("Maximum keep-alive timeout in ms"),
	keepAliveTimeoutThreshold: z
		.number()
		.int()
		.positive()
		.default(1000)
		.describe("Threshold before refreshing keep-alive"),
	connections: z
		.number()
		.int()
		.positive({ message: "Connections must be > 0" })
		.default(50)
		.describe("Maximum concurrent HTTP connections"),
	pipelining: z
		.number()
		.int()
		.positive()
		.default(1)
		.describe("Number of pipelined requests"),
	connectTimeout: z
		.number()
		.int()
		.positive()
		.default(10000)
		.describe("Connection timeout in ms"),
	tcpKeepAlive: z.boolean().default(true).describe("Enable TCP keep-alive"),
	tcpKeepAliveInitialDelay: z
		.number()
		.int()
		.positive()
		.default(30000)
		.describe("Initial delay for TCP keep-alive"),
});

export const HOOK_CONFIG_SCHEMA = z.object({
	type: z.literal("command").default("command").describe("Type of hook"),
	command: z
		.string()
		.min(1, { message: "Hook command cannot be empty" })
		.describe("Command to execute"),
	timeout: z
		.number()
		.int()
		.positive()
		.optional()
		.default(30000)
		.describe("Hook execution timeout in ms"),
});

export const HOOK_MATCHER_SCHEMA = z.object({
	matcher: z
		.string()
		.min(1, { message: "Matcher pattern cannot be empty" })
		.default("*")
		.describe("Glob pattern to match events/tools"),
	hooks: z.array(HOOK_CONFIG_SCHEMA).describe("List of hooks to trigger"),
});

export const HOOKS_CONFIG_SCHEMA = z.object({
	PreToolUse: z
		.array(HOOK_MATCHER_SCHEMA)
		.optional()
		.describe("Hooks running before a tool executes"),
	PostToolUse: z
		.array(HOOK_MATCHER_SCHEMA)
		.optional()
		.describe("Hooks running after a tool executes"),
	PreCommit: z
		.array(HOOK_MATCHER_SCHEMA)
		.optional()
		.describe("Hooks running before a git commit"),
	Notification: z
		.array(HOOK_MATCHER_SCHEMA)
		.optional()
		.describe("Hooks running on system notifications"),
});

export const ADVISOR_MODEL_SCHEMA = z.object({
	enabled: z.boolean().default(false),
	model: z.string().optional(),
	provider: z.string().optional(),
	instructions: z
		.string()
		.default(
			"Review the primary agent's output for correctness and safety",
		),
	maxReviewsPerMinute: z.number().positive().default(3).describe("Max advisor reviews per minute (sliding window)"),
	costLimit: z.number().positive().default(0.50).describe("Cumulative cost limit for advisor reviews"),
}).optional();

export const STREAM_RULE_SCHEMA = z.object({
	pattern: z.string().describe("Regex pattern to match against streaming output"),
	remediation: z.string().describe("System instruction to inject when pattern matches"),
	enabled: z.boolean().default(true),
	maxRetries: z.number().int().positive().default(3).optional(),
});

/** Built-in default stream rules to catch common failure patterns on session start */
export const DEFAULT_STREAM_RULES: z.infer<typeof STREAM_RULE_SCHEMA>[] = [
	{ pattern: "I notice (you|the model) (are|is) repeating", remediation: "Continue with your previous response. Do not repeat yourself.", enabled: true },
	{ pattern: "^(?!.*[\'\"])(As an AI|I was not programmed|I cannot (assist|help|do|provide|complete) (with|this|that|the))", remediation: "You are Tehuti, a coding assistant. Respond directly without disclaimers.", enabled: true },
];
export const PERFORMANCE_CONFIG_SCHEMA = z.object({
	maxParallelTools: z
		.number()
		.int()
		.min(1)
		.max(20)
		.default(5)
		.describe("Max parallel tool executions"),
	prefetchQueueSize: z
		.number()
		.int()
		.min(1)
		.max(50)
		.default(10)
		.describe("Max prefetch queue size"),
	prefetchTimeoutMs: z
		.number()
		.int()
		.min(1000)
		.max(30000)
		.default(5000)
		.describe("Prefetch timeout in ms"),
	contextCompressionThreshold: z
		.number()
		.min(0.5)
		.max(0.95)
		.default(0.85)
		.describe("Context compression trigger threshold"),
	contextCompressionTarget: z
		.number()
		.min(0.5)
		.max(0.95)
		.default(0.80)
		.describe("Context compression target threshold"),
	autoSaveIntervalMs: z
		.number()
		.int()
		.min(30000)
		.max(3600000)
		.default(300000)
		.describe("Session auto-save interval in ms"),
	searchCacheTTL: z
		.number()
		.int()
		.min(10000)
		.max(600000)
		.default(60000)
		.describe("Memory search cache TTL in ms"),
	searchCacheMaxSize: z
		.number()
		.int()
		.min(100)
		.max(5000)
		.default(500)
		.describe("Memory search cache max entries"),
}).default({}).describe("Performance tuning options");


export const TEHUTI_CONFIG_SCHEMA = z.object({
	$schema: z
		.string()
		.url({ message: "$schema must be a valid URL" })
		.optional()
		.describe("JSON Schema URL"),
	model: z
		.string()
		.min(1, { message: "Model name cannot be empty" })
		.default("deepseek-v4-flash")
		.describe("Primary LLM model ID"),
	fallbackModel: z
		.string()
		.min(1, { message: "Fallback model name cannot be empty" })
		.default("deepseek-v4-flash")
		.describe("Fallback model ID if primary fails"),
	apiKey: z
		.string()
		.min(1, { message: "API key cannot be empty string" })
		.optional()
		.describe("API Key for the primary provider"),
	baseUrl: z
		.string()
		.url({ message: "baseUrl must be a valid URL" })
		.optional()
		.describe("Override base URL for the primary provider"),
	provider: PROVIDER_SCHEMA,
	customProvider: CUSTOM_PROVIDER_SCHEMA.optional().describe(
		"Configuration for an unsupported provider",
	),
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
		.default({})
		.describe("OAuth tokens"),
	// Fallback maxTokens; overridden by live model data when available
	maxTokens: z
		.number()
		.int()
		.positive({ message: "maxTokens must be positive" })
		.default(32000)
		.describe("Maximum tokens for model output"),
	maxIterations: z
		.number()
		.int()
		.positive({ message: "maxIterations must be positive" })
		.default(150)
		.describe("Maximum tool-use iterations per request"),
	temperature: z
		.number()
		.min(0, { message: "temperature must be >= 0" })
		.max(2, { message: "temperature must be <= 2" })
		.default(0.7)
		.describe("LLM sampling temperature (0.0 - 2.0)"),
	extendedThinking: z
		.boolean()
		.default(false)
		.describe("Enable extended reasoning mode if supported"),
	thinkingBudgetTokens: z
		.number()
		.int()
		.min(1024, { message: "thinkingBudgetTokens must be at least 1024" })
		.max(100000, { message: "thinkingBudgetTokens cannot exceed 100000" })
		.optional()
		.describe("Token budget for extended reasoning"),
	requestTimeout: z
		.number()
		.int()
		.min(5000, { message: "requestTimeout must be >= 5000ms" })
		.max(600000, { message: "requestTimeout must be <= 600000ms" })
		.default(120000)
		.describe("Timeout for LLM API requests in ms"),
	maxRetries: z
		.number()
		.int()
		.min(0, { message: "maxRetries cannot be negative" })
		.max(10, { message: "maxRetries cannot exceed 10" })
		.default(3)
		.describe("Max retries for failed API calls"),
	modelSelection: MODEL_SELECTION_SCHEMA.default("auto"),
	modelTiers: z
		.object({
			fast: z
				.string()
				.min(1, { message: "Fast tier model name cannot be empty" })
				.optional()
				.describe("Model ID for fast tier"),
			balanced: z
				.string()
				.min(1, { message: "Balanced tier model name cannot be empty" })
				.optional()
				.describe("Model ID for balanced tier"),
			deep: z
				.string()
				.min(1, { message: "Deep tier model name cannot be empty" })
				.optional()
				.describe("Model ID for deep reasoning tier"),
		})
		.optional()
		.describe("Custom mapping of model IDs to capability tiers"),
	permissions: PERMISSIONS_CONFIG_SCHEMA.default({}),
	mcp: z
		.object({
			enabled: z
				.boolean()
				.default(true)
				.describe("Enable Model Context Protocol"),
			servers: z
				.record(MCP_SERVER_CONFIG_SCHEMA)
				.optional()
				.default({})
				.describe("Configured MCP servers"),
		})
		.optional()
		.default({ enabled: true, servers: {} }),
	branding: BRANDING_CONFIG_SCHEMA.optional(),
	debug: z.boolean().default(false).describe("Enable verbose debug logging"),
	telemetry: z
		.boolean()
		.default(false)
		.describe("Enable anonymous usage telemetry"),
	hooks: HOOKS_CONFIG_SCHEMA.optional().default({}),
	// Advanced features
	kilocode: KILOCODE_ADVANCED_SCHEMA.optional().default({}),
	grepai: GREPAI_ADVANCED_SCHEMA.optional().default({}),
	collaboration: COLLABORATION_SCHEMA.optional().default({}),
	http: HTTP_CONFIG_SCHEMA.optional().default({}),
	daemon: DAEMON_CONFIG_SCHEMA.optional().default({}),
	messaging: MESSAGING_CONFIG_SCHEMA.optional().default({}),
	selfHealing: SELF_HEALING_CONFIG_SCHEMA.optional().default({}),
	personality: PERSONALITY_CONFIG_SCHEMA.optional().default({}),
	memory: MEMORY_CONFIG_SCHEMA.optional().default({}),
	advisorModel: ADVISOR_MODEL_SCHEMA,
	modelCapabilities: z
		.object({
			contextLength: z
				.number()
				.int()
				.positive({ message: "contextLength must be positive" })
				.optional()
				.describe("Maximum context window size"),
			maxOutputTokens: z
				.number()
				.int()
				.positive({ message: "maxOutputTokens must be positive" })
				.optional()
				.describe("Maximum output tokens limit"),
			supportsVision: z
				.boolean()
				.optional()
				.describe("Whether the model supports image inputs"),
			supportsTools: z
				.boolean()
				.optional()
				.describe("Whether the model supports tool calling"),
		})
		.optional()
		.describe("Overrides for model capabilities"),
	pathModels: z
		.array(
			z.object({
				pattern: z
					.string()
					.describe(
						"Glob pattern for file paths (e.g., 'src/**/*.ts')",
					),
				model: z
					.string()
					.describe(
						"Model ID to use for files matching this pattern",
					),
				provider: z
					.string()
					.optional()
					.describe(
						"Provider to use for this path pattern",
					),
			}),
		)
		.default([])
		.describe(
			"Path-scoped model routing rules for matching file paths to models",
		),
	gitInfoCache: z
		.object({
			refreshInterval: z
				.number()
				.int()
				.positive()
				.default(30000)
				.describe("Git info refresh interval in milliseconds"),
		})
		.optional()
		.default({ refreshInterval: 30000 })
		.describe("Git info caching configuration (prevents blocking execSync on every render)"),
	streamRules: z.array(STREAM_RULE_SCHEMA).default([]).describe("Stream monitoring rules"),
	performance: PERFORMANCE_CONFIG_SCHEMA,
});

export type TehutiConfig = z.infer<typeof TEHUTI_CONFIG_SCHEMA>;
export type PermissionsConfig = z.infer<typeof PERMISSIONS_CONFIG_SCHEMA>;
export type MCPServerConfig = z.infer<typeof MCP_SERVER_CONFIG_SCHEMA>;
export type MCPTransportType = z.infer<typeof MCPTransportTypeSchema>;
export type BrandingConfig = z.infer<typeof BRANDING_CONFIG_SCHEMA>;
export type ModelSelectionMode = z.infer<typeof MODEL_SELECTION_SCHEMA>;
export type HttpConfig = z.infer<typeof HTTP_CONFIG_SCHEMA>;
export type MemoryConfig = z.infer<typeof MEMORY_CONFIG_SCHEMA>;

export const DEFAULT_CONFIG: TehutiConfig = {
	model: "deepseek-v4-flash",
	fallbackModel: "deepseek-v4-flash",
	apiKey: undefined,
	baseUrl: undefined,
	provider: "opencode",
	maxTokens: 32000,
	maxIterations: 150,
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
	branding: {
		name: "Tehuti",
		tagline: "Scribe of Code Transformations",
		symbol: "𓆣",
		glyphMode: "unicode",
	},
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
			maxContextLength: 1000000,
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
		restartPolicy: "on-failure",
		logLevel: "info",
	},
	messaging: {
		enabled: true,
		historySize: 100,
	},
	selfHealing: {
		enabled: true,
		maxRetries: 3,
		command: "npm test",
	},
	personality: {
		style: "helpful",
		verbosity: "medium",
		learningEnabled: true,
		autoEnable: false,
		styleInjection: true,
		analysisFrequency: 1,
	},
	memory: {
		consolidationIntervalMs: 15 * 60 * 1000,
	},
	advisorModel: {
		enabled: false,
		instructions:
			"Review the primary agent's output for correctness and safety",
		maxReviewsPerMinute: 3,
		costLimit: 0.50,
	},
	modelCapabilities: {
		contextLength: 1000000,
		maxOutputTokens: 32000,
		supportsVision: true,
		supportsTools: true,
	},
	pathModels: [],
	gitInfoCache: { refreshInterval: 30000 },
	streamRules: DEFAULT_STREAM_RULES,
	performance: {
		maxParallelTools: 5,
		prefetchQueueSize: 10,
		prefetchTimeoutMs: 5000,
		contextCompressionThreshold: 0.85,
		contextCompressionTarget: 0.80,
		autoSaveIntervalMs: 300000,
		searchCacheTTL: 60000,
		searchCacheMaxSize: 500,
	},
};
