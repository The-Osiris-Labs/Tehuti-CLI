import {
	CustomProviderClient,
	costTracker,
	createStreamingState,
	getToolCallsFromState,
	KiloCodeClient,
	OpenRouterClient,
	processStreamChunk,
} from "../api/index.js";
import { isReasoningModel } from "../api/model-capabilities.js";
import type { OpenRouterTool } from "../api/openrouter.js";
import { supportsOpenAICompatibleRuntime } from "../config/providers.js";
import { hookExecutor, parseHooksConfig } from "../hooks/executor.js";
import { mcpManager } from "../mcp/client.js";
import { createMCPToolDefinition } from "../mcp/tool-adapter.js";
import { checkPermission } from "../permissions/index.js";
import { debug } from "../utils/debug.js";
import { AgentError, APIError, formatError } from "../utils/errors.js";

import { getTelemetry } from "../utils/telemetry.js";
import {
	getToolCache,
	invalidateOnWrite,
	loadCacheFromDisk,
	saveCacheToDisk,
	shouldCacheTool,
} from "./cache/index.js";
import type { AgentContext } from "./context.js";
import {
	addAssistantMessageWithTools,
	addToolResult,
	addUserMessage,
	buildSystemPrompt,
	createAgentContext,
	getToolContext,
	normalizeToolMessageHistory,
	trackToolCall,
	warnOnContextLimit,
} from "./context.js";
import {
	estimateTokens,
} from "./context-compressor.js";
import {
	classifyTask,
	MODEL_TIERS,
	selectModelForClassification,
} from "./model-router.js";
import {
	classifyToolCalls,
	executeToolsParallel,
	getParallelizableCount,
	type ToolCall,
} from "./parallel-executor.js";
import { getPrefetcher } from "./prefetcher.js";
import { skillsTools } from "./skills/tools.js";
import { astTool } from "./tools/ast.js";
import { backgroundTools } from "./tools/background.js";
import { bashTool } from "./tools/bash.js";
import { collaborationTools } from "./tools/collaboration.js";
import { customProviderTools } from "./tools/custom-provider.js";
import { applyDiffTool } from "./tools/apply-diff.js";
import { envTools } from "./tools/env.js";
import { allFsTools } from "./tools/fs.js";
import { gitTools } from "./tools/git.js";
import {
	executeTool,
	getToolDefinitions,
	registerTools,
	unregisterToolsWhere,
} from "./tools/index.js";
import { kiloCodeTools } from "./tools/kilocode.js";
import { kilocodeAdvancedTools } from "./tools/kilocode-advanced.js";
import { mcpPromptTools } from "./tools/mcp-prompts.js";
import { memoryTools } from "./tools/memory.js";
import { networkTools } from "./tools/network.js";
import {
	isPlanMode,
	isToolAllowedInPlanMode,
	planTools,
	setPlanMode,
} from "./tools/plan-mode.js";
import { repoMapTool } from "./tools/repo-map.js";
import { searchTools } from "./tools/search.js";
import { semanticTools } from "./tools/semantic.js";
import { serviceTools } from "./tools/service.js";
import { swarmTools } from "./tools/swarm.js";
import { setParentContext, systemTools } from "./tools/system.js";
import { webTools } from "./tools/web.js";
import { shadowWorkspaceTool } from "./shadow-workspace.js";

registerTools([
	astTool,
	applyDiffTool,
	...allFsTools,
	...searchTools,
	repoMapTool,
	bashTool,
	...webTools,
	...systemTools,
	...envTools,
	...networkTools,
	...serviceTools,
	...mcpPromptTools,
	...memoryTools,
	...backgroundTools,
	...planTools,
	...gitTools,
	...skillsTools,
	...semanticTools,
	...kiloCodeTools,
	...kilocodeAdvancedTools,
	...collaborationTools,
	...customProviderTools,
	...swarmTools,
	shadowWorkspaceTool,
]);

loadCacheFromDisk();

function createProviderClient(
	ctx: AgentContext,
): OpenRouterClient | KiloCodeClient | CustomProviderClient {
	if (
		ctx.config.provider !== "kilocode" &&
		ctx.config.provider !== "custom" &&
		!supportsOpenAICompatibleRuntime(ctx.config.provider)
	) {
		throw new APIError(
			`Provider "${ctx.config.provider}" is not supported by the current OpenAI-compatible runtime. Use an OpenAI-compatible provider/base URL, OpenRouter, OpenCode, KiloCode, or the custom provider adapter instead.`,
		);
	}

	try {
		if (ctx.config.provider === "kilocode") {
			return KiloCodeClient.getInstance(ctx.config);
		}
		if (ctx.config.provider === "custom") {
			return CustomProviderClient.getInstance(ctx.config);
		}
		return OpenRouterClient.getInstance(ctx.config);
	} catch {
		if (ctx.config.provider === "kilocode") {
			return new KiloCodeClient(ctx.config);
		}
		if (ctx.config.provider === "custom") {
			return new CustomProviderClient(ctx.config);
		}
		return new OpenRouterClient(ctx.config);
	}
}

function syncMCPToolRegistry(): void {
	unregisterToolsWhere(
		(tool) =>
			tool.category === "mcp" &&
			tool.name.startsWith("mcp_") &&
			tool.name !== "mcp_get_prompt" &&
			tool.name !== "mcp_list_prompts",
	);

	const dynamicTools = mcpManager
		.getAllTools()
		.map(({ serverName, tool }) =>
			createMCPToolDefinition(serverName, tool, async (args) =>
				mcpManager.executeTool(
					serverName,
					tool.name,
					(args && typeof args === "object" ? args : {}) as Record<
						string,
						unknown
					>,
				),
			),
		);

	if (dynamicTools.length > 0) {
		registerTools(dynamicTools);
		debug.log("mcp", `Registered ${dynamicTools.length} dynamic MCP tools`);
	}
}

export function initializeAgent(): void {
	loadCacheFromDisk();
	// Bootstrap environment memory asynchronously; failure is non-fatal.
	import("./memory/env-bootstrap.js")
		.then(({ bootstrapEnvironmentMemory }) => bootstrapEnvironmentMemory(process.cwd()))
		.then((r) => debug.log("memory", `Env bootstrap wrote ${r.written} facts`))
		.catch((err) => debug.log("memory", `Env bootstrap failed: ${err}`));
}

export function shutdownAgent(): void {
	saveCacheToDisk();
}

export function configureHooks(hooksConfig: unknown): void {
	let targetConfig = hooksConfig;
	if (hooksConfig && typeof hooksConfig === "object" && "hooks" in hooksConfig) {
		targetConfig = (hooksConfig as any).hooks;
	}
	const hooks = parseHooksConfig(targetConfig);
	hookExecutor.loadConfig(hooks);
}

export { setPlanMode, isPlanMode, isToolAllowedInPlanMode };

export interface AgentLoopOptions {
	onToken?: (token: string) => void;
	onToolCall?: (name: string, args: unknown) => void;
	onToolResult?: (name: string, result: unknown) => void;
	onThinking?: (content: string) => void;
	onProgress?: (progress: number, label: string) => void;
	signal?: AbortSignal;
}

export interface AgentLoopResult {
	content: string;
	toolCalls: number;
	success: boolean;
	finishReason: string | null;
	thinking?: string;
	usage?: {
		promptTokens: number;
		completionTokens: number;
		totalTokens: number;
		cacheReadTokens?: number;
		cacheWriteTokens?: number;
	};
	sessionStats?: {
		totalPromptTokens: number;
		totalCompletionTokens: number;
		totalCacheReadTokens: number;
		totalCacheWriteTokens: number;
		totalCost: number;
		requestCount: number;
	};
}

import { runAgentLoop as _runAgentLoop } from "./loop/index.js";

export async function runAgentLoop(
	ctx: AgentContext,
	userMessage: string,
	options: AgentLoopOptions = {},
): Promise<AgentLoopResult> {
	const client = createProviderClient(ctx);
	return await _runAgentLoop(
		ctx,
		userMessage,
		client,
		syncMCPToolRegistry,
		options,
	);
}

export async function runOneShot(
	ctx: AgentContext,
	prompt: string,
	options: AgentLoopOptions = {},
): Promise<string> {
	const result = await runAgentLoop(ctx, prompt, options);
	return result.content;
}

export { createAgentContext };
export type { AgentContext };
