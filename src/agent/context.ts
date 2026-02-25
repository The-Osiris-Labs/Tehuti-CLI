import path from "node:path";
import fs from "fs-extra";
import type {
	OpenRouterMessage,
	OpenRouterToolCall,
} from "../api/openrouter.js";
import type { TehutiConfig } from "../config/schema.js";
import { debug } from "../utils/debug.js";
import { consola } from "../utils/logger.js";
import type { DiffPreviewOptions } from "./tools/registry.js";

const PROJECT_INSTRUCTION_FILES = [
	"CLAUDE.md",
	"TEHUTI.md",
	".claude.md",
	".tehuti.md",
	"AGENTS.md",
];
const MAX_CONTEXT_TOKENS = 100000;
const COMPACT_THRESHOLD = 0.85;
const MIN_MESSAGES_TO_KEEP = 6;

export function estimateTokens(messages: OpenRouterMessage[]): number {
	return messages.reduce((sum, msg) => {
		let content = "";
		if (typeof msg.content === "string") {
			content = msg.content;
		} else if (Array.isArray(msg.content)) {
			content = msg.content
				.map((c) => (typeof c === "string" ? c : JSON.stringify(c)))
				.join("");
		}
		if (msg.tool_calls) {
			content += JSON.stringify(msg.tool_calls);
		}
		return sum + Math.ceil(content.length / 4);
	}, 0);
}

export function compactContext(
	ctx: AgentContext,
	targetTokens?: number,
): boolean {
	const target =
		targetTokens ?? Math.floor(MAX_CONTEXT_TOKENS * COMPACT_THRESHOLD);
	const currentTokens = estimateTokens(ctx.messages);

	if (currentTokens <= target) {
		return false;
	}

	debug.log(
		"context",
		`Compacting context: ${currentTokens} tokens -> ${target}`,
	);
	consola.warn(`Context compaction triggered (${currentTokens} tokens)`);

	const systemMessage = ctx.messages[0];
	const recentMessages = ctx.messages.slice(-MIN_MESSAGES_TO_KEEP);
	const midMessages = ctx.messages.slice(1, -MIN_MESSAGES_TO_KEEP);

	if (midMessages.length === 0) {
		return false;
	}

	const compactedSummary = `[${midMessages.length} earlier messages compacted for context efficiency]`;

	ctx.messages = [
		systemMessage,
		{ role: "user", content: compactedSummary },
		...recentMessages,
	];

	const newTokens = estimateTokens(ctx.messages);
	debug.log(
		"context",
		`Context compacted: ${currentTokens} -> ${newTokens} tokens`,
	);

	return true;
}

export function warnOnContextLimit(ctx: AgentContext): boolean {
	const tokens = estimateTokens(ctx.messages);
	const ratio = tokens / MAX_CONTEXT_TOKENS;

	if (ratio > 0.95) {
		consola.warn(
			`Context at ${Math.round(ratio * 100)}% capacity (${tokens} tokens)`,
		);
		compactContext(ctx);
		return true;
	}

	if (ratio > 0.8) {
		consola.info(`Context at ${Math.round(ratio * 100)}% capacity`);
	}

	return false;
}

export interface AgentContext {
	cwd: string;
	workingDir: string;
	messages: OpenRouterMessage[];
	config: TehutiConfig;
	projectInstructions?: string;
	diffPreview?: DiffPreviewOptions;
	metadata: {
		startTime: Date;
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
): Promise<AgentContext> {
	const resolvedCwd = path.resolve(cwd);
	const projectInstructions = await loadProjectInstructions(resolvedCwd);

	return {
		cwd: resolvedCwd,
		workingDir: resolvedCwd,
		messages: [],
		config,
		projectInstructions,
		diffPreview,
		metadata: {
			startTime: new Date(),
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

export function buildSystemPrompt(ctx: AgentContext): string {
	const projectInstructionsSection = ctx.projectInstructions
		? `\n## Project Instructions\n\n${ctx.projectInstructions}\n`
		: "";

	return `You are Tehuti, the Scribe of Code Transformations - an AI coding assistant.

## Identity
- You are an expert software engineer with extensive knowledge in many programming languages, frameworks, design patterns, and best practices.
- Your goal is to accomplish the user's task efficiently and effectively.
- You work iteratively, breaking down complex tasks into clear steps.
${projectInstructionsSection}
## Operational Rules
- Always explain what you're doing before doing it.
- Use tools safely - never run destructive commands without confirmation.
- Follow the project's coding conventions and best practices.
- Write clean, well-documented code.
- Be concise in explanations but thorough in execution.
- When unsure, ask clarifying questions.

## Working Directory
- Current directory: ${ctx.cwd}
- All file paths should be relative to this directory unless absolute paths are provided.

## Environment
- Platform: ${process.platform}
- Node.js: ${process.version}
- Shell: ${process.env.SHELL ?? "unknown"}

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

export function addUserMessage(ctx: AgentContext, content: string): void {
	ctx.messages.push({
		role: "user",
		content,
	});
	debug.log("context", `Added user message (${content.length} chars)`);
}

export function addAssistantMessage(ctx: AgentContext, content: string): void {
	ctx.messages.push({
		role: "assistant",
		content,
	});
	debug.log("context", `Added assistant message (${content.length} chars)`);
}

export function addAssistantMessageWithTools(
	ctx: AgentContext,
	content: string,
	toolCalls?: OpenRouterToolCall[],
): void {
	const message: OpenRouterMessage = {
		role: "assistant",
		content,
	};

	if (toolCalls && toolCalls.length > 0) {
		message.tool_calls = toolCalls;
	}

	ctx.messages.push(message);
	debug.log(
		"context",
		`Added assistant message (${content.length} chars, ${toolCalls?.length ?? 0} tool calls)`,
	);
}

export function addToolResult(
	ctx: AgentContext,
	toolCallId: string,
	toolName: string,
	result: string,
): void {
	ctx.messages.push({
		role: "tool",
		tool_call_id: toolCallId,
		name: toolName,
		content: result,
	});
	debug.log("context", `Added tool result for ${toolName}`);
}

export function getToolContext(ctx: AgentContext) {
	return {
		cwd: ctx.cwd,
		workingDir: ctx.workingDir,
		env: process.env as Record<string, string>,
		timeout: 120000,
		diffPreview: ctx.diffPreview,
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
	}
}

export function trackFileWritten(ctx: AgentContext, filePath: string): void {
	if (!ctx.metadata.filesWritten.includes(filePath)) {
		ctx.metadata.filesWritten.push(filePath);
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
