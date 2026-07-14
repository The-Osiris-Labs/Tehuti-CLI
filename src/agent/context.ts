import { randomUUID } from "node:crypto";
import path from "node:path";
import fs from "fs-extra";
import type {
	ContentBlock,
	StandardMessage,
	StandardToolCall,
} from "../api/base-client.js";
import type { TehutiConfig } from "../config/schema.js";
import { debug } from "../utils/debug.js";
import {
	compressContext,
	estimateTokens as tiktokenEstimateTokens,
} from "./context-compressor.js";
import { InjectionQueue } from "./events.js";
import { getSystemPromptMemory } from "./memory/graph.js";
import { initMemory } from "./memory/index.js";
import { getPersonalityPromptBlock } from "./memory/personality.js";
import type { AgentContext, DiffPreviewOptions } from "./types.js";
export { buildSystemPrompt } from "./system-prompt.js";

const PROJECT_INSTRUCTION_FILES = [
	"CLAUDE.md",
	"TEHUTI.md",
	".claude.md",
	".tehuti.md",
	"AGENTS.md",
];
const COMPACT_THRESHOLD = 0.85;
// Keep a meaningful recent window in model context. The append-only archive
// retains everything else, so this is a UX/relevance tradeoff, not data loss.
const MIN_MESSAGES_TO_KEEP = 20;

/**
 * Removes reasoning/thinking tokens from model output.
 * 
 * Strips XML-style thinking tags (<think>, <thinking>, <reasoning>) and their
 * content from the response. Used to clean up model output before displaying
 * to users or persisting to session history.
 * 
 * @param content - Raw model output potentially containing thinking tags
 * @returns Cleaned content with all thinking/reasoning blocks removed
 * 
 * @example
 * ```typescript
 * const raw = "<think>Let me analyze this...</think>Here's the solution";
 * const clean = stripReasoningTokens(raw);
 * // clean = "Here's the solution"
 * ```
 */
export function stripReasoningTokens(content: string): string {
	return content.replace(
		/<(think|thinking|reasoning)>[\s\S]*?(?:<\/\1>|$)/g,
		"",
	);
}

/**
 * Estimates token count for a message array using tiktoken.
 * 
 * Uses OpenAI's tiktoken library to estimate the number of tokens in the
 * message array. This is used for context window management and compression
 * decisions. The estimation is approximate but highly accurate for most models.
 * 
 * @param messages - Array of messages to estimate tokens for
 * @returns Estimated token count (number of tokens)
 * 
 * @example
 * ```typescript
 * const tokens = estimateTokens(ctx.messages);
 * if (tokens > 100000) {
 *   console.warn('Context is getting large');
 * }
 * ```
 */
export function estimateTokens(messages: StandardMessage[]): number {
	return tiktokenEstimateTokens(messages);
}

/**
 * Compacts the agent context by removing old messages and creating a digest.
 * 
 * When context grows large (>85% of max), this function compresses it by:
 * 1. Keeping the first message (system prompt) and last 20 messages
 * 2. Extracting a structured digest from removed messages (actions, decisions, recoveries)
 * 3. Persisting the digest to compactionHistory for future reference
 * 4. Moving full transcript to archive.json (append-only log)
 * 
 * This is deterministic compression (no LLM calls), making it fast and cost-free.
 * The digest captures key information without losing context entirely.
 * 
 * @param ctx - Agent context containing messages to compact
 * @param targetTokens - Optional target token count (default: 85% of maxContext)
 * @param maxContext - Optional maximum context length (default: from config or 128000)
 * @returns true if compaction occurred, false if context was already small enough
 * 
 * @example
 * ```typescript
 * // Manual compaction
 * const compacted = compactContext(ctx, 50000);
 * if (compacted) {
 *   console.log('Context compacted, digest created');
 * }
 * 
 * // Auto-compact at 90% capacity
 * if (estimateTokens(ctx.messages) > maxContext * 0.9) {
 *   compactContext(ctx);
 * }
 * ```
 */
export function compactContext(
	ctx: AgentContext,
	targetTokens?: number,
	maxContext?: number,
): boolean {
	const effectiveMaxContext =
		maxContext ??
		ctx.modelContextLength ??
		ctx.config.kilocode?.contextManagement?.maxContextLength ??
		1000000;
	const target =
		targetTokens ?? Math.floor(effectiveMaxContext * COMPACT_THRESHOLD);
	const currentTokens = estimateTokens(ctx.messages);

	if (currentTokens <= target) {
		return false;
	}

	debug.log(
		"context",
		`Compacting context: ${currentTokens} tokens -> ${target}`,
	);
	debug.log(
		"context",
		`Context compaction triggered (${currentTokens} tokens)`,
	);

	const result = compressContext(ctx.messages, {
		keepFirstN: 1,
		keepLastN: MIN_MESSAGES_TO_KEEP,
	});

	if (result.removedCount === 0) {
		return false;
	}

	ctx.messages = result.messages;

	// appendOnlyLog is the audit/archive transcript. Model context reduction
	// and human-visible history are separate concerns, so it must remain intact.
	if (result.digest) {
		ctx.compactionHistory ??= [];
		ctx.compactionHistory.push(result.digest);
	}

	debug.log(
		"context",
		`Context compacted: ${currentTokens} -> ${result.newTokens} tokens (Saved ${result.savedTokens} tokens)`,
	);

	return true;
}

/**
 * Checks context usage and warns/compacts if near limit.
 * 
 * Monitors context size relative to model's maximum context length:
 * - >90% capacity: Logs warning and triggers automatic compaction
 * - >80% capacity: Logs warning (no action)
 * - ≤80% capacity: No action
 * 
 * This is called periodically during the agent loop to prevent context overflow.
 * 
 * @param ctx - Agent context to check
 * @returns true if context is >90% capacity (compaction triggered), false otherwise
 * 
 * @example
 * ```typescript
 * // Check before sending to model
 * if (warnOnContextLimit(ctx)) {
 *   console.warn('Context auto-compacted, consider /compact for manual control');
 * }
 * ```
 */
export function warnOnContextLimit(ctx: AgentContext): boolean {
	const maxContext =
		ctx.modelContextLength ??
		ctx.config.kilocode?.contextManagement?.maxContextLength ??
		1000000;
	const tokens = estimateTokens(ctx.messages);
	const ratio = tokens / maxContext;

	if (ratio > 0.9) {
		debug.log(
			"context",
			`Context at ${Math.round(ratio * 100)}% capacity (${tokens} tokens)`,
		);
		compactContext(ctx);
		return true;
	}

	if (ratio > 0.8) {
		debug.log("context", `Context at ${Math.round(ratio * 100)}% capacity`);
	}

	return false;
}

/**
 * Normalizes tool call history by removing orphaned tool calls.
 * 
 * Ensures message history is valid for the API by:
 * 1. Removing assistant messages with tool_calls that have no corresponding tool responses
 * 2. Removing tool messages that reference non-existent tool_call_ids
 * 3. Preserving valid tool call/response pairs
 * 
 * This is critical for API compatibility - most providers reject requests with
 * unmatched tool calls/responses.
 * 
 * @param messages - Raw message history potentially containing orphaned tool calls
 * @returns Normalized message history with all tool calls properly matched
 * 
 * @example
 * ```typescript
 * // After loading session from disk
 * const normalized = normalizeToolMessageHistory(session.messages);
 * ctx.messages = normalized;
 * 
 * // Before sending to API
 * const clean = normalizeToolMessageHistory(ctx.messages);
 * await client.streamChat(clean, tools);
 * ```
 */
export function normalizeToolMessageHistory(
	messages: StandardMessage[],
): StandardMessage[] {
	const unresolvedToolCallIds = new Set<string>();
	const normalized: StandardMessage[] = [];

	for (const message of messages) {
		if (message.role === "assistant" && message.tool_calls?.length) {
			const validToolCalls = message.tool_calls.filter(
				(toolCall) =>
					toolCall.id &&
					toolCall.type === "function" &&
					toolCall.function?.name,
			);

			if (validToolCalls.length === 0) {
				normalized.push({ ...message, tool_calls: undefined });
				continue;
			}

			for (const toolCall of validToolCalls) {
				unresolvedToolCallIds.add(toolCall.id);
			}
			normalized.push({ ...message, tool_calls: validToolCalls });
			continue;
		}

		if (message.role === "tool") {
			if (
				message.tool_call_id &&
				unresolvedToolCallIds.has(message.tool_call_id)
			) {
				unresolvedToolCallIds.delete(message.tool_call_id);
				normalized.push(message);
			}
			continue;
		}

		normalized.push(message);
	}

	if (unresolvedToolCallIds.size === 0) {
		return normalized;
	}

	return normalized
		.map((message) => {
			if (message.role !== "assistant" || !message.tool_calls?.length) {
				return message;
			}

			const resolvedToolCalls = message.tool_calls.filter(
				(toolCall) => !unresolvedToolCallIds.has(toolCall.id),
			);

			if (resolvedToolCalls.length === message.tool_calls.length) {
				return message;
			}

			return {
				...message,
				tool_calls:
					resolvedToolCalls.length > 0 ? resolvedToolCalls : undefined,
			};
		})
		.filter((message) => {
			if (message.role !== "assistant") return true;
			const hasText =
				typeof message.content === "string"
					? message.content.length > 0
					: message.content.length > 0;
			return hasText || Boolean(message.tool_calls?.length);
		});
}

/** Re-exported from shared types for backward compatibility. */
export type { AgentContext } from "./types.js";

async function loadProjectInstructions(
	cwd: string,
): Promise<string | undefined> {
	for (const file of PROJECT_INSTRUCTION_FILES) {
		const filePath = path.join(cwd, file);
		try {
			if (await fs.pathExists(filePath)) {
				const content = await fs.readFile(filePath, "utf-8");
				debug.log("context", `Loaded project instructions from ${file}`);
				return content;
			}
		} catch {
			debug.log("context", `Failed to load project instructions from ${file}`);
		}
	}
	return undefined;
}

/**
 * Creates a new agent context for running the agent loop.
 * 
 * Initializes all asynchronous context loading:
 * 1. Resolves CWD from sessionId (if resuming) or uses provided cwd
 * 2. Loads project instructions from CLAUDE.md/TEHUTI.md/AGENTS.md
 * 3. Initializes memory system (background, non-blocking)
 * 4. Loads personality/preferences (background, non-blocking)
 * 5. Preloads recent files from database
 * 
 * The context is fully usable immediately (async loads happen in background),
 * but system prompt will be incomplete until async loads complete.
 * 
 * @param cwd - Current working directory (used if no sessionId)
 * @param config - Tehuti configuration object
 * @param diffPreview - Optional diff preview settings
 * @param companionMode - Whether running in companion mode (daemon-connected)
 * @param sessionId - Optional session ID for resume/continuity
 * @returns Fully initialized agent context
 * 
 * @example
 * ```typescript
 * // New session
 * const ctx = await createAgentContext(process.cwd(), config);
 * 
 * // Resume existing session
 * const ctx = await createAgentContext(
 *   process.cwd(),
 *   config,
 *   undefined,
 *   false,
 *   'session-abc123'
 * );
 * 
 * // Companion mode (connected to daemon)
 * const ctx = await createAgentContext(
 *   process.cwd(),
 *   config,
 *   undefined,
 *   true
 * );
 * ```
 */
export async function createAgentContext(
	cwd: string,
	config: TehutiConfig,
	diffPreview?: DiffPreviewOptions,
	companionMode?: boolean,
	sessionId?: string,
): Promise<AgentContext> {
	let resolvedCwd = path.resolve(cwd);
	let recentFiles: string[] = [];

	if (sessionId) {
		try {
			const { getUserPreference, setUserPreference } = await import(
				"./memory/personality.js"
			);

			// 1. Preload CWD
			const dbCwd = await getUserPreference(`cwd_${sessionId}`);
			if (dbCwd) {
				resolvedCwd = path.resolve(dbCwd);
			} else {
				setUserPreference(`cwd_${sessionId}`, resolvedCwd);
			}

			// 2. Preload Recent File Cache
			const dbRecentFiles = await getUserPreference(
				`recent_files_${sessionId}`,
			);
			if (dbRecentFiles) {
				try {
					recentFiles = JSON.parse(dbRecentFiles);
				} catch {
					debug.log("context", "Failed to parse recent files from DB");
				}
			}
		} catch (e) {
			debug.log(
				"context",
				`Failed to preload DB context for session ${sessionId}: ${e}`,
			);
		}
	}

	const projectInstructions = await loadProjectInstructions(resolvedCwd);
	const systemMemoryPromise = getSystemPromptMemory(resolvedCwd);

	// 3. Preload Personality Styles instantly (move initMemory to background)
	const personalityBlockPromise =
		config.personality?.styleInjection !== false
			? (async () => {
					initMemory(config.memory?.consolidationIntervalMs).catch(() => {
				debug.log("context", "Failed to initialize memory");
			});
					return getPersonalityPromptBlock(resolvedCwd);
				})()
			: Promise.resolve("");

	return {
		cwd: resolvedCwd,
		workingDir: resolvedCwd,
		messages: [],
		appendOnlyLog: [],
		compactionHistory: [],
		config,
		projectInstructions,
		systemMemoryPromise,
		personalityBlockPromise,
		diffPreview,
		companionMode,
		sessionId,
		readFilesThisSession: new Set(recentFiles),
		injectionQueue: new InjectionQueue(),
		metadata: {
			startTime: new Date(),
			sessionCost: 0,
			toolCalls: 0,
			tokensUsed: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			filesRead: [],
			filesWritten: [],
			commandsRun: [],
		},
	};
}
function getTimestampPrefix(): string {
	const now = new Date();
	const hh = String(now.getHours()).padStart(2, "0");
	const mm = String(now.getMinutes()).padStart(2, "0");
	const ss = String(now.getSeconds()).padStart(2, "0");
	return `[Timestamp: ${hh}:${mm}:${ss}]\n`;
}

export function addUserMessage(ctx: AgentContext, content: string): void {
	if (!content || content.trim().length === 0) {
		debug.log("context", "Skipping empty user message");
		return;
	}
	const timePrefix = getTimestampPrefix();
	const finalContent = `${timePrefix}${content}`;
	const msg: StandardMessage = {
		role: "user",
		content: finalContent,
		timestamp: Date.now(),
		internalId: randomUUID(),
	};
	ctx.messages.push(msg);
	ctx.appendOnlyLog.push(msg);
	debug.log("context", `Added user message (${content.length} chars)`);
}

export function addAssistantMessage(ctx: AgentContext, content: string): void {
	const timePrefix = getTimestampPrefix();
	const stripped = stripReasoningTokens(content);
	const finalContent = stripped
		? `${timePrefix}${stripped}`
		: timePrefix.trim();
	const msg: StandardMessage = {
		role: "assistant",
		content: finalContent,
		timestamp: Date.now(),
		internalId: randomUUID(),
	};
	ctx.messages.push(msg);
	ctx.appendOnlyLog.push(msg);
	debug.log("context", `Added assistant message (${msg.content.length} chars)`);
}

export function addAssistantMessageWithTools(
	ctx: AgentContext,
	content: string,
	toolCalls?: StandardToolCall[],
): void {
	const timePrefix = getTimestampPrefix();
	const stripped = stripReasoningTokens(content);
	const finalContent = stripped
		? `${timePrefix}${stripped}`
		: timePrefix.trim();
	const message: StandardMessage = {
		role: "assistant",
		content: finalContent,
		timestamp: Date.now(),
		internalId: randomUUID(),
	};

	if (toolCalls && toolCalls.length > 0) {
		message.tool_calls = toolCalls;
	}

	ctx.messages.push(message);
	ctx.appendOnlyLog.push(message);
	debug.log(
		"context",
		`Added assistant message (${content.length} chars, ${toolCalls?.length ?? 0} tool calls)`,
	);
}

export function addToolResult(
	ctx: AgentContext,
	toolCallId: string,
	toolName: string,
	result: string | ContentBlock[],
): void {
	const msg: StandardMessage = {
		role: "tool",
		tool_call_id: toolCallId,
		name: toolName,
		content: result,
		timestamp: Date.now(),
		internalId: randomUUID(),
	};
	ctx.messages.push(msg);
	ctx.appendOnlyLog.push(msg);
	debug.log("context", `Added tool result for ${toolName}`);
}

export function getToolContext(ctx: AgentContext, signal?: AbortSignal) {
	return {
		cwd: ctx.cwd,
		workingDir: ctx.workingDir,
		env: process.env as Record<string, string>,
		timeout: 120000,
		diffPreview: ctx.diffPreview,
		readFilesThisSession: ctx.readFilesThisSession,
		signal,
		agentContext: ctx,
	};
}

export function updateMetadata(
	ctx: AgentContext,
	updates: Partial<AgentContext["metadata"]>,
): void {
	ctx.metadata = { ...ctx.metadata, ...updates };
}

export function trackToolCall(ctx: AgentContext, toolName: string): void {
	ctx.metadata.toolCalls++;
	debug.log("context", `Tool call #${ctx.metadata.toolCalls}: ${toolName}`);
}

function trackFileOperation(
	ctx: AgentContext,
	filePath: string,
	operation: "read" | "write",
): void {
	const files = operation === "read" ? ctx.metadata.filesRead : ctx.metadata.filesWritten;
	if (files.includes(filePath)) {
		return;
	}
	files.push(filePath);
	ctx.readFilesThisSession.add(filePath);

	if (ctx.sessionId) {
		import("./memory/personality.js")
			.then(({ setUserPreference }) => {
				setUserPreference(
					`recent_files_${ctx.sessionId}`,
					JSON.stringify(Array.from(ctx.readFilesThisSession)),
				);
			})
			.catch(() => {});
	}
}

export function trackFileRead(ctx: AgentContext, filePath: string): void {
	trackFileOperation(ctx, filePath, "read");
}

export function trackFileWritten(ctx: AgentContext, filePath: string): void {
	trackFileOperation(ctx, filePath, "write");
}

export function trackCommand(ctx: AgentContext, command: string): void {
	ctx.metadata.commandsRun.push(command);
}

export function getContextSummary(ctx: AgentContext): string {
	const elapsed = Date.now() - ctx.metadata.startTime.getTime();
	const seconds = Math.round(elapsed / 1000);
	const cacheSavings =
		ctx.metadata.cacheReadTokens > 0
			? `\n- Cache savings: ${ctx.metadata.cacheReadTokens} tokens read from cache`
			: "";

	return `
## Session Summary
- Duration: ${seconds}s
- Tool calls: ${ctx.metadata.toolCalls}
- Files read: ${ctx.metadata.filesRead.length}
- Files written: ${ctx.metadata.filesWritten.length}
- Commands run: ${ctx.metadata.commandsRun.length}${cacheSavings}
`;
}

export async function warmupContext(ctx: AgentContext): Promise<void> {
	debug.log("context", "Starting warmup scan...");

	try {
		const gitDir = path.join(ctx.cwd, ".git");
		const hasGit = await fs.pathExists(gitDir);

		if (hasGit) {
			debug.log("context", "Git repository detected");
		}

		const packageJson = path.join(ctx.cwd, "package.json");
		if (await fs.pathExists(packageJson)) {
			const pkg = await fs.readJson(packageJson);
			debug.log("context", `Project: ${pkg.name ?? "unnamed"}`);
		}
	} catch (_error) {
		debug.log("context", "Warmup scan failed (non-critical)");
	}
}
