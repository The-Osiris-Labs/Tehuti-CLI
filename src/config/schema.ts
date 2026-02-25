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
	url: z.string().optional(),
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

export const TEHUTI_CONFIG_SCHEMA = z.object({
	$schema: z.string().optional(),
	model: z.string().default("z-ai/glm-4.5-air:free"),
	fallbackModel: z.string().default("z-ai/glm-4.5-air:free"),
	apiKey: z.string().optional(),
	baseUrl: z.string().default("https://openrouter.ai/api/v1"),
	maxTokens: z.number().int().positive().default(32000),
	maxIterations: z.number().int().positive().default(50),
	temperature: z.number().min(0).max(2).default(0.7),
	extendedThinking: z.boolean().default(false),
	thinkingBudgetTokens: z.number().int().min(1024).max(100000).optional(),
	requestTimeout: z.number().int().min(5000).max(600000).default(120000),
	maxRetries: z.number().int().min(0).max(10).default(3),
	modelSelection: MODEL_SELECTION_SCHEMA.default("auto"),
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
});

export type TehutiConfig = z.infer<typeof TEHUTI_CONFIG_SCHEMA>;
export type PermissionsConfig = z.infer<typeof PERMISSIONS_CONFIG_SCHEMA>;
export type MCPServerConfig = z.infer<typeof MCP_SERVER_CONFIG_SCHEMA>;
export type MCPTransportType = z.infer<typeof MCPTransportTypeSchema>;
export type BrandingConfig = z.infer<typeof BRANDING_CONFIG_SCHEMA>;
export type ModelSelectionMode = z.infer<typeof MODEL_SELECTION_SCHEMA>;

export const DEFAULT_CONFIG: TehutiConfig = {
	model: "z-ai/glm-4.5-air:free",
	fallbackModel: "z-ai/glm-4.5-air:free",
	baseUrl: "https://openrouter.ai/api/v1",
	maxTokens: 32000,
	maxIterations: 50,
	temperature: 0.7,
	extendedThinking: false,
	requestTimeout: 120000,
	maxRetries: 3,
	modelSelection: "auto",
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
	debug: false,
	telemetry: false,
};
