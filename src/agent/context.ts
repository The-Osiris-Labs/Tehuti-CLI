import { randomUUID } from "node:crypto";
import path from "node:path";
import fs from "fs-extra";
import type {
	ContentBlock,
	StandardMessage,
	StandardToolCall,
} from "../api/base-client.js";
import type { TehutiConfig } from "../config/schema.js";
import { TehutiDaemonClient } from "../daemon/client.js";
import { getCapabilities } from "../terminal/capabilities.js";
import { debug } from "../utils/debug.js";
import {
	type CompactionDigest,
	compressContext,
	estimateTokens as tiktokenEstimateTokens,
} from "./context-compressor.js";
import { InjectionQueue } from "./events.js";
import { getSystemPromptMemory } from "./memory/graph.js";
import { initMemory } from "./memory/index.js";
import { getPersonalityPromptBlock } from "./memory/personality.js";
import { getSkillsManager } from "./skills/manager.js";
import type { DiffPreviewOptions } from "./tools/registry.js";

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

export function stripReasoningTokens(content: string): string {
	return content.replace(
		/<(think|thinking|reasoning)>[\s\S]*?(?:<\/\1>|$)/g,
		"",
	);
}

export function estimateTokens(messages: StandardMessage[]): number {
	return tiktokenEstimateTokens(messages);
}

export function compactContext(
	ctx: AgentContext,
	targetTokens?: number,
	maxContext?: number,
): boolean {
	const effectiveMaxContext =
		maxContext ??
		ctx.modelContextLength ??
		ctx.config.kilocode?.contextManagement?.maxContextLength ??
		128000;
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

export function warnOnContextLimit(ctx: AgentContext): boolean {
	const maxContext =
		ctx.modelContextLength ??
		ctx.config.kilocode?.contextManagement?.maxContextLength ??
		128000;
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

export interface AgentContext {
	cwd: string;
	workingDir: string;
	messages: StandardMessage[];
	appendOnlyLog: StandardMessage[];
	/** Deterministic summaries of ranges removed from the model-facing context. */
	compactionHistory: CompactionDigest[];
	config: TehutiConfig;
	projectInstructions?: string;
	systemMemoryPromise?: Promise<string>;
	diffPreview?: DiffPreviewOptions;
	companionMode?: boolean;
	sessionId?: string;
	personalityBlockPromise?: Promise<string>;
	readFilesThisSession: Set<string>;
	isSleeping?: boolean;
	injectionQueue: InjectionQueue;
	/** Live model context length resolved from provider API (overrides config fallback) */
	modelContextLength?: number;
	metadata: {
		startTime: Date;
		sessionCost?: number;
		toolCalls: number;
		tokensUsed: number;
		cacheReadTokens: number;
		cacheWriteTokens: number;
		filesRead: string[];
		filesWritten: string[];
		commandsRun: string[];
	};
}

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
		} catch {}
	}
	return undefined;
}

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
				} catch {}
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
					initMemory(config.memory?.consolidationIntervalMs).catch(() => {});
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

export async function buildSystemPrompt(
	ctx: AgentContext,
	userQuery?: string,
): Promise<string> {
	const projectInstructionsSection = ctx.projectInstructions
		? `\n## Project Instructions\n\n${ctx.projectInstructions}\n`
		: "";

	const systemMemory = ctx.systemMemoryPromise
		? await ctx.systemMemoryPromise
		: "";
	const systemMemorySection = systemMemory ? `${systemMemory}\n` : "";

	const personalitySection = ctx.personalityBlockPromise
		? await ctx.personalityBlockPromise
		: "";
	const personalityBlock = personalitySection
		? `\n## Personality & Preferences\n${personalitySection}\n`
		: "";

	let skillsSection = "";
	if (userQuery) {
		const skillsManager = getSkillsManager();
		const relevantSkills = skillsManager.findRelevantSkills(userQuery);
		if (relevantSkills.length > 0) {
			const expertise = skillsManager.getExpertiseForSkills(relevantSkills);
			skillsSection = `\n## Relevant Expertise${expertise}\n`;
		}
	}

	// ── Temporal context (computed fresh on every buildSystemPrompt call) ──────
	const _now = new Date();
	const _dayNames = [
		"Sunday",
		"Monday",
		"Tuesday",
		"Wednesday",
		"Thursday",
		"Friday",
		"Saturday",
	];
	const _monthNames = [
		"January",
		"February",
		"March",
		"April",
		"May",
		"June",
		"July",
		"August",
		"September",
		"October",
		"November",
		"December",
	];
	const _dayOfWeek = _dayNames[_now.getDay()];
	const _monthName = _monthNames[_now.getMonth()];
	const _day = _now.getDate();
	const _year = _now.getFullYear();
	const _hh = String(_now.getHours()).padStart(2, "0");
	const _mm = String(_now.getMinutes()).padStart(2, "0");
	// getTimezoneOffset() returns minutes *behind* UTC (negative = ahead of UTC)
	const _tzOffsetMin = -_now.getTimezoneOffset();
	const _tzSign = _tzOffsetMin >= 0 ? "+" : "-";
	const _tzHH = String(Math.floor(Math.abs(_tzOffsetMin) / 60)).padStart(
		2,
		"0",
	);
	const _tzMM = String(Math.abs(_tzOffsetMin) % 60).padStart(2, "0");
	const _tzLabel = `UTC${_tzSign}${_tzHH}:${_tzMM}`;
	const _isoTimestamp = _now
		.toISOString()
		.replace("Z", `${_tzSign}${_tzHH}:${_tzMM}`);

	let daemonInfo = "";
	try {
		const client = new TehutiDaemonClient();
		await client.connect();
		const pong: any = await new Promise((resolve, reject) => {
			client.onMessage((msg) => {
				if (msg.type === "pong") resolve(msg);
			});
			client.send({ type: "ping" });
			setTimeout(() => reject(new Error("timeout")), 500);
		});
		client.disconnect();

		const uptimeD = Math.floor(pong.uptime / 86400);
		const uptimeH = Math.floor((pong.uptime % 86400) / 3600);
		const uptimeM = Math.floor((pong.uptime % 3600) / 60);
		const uptimeS = Math.floor(pong.uptime % 60);

		const parts = [];
		if (uptimeD > 0) parts.push(`${uptimeD}d`);
		if (uptimeH > 0) parts.push(`${uptimeH}h`);
		if (uptimeM > 0) parts.push(`${uptimeM}m`);
		parts.push(`${uptimeS}s`);
		const daemonUptimeFormatted = parts.join(" ");

		daemonInfo = `\n## Companion Daemon Status\n- Daemon Uptime: ${daemonUptimeFormatted}\n- Session Start Time: ${pong.session_start_time || "Unknown"}\n`;
	} catch (e) {
		// daemon not running or unresponsive, skip
	}

	return `You are Tehuti, the Scribe of Code Transformations - an AI coding assistant.

## Identity
- You are an expert software engineer with extensive knowledge in many programming languages, frameworks, design patterns, and best practices.
- Your goal is to accomplish the user's task efficiently and effectively.
- You work iteratively, breaking down complex tasks into clear steps.
${projectInstructionsSection}${systemMemorySection}${personalityBlock}${skillsSection}${daemonInfo}
## Operational Rules
- Always explain what you're doing before doing it.
- Use tools safely - never run destructive commands without confirmation.
- Follow the project's coding conventions and best practices.
- Write clean, well-documented code.
- **CRITICAL:** Be extremely concise. Avoid "wordy" explanations, excessive bolding, or walls of text. Get straight to the point.
- When unsure, ask clarifying questions.

## Epistemic Rigor & Scope Discipline
- **Evidence is everything:** Never accept or assert a claim about codebase behavior without concrete evidence from tool inspection. If evidence is missing or insufficient, state so explicitly.
- **Separate observation from interpretation:** First state what actually happened or what the code contains (quotes, line numbers, file paths). Only then offer interpretation.
- **Verify Outdated Limitations:** If you read about a bug, missing feature, or limitation from past session logs, memories, or old documentation, YOU MUST VERIFY its current existence in the codebase before acting or making recommendations. Do not assume historical limitations are still present.
- **Hunt patterns, not just instances:** When identifying a failure mode or bug, check whether it is an isolated case or part of a recurring class across the codebase.
- **Maintain radical scope discipline:** Never use sweeping assertions ("all", "every", "complete", "hardened") without exhaustive verification.
- **Surface assumptions:** If you resolve ambiguity or make a speculative assumption, explicitly label it with \`[UNVERIFIED ASSUMPTION]\`. Treat unverified assumptions as hypotheses to test.

## Sandbox & Security Boundaries
- **Model Discovery:** DO NOT hallucinate model availability based on environment variables. The presence of an API key DOES NOT imply the harness supports those models.
- **Global Tools:** DO NOT attempt to install global tools (e.g. \`cargo\`, \`rustc\`, \`brew\`) without explicit user permission.
- **Artifacts:** DO NOT build or compile large native binaries (e.g. \`.node\` or \`.dylib\`) unless specifically instructed.

## Execution & Truncation Defenses
- **Chunking:** For large file rewrites, DO NOT attempt to return massive blocks of code in a single response, as this causes catastrophic pipeline truncation and JSON parsing failures. Break work down using intermediate commits and smaller edits.
- **Finality:** Never leave uncommitted edits or hanging states at the end of a tool sequence.


## Working Directory
- Current directory: ${ctx.cwd}
- All file paths should be relative to this directory unless absolute paths are provided.

## Environment
- Platform: ${process.platform}
- Node.js: ${process.version}
- Shell: ${process.env.SHELL ?? "unknown"}
- Terminal: ${(() => {
		try {
			const c = getCapabilities();
			const g = c.graphics;
			const graphicsList =
				[
					g.sixel ? "Sixel" : null,
					g.kitty ? "Kitty" : null,
					g.iterm ? "iTerm2" : null,
				]
					.filter(Boolean)
					.join("/") || "none";
			const colorLabel = c.colors.has16m
				? "TrueColor"
				: c.colors.has256
					? "256"
					: c.colors.hasBasic
						? "16"
						: "none";
			return `${c.emulator} (${c.size.columns}x${c.size.rows}, ${colorLabel}, graphics: ${graphicsList})`;
		} catch {
			return "unknown";
		}
	})()}

## Temporal Context
- Current date: ${_dayOfWeek}, ${_monthName} ${_day}, ${_year}
- Current time: ${_hh}:${_mm} (${_tzLabel})
- ISO timestamp: ${_isoTimestamp}

## Epistemic Protocol
- **Observation vs Interpretation**: You must explicitly differentiate between empirical observation (what the tool output literally states) and interpretation (your inference or speculation).
- **No Unverified Assumptions**: Do not state facts about the project state or environment without first verifying them via tools or referring to Long-Term Memory.
- **Confidence Disclosure**: When retrieving information from memory or reasoning about complex state, implicitly state your confidence bounds. Treat speculative plans as hypotheses until verified by a tool.

## Harness & Subagent Capabilities
- **Harness**: You are running inside the Tehuti Agent Harness, a powerful terminal-based environment.
- **Parallel Subagents**: You can spawn specialized subagents (via \`delegate_task\`) to work on tasks in the background as separate forked Node.js processes. Use \`await_subagents\` to block until one or more complete and collect their results. Use \`check_subagent_status\` to poll a single subagent\u2019s status. Use \`list_subagents\` to enumerate all running/finished subagents. Use \`send_message_to_subagent\` to push a message into a running subagent\u2019s context. Use \`abort_subagent\` to cancel one.
- **Tools**: You possess direct terminal access, file system I/O, advanced code parsing, and dynamic MCP (Model Context Protocol) integration for extending your capabilities.
- **Media**: Your terminal harness natively supports projecting images and video previews using Sixel/iTerm graphics protocols.

## Tool Usage Guidelines
- Use the \`read\` tool to understand existing code before making changes.
- Use the \`glob\` and \`grep\` tools to explore the codebase.
- Use the \`bash\` tool for git, npm, docker, and other CLI operations.
- Use the \`write\` tool for new files, \`edit\` tool for modifications.
- Always verify changes by reading the file after writing or editing.

## Output Format
- Use markdown formatting for responses.
- Include code blocks with appropriate language tags.
- Use headings to organize complex responses.

## Important Constraints
- Maximum iterations: ${ctx.config.maxIterations}
- Maximum tokens per response: ${ctx.config.maxTokens}
- Model: ${ctx.config.model}

When you complete a task, summarize what was done and any follow-up actions needed.`;
}

function getTimestampPrefix(): string {
	const now = new Date();
	const hh = String(now.getHours()).padStart(2, "0");
	const mm = String(now.getMinutes()).padStart(2, "0");
	const ss = String(now.getSeconds()).padStart(2, "0");
	return `[Timestamp: ${hh}:${mm}:${ss}]\n`;
}

export function addUserMessage(ctx: AgentContext, content: string): void {
	const timePrefix = getTimestampPrefix();
	const finalContent = content ? `${timePrefix}${content}` : timePrefix.trim();
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

export function trackFileRead(ctx: AgentContext, filePath: string): void {
	if (!ctx.metadata.filesRead.includes(filePath)) {
		ctx.metadata.filesRead.push(filePath);
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
}

export function trackFileWritten(ctx: AgentContext, filePath: string): void {
	if (!ctx.metadata.filesWritten.includes(filePath)) {
		ctx.metadata.filesWritten.push(filePath);
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
