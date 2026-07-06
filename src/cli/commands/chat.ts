import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { MouseProvider, useOnWheel } from "@ink-tools/ink-mouse";
import chalk from "chalk";
import clipboardy from "clipboardy";
import { Command } from "commander";
import { consola } from "consola";
import { Box, render, Text, useApp, useStdout } from "ink";
import Spinner from "ink-spinner";
import React, {
	useCallback,
	useDeferredValue,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { saveCacheToDisk } from "../../agent/cache/index.js";
import { compactContext, estimateTokens } from "../../agent/context.js";
import {
	type AgentContext,
	createAgentContext,
	isPlanMode,
	runAgentLoop,
	runOneShot,
	setPlanMode,
} from "../../agent/index.js";
import {
	type QuestionData,
	setQuestionResolver,
} from "../../agent/tools/system.js";
import { updateHttpAgentConfig } from "../../api/http-agent.js";
import { costTracker } from "../../api/index.js";
import { listModelsForProvider } from "../../api/models.js";
import { BRANDING, DECORATIVE, HIEROGLYPHS } from "../../branding/index.js";
import {
	configWarnings,
	type DEFAULT_CONFIG,
	getGlobalConfig,
	loadConfig,
	runSetupWizard,
	saveGlobalConfig,
} from "../../config/index.js";
import {
	getAllProviders,
	getEnvApiKeyForProvider,
	getProviderInfo,
	resolveBaseUrlForProvider,
} from "../../config/providers.js";
import { mcpManager } from "../../mcp/index.js";
import { setPermissionResolver } from "../../permissions/prompts.js";
import { sessionManager } from "../../session/manager.js";
import {
	createStreamingOutputManager,
	type StreamingOutputManager,
} from "../../terminal/buffered-writer.js";
import { initHighlighter } from "../../terminal/highlighter.js";
import { computeMessageLines } from "../../terminal/output.js";
import { debug } from "../../utils/debug.js";
import {
	AgentError,
	APIError,
	ConfigError,
	registerCleanupHandler,
} from "../../utils/errors.js";
import { getTelemetry, resetTelemetry } from "../../utils/telemetry.js";
import { bootstrapCLI, loadTehutiConfig } from "../bootstrap.js";
import {
	compactBlockForUi,
	compactMessagesForUi,
	compactToolResultForUi,
	needsUiCompaction,
	safeStringify,
	TOOL_RESULT_PREVIEW_CHARS,
	truncateMiddle,
	UI_MAX_REASONING_CHARS,
	UI_MAX_TEXT_CHARS,
	type UiBlock,
	type UiMessage,
} from "../ui/chat-memory.js";
import {
	type CommandItem,
	CommandPalette,
	createCommands,
	formatHelpOutput,
} from "../ui/components/CommandPalette.js";
import { ConfigEditor } from "../ui/components/ConfigEditor.js";
import { ExpandableToolOutput } from "../ui/components/ExpandableToolOutput.js";
import { HieroglyphSpinner } from "../ui/components/HieroglyphSpinner.js";
import { PermissionPrompt } from "../ui/components/PermissionPrompt.js";
import { ProgressBar } from "../ui/components/ProgressBar.js";
import { QuestionPrompt } from "../ui/components/QuestionPrompt.js";
import { SessionList } from "../ui/components/SessionList.js";
import { StatusIndicator } from "../ui/components/StatusIndicator.js";
import { SwarmVisualizer } from "../ui/components/SwarmVisualizer.js";
import { TodoList } from "../ui/components/TodoList.js";
import { TehutiHeader } from "../ui/components/TehutiHeader.js";
import { useChatInput } from "../ui/hooks/useChatInput.js";
import { useChatState } from "../ui/hooks/useChatState.js";
import { renderMarkdown } from "../ui/markdown-mapper.js";
import { companionCommand } from "./companion.js";
import { daemonCommand } from "./daemon.js";

const GOLD = BRANDING.colors?.primary || "#F5C518";
const CORAL = BRANDING.colors?.accent || "#FF6B35";
const GREEN = BRANDING.colors?.green || "#22C55E";
const GRAY = BRANDING.colors?.gray || "#9CA3AF";
const RED = BRANDING.colors?.red || "#EF4444";
const CYAN = BRANDING.colors?.cyan || "#06B6D4";
const SAND = BRANDING.colors?.sand || "#8B7355";
const PURPLE = BRANDING.colors?.purple || "#A855F7";

const TOOL_ICONS: Record<string, string> = {
	read: "📖",
	read_file: "📖",
	write: "✏️",
	write_file: "✏️",
	edit: "📝",
	edit_file: "📝",
	bash: "⚡",
	glob: "📁",
	grep: "🔍",
	webfetch: "🌐",
	web_search: "🔍",
	question: "❓",
	list_directory: "📂",
	list_files: "📂",
};

type RuntimeCustomProvider = {
	name: string;
	baseUrl: string;
	apiKey?: string;
	headers?: Record<string, string>;
};

type RuntimeProviderState = {
	provider: string;
	baseUrl?: string;
	apiKey?: string;
	customProvider?: RuntimeCustomProvider;
};

type ChatCommandOptions = {
	json?: boolean;
	quiet?: boolean;
	continue?: boolean;
	[key: string]: unknown;
};

function normalizeCustomProvider(
	value: unknown,
): RuntimeCustomProvider | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}

	const record = value as Record<string, unknown>;
	const name = typeof record.name === "string" ? record.name.trim() : "";
	const baseUrl =
		typeof record.baseUrl === "string" ? record.baseUrl.trim() : "";

	if (!name || !baseUrl) {
		return undefined;
	}

	const apiKey =
		typeof record.apiKey === "string" && record.apiKey.trim().length > 0
			? record.apiKey.trim()
			: undefined;
	const rawHeaders =
		typeof record.headers === "object" && record.headers !== null
			? (record.headers as Record<string, unknown>)
			: undefined;

	const headers =
		rawHeaders &&
		Object.entries(rawHeaders).every(([, value]) => typeof value === "string")
			? (Object.fromEntries(
					Object.entries(rawHeaders).map(([key, value]) => [
						key,
						String(value),
					]),
				) as Record<string, string>)
			: undefined;

	return {
		name,
		baseUrl,
		...(apiKey ? { apiKey } : {}),
		...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
	};
}

function formatToolCall(toolName: string, args: unknown): string {
	const icon = TOOL_ICONS[toolName] || "🔧";

	switch (toolName) {
		case "read":
		case "read_file": {
			const filePath =
				typeof args === "object" && args !== null && "file_path" in args
					? (args as Record<string, unknown>).file_path
					: "";
			return `${icon} Reading: ${filePath}`;
		}
		case "write":
		case "write_file": {
			const filePath =
				typeof args === "object" && args !== null && "file_path" in args
					? (args as Record<string, unknown>).file_path
					: "";
			return `${icon} Writing: ${filePath}`;
		}
		case "edit":
		case "edit_file": {
			const filePath =
				typeof args === "object" && args !== null && "file_path" in args
					? (args as Record<string, unknown>).file_path
					: "";
			return `${icon} Editing: ${filePath}`;
		}
		case "bash": {
			const command =
				typeof args === "object" && args !== null && "command" in args
					? (args as Record<string, unknown>).command
					: "";
			const cmdStr = String(command).slice(0, 50);
			return `${icon} Running: ${cmdStr}${String(command).length > 50 ? "..." : ""}`;
		}
		case "glob": {
			const pattern =
				typeof args === "object" && args !== null && "pattern" in args
					? (args as Record<string, unknown>).pattern
					: "";
			return `${icon} Finding: ${pattern}`;
		}
		case "grep": {
			const pattern =
				typeof args === "object" && args !== null && "pattern" in args
					? (args as Record<string, unknown>).pattern
					: "";
			const pth =
				typeof args === "object" && args !== null && "path" in args
					? (args as Record<string, unknown>).path
					: "";
			return `${icon} Searching: "${pattern}" in ${pth}`;
		}
		case "webfetch": {
			const url =
				typeof args === "object" && args !== null && "url" in args
					? (args as Record<string, unknown>).url
					: "";
			return `${icon} Fetching: ${String(url).slice(0, 60)}`;
		}
		case "web_search": {
			const query =
				typeof args === "object" && args !== null && "query" in args
					? (args as Record<string, unknown>).query
					: "";
			return `${icon} Searching web: "${query}"`;
		}
		default:
			return `${icon} ${toolName}`;
	}
}

interface FormattedToolResult {
	preview: string;
	full: string;
	isTruncated: boolean;
	linesCount: number;
	truncatedLinesCount: number;
}

function formatToolResult(
	result: unknown,
	maxWidth: number = 80,
	previewLinesCount: number = 5,
): FormattedToolResult {
	if (!result) {
		return {
			preview: "",
			full: "",
			isTruncated: false,
			linesCount: 0,
			truncatedLinesCount: 0,
		};
	}

	let output: string;
	if (typeof result === "string") {
		output = result;
	} else if (
		typeof result === "object" &&
		result !== null &&
		"output" in result
	) {
		output = String((result as Record<string, unknown>).output);
	} else {
		output = safeStringify(result);
	}
	output = truncateMiddle(
		output,
		TOOL_RESULT_PREVIEW_CHARS,
		"truncated for display",
	);

	const lines = output.split("\n");
	const isTruncated = lines.length > previewLinesCount;
	const displayLines = isTruncated ? lines.slice(0, previewLinesCount) : lines;

	const formatLines = (lineArray: string[]): string => {
		return lineArray
			.map((line) => {
				const truncated =
					line.length > maxWidth - 4
						? `${line.slice(0, maxWidth - 7)}...`
						: line;
				return `  │ ${truncated}`;
			})
			.join("\n");
	};

	const preview = isTruncated
		? `${formatLines(displayLines)}\n  │ ... (${lines.length - previewLinesCount} more lines)`
		: formatLines(displayLines);

	return {
		preview,
		full: preview,
		isTruncated,
		linesCount: lines.length,
		truncatedLinesCount: isTruncated ? lines.length - previewLinesCount : 0,
	};
}

const CONFIG_PATH = path.join(os.homedir(), ".tehuti.json");

function formatSessionsTable(sessions: unknown[]): string {
	if (!sessions || sessions.length === 0) return "No saved sessions";
	return `[SESSION_LIST]${JSON.stringify(sessions)}`;
}

const HISTORY_PATH = path.join(os.homedir(), ".tehuti", "history.json");

function loadHistory(): string[] {
	try {
		if (fs.existsSync(HISTORY_PATH)) {
			return JSON.parse(fs.readFileSync(HISTORY_PATH, "utf-8")) as string[];
		}
	} catch {}
	return [];
}

function saveHistory(history: string[]): void {
	try {
		fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true });
		fs.writeFileSync(
			HISTORY_PATH,
			JSON.stringify(history.slice(0, 1000), null, 2),
		);
	} catch {}
}

const _ANSI = {
	reset: "\x1b[0m",
	bold: "\x1b[1m",
	italic: "\x1b[3m",
	dim: "\x1b[2m",
	cyan: "\x1b[36m",
	yellow: "\x1b[33m",
	green: "\x1b[32m",
	red: "\x1b[31m",
	magenta: "\x1b[35m",
	blue: "\x1b[34m",
	orange: "\x1b[38;5;208m",
	coral: "\x1b[38;5;174m",
};

// Initialize highlighter early
initHighlighter().catch((err) => {
	console.error("Failed to initialize syntax highlighter:", err);
});

export function parseContentBlocks(
	content: string,
): Array<{ type: "text" | "reasoning"; content: string }> {
	const blocks: Array<{ type: "text" | "reasoning"; content: string }> = [];
	const regex = /<(think|thinking|reasoning)>([\s\S]*?)(?:<\/\1>|$)/g;
	
	let lastIndex = 0;
	let match;
	
	while ((match = regex.exec(content)) !== null) {
		if (match.index > lastIndex) {
			blocks.push({ type: "text", content: content.slice(lastIndex, match.index) });
		}
		
		blocks.push({ type: "reasoning", content: match[2] });
		lastIndex = regex.lastIndex;
	}
	
	if (lastIndex < content.length) {
		blocks.push({ type: "text", content: content.slice(lastIndex) });
	}
	
	return blocks;
}

export function normalizeBlocks(
	blocks: Array<
		| { type: "text"; content: string }
		| { type: "reasoning"; content: string }
		| {
				type: "tool";
				id: string;
				name: string;
				description: string;
				result: unknown;
		  }
	>,
): Array<
	| { type: "text"; content: string }
	| { type: "reasoning"; content: string }
	| {
			type: "tool";
			id: string;
			name: string;
			description: string;
			result: unknown;
	  }
> {
	const normalized: typeof blocks = [];
	for (const block of blocks) {
		if (block.type === "text") {
			const parsed = parseContentBlocks(block.content);
			normalized.push(...parsed);
		} else {
			normalized.push(block);
		}
	}
	return normalized;
}

function getEnhancedToolName(name: string, description?: string): string {
	const base = description || name || "unknown_tool";

	if (!name) return base;

	if (name === "store_insight" || name === "query_memory") {
		return `${base} 𓂀 [Deep Memory]`;
	}

	if (
		name.includes("aci_") ||
		name.includes("sandbox") ||
		name.includes("speculative")
	) {
		return `${base} 𓋹 [Sandbox/ACI]`;
	}

	if (name.includes("shadow_workspace")) {
		return `${base} 𓂝 [Shadow Workspace]`;
	}

	return base;
}

function getToolRenderStatus(result: unknown): "pending" | "success" | "error" {
	if (result === "[Compacted]") return "success";
	if (result === null) return "pending";
	if (result && typeof result === "object" && "success" in result) {
		return (result as { success?: unknown }).success === false
			? "error"
			: "success";
	}
	return "success";
}

function ChatUI({
	companionMode,
	apiKey,
	model,
	diffPreview,
	cfg,
	continueSession,
	onExit,
	mouseEnabled,
	onToggleMouse,
}: {
	apiKey: string;
	model: string;
	diffPreview?: { showPreview: boolean; autoConfirm?: boolean };
	cfg: typeof DEFAULT_CONFIG;
	continueSession?: boolean;
	onExit: () => void;
	mouseEnabled?: boolean;
	onToggleMouse?: () => void;
	companionMode?: boolean;
}) {
	const {
		messages,
		setMessages,
		input,
		setInput,
		cursorPos,
		setCursorPos,
		selectionStart,
		setSelectionStart,
		selectionEnd,
		setSelectionEnd,
		loading,
		setLoading,
		error,
		setError,
		ctxModel,
		setCtxModel,
		runtimeProvider,
		setRuntimeProvider,
		runtimeBaseUrl,
		setRuntimeBaseUrl,
		runtimeApiKey,
		setRuntimeApiKey,
		runtimeCustomProvider,
		setRuntimeCustomProvider,
		scrollOffset,
		setScrollOffset,
		history,
		setHistory,
		historyIndex,
		setHistoryIndex,
		sessionId,
		setSessionId,
		showWelcome,
		setShowWelcome,
		sessionCost,
		setSessionCost,
		thinking,
		setThinking,
		showThinking,
		setShowThinking,
		showCommandPalette,
		setShowCommandPalette,
		showDashboard,
		setShowDashboard,
		pendingQuestion,
		setPendingQuestion,
		progress,
		setProgress,
		operationLabel,
		setOperationLabel,
		showConfigEditor,
		setShowConfigEditor,
		showSessionList,
		setShowSessionList,
		savedSessions,
		setSavedSessions,
		questionResolverRef,
		pendingPermission,
		setPendingPermission,
		permissionResolverRef,
	} = useChatState(model, apiKey, cfg);
	const [commandPaletteInitialQuery, setCommandPaletteInitialQuery] =
		React.useState("");

	const normalizedProvider = useMemo(
		() => runtimeProvider.trim().toLowerCase() || "openrouter",
		[runtimeProvider],
	);
	const resolveRuntimeApiKey = useCallback(
		(
			targetProvider: string,
			explicitKey?: string,
			overrideCustomProvider?: RuntimeCustomProvider,
		) => {
			const provider =
				targetProvider.trim().toLowerCase() || normalizedProvider;
			const trimmedExplicit = explicitKey?.trim();
			if (trimmedExplicit) {
				return trimmedExplicit;
			}

			const envApiKey = getEnvApiKeyForProvider(provider);
			if (envApiKey) {
				return envApiKey;
			}

			if (provider === normalizedProvider) {
				return runtimeApiKey;
			}

			if (provider === "custom") {
				return overrideCustomProvider?.apiKey || runtimeCustomProvider?.apiKey;
			}

			if (provider === (cfg.provider || "openrouter")) {
				return cfg.apiKey;
			}

			return undefined;
		},
		[
			cfg.provider,
			cfg.apiKey,
			normalizedProvider,
			runtimeApiKey,
			runtimeCustomProvider,
		],
	);

	const resolveRuntimeProviderState = useCallback(
		(
			provider?: string,
			options?: {
				baseUrl?: string;
				apiKey?: string;
				customProvider?: RuntimeCustomProvider;
			},
		): RuntimeProviderState => {
			const targetProvider =
				provider?.trim().toLowerCase() || normalizedProvider;
			const explicitBaseUrl =
				options?.baseUrl !== undefined ? options.baseUrl?.trim() : undefined;

			const requestedCustomProvider =
				targetProvider === "custom"
					? options?.customProvider ||
						runtimeCustomProvider ||
						normalizeCustomProvider(cfg.customProvider)
					: undefined;

			const resolvedBaseUrl = resolveBaseUrlForProvider(
				targetProvider,
				targetProvider === "custom"
					? explicitBaseUrl || requestedCustomProvider?.baseUrl
					: (explicitBaseUrl ?? runtimeBaseUrl),
			);

			const resolvedCustomProvider =
				targetProvider === "custom" && requestedCustomProvider
					? {
							...requestedCustomProvider,
							name: requestedCustomProvider.name || "custom",
							...(resolvedBaseUrl ? { baseUrl: resolvedBaseUrl } : {}),
						}
					: undefined;

			return {
				provider: targetProvider,
				baseUrl: resolvedBaseUrl,
				apiKey: resolveRuntimeApiKey(
					targetProvider,
					options?.apiKey,
					resolvedCustomProvider,
				),
				customProvider: resolvedCustomProvider,
			};
		},
		[
			cfg.customProvider,
			runtimeBaseUrl,
			runtimeCustomProvider,
			normalizedProvider,
			resolveRuntimeApiKey,
		],
	);

	const applyRuntimeProviderState = useCallback(
		(next: RuntimeProviderState) => {
			setRuntimeProvider(next.provider);
			setRuntimeBaseUrl(next.baseUrl);
			setRuntimeApiKey(next.apiKey || "");
			setRuntimeCustomProvider(
				next.provider === "custom" ? next.customProvider : undefined,
			);

			if (ctxRef.current) {
				ctxRef.current.config.provider = next.provider;
				if (next.baseUrl) {
					ctxRef.current.config.baseUrl = next.baseUrl;
				} else {
					delete ctxRef.current.config.baseUrl;
				}
				if (next.apiKey) {
					ctxRef.current.config.apiKey = next.apiKey;
				} else {
					delete ctxRef.current.config.apiKey;
				}
				if (next.provider === "custom" && next.customProvider?.baseUrl) {
					ctxRef.current.config.customProvider = next.customProvider;
				} else {
					delete ctxRef.current.config.customProvider;
				}
			}
		},
		[
			setRuntimeProvider,
			setRuntimeBaseUrl,
			setRuntimeApiKey,
			setRuntimeCustomProvider,
		],
	);

	const persistRuntimeProviderState = useCallback(
		(
			next: RuntimeProviderState,
			overrides?: {
				model?: string;
			},
		) => {
			saveGlobalConfig({
				provider: next.provider,
				baseUrl: next.baseUrl,
				apiKey: next.apiKey,
				customProvider:
					next.provider === "custom" ? next.customProvider : undefined,
				model: overrides?.model ?? ctxModel,
			});
		},
		[ctxModel],
	);

	const getActiveConfig = useCallback(() => {
		const resolved = resolveRuntimeProviderState();
		return {
			...cfg,
			provider: resolved.provider,
			model: ctxModel,
			baseUrl: resolved.baseUrl,
			customProvider: resolved.customProvider,
			apiKey: resolved.apiKey,
		};
	}, [cfg, ctxModel, resolveRuntimeProviderState]);

	const ensureContext = useCallback(async () => {
		if (ctxRef.current) {
			return ctxRef.current;
		}

		const ctx = await createAgentContext(
			process.cwd(),
			getActiveConfig(),
			diffPreview,
			companionMode,
		);
		ctxRef.current = ctx;
		return ctx;
	}, [diffPreview, getActiveConfig]);

	const requestGenerationRef = useRef(0);
	const requestControllerRef = useRef<AbortController | null>(null);

	const abortActiveRequest = useCallback(() => {
		requestGenerationRef.current += 1;
		if (requestControllerRef.current) {
			requestControllerRef.current.abort();
			requestControllerRef.current = null;
		}
	}, []);

	const beginRequest = useCallback(() => {
		abortActiveRequest();
		const controller = new AbortController();
		requestControllerRef.current = controller;
		return {
			requestId: requestGenerationRef.current,
			controller,
		};
	}, [abortActiveRequest]);

	const isCurrentRequest = useCallback(
		(requestId: number, signal?: AbortSignal) =>
			requestGenerationRef.current === requestId && !signal?.aborted,
		[],
	);

	const resetConversation = useCallback(
		async (createNewSession = true) => {
			setLoading(true);
			try {
				abortActiveRequest();
				if (pendingQuestion) {
					pendingQuestion.reject(new Error("Question cancelled by reset"));
					setPendingQuestion(null);
				}

				setMessages([]);
				setThinking("");
				setShowThinking(false);
				setSessionCost(0);
				setShowWelcome(true);
				setHistoryIndex(-1);
				setInput("");
				setCursorPos(0);
				setScrollOffset(0);
				setError("");
				setProgress(0);
				setOperationLabel("");
				costTracker.reset();
				resetTelemetry();
				ctxRef.current = null;
				if (createNewSession) {
					const id = await sessionManager.createSession(
						process.cwd(),
						ctxModel,
						undefined,
						{
							provider: normalizedProvider,
							baseUrl: runtimeBaseUrl,
							customProvider:
								normalizedProvider === "custom"
									? runtimeCustomProvider
									: undefined,
						},
					);
					setSessionId(id);
				}
			} finally {
				setLoading(false);
			}
		},
		[
			ctxModel,
			pendingQuestion,
			normalizedProvider,
			runtimeBaseUrl,
			runtimeCustomProvider,
			abortActiveRequest,
			setMessages,
			setThinking,
			setShowThinking,
			setSessionCost,
			setShowWelcome,
			setHistoryIndex,
			setInput,
			setCursorPos,
			setScrollOffset,
			setError,
			setProgress,
			setOperationLabel,
			setSessionId,
			setLoading,
			setPendingQuestion,
		],
	);
	const { exit } = useApp();
	const { stdout } = useStdout();
	const ctxRef = useRef<AgentContext | null>(null);
	const msgIdRef = useRef(0);
	const messagesRef = useRef<typeof messages>([]);
	const messagesEndRef = useRef<boolean>(true);
	const inputBeforeHistoryRef = useRef<string>("");
	const batchedTokensRef = useRef<string>("");
	const batchTimerRef = useRef<NodeJS.Timeout | null>(null);
	const streamingContentRef = useRef<string>("");
	const streamingMsgIdRef = useRef<number | null>(null);

	const [terminalSize, setTerminalSize] = useState({
		rows: stdout?.rows || 24,
		columns: stdout?.columns || 80,
	});

	useEffect(() => {
		let timer: NodeJS.Timeout | null = null;
		const handleResize = () => {
			if (timer) clearTimeout(timer);
			timer = setTimeout(() => {
				setTerminalSize({
					rows: stdout?.rows || 24,
					columns: stdout?.columns || 80,
				});
			}, 100);
		};

		stdout?.on("resize", handleResize);

		return () => {
			if (timer) clearTimeout(timer);
			stdout?.off("resize", handleResize);
		};
	}, [stdout]);

	const scrollContainerRef = useRef(null);
	useOnWheel(scrollContainerRef, (event) => {
		if (event.button === "wheel-up") {
			scrollLineUp();
		} else if (event.button === "wheel-down") {
			scrollLineDown();
		}
	});

	const terminalHeight = terminalSize.rows;
	const terminalWidth = terminalSize.columns;
	const headerHeight = 3;
	const inputHeight = 3;
	const shouldShowHeader =
		showWelcome && scrollOffset === 0 && messages.length > 0;
	const headerScrollHeight = shouldShowHeader ? 14 : 0;
	const warningsHeight = configWarnings.length * 4;

	messagesRef.current = messages;

	useEffect(() => {
		// Skip compaction during active streaming to avoid visual flicker
		if (loading || !needsUiCompaction(messages as UiMessage[])) return;
		setMessages((current) => {
			if (loading || !needsUiCompaction(current as UiMessage[])) return current;
			return compactMessagesForUi(current as UiMessage[]) as typeof current;
		});
	}, [messages, loading, setMessages]);

	// Cleanup batch timer on unmount
	useEffect(() => {
		return () => {
			if (batchTimerRef.current) {
				clearTimeout(batchTimerRef.current);
				batchTimerRef.current = null;
			}
		};
	}, []);

	const flushBatchedTokens = useCallback(() => {
		if (batchTimerRef.current) {
			clearTimeout(batchTimerRef.current);
			batchTimerRef.current = null;
		}

		if (batchedTokensRef.current.length === 0) return;

		const tokens = batchedTokensRef.current;
		batchedTokensRef.current = "";
		streamingContentRef.current = truncateMiddle(
			streamingContentRef.current + tokens,
			UI_MAX_TEXT_CHARS,
			"truncated for UI memory",
		);

		if (streamingMsgIdRef.current !== null) {
			setMessages((m) => {
				const updated = [];
				for (let i = 0; i < m.length; i++) {
					const msg = m[i];
					if (msg.id !== streamingMsgIdRef.current) {
						updated.push(msg);
						continue;
					}
					const freshBlocks = msg.blocks ? msg.blocks.slice() : [];
					const lastBlock = freshBlocks[freshBlocks.length - 1];
					if (lastBlock && lastBlock.type === "text") {
						freshBlocks[freshBlocks.length - 1] = {
							...lastBlock,
							content: truncateMiddle(
								lastBlock.content + tokens,
								UI_MAX_TEXT_CHARS,
								"truncated for UI memory",
							),
						};
					} else {
						freshBlocks.push({ type: "text", content: tokens });
					}
					updated.push({
						...msg,
						content: streamingContentRef.current,
						blocks: freshBlocks,
					});
				}
				return updated;
			});
		}
	}, [setMessages]);

	const batchToken = useCallback(
		(token: string) => {
			batchedTokensRef.current += token;

			if (token.includes("\n") || batchedTokensRef.current.length > 20) {
				flushBatchedTokens();
				return;
			}

			if (!batchTimerRef.current) {
				batchTimerRef.current = setTimeout(() => {
					flushBatchedTokens();
				}, 50);
			}
		},
		[flushBatchedTokens],
	);

	const handleCommandPaletteSelect = useCallback(
		(cmd: CommandItem) => {
			setShowCommandPalette(false);
			setCommandPaletteInitialQuery("");
			if (cmd.action) cmd.action();
		},
		[setShowCommandPalette],
	);

	const handleCommandPaletteClose = useCallback(() => {
		setShowCommandPalette(false);
		setCommandPaletteInitialQuery("");
	}, [setShowCommandPalette]);

	const handleModelSwitch = useCallback(() => {
		setMessages((m) => [
			...m,
			{
				id: msgIdRef.current++,
				role: "system",
				content:
					"Use: /model <model-name> to switch models.\nExample: /model deepseek-v4-flash\n\nUse /models to see available free models.",
			},
		]);
	}, [setMessages]);

	const handleShowCost = useCallback(() => {
		const stats = costTracker.getSessionStats();
		setMessages((m) => [
			...m,
			{
				id: msgIdRef.current++,
				role: "system",
				content: `Session Cost:\n  Requests: ${stats.requestCount}\n  Tokens: ${(stats.totalPromptTokens + stats.totalCompletionTokens).toLocaleString()}\n  Cost: $${stats.totalCost.toFixed(4)}${stats.totalCacheReadTokens > 0 ? `\n  Cache savings: ${stats.totalCacheReadTokens.toLocaleString()} tokens` : ""}`,
			},
		]);
	}, [setMessages]);

	const handleClear = useCallback(async () => {
		await resetConversation();
	}, [resetConversation]);

	const handleCompact = useCallback(() => {
		const ctx = ctxRef.current;
		if (ctx) {
			const currentTokens = estimateTokens(ctx.messages);
			const compacted = compactContext(ctx);
			if (compacted) {
				const newTokens = estimateTokens(ctx.messages);
				setMessages((m) => [
					...m,
					{
						id: msgIdRef.current++,
						role: "system",
						content: `Context compacted: ${currentTokens} → ${newTokens} tokens`,
					},
				]);
			} else {
				setMessages((m) => [
					...m,
					{
						id: msgIdRef.current++,
						role: "system",
						content: `Context already compact (${currentTokens} tokens)`,
					},
				]);
			}
		}
	}, [setMessages]);

	const handleThinking = useCallback(() => {
		const ctx = ctxRef.current;
		if (ctx) {
			ctx.config.extendedThinking = !ctx.config.extendedThinking;
			setMessages((m) => [
				...m,
				{
					id: msgIdRef.current++,
					role: "system",
					content: `Extended thinking mode ${ctx.config.extendedThinking ? "enabled" : "disabled"}`,
				},
			]);
		}
	}, [setMessages]);

	const handlePlan = useCallback(() => {
		const ctx = ctxRef.current;
		if (ctx) {
			const newPlanMode = !isPlanMode();
			setPlanMode(newPlanMode);
			setMessages((m) => [
				...m,
				{
					id: msgIdRef.current++,
					role: "system",
					content: newPlanMode
						? "Plan mode entered - read-only exploration"
						: "Plan mode exited - full access restored",
				},
			]);
		}
	}, [setMessages]);

	const handleShowHelp = useCallback(() => {
		setMessages((m) => [
			...m,
			{
				id: msgIdRef.current++,
				role: "system",
				content: formatHelpOutput(),
			},
		]);
	}, [setMessages]);

	const handleShowStats = useCallback(() => {
		const telemetry = getTelemetry();
		const stats = telemetry.getSummary();
		setMessages((m) => [
			...m,
			{
				id: msgIdRef.current++,
				role: "system",
				content: stats,
			},
		]);
	}, [setMessages]);

	const handleConfig = useCallback(() => {
		setShowConfigEditor(true);
	}, [setShowConfigEditor]);

	const handleShowSessions = useCallback(async () => {
		setLoading(true);
		const sessions = await sessionManager.listSessions();
		const table = formatSessionsTable(sessions);
		setMessages((m) => [
			...m,
			{
				id: msgIdRef.current++,
				role: "system",
				content: sessions.length > 0 ? table : "No saved sessions",
			},
		]);
		setLoading(false);
	}, [setLoading, setMessages]);

	const handleShowModels = useCallback(
		async (opts?: { provider?: string; apiKey?: string; baseUrl?: string }) => {
			setLoading(true);
			const provider =
				opts?.provider?.trim().toLowerCase() || normalizedProvider;
			const resolved = resolveRuntimeProviderState(provider, {
				baseUrl: opts?.baseUrl,
				apiKey: opts?.apiKey,
			});
			const base = resolveBaseUrlForProvider(provider, resolved.baseUrl);
			setMessages((m) => [
				...m,
				{
					id: msgIdRef.current++,
					role: "system",
					content: `Fetching live models + accurate specs for ${provider || "current"}...`,
				},
			]);

			try {
				const rich = await listModelsForProvider(provider || "openrouter", {
					apiKey: resolved.apiKey,
					baseUrl: base,
					headers: resolved.customProvider?.headers,
				});

				const models = [...rich].sort(
					(a, b) => (b.contextLength ?? 0) - (a.contextLength ?? 0),
				);

				const list = models.length
					? models
							.slice(0, 40)
							.map((m) => {
								const ctx = m.contextLength
									? ` ctx:${Math.round(m.contextLength / 1000)}k`
									: "";
								const pr =
									m.pricing && (m.pricing.input || m.pricing.output)
										? ` in:$${((m.pricing.input || 0) / 1e6).toFixed(4)}/M`
										: "";
								return `  ${m.id}${ctx}${pr}`;
							})
							.join("\n")
					: "  (no data from endpoint; verify key/base via /config)";

				setMessages((msgs) => [
					...msgs.slice(0, -1),
					{
						id: msgIdRef.current++,
						role: "system",
						content: `Live models for ${
							provider || "provider"
						} (fetched accurate context/pricing when provided):\n${list}\n\nUse: /model <full-id>\nContext shown is from provider endpoint.`,
					},
				]);
			} catch (e) {
				setMessages((msgs) => [
					...msgs.slice(0, -1),
					{
						id: msgIdRef.current++,
						role: "system",
						content: `Failed to fetch models: ${
							e instanceof Error ? e.message : String(e)
						} \nCheck /config for key/base for ${provider || "provider"}.`,
					},
				]);
			} finally {
				setLoading(false);
			}
		},
		[normalizedProvider, resolveRuntimeProviderState, setLoading, setMessages],
	);

	const describeProvider = useCallback((providerId: string) => {
		const info = getProviderInfo(providerId.toLowerCase());
		if (!info) {
			return `- ${providerId} (unknown)`;
		}
		const defaultBase = info.defaultBaseUrl || "custom";
		return `- ${info.id}: ${info.name} | base: ${defaultBase} | list endpoint: ${info.modelListEndpoint}`;
	}, []);

	const handleProviderSwitch = useCallback(
		async (requestedProvider?: string) => {
			if (!requestedProvider) {
				const providers = getAllProviders();
				const list = providers
					.map((provider) => describeProvider(provider.id))
					.join("\n");
				setMessages((m) => [
					...m,
					{
						id: msgIdRef.current++,
						role: "system",
						content: `Supported providers:\n${list}\n\nUse: /provider <id>   Then /models for current provider's catalog.`,
					},
				]);
				return;
			}

			const normalized = requestedProvider.trim().toLowerCase();
			const info = getProviderInfo(normalized);
			if (!info) {
				setMessages((m) => [
					...m,
					{
						id: msgIdRef.current++,
						role: "system",
						content: `Unknown provider "${requestedProvider}". Use /providers for a full list.`,
					},
				]);
				return;
			}

			if (!info.isOpenAICompatible && info.id !== "kilocode") {
				setMessages((m) => [
					...m,
					{
						id: msgIdRef.current++,
						role: "system",
						content: `${info.name} is not OpenAI-compatible in the current runtime and can't be used directly yet.`,
					},
				]);
				return;
			}

			const nextState = resolveRuntimeProviderState(normalized, {
				customProvider:
					normalized === "custom"
						? runtimeCustomProvider ||
							normalizeCustomProvider(cfg.customProvider)
						: undefined,
			});

			if (normalized === "custom" && !nextState.customProvider) {
				setMessages((m) => [
					...m,
					{
						id: msgIdRef.current++,
						role: "system",
						content:
							"Custom provider requires customProvider settings. Use /config and set provider + baseUrl first.",
					},
				]);
				return;
			}

			applyRuntimeProviderState(nextState);
			persistRuntimeProviderState(nextState);

			setMessages((m) => [
				...m,
				{
					id: msgIdRef.current++,
					role: "system",
					content: `Provider switched to ${normalized}. Base URL: ${nextState.baseUrl || "auto"}. Use /models for live catalog.`,
				},
			]);
			await handleShowModels({
				provider: normalized,
				apiKey: nextState.apiKey,
				baseUrl: nextState.baseUrl,
			});
		},
		[
			setMessages,
			describeProvider,
			handleShowModels,
			cfg.customProvider,
			runtimeCustomProvider,
			applyRuntimeProviderState,
			persistRuntimeProviderState,
			resolveRuntimeProviderState,
		],
	);

	const handleSave = useCallback(async () => {
		if (sessionId && ctxRef.current) {
			await sessionManager.saveSession(sessionId, ctxRef.current);
			setMessages((m) => [
				...m,
				{
					id: msgIdRef.current++,
					role: "system",
					content: `Session saved: ${sessionId.slice(0, 8)}`,
				},
			]);
		} else {
			setMessages((m) => [
				...m,
				{
					id: msgIdRef.current++,
					role: "system",
					content: "No session to save. Start a conversation first.",
				},
			]);
		}
	}, [sessionId, setMessages]);
	const loadSessionById = useCallback(
		async (id: string) => {
			setLoading(true);
			try {
				const data = await sessionManager.loadSession(id);
				if (data && data.messages.length > 0) {
					const loadedProvider = data.metadata.provider?.trim().toLowerCase();
					const loadedBaseUrl = data.metadata.baseUrl?.trim();
					const loadedCustomProvider = normalizeCustomProvider(
						data.metadata.customProvider,
					);
					const resolvedProvider = loadedProvider || runtimeProvider;
					const sourceCustomProvider =
						loadedCustomProvider ||
						runtimeCustomProvider ||
						normalizeCustomProvider(cfg.customProvider);
					const resolvedState = resolveRuntimeProviderState(resolvedProvider, {
						baseUrl: loadedBaseUrl || "",
						customProvider: sourceCustomProvider,
					});
					const resolvedModel = data.metadata.model || ctxModel;

					applyRuntimeProviderState(resolvedState);
					persistRuntimeProviderState(resolvedState, { model: resolvedModel });

					const loadedMsgs: UiMessage[] = [];
					let uiMsgId = 0;

					for (let i = 0; i < data.messages.length; i++) {
						const m = data.messages[i];
						if (m.role === "system" || m.role === "tool") continue;

						const contentStr =
							typeof m.content === "string"
								? m.content
								: JSON.stringify(m.content);

						const uiMsg: UiMessage = {
							id: uiMsgId++,
							role: m.role,
							content: contentStr,
						};

						if (m.role === "assistant") {
							uiMsg.toolCalls = [];
							uiMsg.blocks = [];

							if (contentStr) {
								uiMsg.blocks.push({ type: "text", content: contentStr });
							}

							if (m.tool_calls && m.tool_calls.length > 0) {
								for (const tc of m.tool_calls) {
									const toolMsg = data.messages.find(
										(msg) => msg.role === "tool" && msg.tool_call_id === tc.id,
									);
									let toolResultStr: string | null = null;
									if (toolMsg) {
										toolResultStr =
											typeof toolMsg.content === "string"
												? toolMsg.content
												: JSON.stringify(toolMsg.content);
									}

									let parsedResult: unknown = toolResultStr;
									if (toolResultStr) {
										try {
											parsedResult = JSON.parse(toolResultStr);
										} catch {}
									}

									const toolData = {
										id: tc.id,
										name: tc.function.name,
										description: tc.function.arguments,
										result: parsedResult,
										isExpanded: false,
									};

									uiMsg.toolCalls.push(toolData);
									uiMsg.blocks.push({
										type: "tool",
										...toolData,
									});
								}
							}
						}
						loadedMsgs.push(uiMsg);
					}
					setMessages(loadedMsgs);
					msgIdRef.current = loadedMsgs.length;
					setSessionId(id);
					setShowWelcome(false);
					setThinking("");
					setShowThinking(false);
					costTracker.reset();
					setSessionCost(0);
					ctxRef.current = await createAgentContext(
						process.cwd(),
						{
							...getActiveConfig(),
							provider: resolvedState.provider,
							baseUrl: resolvedState.baseUrl,
							apiKey: resolvedState.apiKey,
							customProvider:
								resolvedState.provider === "custom" &&
								resolvedState.customProvider?.baseUrl
									? resolvedState.customProvider
									: undefined,
							model: resolvedModel,
							maxIterations: 50,
							maxTokens: 4096,
							permissions: {
								defaultMode: "trust",
								alwaysAllow: [],
								alwaysDeny: [],
								trustedMode: true,
							},
						},
						diffPreview,
						companionMode,
					);
					ctxRef.current.config.provider = resolvedState.provider;
					if (resolvedState.baseUrl) {
						ctxRef.current.config.baseUrl = resolvedState.baseUrl;
					} else {
						delete ctxRef.current.config.baseUrl;
					}
					if (resolvedState.apiKey) {
						ctxRef.current.config.apiKey = resolvedState.apiKey;
					} else {
						delete ctxRef.current.config.apiKey;
					}
					if (
						resolvedState.provider === "custom" &&
						resolvedState.customProvider?.baseUrl
					) {
						ctxRef.current.config.customProvider = resolvedState.customProvider;
					} else {
						delete ctxRef.current.config.customProvider;
					}
					ctxRef.current.messages = data.messages;
					// Seed context with the loaded historical messages
					ctxRef.current.messages = JSON.parse(JSON.stringify(data.messages));
					ctxRef.current.appendOnlyLog = JSON.parse(
						JSON.stringify(data.appendOnlyLog || data.messages),
					);

					if (data.context) {
						ctxRef.current.workingDir =
							data.context.workingDir || process.cwd();
						ctxRef.current.metadata = {
							...ctxRef.current.metadata,
							...data.context.metadata,
						};
						ctxRef.current.readFilesThisSession = new Set(
							data.context.readFilesThisSession || [],
						);
					}

					if (data.metadata.model) {
						setCtxModel(resolvedModel);
					}
					setMessages((m) => [
						...m,
						{
							id: msgIdRef.current++,
							role: "system",
							content: `Loaded session: ${data.metadata.name || id.slice(0, 8)} (${loadedMsgs.length} messages)`,
						},
					]);
				} else {
					setMessages((m) => [
						...m,
						{
							id: msgIdRef.current++,
							role: "system",
							content: `Session not found or empty: ${id}`,
						},
					]);
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				setMessages((m) => [
					...m,
					{
						id: msgIdRef.current++,
						role: "system",
						content: `Error loading session ${id}: ${message}`,
					},
				]);
			} finally {
				setLoading(false);
			}
		},
		[
			runtimeProvider,
			runtimeCustomProvider,
			cfg.customProvider,
			ctxModel,
			applyRuntimeProviderState,
			persistRuntimeProviderState,
			resolveRuntimeProviderState,
			getActiveConfig,
			setMessages,
			setSessionId,
			setShowWelcome,
			setThinking,
			setShowThinking,
			setSessionCost,
			setLoading,
			setCtxModel,
			diffPreview,
		],
	);

	const handleLoad = useCallback(
		async (targetSessionId?: string) => {
			if (typeof targetSessionId === "string" && targetSessionId.trim()) {
				await loadSessionById(targetSessionId.trim());
				return;
			}
			setLoading(true);
			const sessions = await sessionManager.listSessions();
			if (sessions.length === 0) {
				setMessages((m) => [
					...m,
					{
						id: msgIdRef.current++,
						role: "system",
						content: "No saved sessions. Use /save to save current session.",
					},
				]);
			} else {
				const limit = 30;
				const displaySessions = sessions.slice(0, limit);
				const list = displaySessions
					.map(
						(s, i) =>
							`${i + 1}. ${s.name || s.id.slice(0, 8)} (${s.messageCount} msgs)`,
					)
					.join("\n");
				setMessages((m) => [
					...m,
					{
						id: msgIdRef.current++,
						role: "system",
						content: `Saved sessions (showing recent ${displaySessions.length} of ${sessions.length}):\n${list}\n\nUse: /load <id> | /search <query>`,
					},
				]);
			}
			setLoading(false);
		},
		[loadSessionById, setLoading, setMessages],
	);

	const handleSearchSessions = useCallback(
		async (query: string) => {
			setLoading(true);
			const results = await sessionManager.searchSessions(query);
			const limit = 30;
			const displaySessions = results.slice(0, limit);
			const table = formatSessionsTable(displaySessions);
			setMessages((m) => [
				...m,
				{
					id: msgIdRef.current++,
					role: "system",
					content:
						results.length > 0 ? table : `No sessions found for "${query}"`,
				},
			]);
			setLoading(false);
		},
		[setLoading, setMessages],
	);

	const commands = useMemo(
		() =>
			createCommands({
				onCost: handleShowCost,
				onModel: handleModelSwitch,
				onClear: handleClear,
				onExit: () => {
					console.log();
					console.log(chalk.hex(GOLD)(costTracker.getSessionSummary()));
					console.log(chalk.hex(SAND)(getTelemetry().getSummary()));
					saveCacheToDisk();
					onExit();
					exit();
				},
				onHelp: handleShowHelp,
				onSessions: handleShowSessions,
				onModels: handleShowModels,
				onSave: handleSave,
				onLoad: handleLoad,
				onProvider: handleProviderSwitch,
				onProviders: () => handleProviderSwitch(),
				onStats: handleShowStats,
				onCompact: handleCompact,
				onThinking: handleThinking,
				onPlan: handlePlan,
				onSkills: async () => {
					const ctx = await ensureContext();
					const result = await runOneShot(ctx, "/skills");
					setMessages((m) => [
						...m,
						{ id: msgIdRef.current++, role: "system", content: result },
					]);
				},
				onConfig: handleConfig,
				onDashboard: () => setShowDashboard((prev) => !prev),
				getAvailableModels: async () => {
					// We import dynamically to avoid top-level load of models
					const { listModelsForProvider } = await import("../../api/models.js");
					const { globalConfig } = await import("../../config/index.js");
					const provider = globalConfig.get("provider") || "openrouter";
					const apiKeys = globalConfig.get("apiKeys") || {};
					const apiKey = apiKeys[provider as keyof typeof apiKeys] as
						| string
						| undefined;

					const liveModels = await listModelsForProvider(provider, {
						apiKey,
						baseUrl: globalConfig.get("apiBaseUrl"),
					});
					return liveModels.map((m) => ({ id: m.id, name: m.name || m.id }));
				},
				getSavedSessions: async () => {
					const { sessionManager } = await import("../../session/manager.js");
					const sessions = await sessionManager.listSessions();
					return sessions.map((s) => ({
						id: s.id,
						name: s.name || s.id,
						date: new Date(s.updatedAt).toLocaleString(),
					}));
				},
			}),
		[
			handleShowCost,
			handleModelSwitch,
			handleClear,
			onExit,
			exit,
			handleShowHelp,
			handleShowSessions,
			handleShowModels,
			handleProviderSwitch,
			handleSave,
			handleLoad,
			handleShowStats,
			handleCompact,
			handleThinking,
			handlePlan,
			handleConfig,
			ensureContext,
			setMessages,
			setShowDashboard,
		],
	);

	// Calculate command suggestions count to dynamically adjust layout (now 0 because palette handles it)
	const suggestionsCount = 0;

	// Account for command palette height if open
	const paletteHeight = showCommandPalette ? 16 : 0;

	const chatViewportHeight = Math.max(
		3,
		terminalHeight -
			headerHeight -
			inputHeight -
			4 -
			headerScrollHeight -
			warningsHeight -
			suggestionsCount -
			paletteHeight,
	);
	const contentMaxWidth = Math.max(40, terminalWidth - 4);

	// We can now use computeMessageLines directly since it caches results,
	// preventing the UI from hanging on long responses.
	const totalMessageLines = useMemo(() => {
		let lines = 0;
		for (const msg of messages) {
			lines += computeMessageLines(msg, contentMaxWidth);
		}
		if (showWelcome) {
			lines += messages.length > 0 ? 3 : 12;
		}
		return lines;
	}, [messages, contentMaxWidth, showWelcome]);

	// Keep scroll offset bound to total lines
	useEffect(() => {
		if (messagesEndRef.current) {
			setScrollOffset(0);
		} else {
			setScrollOffset((prev) => {
				const maxOff = Math.max(0, totalMessageLines - chatViewportHeight);
				return Math.min(prev, maxOff);
			});
		}
	}, [totalMessageLines, chatViewportHeight, setScrollOffset]);

	useEffect(() => {
		setHistory(loadHistory());

		let mounted = true;
		const controller = new AbortController();

		async function initSession() {
			try {
				const recentId = continueSession
					? await sessionManager.getRecentSession(process.cwd())
					: null;
				if (recentId && mounted && !controller.signal.aborted) {
					const data = await sessionManager.loadSession(recentId);
					if (
						data &&
						data.messages.length > 0 &&
						mounted &&
						!controller.signal.aborted
					) {
						const loadedProvider = data.metadata.provider?.trim().toLowerCase();
						const loadedBaseUrl = data.metadata.baseUrl?.trim();
						const loadedCustomProvider = normalizeCustomProvider(
							data.metadata.customProvider,
						);
						const nextProvider = loadedProvider || runtimeProvider;
						const nextState = resolveRuntimeProviderState(nextProvider, {
							baseUrl: loadedBaseUrl || "",
							customProvider:
								loadedCustomProvider ||
								runtimeCustomProvider ||
								normalizeCustomProvider(cfg.customProvider),
						});
						applyRuntimeProviderState(nextState);

						const loadedMsgs = data.messages
							.filter((m) => m.role === "user" || m.role === "assistant")
							.map((m, i) => ({
								id: i,
								role: m.role,
								content:
									typeof m.content === "string"
										? m.content
										: JSON.stringify(m.content),
							}));
						if (loadedMsgs.length > 0) {
							setMessages(loadedMsgs);
							msgIdRef.current = loadedMsgs.length;
							setShowWelcome(false);
							setSessionId(recentId);
							if (data.metadata.model) {
								setCtxModel(data.metadata.model);
							}

							// Seed the AgentContext behind the scenes
							ctxRef.current = await createAgentContext(
								process.cwd(),
								{
									...getActiveConfig(),
									provider: nextState.provider,
									baseUrl: nextState.baseUrl,
									apiKey: nextState.apiKey,
									customProvider:
										nextState.provider === "custom" &&
										nextState.customProvider?.baseUrl
											? nextState.customProvider
											: undefined,
									model: data.metadata.model || ctxModel,
									maxIterations: 50,
									maxTokens: 4096,
									permissions: {
										defaultMode: "trust",
										alwaysAllow: [],
										alwaysDeny: [],
										trustedMode: true,
									},
								},
								diffPreview,
								companionMode,
							);
							ctxRef.current.messages = JSON.parse(
								JSON.stringify(data.messages),
							);

							return;
						}
					}
				}

				if (mounted && !controller.signal.aborted) {
					const bootstrap = resolveRuntimeProviderState();
					const id = await sessionManager.createSession(
						process.cwd(),
						ctxModel,
						undefined,
						{
							provider: bootstrap.provider,
							baseUrl: bootstrap.baseUrl,
							customProvider:
								bootstrap.provider === "custom"
									? bootstrap.customProvider
									: undefined,
						},
					);
					setSessionId(id);
				}
			} catch (error) {
				if (error instanceof Error && error.name !== "AbortError") {
					console.error("Session initialization failed:", error);
				}
			}
		}
		initSession();

		return () => {
			mounted = false;
			controller.abort();
			abortActiveRequest();
			if (batchTimerRef.current) {
				clearTimeout(batchTimerRef.current);
				batchTimerRef.current = null;
			}
		};
	}, [
		continueSession,
		runtimeProvider,
		runtimeCustomProvider,
		cfg.customProvider,
		resolveRuntimeProviderState,
		applyRuntimeProviderState,
		ctxModel,
		setHistory,
		setMessages,
		setShowWelcome,
		setSessionId,
		setCtxModel,
		abortActiveRequest,
		diffPreview,
		getActiveConfig,
	]);

	useEffect(() => {
		const questionResolver = async (
			questions: QuestionData[],
		): Promise<string[]> => {
			return new Promise((resolve, reject) => {
				setPendingQuestion({ questions, resolve, reject });
			});
		};
		questionResolverRef.current = questionResolver;
		setQuestionResolver(questionResolver);
		const permissionResolver = permissionResolverRef.current;
		if (permissionResolver) {
			setPermissionResolver(permissionResolver);
		}

		return () => {
			setQuestionResolver(async () => {
				throw new Error("UI disconnected.");
			});
			setPermissionResolver(async (_req, isDangerous) => {
				return !isDangerous; // Default fallback if UI unmounts
			});
		};
	}, [questionResolverRef, permissionResolverRef, setPendingQuestion]);

	const _handleQuestionAnswer = useCallback(
		async (questionIdx: number, answer: string | string[]) => {
			if (!pendingQuestion) return;

			const { questions, resolve } = pendingQuestion;
			const answers: string[] = [];

			for (let i = 0; i < questions.length; i++) {
				if (i === questionIdx) {
					if (Array.isArray(answer)) {
						answers.push(...answer);
					} else {
						answers.push(answer);
					}
				}
			}

			setPendingQuestion(null);
			resolve(answers);
		},
		[pendingQuestion, setPendingQuestion],
	);

	const _handleQuestionCancel = useCallback(() => {
		if (!pendingQuestion) return;
		pendingQuestion.reject(new Error("Question cancelled"));
		setPendingQuestion(null);
	}, [pendingQuestion, setPendingQuestion]);

	// For performance, we only render the messages that intersect the viewport plus a buffer.
	// The line estimate is intentionally cheap (no markdown rendering) to avoid hanging
	// the UI when long final responses are streamed.
	const visibleMessages = useMemo(() => {
		const linesNeeded = chatViewportHeight + scrollOffset + 20;
		const avgCharsPerLine = Math.max(20, contentMaxWidth - 4);
		const estimateMsgLines = (msg: any) => {
			let l = 1;
			const blocks = msg.blocks;
			if (blocks && blocks.length > 0) {
				for (const block of blocks) {
					if (block.type === "text") {
						const text =
							typeof block.content === "string"
								? block.content
								: String(block.content || "");
						l +=
							Math.max(1, Math.ceil(text.length / avgCharsPerLine)) +
							(text.match(/\n/g) || []).length;
					} else if (block.type === "reasoning") {
						l +=
							2 +
							Math.max(
								1,
								Math.ceil(
									String(block.content || "").length /
										Math.max(10, contentMaxWidth - 5),
								),
							);
					} else if (block.type === "tool") {
						l += 8;
					}
				}
			} else if (typeof msg.content === "string") {
				const text = msg.content;
				l +=
					Math.max(1, Math.ceil(text.length / avgCharsPerLine)) +
					(text.match(/\n/g) || []).length;
			}
			return l + 1;
		};
		let accumulatedLines = 0;
		let sliceIndex = messages.length;
		for (let i = messages.length - 1; i >= 0; i--) {
			accumulatedLines += estimateMsgLines(messages[i]);
			sliceIndex = i;
			if (accumulatedLines >= linesNeeded) break;
		}
		return messages.slice(
			Math.min(sliceIndex, Math.max(0, messages.length - 50)),
		);
	}, [messages, scrollOffset, chatViewportHeight, contentMaxWidth]);

	const scrollToBottom = useCallback(() => {
		messagesEndRef.current = true;
		setScrollOffset(0);
	}, [setScrollOffset]);

	const scrollToTop = useCallback(() => {
		messagesEndRef.current = false;
		setScrollOffset(Math.max(0, totalMessageLines - chatViewportHeight));
	}, [totalMessageLines, chatViewportHeight, setScrollOffset]);

	const scrollPageUp = useCallback(() => {
		messagesEndRef.current = false;
		const maxOff = Math.max(0, totalMessageLines - chatViewportHeight);
		setScrollOffset((off) => Math.min(maxOff, off + chatViewportHeight));
	}, [totalMessageLines, chatViewportHeight, setScrollOffset]);

	const scrollPageDown = useCallback(() => {
		setScrollOffset((off) => {
			const newOff = Math.max(0, off - chatViewportHeight);
			if (newOff <= 0) messagesEndRef.current = true;
			return newOff;
		});
	}, [chatViewportHeight, setScrollOffset]);

	const scrollLineUp = useCallback(() => {
		messagesEndRef.current = false;
		const maxOff = Math.max(0, totalMessageLines - chatViewportHeight);
		setScrollOffset((off) => Math.min(maxOff, off + 3)); // Scroll by 3 for smoothness
	}, [totalMessageLines, chatViewportHeight, setScrollOffset]);

	const scrollLineDown = useCallback(() => {
		setScrollOffset((off) => {
			const newOff = Math.max(0, off - 3); // Scroll by 3 for smoothness
			if (newOff <= 0) messagesEndRef.current = true;
			return newOff;
		});
	}, [setScrollOffset]);

	useEffect(() => {
		if (messagesEndRef.current) {
			scrollToBottom();
		}
	}, [scrollToBottom]);

	useChatInput({
		input,
		setInput,
		cursorPos,
		setCursorPos,
		showCommandPalette,
		setShowCommandPalette,
		history,
		setHistory,
		historyIndex,
		setHistoryIndex,
		inputBeforeHistoryRef,
		commands,
		sessionId,
		ctxRef,
		sessionManager,
		costTracker,
		onExit,
		exit,
		selectionStart,
		setSelectionStart,
		selectionEnd,
		setSelectionEnd,
		loading,
		scrollPageUp,
		scrollPageDown,
		scrollLineUp,
		scrollLineDown,
		scrollToTop,
		scrollToBottom,
		resetConversation,
		send,
		saveHistory,
		showConfigEditor,
		showSessionList,
		pendingQuestion,
	});

	async function send(text: string) {
		setInput("");
		setCursorPos(0);
		messagesEndRef.current = true;

		if (text.startsWith("/")) {
			const cmd = text.toLowerCase().trim();

			if (["/exit", "/quit", "/q"].includes(cmd)) {
				console.log();
				console.log(chalk.hex(GOLD)(costTracker.getSessionSummary()));
				onExit();
				exit();
				return;
			}

			if (cmd === "/clear") {
				await resetConversation();
				return;
			}

			if (cmd === "/mouse") {
				if (onToggleMouse) {
					onToggleMouse();
					setMessages((m) => [
						...m,
						{
							id: msgIdRef.current++,
							role: "system",
							content: `Mouse tracking is now ${mouseEnabled ? "DISABLED" : "ENABLED"}. ${mouseEnabled ? "You can now use your terminal's native selection to copy text." : ""}`,
						},
					]);
				} else {
					setMessages((m) => [
						...m,
						{
							id: msgIdRef.current++,
							role: "system",
							content: "Mouse toggle is not supported in this environment.",
						},
					]);
				}
				return;
			}

			if (cmd === "/copy") {
				// Find the last assistant message
				const lastAssistantMsg = [...messages]
					.reverse()
					.find((m) => m.role === "assistant");
				if (lastAssistantMsg) {
					try {
						clipboardy.writeSync(lastAssistantMsg.content);
						setMessages((m) => [
							...m,
							{
								id: msgIdRef.current++,
								role: "system",
								content:
									"Copied the last assistant response to your clipboard! 📋",
							},
						]);
					} catch (err) {
						setMessages((m) => [
							...m,
							{
								id: msgIdRef.current++,
								role: "system",
								content: `Failed to copy to clipboard: ${err instanceof Error ? err.message : String(err)}`,
							},
						]);
					}
				} else {
					setMessages((m) => [
						...m,
						{
							id: msgIdRef.current++,
							role: "system",
							content: "No assistant messages found to copy.",
						},
					]);
				}
				return;
			}

			if (cmd === "/cost") {
				const stats = costTracker.getSessionStats();
				setMessages((m) => [
					...m,
					{
						id: msgIdRef.current++,
						role: "system",
						content: `Session Cost:\n  Requests: ${stats.requestCount}\n  Tokens: ${(stats.totalPromptTokens + stats.totalCompletionTokens).toLocaleString()}\n  Cost: $${stats.totalCost.toFixed(4)}${stats.totalCacheReadTokens > 0 ? `\n  Cache savings: ${stats.totalCacheReadTokens.toLocaleString()} tokens` : ""}`,
					},
				]);
				return;
			}

			if (cmd === "/stats") {
				const telemetry = getTelemetry();
				const summary = telemetry.getSummary();
				setMessages((m) => [
					...m,
					{
						id: msgIdRef.current++,
						role: "system",
						content: summary,
					},
				]);
				return;
			}

			if (cmd === "/help") {
				setMessages((m) => [
					...m,
					{
						id: msgIdRef.current++,
						role: "system",
						content: formatHelpOutput(),
					},
				]);
				return;
			}

			if (cmd === "/providers") {
				await handleProviderSwitch();
				return;
			}

			if (text.toLowerCase().startsWith("/provider ")) {
				const requestedProvider = text.slice(10).trim();
				await handleProviderSwitch(requestedProvider);
				return;
			}

			if (cmd === "/provider") {
				await handleProviderSwitch();
				return;
			}

			if (cmd === "/sessions") {
				setLoading(true);
				try {
					const sessions = await sessionManager.listSessions();
					setSavedSessions(sessions);
					setShowSessionList(true);
				} catch (err) {
					setMessages((m) => [
						...m,
						{
							id: msgIdRef.current++,
							role: "system",
							content: `❌ Error loading sessions: ${err}`,
						},
					]);
				} finally {
					setLoading(false);
				}
				return;
			}

			if (text.toLowerCase().startsWith("/search ")) {
				const query = text.slice(8).trim();
				await handleSearchSessions(query);
				return;
			}

			if (text.toLowerCase() === "/auth gemini") {
				try {
					const { authenticateGoogleOAuth } = await import(
						"../../api/oauth.js"
					);
					setMessages((m) => [
						...m,
						{
							id: msgIdRef.current++,
							role: "system",
							content: "Launching browser for Google Authentication...",
						},
					]);
					await authenticateGoogleOAuth();
					setMessages((m) => [
						...m,
						{
							id: msgIdRef.current++,
							role: "system",
							content:
								"Google Authentication successful! You can now use Gemini models.",
						},
					]);
				} catch (err) {
					setMessages((m) => [
						...m,
						{
							id: msgIdRef.current++,
							role: "system",
							content: `Google Authentication failed: ${err instanceof Error ? err.message : String(err)}`,
						},
					]);
				}
				return;
			}

			if (cmd === "/reset-key") {
				fs.rmSync(CONFIG_PATH, { force: true });
				setMessages((m) => [
					...m,
					{
						id: msgIdRef.current++,
						role: "system",
						content: "Config reset. Restart tehuti to enter a new API key.",
					},
				]);
				return;
			}

			if (cmd === "/config") {
				setShowConfigEditor(true);
				return;
			}

			if (text.toLowerCase().startsWith("/save")) {
				const name = text.slice(5).trim() || undefined;
				if (sessionId && ctxRef.current) {
					await sessionManager.saveSession(sessionId, ctxRef.current, name);
					setMessages((m) => [
						...m,
						{
							id: msgIdRef.current++,
							role: "system",
							content: `Session saved: ${name || sessionId.slice(0, 8)}`,
						},
					]);
				}
				return;
			}

			if (text.toLowerCase().startsWith("/load ")) {
				const id = text.slice(6).trim();
				await loadSessionById(id);
				return;
			}

			if (cmd === "/model") {
				setMessages((m) => [
					...m,
					{
						id: msgIdRef.current++,
						role: "system",
						content:
							"Use: /model <model-name> to switch models.\nExample: /model deepseek-v4-flash\n\nUse /models to see available options.",
					},
				]);
				return;
			}

			if (cmd === "/models") {
				await handleShowModels();
				return;
			}

			if (text.toLowerCase().startsWith("/model ")) {
				const m = text.slice(7).trim();
				if (m) {
					const resolvedState = resolveRuntimeProviderState();
					setCtxModel(m);
					persistRuntimeProviderState(resolvedState, { model: m });
					if (ctxRef.current) {
						ctxRef.current.config.model = m;
					}
					saveGlobalConfig({ model: m });
					setMessages((msgs) => [
						...msgs,
						{ id: msgIdRef.current++, role: "system", content: `Model: ${m}` },
					]);
				}
				return;
			}

			setMessages((m) => [
				...m,
				{
					id: msgIdRef.current++,
					role: "system",
					content: `Unknown command: ${text}\nType /help for commands.`,
				},
			]);
			return;
		}

		const userMsgId = msgIdRef.current++;
		const assistantMsgId = msgIdRef.current++;
		const request = beginRequest();
		const requestId = request.requestId;
		const requestController = request.controller;

		setMessages((m) => [
			...m, 
			{ id: userMsgId, role: "user", content: text },
			{
				id: assistantMsgId,
				role: "assistant",
				content: "",
				toolCalls: [],
				blocks: [],
			}
		]);
		setLoading(true);
		setError("");
		setThinking("");
		setShowThinking(false);
		setOperationLabel("Tehuti is thinking...");
		setProgress(0);

		streamingContentRef.current = "";
		streamingMsgIdRef.current = assistantMsgId;
		batchedTokensRef.current = "";

		try {
			if (!ctxRef.current) {
				ctxRef.current = await createAgentContext(
					process.cwd(),
					{
						...getActiveConfig(),
						maxIterations: 50,
						maxTokens: 4096,
						permissions: {
							defaultMode: "trust",
							alwaysAllow: [],
							alwaysDeny: [],
							trustedMode: true,
						},
					},
					diffPreview,
					companionMode,
				);
			}

			let response = "";
			const toolCallsInfo: Array<{
				id: string;
				name: string;
				description: string;
				result: unknown;
				isExpanded: boolean;
			}> = [];

			const result = await runAgentLoop(ctxRef.current, text, {
				onToken: (t) => {
					if (
						!isCurrentRequest(requestId, requestController.signal) ||
						requestController.signal.aborted
					) {
						return;
					}
					response += t;
					batchToken(t);
				},
				onToolCall: (id, name, args) => {
					if (
						!isCurrentRequest(requestId, requestController.signal) ||
						requestController.signal.aborted
					) {
						return;
					}
					flushBatchedTokens();
					const toolDesc = formatToolCall(name, args);
					toolCallsInfo.push({
						id,
						name,
						description: toolDesc,
						result: null,
						isExpanded: false,
					});

					setMessages((m) =>
						m.map((msg) => {
							if (msg.id !== assistantMsgId) return msg;
							const blocks = msg.blocks ? [...msg.blocks] : [];
							blocks.push({
								type: "tool",
								id,
								name,
								description: toolDesc,
								result: null,
							});
							return { ...msg, toolCalls: [...toolCallsInfo], blocks };
						}),
					);

					setThinking(`  ${toolDesc}`);
					setShowThinking(true);
				},
				onToolResult: (id, _name, result) => {
					if (
						!isCurrentRequest(requestId, requestController.signal) ||
						requestController.signal.aborted
					) {
						return;
					}
					flushBatchedTokens();

					const safeResult = compactToolResultForUi(result);

					const tcInfo = toolCallsInfo.find((t) => t.id === id);
					if (tcInfo) {
						tcInfo.result = safeResult;
					}

					setMessages((m) =>
						m.map((msg) => {
							if (msg.id !== assistantMsgId) return msg;
							const blocks = msg.blocks ? [...msg.blocks] : [];
							const idx = blocks.findIndex(
								(b) => b.type === "tool" && b.id === id,
							);
							if (idx !== -1) {
								const toolBlock = blocks[idx];
								if (toolBlock.type === "tool") {
									blocks[idx] = { ...toolBlock, result: safeResult };
								}
							}
							return { ...msg, toolCalls: [...toolCallsInfo], blocks };
						}),
					);

					setThinking("");
					setShowThinking(false);
				},
				onThinking: (content) => {
					if (
						!isCurrentRequest(requestId, requestController.signal) ||
						requestController.signal.aborted
					) {
						return;
					}
					if (content.length > 0) {
						setThinking(`Thinking...`);
						setShowThinking(true);

						setMessages((m) =>
							m.map((msg) => {
								if (msg.id !== assistantMsgId) return msg;
								const blocks = msg.blocks ? [...msg.blocks] : [];
								const lastBlock = blocks[blocks.length - 1];
								if (lastBlock && lastBlock.type === "reasoning") {
									blocks[blocks.length - 1] = {
										...lastBlock,
										content: truncateMiddle(
											lastBlock.content + content,
											UI_MAX_REASONING_CHARS,
											"truncated for UI memory",
										),
									};
								} else {
									blocks.push({
										type: "reasoning",
										content: truncateMiddle(
											content,
											UI_MAX_REASONING_CHARS,
											"truncated for UI memory",
										),
									});
								}
								return { ...msg, blocks };
							}),
						);
					}
				},
				onProgress: (progress, label) => {
					if (
						!isCurrentRequest(requestId, requestController.signal) ||
						requestController.signal.aborted
					) {
						return;
					}
					setProgress(progress);
					setOperationLabel(label);
				},
				signal: requestController.signal,
			});

			if (!isCurrentRequest(requestId, requestController.signal)) {
				streamingMsgIdRef.current = null;
				streamingContentRef.current = "";
				return;
			}
			flushBatchedTokens();

			// Prefer the streaming accumulator we already wrote into the message.
			// result.content is the API's final string; response is our local
			// accumulator. If either is missing, fall back to what is already
			// on the message so we never blank out a long final response.
			const streamedContent = streamingContentRef.current;
			const finalContent = truncateMiddle(
				streamedContent || result?.content || response || "",
				UI_MAX_TEXT_CHARS,
				"truncated for UI memory",
			);
			const resultError =
				result && typeof result === "object" && "error" in result
					? String((result as Record<string, unknown>).error)
					: "";
			if (
				(!finalContent && !response) ||
				(result.success === false && resultError)
			) {
				setMessages((m) =>
					m.map((msg) =>
						msg.id === assistantMsgId
							? {
									...msg,
									content: resultError
										? `Error: ${resultError}`
										: `No response received. Check your API key with /reset-key or verify network connectivity.`,
								}
							: msg,
					),
				);
			} else {
				setMessages((m) =>
					m.map((msg) => {
						if (msg.id !== assistantMsgId) return msg;
						let blocks = msg.blocks ? [...msg.blocks] : [];
						if (blocks.length === 0 && finalContent) {
							blocks = [{ type: "text", content: finalContent }];
						}
						blocks = blocks.map((block) =>
							compactBlockForUi(block as UiBlock, true),
						);
						// Preserve tool call results. The blocks array holds the
						// canonical tool results; mirror them into the top-level
						// toolCalls for backward compatibility with older render
						// paths. Wiping them to null previously caused the agentic
						// context to appear empty in the UI for long sessions.
						const toolCallsWithResults = toolCallsInfo.map((toolCall) => {
							const matchingBlock = blocks.find(
								(b) => b.type === "tool" && b.id === toolCall.id,
							);
							if (matchingBlock && matchingBlock.type === "tool") {
								return { ...toolCall, result: matchingBlock.result };
							}
							return toolCall;
						});
						return {
							...msg,
							content: finalContent || `Task completed.`,
							toolCalls: toolCallsWithResults,
							blocks,
						};
					}),
				);
			}

			streamingMsgIdRef.current = null;
			streamingContentRef.current = "";
		} catch (e) {
			const error = e instanceof Error ? e : new Error(String(e));
			if (!isCurrentRequest(requestId, requestController.signal)) {
				return;
			}
			if (error.name === "AbortError") {
				streamingMsgIdRef.current = null;
				streamingContentRef.current = "";
				return;
			}
			debug.log("chat", "Agent error:", error);
			debug.log("chat", "Error stack:", error.stack);

			flushBatchedTokens();

			let errorContent = "An unexpected error occurred";
			let suggestions: string[] = [];

			if (error instanceof APIError) {
				errorContent = error.message;
				if (error.suggestions) {
					suggestions = error.suggestions;
				}
			} else if (error instanceof AgentError) {
				errorContent = error.message;
				if (error.suggestions) {
					suggestions = error.suggestions;
				}
			} else if (error instanceof ConfigError) {
				errorContent = error.message;
				if (error.suggestions) {
					suggestions = error.suggestions;
				}
			} else {
				errorContent = error.message;
				suggestions = [
					"Check your internet connection",
					"Try again later",
					"Run with --debug for more details",
				];
			}

			let fullContent = `Error: ${errorContent}`;
			if (suggestions.length > 0) {
				fullContent += "\n\nSuggestions:";
				suggestions.forEach((suggestion, index) => {
					fullContent += `\n  ${index + 1}. ${suggestion}`;
				});
			}

			setMessages((m) =>
				m.map((msg) =>
					msg.id === assistantMsgId
						? { ...msg, content: fullContent, status: "error" }
						: msg,
				),
			);
			streamingMsgIdRef.current = null;
		}

		const shouldFinalizeRequest =
			isCurrentRequest(requestId, requestController.signal) ||
			requestControllerRef.current === requestController ||
			(requestController.signal.aborted &&
				requestControllerRef.current === null);
		if (shouldFinalizeRequest) {
			setProgress(100);
			setLoading(false);
			setShowThinking(false);
			setOperationLabel("");
			requestControllerRef.current = null;
		}

		if (sessionId && ctxRef.current) {
			void sessionManager
				.saveSession(sessionId, ctxRef.current)
				.catch((err) => {
					debug.log("chat", "Auto-save failed:", err);
				});
		}
	}

	const deferredVisibleMessages = useDeferredValue(visibleMessages);

	const messageElements = useMemo(() => {
		return deferredVisibleMessages.map((m) => {
			let header: React.ReactNode;
			let content: React.ReactNode[];

			if (m.role === "user") {
				const label = `${DECORATIVE.feather} You`;
				const padLen = Math.max(10, contentMaxWidth - label.length - 2);
				const divider = "─".repeat(padLen);
				header = React.createElement(
					Box,
					{ flexDirection: "row", alignItems: "center", marginBottom: 0.5 },
					React.createElement(Text, { bold: true, color: CORAL }, `${label} `),
					React.createElement(Text, { color: CORAL, dimColor: true }, divider),
				);
				content = [
					React.createElement(
						Text,
						{ key: 0, color: CORAL, wrap: "wrap" },
						m.content,
					),
				];
			} else if (m.role === "system") {
				const label = `${DECORATIVE.scroll} System`;
				const padLen = Math.max(
					10,
					contentMaxWidth - label.length - 2 - (m.status ? 10 : 0),
				);
				const divider = "─".repeat(padLen);
				header = React.createElement(
					Box,
					{
						flexDirection: "row",
						alignItems: "center",
						marginBottom: 0.5,
					},
					React.createElement(
						Text,
						{ bold: true, color: SAND, dimColor: true },
						`${label} `,
					),
					m.status &&
						React.createElement(
							Box,
							{ marginRight: 1 },
							React.createElement(StatusIndicator, { status: m.status }),
						),
					React.createElement(Text, { color: SAND, dimColor: true }, divider),
				);
				if (m.content.startsWith("[SESSION_LIST]")) {
					content = [
						React.createElement(
							Box,
							{ key: 0, flexDirection: "column" },
							...renderMarkdown(m.content, contentMaxWidth, `msg-${m.id}`),
						),
					];
				} else {
					content = [
						React.createElement(
							Text,
							{ key: 0, dimColor: true, wrap: "wrap" },
							m.content,
						),
					];
				}
			} else {
				const label = `${DECORATIVE.ibis} Tehuti`;
				const padLen = Math.max(
					10,
					contentMaxWidth - label.length - 2 - (m.status ? 10 : 0),
				);
				const divider = "─".repeat(padLen);
				header = React.createElement(
					Box,
					{
						flexDirection: "row",
						alignItems: "center",
						marginBottom: 0.5,
					},
					React.createElement(Text, { bold: true, color: GREEN }, `${label} `),
					m.status &&
						React.createElement(
							Box,
							{ marginRight: 1 },
							React.createElement(StatusIndicator, { status: m.status }),
						),
					React.createElement(Text, { color: GREEN, dimColor: true }, divider),
				);

				if (m.blocks && m.blocks.length > 0) {
					content = [];
					m.blocks.forEach((block, bIdx) => {
						if (block.type === "text") {
							const subBlocks = parseContentBlocks(block.content);
							subBlocks.forEach((subBlock, sbIdx) => {
								if (subBlock.type === "text") {
									content.push(
										...renderMarkdown(
											subBlock.content,
											contentMaxWidth,
											`msg-${m.id}-blk-${bIdx}-sub-${sbIdx}`,
										),
									);
								} else if (subBlock.type === "reasoning") {
									const borderLine = "─".repeat(
										Math.max(10, contentMaxWidth - 22),
									);
									content.push(
										React.createElement(
											Box,
											{
												flexDirection: "column",
												marginTop: 0.5,
												marginBottom: 0.5,
												key: `msg-${m.id}-reasoning-${bIdx}-${sbIdx}`,
											},
											React.createElement(
												Box,
												{ flexDirection: "row", alignItems: "center" },
												React.createElement(Text, { color: "gray" }, "  ┌─[ "),
												React.createElement(
													Text,
													{ color: "cyan" },
													`${DECORATIVE.eye} Reasoning`,
												),
												React.createElement(
													Text,
													{ color: "gray" },
													` ]${borderLine}`,
												),
											),
											React.createElement(
												Box,
												{ paddingLeft: 2, marginY: 0, flexDirection: "column" },
												...renderMarkdown(
													subBlock.content,
													contentMaxWidth - 4,
													`msg-${m.id}-reasoning-${bIdx}-${sbIdx}-md`,
												),
											),
											React.createElement(
												Box,
												{ flexDirection: "row" },
												React.createElement(
													Text,
													{ color: "gray" },
													`  └─${"─".repeat(Math.max(10, contentMaxWidth - 4))}`,
												),
											),
										),
									);
								}
							});
						} else if (block.type === "reasoning") {
							const borderLine = "─".repeat(Math.max(10, contentMaxWidth - 22));
							content.push(
								React.createElement(
									Box,
									{
										flexDirection: "column",
										marginTop: 0.5,
										marginBottom: 0.5,
										key: `msg-${m.id}-reasoning-${bIdx}`,
									},
									React.createElement(
										Box,
										{ flexDirection: "row", alignItems: "center" },
										React.createElement(Text, { color: "gray" }, "  ┌─[ "),
										React.createElement(
											Text,
											{ color: "cyan" },
											`${DECORATIVE.eye} Reasoning`,
										),
										React.createElement(
											Text,
											{ color: "gray" },
											` ]${borderLine}`,
										),
									),
									React.createElement(
										Box,
										{ paddingLeft: 2, marginY: 0, flexDirection: "column" },
										...renderMarkdown(
											block.content,
											contentMaxWidth - 4,
											`msg-${m.id}-reasoning-${bIdx}-md`,
										),
									),
									React.createElement(
										Box,
										{ flexDirection: "row" },
										React.createElement(
											Text,
											{ color: "gray" },
											`  └─${"─".repeat(Math.max(10, contentMaxWidth - 4))}`,
										),
									),
								),
							);
						} else if (block.type === "tool") {
							content.push(
								React.createElement(
									Box,
									{
										flexDirection: "column",
										marginTop: 0.5,
										marginBottom: 0.5,
										key: block.id || `tool-${bIdx}`,
									},
									React.createElement(ExpandableToolOutput, {
										toolName: getEnhancedToolName(
											block.name || "",
											block.description || "",
										),
										result: block.result,
										maxWidth: contentMaxWidth,
										status: getToolRenderStatus(block.result),
									}),
								),
							);
						}
					});
				} else {
					const subBlocks = parseContentBlocks(m.content);
					content = [];
					subBlocks.forEach((subBlock, sbIdx) => {
						if (subBlock.type === "text") {
							content.push(
								...renderMarkdown(
									subBlock.content,
									contentMaxWidth,
									`msg-${m.id}-sub-${sbIdx}`,
								),
							);
						} else if (subBlock.type === "reasoning") {
							const borderLine = "─".repeat(Math.max(10, contentMaxWidth - 22));
							content.push(
								React.createElement(
									Box,
									{
										flexDirection: "column",
										marginTop: 0.5,
										marginBottom: 0.5,
										key: `msg-${m.id}-reasoning-fallback-${sbIdx}`,
									},
									React.createElement(
										Box,
										{ flexDirection: "row", alignItems: "center" },
										React.createElement(Text, { color: "gray" }, "  ┌─[ "),
										React.createElement(
											Text,
											{ color: "cyan" },
											`${DECORATIVE.eye} Reasoning`,
										),
										React.createElement(
											Text,
											{ color: "gray" },
											` ]${borderLine}`,
										),
									),
									React.createElement(
										Box,
										{ paddingLeft: 2, marginY: 0, flexDirection: "column" },
										...renderMarkdown(
											subBlock.content,
											contentMaxWidth - 4,
											`msg-${m.id}-reasoning-fallback-${sbIdx}-md`,
										),
									),
									React.createElement(
										Box,
										{ flexDirection: "row" },
										React.createElement(
											Text,
											{ color: "gray" },
											`  └─${"─".repeat(Math.max(10, contentMaxWidth - 4))}`,
										),
									),
								),
							);
						}
					});

					if (m.toolCalls && m.toolCalls.length > 0) {
						const toolElements = React.createElement(
							Box,
							{
								flexDirection: "column",
								marginTop: 1,
								key: `tool-calls-${m.id}`,
							},
							...m.toolCalls.map((tc, idx) =>
								React.createElement(ExpandableToolOutput, {
									key: tc.id || `tool-${idx}`,
									toolName: getEnhancedToolName(
										tc.name || "",
										tc.description || "",
									),
									result: tc.result,
									maxWidth: contentMaxWidth,
									status: getToolRenderStatus(tc.result),
								}),
							),
						);
						content.push(toolElements);
					}
				}
			}

			return React.createElement(
				Box,
				{
					key: m.id,
					flexDirection: "column",
					marginBottom: 1,
					paddingTop: 0,
					paddingLeft: 1,
					borderStyle: "single",
					borderTop: false,
					borderRight: false,
					borderBottom: false,
					borderLeft: true,
					borderColor:
						m.role === "assistant" ? GOLD : m.role === "user" ? CORAL : "gray",
					width: contentMaxWidth,
					flexShrink: 1,
				},
				header,
				React.createElement(
					Box,
					{
						paddingLeft: 0,
						marginTop: 0,
						flexDirection: "column",
					},
					...content,
				),
			);
		});
	}, [deferredVisibleMessages, contentMaxWidth, loadSessionById]);

	const commandSuggestions = null;

	const renderInput = useMemo(() => {
		const historyIndicator =
			historyIndex >= 0
				? React.createElement(
						Text,
						{ color: SAND, dimColor: true },
						` [${historyIndex + 1}/${history.length}] `,
					)
				: "";

		const indicatorText = loading
			? HIEROGLYPHS.loading[0]
			: `${DECORATIVE.feather} >`;
		const indicatorColor = loading ? GOLD : CORAL;

		if (
			selectionStart !== null &&
			selectionEnd !== null &&
			selectionStart !== selectionEnd
		) {
			const start = Math.min(selectionStart, selectionEnd);
			const end = Math.max(selectionStart, selectionEnd);
			const before = input.slice(0, start);
			const selected = input.slice(start, end);
			const after = input.slice(end);

			return React.createElement(
				Text,
				{ color: indicatorColor, wrap: "wrap" },
				indicatorText,
				historyIndicator,
				" ",
				before,
				React.createElement(
					Text,
					{ backgroundColor: "gray", color: "black" },
					selected,
				),
				after,
			);
		}

		const before = input.slice(0, cursorPos);
		const after = input.slice(cursorPos);
		const hint =
			!loading && input.length === 0
				? React.createElement(
						Text,
						{ color: "gray", dimColor: true },
						" Type a message, or /help for commands...",
					)
				: null;

		return React.createElement(
			Text,
			{ color: indicatorColor, wrap: "wrap" },
			indicatorText,
			historyIndicator,
			" ",
			before,
			loading ? null : "\u2588",
			after,
			hint,
		);
	}, [
		input,
		cursorPos,
		historyIndex,
		history.length,
		selectionStart,
		selectionEnd,
		loading,
	]);

	const scrollIndicator = null;

	if (showSessionList) {
		return React.createElement(SessionList, {
			sessions: savedSessions,
			onLoadSession: async (id: string) => {
				setShowSessionList(false);
				await loadSessionById(id);
			},
			onClose: () => setShowSessionList(false),
		});
	}

	return showConfigEditor
		? React.createElement(ConfigEditor, {
				config: {
					apiKey: resolveRuntimeApiKey(runtimeProvider) || "",
					model: ctxModel,
					provider: runtimeProvider,
					baseUrl: runtimeBaseUrl,
					temperature: getGlobalConfig().temperature,
					maxTokens: getGlobalConfig().maxTokens,
				},
				width: terminalWidth,
				onSave: (updates) => {
					const normalizedProvider = updates.provider
						? updates.provider.trim().toLowerCase()
						: runtimeProvider;
					const resolvedProvider = normalizedProvider || runtimeProvider;

					const rawBaseUrl =
						updates.baseUrl !== undefined
							? updates.baseUrl?.trim()
							: runtimeBaseUrl;
					const nextApiKey =
						updates.apiKey !== undefined
							? updates.apiKey.trim()
							: resolveRuntimeApiKey(resolvedProvider);
					const resolvedCustomSource =
						resolvedProvider === "custom"
							? runtimeCustomProvider ||
								normalizeCustomProvider(cfg.customProvider)
							: undefined;
					const resolvedState = resolveRuntimeProviderState(resolvedProvider, {
						baseUrl: rawBaseUrl,
						apiKey: nextApiKey,
						customProvider: resolvedCustomSource,
					});
					if (
						resolvedProvider === "custom" &&
						!resolvedState.customProvider?.baseUrl
					) {
						setMessages((m) => [
							...m,
							{
								id: msgIdRef.current++,
								role: "system",
								content:
									"Custom provider settings are incomplete. Set provider + baseUrl first.",
							},
						]);
						return;
					}

					applyRuntimeProviderState(resolvedState);

					if (updates.model?.trim()) {
						setCtxModel(updates.model);
						if (ctxRef.current) {
							ctxRef.current.config.model = updates.model;
						}
					}
					const nextModel = updates.model?.trim()
						? updates.model.trim()
						: ctxModel;
					persistRuntimeProviderState(resolvedState, { model: nextModel });
					setMessages((m) => [
						...m,
						{
							id: msgIdRef.current++,
							role: "system",
							content: "Configuration saved successfully",
						},
					]);
					setShowConfigEditor(false);
				},
				onCancel: () => {
					setShowConfigEditor(false);
				},
			})
		: React.createElement(
				Box,
				{ flexDirection: "column", width: "100%", height: "100%" },
				React.createElement(
					Box,
					{
						paddingX: 1,
						borderTop: false,
						borderLeft: false,
						borderRight: false,
						borderBottom: true,
						borderStyle: "single",
						borderColor: GOLD,
						marginBottom: 1,
					},
					React.createElement(
						Text,
						{ bold: true, color: GOLD },
						`${DECORATIVE.ibis} Tehuti`,
					),
					React.createElement(
						Text,
						{ color: SAND },
						` ${DECORATIVE.separator} ${ctxModel}`,
					),
					sessionCost > 0 &&
						React.createElement(
							Text,
							{ color: SAND, dimColor: true },
							` ${DECORATIVE.separator} $${sessionCost.toFixed(4)}`,
						),
					React.createElement(Box, { flexGrow: 1 }),
					React.createElement(
						Text,
						{ color: GRAY, dimColor: true },
						`${DECORATIVE.eye} Ctrl+P ${DECORATIVE.separator} Ctrl+C`,
					),
				),
				React.createElement(
					Box,
					{
						flexDirection: "column",
						flexGrow: 1,
						paddingX: 1,
						overflow: "hidden",
					},
					...configWarnings.map((warn, idx) =>
						React.createElement(
							Box,
							{
								key: idx,
								paddingY: 0,
								paddingX: 1,
								marginBottom: 1,
								borderStyle: "single",
								borderColor: "yellow",
							},
							React.createElement(
								Text,
								{ color: "yellow", bold: true },
								`𓂀  Warning: ${warn}`,
							),
						),
					),
					showDashboard && React.createElement(SwarmVisualizer, null),
					React.createElement(TodoList, null),
					messages.length === 0
						? React.createElement(
								Box,
								{
									flexGrow: 1,
									flexDirection: "column",
									justifyContent: "center",
									alignItems: "center",
								},
								showWelcome &&
									React.createElement(TehutiHeader, {
										model: ctxModel,
										provider: normalizedProvider,
										onModelClick: () => {
											setCommandPaletteInitialQuery("/model ");
											setShowCommandPalette(true);
										},
										onConfigClick: () => setShowConfigEditor(true),
										onCommandClick: (cmd) => {
											if (cmd === "/clear") setMessages([]);
											else if (cmd === "/exit") {
												void onExit();
												exit();
											} else if (cmd === "/help")
												setMessages((prev) => [
													...prev,
													{
														id: msgIdRef.current++,
														role: "system",
														content: formatHelpOutput(),
													},
												]);
										},
									}),
								!showWelcome &&
									React.createElement(
										Text,
										{ color: SAND, dimColor: true },
										"Type a message to begin",
									),
							)
						: React.createElement(
								Box,
								{
									ref: scrollContainerRef,
									flexDirection: "column",
									flexGrow: 1,
									overflow: "hidden",
									justifyContent: "flex-end",
								},
								React.createElement(
									Box,
									{ flexDirection: "column", marginBottom: -scrollOffset },
									showWelcome &&
										React.createElement(
											Box,
											{
												flexDirection: "column",
												alignItems: "center",
												marginBottom: 1,
											},
											React.createElement(TehutiHeader, {
												compact: true,
												model: ctxModel,
												provider: normalizedProvider,
												onModelClick: () => {
													setCommandPaletteInitialQuery("/model ");
													setShowCommandPalette(true);
												},
												onConfigClick: () => setShowConfigEditor(true),
												onCommandClick: (cmd) => {
													if (cmd === "/clear") setMessages([]);
													else if (cmd === "/exit") {
														void onExit();
														exit();
													} else if (cmd === "/help")
														setMessages((prev) => [
															...prev,
															{
																id: msgIdRef.current++,
																role: "system",
																content: formatHelpOutput(),
															},
														]);
												},
											}),
										),
									...messageElements,
								),
							),
					showThinking &&
						React.createElement(
							Box,
							{
								marginBottom: 1,
								paddingLeft: 2,
								flexDirection: "row",
								gap: 1,
								borderStyle: "single",
								borderTop: false,
								borderRight: false,
								borderBottom: false,
								borderLeft: true,
								borderColor: BRANDING.colors.gold,
							},
							React.createElement(HieroglyphSpinner, null),
							React.createElement(
								Text,
								{ color: SAND, dimColor: true },
								`${thinking.length > 150 ? `...${thinking.slice(-150)}` : thinking}`,
							),
						),
					scrollIndicator &&
						React.createElement(
							Box,
							{ justifyContent: "center" },
							scrollIndicator,
						),
					error &&
						React.createElement(
							Box,
							{
								marginTop: 1,
								paddingX: 1,
								borderStyle: "round",
								borderColor: RED,
							},
							React.createElement(
								Text,
								{ color: RED },
								`${DECORATIVE.eyeOfHorus} ${error}`,
							),
						),
					loading &&
						React.createElement(
							Box,
							{ marginTop: 1, paddingX: 1, flexDirection: "column" },
							React.createElement(
								Box,
								{
									flexDirection: "row",
									alignItems: "center",
									gap: 1,
									marginBottom: 0.5,
								},
								React.createElement(
									Text,
									{ color: GOLD },
									React.createElement(Spinner, { type: "dots" }),
								),
								React.createElement(
									Text,
									{ color: SAND, dimColor: true },
									operationLabel,
								),
							),
							React.createElement(ProgressBar, {
								value: progress,
								width: Math.min(contentMaxWidth - 10, 40),
							}),
						),
				),
				React.createElement(
					Box,
					{
						paddingX: 1,
						paddingTop: 1,
						flexDirection: "column",
					},
					showCommandPalette || showConfigEditor
						? null
						: pendingPermission
							? React.createElement(PermissionPrompt, {
									request: pendingPermission.request,
									isDangerous: pendingPermission.isDangerous,
									onAnswer: (allowed: boolean) => {
										pendingPermission.resolve(allowed);
										setPendingPermission(null);
									},
								})
							: pendingQuestion
								? React.createElement(QuestionPrompt, {
										question: pendingQuestion.questions[0],
										onAnswer: (ans) => _handleQuestionAnswer(0, ans),
										onCancel: _handleQuestionCancel,
									})
								: renderInput,
					showCommandPalette || showConfigEditor ? null : commandSuggestions,
				),
				React.createElement(CommandPalette, {
					commands,
					onSelect: handleCommandPaletteSelect,
					onClose: handleCommandPaletteClose,
					visible: showCommandPalette,
					initialQuery: commandPaletteInitialQuery,
				}),
				companionMode
					? React.createElement(
							Box,
							{
								paddingX: 1,
								borderStyle: "single",
								borderColor: "gray",
								marginTop: 1,
							},
							React.createElement(
								Text,
								{ color: "gray", dimColor: true },
								"𓋹 Companion mode active",
							),
						)
					: null,
			);
}

function App({
	companionMode,
	apiKey,
	model,
	diffPreview,
	cfg,
	continueSession,
	onExit,
}: {
	apiKey: string;
	model: string;
	diffPreview?: { showPreview: boolean; autoConfirm?: boolean };
	cfg: typeof DEFAULT_CONFIG;
	continueSession?: boolean;
	onExit: () => void;
	mouseEnabled?: boolean;
	onToggleMouse?: () => void;
	companionMode?: boolean;
}) {
	const initialMouseEnabled =
		process.env.TEHUTI_DISABLE_MOUSE !== "1" &&
		process.env.NO_MOUSE !== "1" &&
		Boolean(process.stdout.isTTY);

	const [mouseEnabled, setMouseEnabled] = useState(initialMouseEnabled);

	return React.createElement(
		MouseProvider,
		{ autoEnable: mouseEnabled },
		React.createElement(ChatUI, {
			apiKey,
			model,
			diffPreview,
			cfg,
			continueSession,
			onExit,
			mouseEnabled,
			onToggleMouse: () => setMouseEnabled(!mouseEnabled),
			companionMode,
		}),
	);
}

export function createProgram(): Command {
	const program = new Command();

	program
		.name("tehuti")
		.description("Tehuti CLI - Coding assistant powered by OpenCode Go")
		.version("0.1.0", "-v, --version")
		.option("-m, --model <model>", "Override model")
		.option(
			"-p, --provider <provider>",
			"Override provider (openrouter, kilocode, custom)",
		)
		.option("-d, --debug", "Debug mode", false)
		.option("-j, --json", "Output in JSON format (for one-shot prompts)", false)
		.option(
			"-q, --quiet",
			"Suppress tool output (only show final response)",
			false,
		)
		.option("--diff", "Show diff preview before file edits", false)
		.option("--diff-auto", "Show diff preview and auto-approve", false)
		.option("--no-mcp", "Disable MCP")
		.option("--reset-key", "Reset API key and re-prompt")
		.option("-c, --continue", "Continue the previous session automatically")
		.option("--companion", "Start in companion mode", false)
		.argument("[prompt]", "One-shot prompt")
		.action(async (prompt?: string, options?: ChatCommandOptions) => {
			const opts = options ?? {};
			const { cfg, apiKey, model, diffPreview } = await bootstrapCLI(
				prompt,
				opts,
			);

			if (!prompt && !process.stdout.isTTY) {
				consola.error(
					"Interactive mode requires a TTY. Run 'tehuti --help' for usage.",
				);
				process.exit(1);
			}

			if (prompt) {
				const ctx = await createAgentContext(process.cwd(), cfg, diffPreview);

				let outputManager: StreamingOutputManager | undefined;

				if (!opts.json && !opts.quiet) {
					outputManager = createStreamingOutputManager();
				}

				try {
					const result = await runAgentLoop(ctx, prompt, {
						onToken:
							opts.json || opts.quiet
								? undefined
								: (t) => {
										outputManager?.append(t);
									},
						onToolCall:
							opts.json || opts.quiet
								? undefined
								: (name, args) => {
										const toolDesc = formatToolCall(name, args);
										const enhancedDesc = getEnhancedToolName(name, toolDesc);
										outputManager?.writeLine("");
										outputManager?.writeLine(
											chalk.hex(CYAN)(`  ${enhancedDesc}`),
										);
									},
						onToolResult:
							opts.json || opts.quiet
								? undefined
								: (name, result) => {
										const success =
											result &&
											typeof result === "object" &&
											"success" in result
												? (result as { success: boolean }).success
												: true;
										const statusIcon = success
											? chalk.green("✓")
											: chalk.red("✗");

										const formattedResult = formatToolResult(
											result ?? "",
											outputManager?.getTerminalWidth?.() || 80,
										);

										if (formattedResult.preview) {
											outputManager?.writeLine(
												chalk.dim(`  ┌─ ${name} result:`),
											);
											outputManager?.writeLine(
												chalk.dim(formattedResult.preview),
											);
											outputManager?.writeLine(chalk.dim("  └─"));
										} else {
											outputManager?.writeLine(
												chalk.dim(`  ${statusIcon} ${name} completed`),
											);
										}
									},
						onThinking:
							opts.json || opts.quiet
								? undefined
								: (content) => {
										if (content.length > 0) {
											process.stdout.write(
												`\r\x1b[K${chalk.hex(GOLD)(HIEROGLYPHS.thinking[0])} ${chalk.hex(PURPLE)(`Thinking...`)}`,
											);
										}
									},
					});

					outputManager?.finish();

					if (opts.json) {
						console.log(
							JSON.stringify(
								{
									content: result.content,
									success: result.success,
									finishReason: result.finishReason,
									toolCalls: result.toolCalls,
									usage: result.usage,
									sessionStats: result.sessionStats,
								},
								null,
								2,
							),
						);
					}
				} catch (error) {
					outputManager?.destroy();
					throw error;
				} finally {
					await mcpManager.disconnectAll();
				}
			} else {
				const originalWrite = process.stdout.write;
				process.stdout.write = ((chunk: any, encoding?: any, cb?: any) => {
					originalWrite.call(process.stdout, "\x1b[?2026h");
					const result = originalWrite.call(
						process.stdout,
						chunk,
						encoding,
						cb,
					);
					originalWrite.call(process.stdout, "\x1b[?2026l");
					return result;
				}) as any;

				const { waitUntilExit, unmount } = render(
					React.createElement(App, {
						apiKey: apiKey || "",
						model,
						diffPreview,
						cfg,
						continueSession: opts.continue,
						companionMode: !!opts.companion,
						onExit: async () => {
							await mcpManager.disconnectAll();
						},
					}),
				);
				registerCleanupHandler(() => {
					unmount();
				});
				await waitUntilExit();
			}
		});

	program
		.command("init")
		.description("Configure and initialize Tehuti CLI settings")
		.action(async () => {
			await runSetupWizard();
		});

	program
		.command("config")
		.description("Show current config")
		.action(() => {
			const cfg = loadTehutiConfig();
			const masked = {
				...cfg,
				apiKey: cfg.apiKey
					? `${cfg.apiKey.slice(0, 10)}...${cfg.apiKey.slice(-4)}`
					: undefined,
			};
			console.log(JSON.stringify(masked, null, 2));
		});

	program
		.command("mcp")
		.description("MCP server management")
		.argument(
			"[action]",
			"Action: status, tools, connect <name>, disconnect <name>",
		)
		.argument("[name]", "Server name for connect/disconnect")
		.action(async (action, name) => {
			const cfg = await loadConfig();
			if (cfg.http) {
				updateHttpAgentConfig(cfg.http);
			}

			if (!action || action === "status") {
				const servers = cfg.mcp?.servers ?? {};
				const statuses = mcpManager.getAllServerStatuses();

				console.log();
				console.log(chalk.hex(GOLD)("  𓆣 MCP Servers"));
				console.log();

				if (Object.keys(servers).length === 0) {
					console.log(chalk.hex(SAND)("  No servers configured"));
					console.log();
					return;
				}

				for (const [serverName, serverConfig] of Object.entries(servers)) {
					const status = statuses.find((s) => s.name === serverName);
					const statusInfo = status?.status ?? "disconnected";
					const statusColor =
						statusInfo === "connected"
							? chalk.green
							: statusInfo === "connecting" || statusInfo === "reconnecting"
								? chalk.hex(SAND)
								: statusInfo === "error"
									? chalk.red
									: chalk.gray;

					const transport = serverConfig.transport ?? "stdio";
					const toolCount = mcpManager.getServer(serverName)?.tools.length ?? 0;

					console.log(`  ${statusColor("◆")} ${chalk.bold(serverName)}`);
					console.log(
						chalk.gray(`    ${transport} ◆ ${statusInfo} ◆ ${toolCount} tools`),
					);
					if (status?.lastError) {
						console.log(chalk.red(`    ✗ ${status.lastError}`));
					}
					console.log();
				}
				return;
			}

			if (action === "tools") {
				const tools = mcpManager.getAllTools();
				console.log();
				console.log(chalk.hex(GOLD)("  𓆣 MCP Tools"));
				console.log();

				if (tools.length === 0) {
					console.log(chalk.gray("  No tools available"));
					console.log();
					return;
				}

				const grouped = new Map<string, typeof tools>();
				for (const t of tools) {
					const list = grouped.get(t.serverName) ?? [];
					list.push(t);
					grouped.set(t.serverName, list);
				}

				for (const [serverName, serverTools] of grouped) {
					console.log(chalk.cyan(`  ${serverName}:`));
					for (const t of serverTools) {
						const desc = t.tool.description.slice(0, 50);
						console.log(
							chalk.gray(`    - ${t.tool.name}`) +
								chalk.dim(` ${desc}${desc.length >= 50 ? "..." : ""}`),
						);
					}
					console.log();
				}
				return;
			}

			if (action === "connect" && name) {
				const serverConfig = cfg.mcp?.servers?.[name];
				if (!serverConfig) {
					consola.error(`Server "${name}" not found in config`);
					process.exit(1);
				}

				consola.start(`Connecting to ${name}...`);
				try {
					await mcpManager.connectServer(name, serverConfig);
					consola.success(`Connected to ${name}`);
				} catch (e) {
					const msg = e instanceof Error ? e.message : String(e);
					consola.fail(`Failed to connect: ${msg}`);
				}
				return;
			}

			if (action === "disconnect" && name) {
				await mcpManager.disconnectServer(name);
				consola.success(`Disconnected from ${name}`);
				return;
			}

			if (action === "refresh" && name) {
				const tools = await mcpManager.refreshTools(name);
				consola.success(`Refreshed ${tools.length} tools from ${name}`);
				return;
			}

			console.log(
				chalk.gray(
					"  Usage: tehuti mcp [status|tools|connect <name>|disconnect <name>|refresh <name>]",
				),
			);
		});

	program.addCommand(daemonCommand());
	program.addCommand(companionCommand());

	return program;
}
