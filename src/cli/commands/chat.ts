import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as readline from "node:readline";
import chalk from "chalk";
import { Command } from "commander";
import { consola } from "consola";
import { Box, render, Text, useApp, useInput, useStdout } from "ink";
import Spinner from "ink-spinner";
import { marked } from "marked";
import type { Token } from "marked";
import React, {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	type AgentContext,
	configureHooks,
	createAgentContext,
	runAgentLoop,
} from "../../agent/index.js";
import { saveCacheToDisk } from "../../agent/cache/index.js";
import {
	type QuestionData,
	setQuestionResolver,
} from "../../agent/tools/system.js";
import { costTracker } from "../../api/index.js";
import {
	ASCII_ART,
	DECORATIVE,
	HIEROGLYPHS,
	WELCOME_MESSAGE,
} from "../../branding/index.js";
import { DEFAULT_CONFIG, loadConfig } from "../../config/index.js";
import { mcpManager } from "../../mcp/index.js";
import { sessionManager } from "../../session/manager.js";
import {
	highlightToAnsi,
	isHighlighterReady,
} from "../../terminal/highlighter.js";
import {
	createStreamingOutputManager,
	type StreamingOutputManager,
} from "../../terminal/buffered-writer.js";
import { renderMarkdownToAnsi } from "../../terminal/markdown.js";
import { debug } from "../../utils/debug.js";
import { setupErrorHandlers } from "../../utils/errors.js";
import { setDebugMode } from "../../utils/logger.js";
import { getTelemetry, resetTelemetry } from "../../utils/telemetry.js";
import {
	type CommandItem,
	CommandPalette,
	createCommands,
	formatHelpOutput,
	getCommandSuggestions,
} from "../ui/components/CommandPalette.js";

const GOLD = "#D4AF37";
const CORAL = "#D97757";
const GREEN = "#10B981";
const GRAY = "#6B7280";
const RED = "#EF4444";
const OBSIDIAN = "#1A1A2E";
const CYAN = "#06B6D4";
const SAND = "#C2B280";
const NILE = "#2E5A6B";
const PAPYRUS = "#F5E6C8";
const BLUE = "#3B82F6";
const PURPLE = "#A855F7";

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

function formatToolCall(toolName: string, args: unknown): string {
	const icon = TOOL_ICONS[toolName] || "🔧";
	
	switch (toolName) {
		case "read":
		case "read_file": {
			const filePath = typeof args === "object" && args !== null && "file_path" in args 
				? (args as Record<string, unknown>).file_path 
				: "";
			return `${icon} Reading: ${filePath}`;
		}
		case "write":
		case "write_file": {
			const filePath = typeof args === "object" && args !== null && "file_path" in args 
				? (args as Record<string, unknown>).file_path 
				: "";
			return `${icon} Writing: ${filePath}`;
		}
		case "edit":
		case "edit_file": {
			const filePath = typeof args === "object" && args !== null && "file_path" in args 
				? (args as Record<string, unknown>).file_path 
				: "";
			return `${icon} Editing: ${filePath}`;
		}
		case "bash": {
			const command = typeof args === "object" && args !== null && "command" in args 
				? (args as Record<string, unknown>).command 
				: "";
			const cmdStr = String(command).slice(0, 50);
			return `${icon} Running: ${cmdStr}${String(command).length > 50 ? "..." : ""}`;
		}
		case "glob": {
			const pattern = typeof args === "object" && args !== null && "pattern" in args 
				? (args as Record<string, unknown>).pattern 
				: "";
			return `${icon} Finding: ${pattern}`;
		}
		case "grep": {
			const pattern = typeof args === "object" && args !== null && "pattern" in args 
				? (args as Record<string, unknown>).pattern 
				: "";
			const pth = typeof args === "object" && args !== null && "path" in args 
				? (args as Record<string, unknown>).path 
				: "";
			return `${icon} Searching: "${pattern}" in ${pth}`;
		}
		case "webfetch": {
			const url = typeof args === "object" && args !== null && "url" in args 
				? (args as Record<string, unknown>).url 
				: "";
			return `${icon} Fetching: ${String(url).slice(0, 60)}`;
		}
		case "web_search": {
			const query = typeof args === "object" && args !== null && "query" in args 
				? (args as Record<string, unknown>).query 
				: "";
			return `${icon} Searching web: "${query}"`;
		}
		default:
			return `${icon} ${toolName}`;
	}
}

function formatToolResult(result: unknown, maxWidth: number = 80): string {
	if (!result) return "";
	
	let output: string;
	if (typeof result === "string") {
		output = result;
	} else if (typeof result === "object" && result !== null && "output" in result) {
		output = String((result as Record<string, unknown>).output);
	} else {
		output = JSON.stringify(result);
	}
	
	const lines = output.split("\n");
	const previewLines = lines.slice(0, 8);
	
	const formatted = previewLines
		.map(line => {
			const truncated = line.length > maxWidth - 4 ? line.slice(0, maxWidth - 7) + "..." : line;
			return `  │ ${truncated}`;
		})
		.join("\n");
	
	if (lines.length > 8) {
		return `${formatted}\n  │ ... (${lines.length - 8} more lines)`;
	}
	
	return formatted;
}

const CONFIG_PATH = path.join(os.homedir(), ".tehuti.json");
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

function highlightSyntax(code: string, language?: string): string {
	if (isHighlighterReady()) {
		return highlightToAnsi(code, language);
	}
	return code;
}

function renderMarkdown(text: string, maxWidth?: number): React.ReactNode[] {
	const elements: React.ReactNode[] = [];
	const tokens = marked.lexer(text);
	let keyCounter = 0;
	const getKey = () => `md-${keyCounter++}`;

	for (const token of tokens) {
		const rendered = renderToken(token, getKey, maxWidth);
		if (rendered) {
			if (Array.isArray(rendered)) {
				elements.push(...rendered);
			} else {
				elements.push(rendered);
			}
		}
	}

	return elements;
}

function renderToken(
	token: Token,
	getKey: () => string,
	maxWidth?: number,
): React.ReactNode | React.ReactNode[] | null {
	switch (token.type) {
		case "code": {
			const lang = token.lang || "text";
			const code = token.text.trim();
			const highlighted = highlightSyntax(code, lang);
			const codeWidth = maxWidth ? Math.min(maxWidth - 4, 100) : 100;
			return React.createElement(
				Box,
				{
					key: getKey(),
					flexDirection: "column",
					marginTop: 1,
					marginBottom: 1,
					paddingLeft: 1,
					paddingRight: 1,
					borderStyle: "round",
					borderColor: GRAY,
					width: codeWidth,
				},
				React.createElement(Text, { dimColor: true }, lang),
				React.createElement(Text, { wrap: "wrap" }, highlighted),
			);
		}

		case "heading": {
			const level = token.depth;
			const color = level === 1 ? GOLD : level === 2 ? CORAL : GREEN;
			const inlineElements = renderInlineTokens(token.tokens || [], getKey);
			return React.createElement(
				Text,
				{ key: getKey(), bold: true, color, wrap: "wrap" },
				...inlineElements,
			);
		}

		case "paragraph": {
			const inlineElements = renderInlineTokens(token.tokens || [], getKey);
			return React.createElement(
				Text,
				{ key: getKey(), wrap: "wrap" },
				...inlineElements,
			);
		}

		case "list": {
			const items: React.ReactNode[] = [];
			for (let i = 0; i < token.items.length; i++) {
				const item = token.items[i];
				const inlineElements = renderInlineTokens(item.tokens || [], getKey);
				const bullet = token.ordered ? `${i + 1}.` : "•";
				items.push(
					React.createElement(
						Text,
						{ key: getKey(), wrap: "wrap" },
						React.createElement(Text, { color: CORAL }, `${bullet} `),
						...inlineElements,
					),
				);
			}
			return items;
		}

		case "blockquote": {
			const innerElements = renderInlineTokens(token.tokens || [], getKey);
			return React.createElement(
				Box,
				{
					key: getKey(),
					paddingLeft: 2,
					borderStyle: "single" as const,
					borderColor: GRAY,
				},
				React.createElement(
					Text,
					{ dimColor: true, italic: true, wrap: "wrap" },
					...innerElements,
				),
			);
		}

		case "hr": {
			const lineLen = maxWidth ? Math.min(maxWidth - 4, 40) : 40;
			return React.createElement(
				Text,
				{ key: getKey(), dimColor: true, color: GRAY },
				"─".repeat(lineLen),
			);
		}

		case "space": {
			return React.createElement(Text, { key: getKey() }, "\n");
		}

		default:
			return null;
	}
}

function renderInlineTokens(tokens: Token[], getKey: () => string): React.ReactNode[] {
	const elements: React.ReactNode[] = [];

	for (const token of tokens) {
		const rendered = renderInlineToken(token, getKey);
		if (rendered) {
			if (Array.isArray(rendered)) {
				elements.push(...rendered);
			} else {
				elements.push(rendered);
			}
		}
	}

	return elements;
}

function renderInlineToken(
	token: Token,
	getKey: () => string,
): React.ReactNode | React.ReactNode[] | null {
	switch (token.type) {
		case "text": {
			return token.text;
		}

		case "codespan": {
			return React.createElement(
				Text,
				{ key: getKey(), color: CYAN, backgroundColor: "#1e293b" },
				` ${token.text} `,
			);
		}

		case "strong": {
			const inner = renderInlineTokens(token.tokens || [], getKey);
			return React.createElement(
				Text,
				{ key: getKey(), bold: true },
				...inner,
			);
		}

		case "em": {
			const inner = renderInlineTokens(token.tokens || [], getKey);
			return React.createElement(
				Text,
				{ key: getKey(), italic: true },
				...inner,
			);
		}

		case "link": {
			const inner = renderInlineTokens(token.tokens || [], getKey);
			return React.createElement(
				Text,
				{ key: getKey(), color: CYAN, underline: true },
				...inner,
			);
		}

		case "br": {
			return React.createElement(Text, { key: getKey() }, "\n");
		}

		case "del": {
			const inner = renderInlineTokens(token.tokens || [], getKey);
			return React.createElement(
				Text,
				{ key: getKey(), strikethrough: true },
				...inner,
			);
		}

		case "escape": {
			return token.text;
		}

		default:
			if ("text" in token && typeof token.text === "string") {
				return token.text;
			}
			if ("tokens" in token && Array.isArray(token.tokens)) {
				return renderInlineTokens(token.tokens, getKey);
			}
			return null;
	}
}

interface TehutiConfig {
	apiKey?: string;
	model?: string;
	initialized?: boolean;
}

interface OpenRouterErrorResponse {
	error?: { message: string };
}

interface OpenRouterModelsResponse {
	data: Array<{
		id: string;
		context_length?: number;
		pricing?: { prompt?: string };
	}>;
}

function loadTehutiConfig(): TehutiConfig {
	try {
		if (fs.existsSync(CONFIG_PATH)) {
			return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")) as TehutiConfig;
		}
	} catch {}
	return {};
}

function saveTehutiConfig(data: Record<string, unknown>) {
	const existing = loadTehutiConfig();
	fs.writeFileSync(
		CONFIG_PATH,
		JSON.stringify({ ...existing, ...data }, null, 2),
	);
}

async function promptForKey(): Promise<{
	apiKey: string;
	model: string;
} | null> {
	console.log();
	console.log(chalk.hex(GOLD)(`  ${DECORATIVE.ibis} Tehuti`));
	console.log(chalk.hex(SAND)("  Scribe of Code Transformations"));
	console.log();
	console.log(chalk.gray("  Enter your OpenRouter API key"));
	console.log(
		chalk.gray("  Get a key: ") + chalk.cyan("https://openrouter.ai/keys"),
	);
	console.log();

	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	return new Promise((resolve) => {
		rl.question(chalk.hex(CORAL)(`  ${DECORATIVE.scroll} Key: `), async (key) => {
			rl.close();

			const trimmed = key.trim();
			if (!trimmed) {
				consola.fail("No key provided");
				resolve(null);
				return;
			}

			console.log(chalk.gray("  Validating..."));

			try {
				const res = await fetch(
					"https://openrouter.ai/api/v1/chat/completions",
					{
						method: "POST",
						headers: {
							Authorization: `Bearer ${trimmed}`,
							"Content-Type": "application/json",
						},
						body: JSON.stringify({
							model: "openrouter/auto",
							messages: [{ role: "user", content: "test" }],
							max_tokens: 1,
						}),
					},
				);

				const data = (await res.json()) as OpenRouterErrorResponse;

				if (data.error) {
					consola.fail(data.error.message);
					rl.close();
					resolve(null);
					return;
				}

				saveTehutiConfig({
					apiKey: trimmed,
					model: "z-ai/glm-4.5-air:free",
					initialized: true,
				});
				consola.success("Key saved!");
				console.log();
				resolve({ apiKey: trimmed, model: "z-ai/glm-4.5-air:free" });
			} catch (e) {
				const message = e instanceof Error ? e.message : String(e);
				consola.fail(message);
				resolve(null);
			}
		});
	});
}

function _QuestionPrompt({
	question,
	onAnswer,
	onCancel,
}: {
	question: QuestionData;
	onAnswer: (answer: string | string[]) => void;
	onCancel: () => void;
}) {
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [customMode, setCustomMode] = useState(false);
	const [customInput, setCustomInput] = useState("");
	const [selectedMultiple, setSelectedMultiple] = useState<Set<number>>(
		new Set(),
	);
	const { stdout } = useStdout();

	useInput((k, key) => {
		if (customMode) {
			if (key.return) {
				onAnswer(customInput);
				return;
			}
			if (key.escape) {
				setCustomMode(false);
				setCustomInput("");
				return;
			}
			if (key.backspace || key.delete || k === "\x7f" || k === "\b") {
				setCustomInput((prev) => prev.slice(0, -1));
				return;
			}
			if (k && k.length === 1 && !key.ctrl && !key.meta) {
				setCustomInput((prev) => prev + k);
			}
			return;
		}

		if (key.upArrow) {
			const maxIdx = question.options.length;
			setSelectedIndex((prev) => (prev - 1 + maxIdx + 1) % (maxIdx + 1));
			return;
		}

		if (key.downArrow) {
			const maxIdx = question.options.length;
			setSelectedIndex((prev) => (prev + 1) % (maxIdx + 1));
			return;
		}

		if (key.return) {
			if (selectedIndex === question.options.length) {
				setCustomMode(true);
				return;
			}

			if (question.multiple) {
				const answers = Array.from(selectedMultiple).map(
					(i) => question.options[i].label,
				);
				if (answers.length === 0) {
					const current = selectedIndex;
					if (!selectedMultiple.has(current)) {
						onAnswer([question.options[current].label]);
					} else {
						onAnswer(answers);
					}
				} else {
					onAnswer(answers);
				}
			} else {
				onAnswer(question.options[selectedIndex].label);
			}
			return;
		}

		if (key.escape) {
			onCancel();
			return;
		}

		if (
			question.multiple &&
			k === " " &&
			selectedIndex < question.options.length
		) {
			setSelectedMultiple((prev) => {
				const next = new Set(prev);
				if (next.has(selectedIndex)) {
					next.delete(selectedIndex);
				} else {
					next.add(selectedIndex);
				}
				return next;
			});
		}
	});

	if (customMode) {
		return React.createElement(
			Box,
			{
				flexDirection: "column",
				paddingX: 1,
				borderStyle: "round",
				borderColor: GOLD,
			},
			React.createElement(Text, { bold: true, color: GOLD }, question.header),
			React.createElement(Text, { color: GRAY }, "Type your answer:"),
			React.createElement(Text, { color: CORAL }, `> ${customInput}\u2588`),
			React.createElement(
				Text,
				{ dimColor: true },
				"Enter to confirm | Esc to cancel",
			),
		);
	}

	return React.createElement(
		Box,
		{
			flexDirection: "column",
			paddingX: 1,
			borderStyle: "round",
			borderColor: GOLD,
		},
		React.createElement(Text, { bold: true, color: GOLD }, question.header),
		React.createElement(Text, null, question.question),
		React.createElement(Text, null, ""),
		...question.options.map((opt, idx) =>
			React.createElement(
				Box,
				{ key: idx },
				React.createElement(
					Text,
					{
						color: selectedIndex === idx ? CORAL : GRAY,
						bold: selectedIndex === idx,
					},
					question.multiple
						? `${selectedMultiple.has(idx) ? "[x]" : "[ ]"} ${selectedIndex === idx ? "> " : "  "}${opt.label}`
						: `${selectedIndex === idx ? "> " : "  "}${opt.label}`,
				),
				opt.description &&
					React.createElement(
						Text,
						{ dimColor: true, color: GRAY },
						` - ${opt.description}`,
					),
			),
		),
		React.createElement(
			Box,
			{ key: "custom" },
			React.createElement(
				Text,
				{
					color: selectedIndex === question.options.length ? CORAL : GRAY,
					bold: selectedIndex === question.options.length,
				},
				`${selectedIndex === question.options.length ? "> " : "  "}Type custom answer`,
			),
		),
		React.createElement(
			Text,
			{ dimColor: true },
			`\n↑↓ navigate | Enter select${question.multiple ? " | Space toggle" : ""} | Esc cancel`,
		),
	);
}

function ChatUI({
	apiKey,
	model,
	diffPreview,
	cfg,
	onExit,
}: {
	apiKey: string;
	model: string;
	diffPreview?: { showPreview: boolean; autoConfirm?: boolean };
	cfg: typeof DEFAULT_CONFIG;
	onExit: () => void;
}) {
	const [messages, setMessages] = useState<
		Array<{ id: number; role: string; content: string }>
	>([]);
	const [input, setInput] = useState("");
	const [cursorPos, setCursorPos] = useState(0);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");
	const [ctxModel, setCtxModel] = useState(model);
	const [scrollOffset, setScrollOffset] = useState(0);
	const [history, setHistory] = useState<string[]>([]);
	const [historyIndex, setHistoryIndex] = useState(-1);
	const [sessionId, setSessionId] = useState<string | null>(null);
	const [showWelcome, setShowWelcome] = useState(true);
	const [sessionCost, setSessionCost] = useState(0);
	const [thinking, setThinking] = useState("");
	const [showThinking, setShowThinking] = useState(false);
	const [showCommandPalette, setShowCommandPalette] = useState(false);
	const [pendingQuestion, setPendingQuestion] = useState<{
		questions: QuestionData[];
		resolve: (answers: string[]) => void;
		reject: (error: Error) => void;
	} | null>(null);
	const questionResolverRef = useRef<
		((questions: QuestionData[]) => Promise<string[]>) | null
	>(null);
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

	const terminalHeight = stdout?.rows || 24;
	const terminalWidth = stdout?.columns || 80;
	const headerHeight = 3;
	const inputHeight = 3;
	const maxVisibleMessages = Math.max(
		3,
		terminalHeight - headerHeight - inputHeight - 4,
	);
	const contentMaxWidth = Math.min(terminalWidth - 4, 120);

	messagesRef.current = messages;
	
	const flushBatchedTokens = useCallback(() => {
		if (batchTimerRef.current) {
			clearTimeout(batchTimerRef.current);
			batchTimerRef.current = null;
		}
		
		if (batchedTokensRef.current.length === 0) return;
		
		const tokens = batchedTokensRef.current;
		batchedTokensRef.current = "";
		streamingContentRef.current += tokens;
		
		if (streamingMsgIdRef.current !== null) {
			setMessages((m) =>
				m.map((msg) =>
					msg.id === streamingMsgIdRef.current 
						? { ...msg, content: streamingContentRef.current } 
						: msg,
				),
			);
		}
	}, []);
	
	const batchToken = useCallback((token: string) => {
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
	}, [flushBatchedTokens]);

	const handleCommandPaletteSelect = useCallback((cmd: CommandItem) => {
		setShowCommandPalette(false);
		cmd.action();
	}, []);

	const handleCommandPaletteClose = useCallback(() => {
		setShowCommandPalette(false);
	}, []);

	const handleModelSwitch = useCallback(() => {
		setMessages((m) => [
			...m,
			{
				id: msgIdRef.current++,
				role: "system",
				content:
					"Use: /model <model-name> to switch models.\nExample: /model z-ai/glm-4.5-air:free\n\nUse /models to see available free models.",
			},
		]);
	}, []);

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
	}, []);

	const handleClear = useCallback(() => {
		setMessages([]);
		ctxRef.current = null;
		setThinking("");
		setShowThinking(false);
		costTracker.reset();
		setSessionCost(0);
	}, []);

	const handleShowHelp = useCallback(() => {
		setMessages((m) => [
			...m,
			{
				id: msgIdRef.current++,
				role: "system",
				content: formatHelpOutput(),
			},
		]);
	}, []);

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
	}, []);

	const handleShowSessions = useCallback(async () => {
		setLoading(true);
		const sessions = await sessionManager.listSessions();
		const list = sessions
			.slice(0, 10)
			.map((s, i) => {
				const date = new Date(s.updatedAt).toLocaleDateString();
				const msgs = `${s.messageCount} msgs`;
				return `  ${i + 1}. ${s.name || s.id.slice(0, 8)} (${msgs}, ${date})`;
			})
			.join("\n");
		setMessages((m) => [
			...m,
			{
				id: msgIdRef.current++,
				role: "system",
				content:
					sessions.length > 0
						? `Recent sessions:\n${list}\n\nUse: /load <id>`
						: "No saved sessions",
			},
		]);
		setLoading(false);
	}, []);

	const handleShowModels = useCallback(async () => {
		setLoading(true);
		setMessages((m) => [
			...m,
			{ id: msgIdRef.current++, role: "system", content: "Fetching models..." },
		]);

		try {
			const res = await fetch("https://openrouter.ai/api/v1/models", {
				headers: { Authorization: `Bearer ${apiKey}` },
			});
			const data = (await res.json()) as OpenRouterModelsResponse;

			const models = data.data
				.filter((m) => m.id.includes(":free") || m.pricing?.prompt === "0")
				.sort((a, b) => {
					const ctxA = a.context_length || 0;
					const ctxB = b.context_length || 0;
					return ctxB - ctxA;
				})
				.slice(0, 15);

			const list = models
				.map((m) => {
					const ctx = m.context_length
						? `${Math.round(m.context_length / 1000)}k ctx`
						: "";
					return `  ${m.id.split("/")[1]?.slice(0, 25) || m.id} ${ctx}`;
				})
				.join("\n");

			setMessages((msgs) => [
				...msgs.slice(0, -1),
				{
					id: msgIdRef.current++,
					role: "system",
					content: `Free models (by context):\n${list}\n\nUse: /model <full-id>`,
				},
			]);
		} catch {
			setMessages((msgs) => [
				...msgs.slice(0, -1),
				{
					id: msgIdRef.current++,
					role: "system",
					content: "Failed to fetch models",
				},
			]);
		}
		setLoading(false);
	}, [apiKey]);

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
	}, [sessionId]);

	const handleLoad = useCallback(async () => {
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
			const list = sessions
				.slice(0, 5)
				.map((s, i) => `${i + 1}. ${s.name || s.id.slice(0, 8)}`)
				.join("\n");
			setMessages((m) => [
				...m,
				{
					id: msgIdRef.current++,
					role: "system",
					content: `Recent sessions:\n${list}\n\nUse: /load <id>`,
				},
			]);
		}
		setLoading(false);
	}, []);

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
				onStats: handleShowStats,
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
			handleSave,
			handleLoad,
			handleShowStats,
		],
	);

	useEffect(() => {
		setHistory(loadHistory());

		let mounted = true;

		async function initSession() {
			const recentId = await sessionManager.getRecentSession(process.cwd());
			if (recentId && mounted) {
				const data = await sessionManager.loadSession(recentId);
				if (data && data.messages.length > 0 && mounted) {
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
						return;
					}
				}
			}

			if (mounted) {
				const id = await sessionManager.createSession(process.cwd(), ctxModel);
				setSessionId(id);
			}
		}
		initSession();

		return () => {
			mounted = false;
		};
	}, []);

	useEffect(() => {
		return () => {
			if (batchTimerRef.current) {
				clearTimeout(batchTimerRef.current);
				batchTimerRef.current = null;
			}
		};
	}, []);

	useEffect(() => {
		questionResolverRef.current = async (
			questions: QuestionData[],
		): Promise<string[]> => {
			return new Promise((resolve, reject) => {
				setPendingQuestion({ questions, resolve, reject });
			});
		};
		setQuestionResolver(questionResolverRef.current);

		return () => {
			setQuestionResolver(async () => {
				throw new Error("Question cancelled - component unmounted");
			});
		};
	}, []);

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
		[pendingQuestion],
	);

	const _handleQuestionCancel = useCallback(() => {
		if (!pendingQuestion) return;
		pendingQuestion.reject(new Error("Question cancelled"));
		setPendingQuestion(null);
	}, [pendingQuestion]);

	const visibleMessages = useMemo(() => {
		if (messages.length <= maxVisibleMessages) {
			return messages;
		}
		if (messagesEndRef.current) {
			return messages.slice(-maxVisibleMessages);
		}
		return messages.slice(scrollOffset, scrollOffset + maxVisibleMessages);
	}, [messages, maxVisibleMessages, scrollOffset]);

	const scrollToBottom = useCallback(() => {
		messagesEndRef.current = true;
		setScrollOffset(Math.max(0, messages.length - maxVisibleMessages));
	}, [messages.length, maxVisibleMessages]);

	useEffect(() => {
		if (messagesEndRef.current) {
			scrollToBottom();
		}
	}, [scrollToBottom]);

	useInput((k, key) => {
		if (showCommandPalette) {
			return;
		}

		if (key.ctrl && k === "k") {
			setShowCommandPalette(true);
			return;
		}

		if (key.ctrl && k === "c") {
			if (sessionId && ctxRef.current) {
				sessionManager.saveSession(sessionId, ctxRef.current);
			}
			console.log();
			console.log(chalk.hex(GOLD)(costTracker.getSessionSummary()));
			onExit();
			exit();
			return;
		}

		if (key.return && input.trim() && !loading) {
			const newHistory = [
				input.trim(),
				...history.filter((h) => h !== input.trim()),
			].slice(0, 100);
			setHistory(newHistory);
			saveHistory(newHistory);
			setHistoryIndex(-1);
			send(input.trim());
			return;
		}

		if (key.upArrow && !loading) {
			if (history.length > 0) {
				if (historyIndex === -1) {
					inputBeforeHistoryRef.current = input;
					setHistoryIndex(0);
					setInput(history[0]);
					setCursorPos(history[0].length);
				} else if (historyIndex < history.length - 1) {
					setHistoryIndex((i) => i + 1);
					setInput(history[historyIndex + 1]);
					setCursorPos(history[historyIndex + 1].length);
				}
			}
			return;
		}

		if (key.downArrow && !loading) {
			if (historyIndex > 0) {
				setHistoryIndex((i) => i - 1);
				setInput(history[historyIndex - 1]);
				setCursorPos(history[historyIndex - 1].length);
			} else if (historyIndex === 0) {
				setHistoryIndex(-1);
				setInput(inputBeforeHistoryRef.current);
				setCursorPos(inputBeforeHistoryRef.current.length);
			}
			return;
		}

		if (key.ctrl && key.upArrow) {
			messagesEndRef.current = false;
			setScrollOffset((off) => Math.max(0, off - 1));
			return;
		}

		if (key.ctrl && key.downArrow) {
			setScrollOffset((off) => {
				const maxOff = Math.max(0, messages.length - maxVisibleMessages);
				const newOff = Math.min(maxOff, off + 1);
				if (newOff >= maxOff) {
					messagesEndRef.current = true;
				}
				return newOff;
			});
			return;
		}

		if (key.ctrl && k === "l") {
			setMessages([]);
			ctxRef.current = null;
			setShowWelcome(true);
			return;
		}

		if (key.ctrl && k === "u") {
			setInput("");
			setCursorPos(0);
			setHistoryIndex(-1);
			return;
		}

		if (key.ctrl && k === "a") {
			setCursorPos(0);
			return;
		}

		if (key.ctrl && k === "e") {
			setCursorPos(input.length);
			return;
		}

		if (key.ctrl && k === "w") {
			const before = input.slice(0, cursorPos);
			const after = input.slice(cursorPos);
			const match = before.match(/\S+\s*$/);
			if (match) {
				const newPos = cursorPos - match[0].length;
				setInput(before.slice(0, newPos) + after);
				setCursorPos(newPos);
			} else {
				setInput(after);
				setCursorPos(0);
			}
			return;
		}

		if (key.backspace || k === "\x7f" || k === "\b") {
			if (cursorPos > 0) {
				setInput((i) => i.slice(0, cursorPos - 1) + i.slice(cursorPos));
				setCursorPos((p) => p - 1);
			}
			return;
		}

		if (key.delete || k === "\x1b[3~") {
			if (cursorPos < input.length) {
				setInput((i) => i.slice(0, cursorPos) + i.slice(cursorPos + 1));
			}
			return;
		}

		if (key.leftArrow) {
			setCursorPos((p) => Math.max(0, p - 1));
			return;
		}

		if (key.rightArrow) {
			setCursorPos((p) => Math.min(input.length, p + 1));
			return;
		}

		if (key.escape) {
			setInput("");
			setCursorPos(0);
			setHistoryIndex(-1);
			return;
		}

		if (k === "\t" && input.startsWith("/")) {
			const suggestions = getCommandSuggestions(input, commands);
			if (suggestions.length > 0) {
				setInput(suggestions[0].label + " ");
				setCursorPos(suggestions[0].label.length + 1);
			}
			return;
		}

		if (k && !key.ctrl && !key.meta && k.length === 1) {
			setInput((i) => i.slice(0, cursorPos) + k + i.slice(cursorPos));
			setCursorPos((p) => p + 1);
			setHistoryIndex(-1);
		}
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
				setMessages([]);
				ctxRef.current = null;
				setThinking("");
				setShowThinking(false);
				costTracker.reset();
				resetTelemetry();
				setSessionCost(0);
				const newId = await sessionManager.createSession(process.cwd(), ctxModel);
				setSessionId(newId);
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

			if (cmd === "/sessions") {
				setLoading(true);
				const sessions = await sessionManager.listSessions();
				const list = sessions
					.slice(0, 10)
					.map((s, i) => {
						const date = new Date(s.updatedAt).toLocaleDateString();
						const msgs = `${s.messageCount} msgs`;
						return `  ${i + 1}. ${s.name || s.id.slice(0, 8)} (${msgs}, ${date})`;
					})
					.join("\n");
				setMessages((m) => [
					...m,
					{
						id: msgIdRef.current++,
						role: "system",
						content:
							sessions.length > 0
								? `Recent sessions:\n${list}\n\nUse: /load <id>`
								: "No saved sessions",
					},
				]);
				setLoading(false);
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
				const data = await sessionManager.loadSession(id);
				if (data && data.messages.length > 0) {
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
							...cfg,
							model: data.metadata.model || ctxModel,
							apiKey,
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
					);
					ctxRef.current.messages = data.messages;
					if (data.metadata.model) {
						setCtxModel(data.metadata.model);
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
							content: `Session not found: ${id}`,
						},
					]);
				}
				return;
			}

			if (cmd === "/models") {
				setLoading(true);
				setMessages((m) => [
					...m,
					{
						id: msgIdRef.current++,
						role: "system",
						content: "Fetching models...",
					},
				]);

				try {
					const res = await fetch("https://openrouter.ai/api/v1/models", {
						headers: { Authorization: `Bearer ${apiKey}` },
					});
					const data = (await res.json()) as OpenRouterModelsResponse;

					const models = data.data
						.filter((m) => m.id.includes(":free") || m.pricing?.prompt === "0")
						.sort((a, b) => {
							const ctxA = a.context_length || 0;
							const ctxB = b.context_length || 0;
							return ctxB - ctxA;
						})
						.slice(0, 15);

					const list = models
						.map((m) => {
							const ctx = m.context_length
								? `${Math.round(m.context_length / 1000)}k ctx`
								: "";
							return `  ${m.id.split("/")[1]?.slice(0, 25) || m.id} ${ctx}`;
						})
						.join("\n");

					setMessages((msgs) => [
						...msgs.slice(0, -1),
						{
							id: msgIdRef.current++,
							role: "system",
							content: `Free models (by context):\n${list}\n\nUse: /model <full-id>`,
						},
					]);
				} catch {
					setMessages((msgs) => [
						...msgs.slice(0, -1),
						{
							id: msgIdRef.current++,
							role: "system",
							content: "Failed to fetch models",
						},
					]);
				}
				setLoading(false);
				return;
			}

			if (text.toLowerCase().startsWith("/model ")) {
				const m = text.slice(7).trim();
				if (m) {
					setCtxModel(m);
					if (ctxRef.current) {
						ctxRef.current.config.model = m;
					}
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

		setMessages((m) => [...m, { id: userMsgId, role: "user", content: text }]);
		setLoading(true);
		setError("");
		setThinking("");
		setShowThinking(false);
		
		streamingContentRef.current = "";
		streamingMsgIdRef.current = assistantMsgId;
		batchedTokensRef.current = "";

		try {
			if (!ctxRef.current) {
				ctxRef.current = await createAgentContext(
					process.cwd(),
					{
						...cfg,
						model: ctxModel,
						apiKey,
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
				);
			}

			let response = "";
			const toolCallsInfo: string[] = [];
			let currentToolName = "";

			setMessages((m) => [
				...m.filter((msg) => msg.id !== assistantMsgId),
				{ id: assistantMsgId, role: "assistant", content: "" },
			]);

			const result = await runAgentLoop(ctxRef.current, text, {
				onToken: (t) => {
					response += t;
					batchToken(t);
				},
				onToolCall: (name, args) => {
					flushBatchedTokens();
					currentToolName = name;
					const toolDesc = formatToolCall(name, args);
					toolCallsInfo.push(toolDesc);
					setThinking(`  ${toolDesc}`);
					setShowThinking(true);
				},
				onToolResult: (name, result) => {
					flushBatchedTokens();
					const success =
						result && typeof result === "object" && "success" in result
							? result.success
							: true;
					const statusIcon = success ? "✓" : "✗";
					const resultPreview = formatToolResult(result, terminalWidth - 10);
					
					if (resultPreview) {
						const previewLines = resultPreview.split("\n").slice(0, 5).join("\n");
						toolCallsInfo.push(`${statusIcon} ${name}:\n${previewLines}`);
					} else {
						toolCallsInfo.push(`${statusIcon} ${name}`);
					}
					
					setThinking("");
					setShowThinking(false);
					currentToolName = "";
				},
				onThinking: (content) => {
					if (content.length > 0) {
						setThinking(`  💭 Thinking...`);
						setShowThinking(true);
					}
				},
			});
			
			flushBatchedTokens();

			const finalContent = result.content || response;
			const toolSummary =
				toolCallsInfo.length > 0
					? `\n\n${DECORATIVE.scroll} Tools used:\n${toolCallsInfo.map(t => `  ${t}`).join("\n")}`
					: "";

			if (result.sessionStats) {
				setSessionCost(result.sessionStats.totalCost);
			}

			if (!finalContent && !response) {
				setMessages((m) =>
					m.map((msg) =>
						msg.id === assistantMsgId
							? { ...msg, content: `No response received. Check your API key with /reset-key or verify network connectivity.` }
							: msg,
					),
				);
			} else {
				setMessages((m) =>
					m.map((msg) =>
						msg.id === assistantMsgId
							? { ...msg, content: finalContent || `Task completed.${toolSummary}` }
							: msg,
					),
				);
			}
			
			streamingMsgIdRef.current = null;
			streamingContentRef.current = "";
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			debug.log("chat", "Agent error:", e);
			flushBatchedTokens();
			setMessages((m) =>
				m.map((msg) =>
					msg.id === assistantMsgId
						? { ...msg, content: `Error: ${message}` }
						: msg,
				),
			);
			streamingMsgIdRef.current = null;
		}
		setLoading(false);
		setShowThinking(false);
	}

	const messageElements = useMemo(() => {
		return visibleMessages.map((m) => {
			let header: React.ReactNode;
			let content: React.ReactNode[];
			
			if (m.role === "user") {
				header = React.createElement(
					Box,
					{ marginBottom: 0 },
					React.createElement(
						Text,
						{ bold: true, color: CORAL, backgroundColor: "#3D2820" },
						` ${DECORATIVE.feather} You `
					)
				);
				content = [React.createElement(
					Text, 
					{ key: 0, color: CORAL, wrap: "wrap" }, 
					m.content
				)];
			} else if (m.role === "system") {
				header = React.createElement(
					Text,
					{ bold: true, color: SAND, dimColor: true },
					`${DECORATIVE.scroll} System`
				);
				content = [React.createElement(
					Text, 
					{ key: 0, dimColor: true, wrap: "wrap" }, 
					m.content
				)];
			} else {
				header = React.createElement(
					Box,
					{ marginBottom: 0 },
					React.createElement(
						Text,
						{ bold: true, color: GREEN, backgroundColor: "#1A3D2E" },
						` ${DECORATIVE.ibis} Tehuti `
					)
				);
				content = renderMarkdown(m.content, contentMaxWidth);
			}

			return React.createElement(
				Box,
				{ 
					key: m.id, 
					flexDirection: "column", 
					marginBottom: 1, 
					paddingTop: 0,
					width: contentMaxWidth,
					flexShrink: 0,
				},
				header,
				React.createElement(
					Box, 
					{ 
						paddingLeft: 1, 
						marginTop: 0,
						flexDirection: "column",
						flexWrap: "wrap",
					}, 
					...content
				),
			);
		});
	}, [visibleMessages, contentMaxWidth]);

	const commandSuggestions = useMemo(() => {
		if (!input.startsWith("/") || showCommandPalette) return null;
		const suggestions = getCommandSuggestions(input, commands);
		if (suggestions.length === 0) return null;
		
		return React.createElement(
			Box,
			{ flexDirection: "column", paddingLeft: 2, marginTop: 0 },
			...suggestions.map((cmd, idx) =>
				React.createElement(
					Text,
					{ key: cmd.id, color: idx === 0 ? GOLD : GRAY, dimColor: idx !== 0 },
					`${idx === 0 ? DECORATIVE.arrow : " "} ${cmd.label}${cmd.usage ? ` ${cmd.usage}` : ""} - ${cmd.description}`,
				),
			),
		);
	}, [input, commands, showCommandPalette]);

	const renderInput = useMemo(() => {
		const before = input.slice(0, cursorPos);
		const after = input.slice(cursorPos);
		return React.createElement(
			Text,
			{ color: CORAL },
			`${DECORATIVE.scroll} ${before}\u2588${after}`,
		);
	}, [input, cursorPos]);

	const scrollIndicator = useMemo(() => {
		if (messages.length <= maxVisibleMessages) return null;
		const position = messagesEndRef.current
			? "end"
			: `${scrollOffset + 1}-${Math.min(scrollOffset + maxVisibleMessages, messages.length)}/${messages.length}`;
		return React.createElement(
			Text,
			{ dimColor: true },
			`[${DECORATIVE.eye} ${position} ${DECORATIVE.arrow}scroll]`,
		);
	}, [messages.length, maxVisibleMessages, scrollOffset]);

	return React.createElement(
		Box,
		{ flexDirection: "column", width: "100%", height: "100%" },
		React.createElement(
			Box,
			{ paddingX: 1, borderStyle: "single", borderColor: GOLD },
			React.createElement(Text, { bold: true, color: GOLD }, `${DECORATIVE.ibis} Tehuti`),
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
				`${DECORATIVE.eye} Ctrl+K ${DECORATIVE.separator} Ctrl+C`,
			),
		),
		React.createElement(
			Box,
			{ flexDirection: "column", flexGrow: 1, paddingX: 1, overflow: "hidden" },
			messages.length === 0 && showWelcome
				? React.createElement(
						Box,
						{
							flexGrow: 1,
							flexDirection: "column",
							justifyContent: "center",
							alignItems: "center",
						},
						React.createElement(
							Text,
							{ color: GOLD },
							ASCII_ART.trim(),
						),
						React.createElement(Text, { color: SAND, dimColor: true }, WELCOME_MESSAGE.trim()),
					)
				: messages.length === 0
					? React.createElement(
							Box,
							{ flexGrow: 1, justifyContent: "center", alignItems: "center" },
							React.createElement(
								Text,
								{ color: SAND, dimColor: true },
								"Type a message to begin",
							),
						)
					: React.createElement(
							Box,
							{ flexDirection: "column", flexGrow: 1 },
							...messageElements,
						),
			showThinking &&
				thinking &&
				React.createElement(
					Box,
					{
						marginBottom: 1,
						paddingLeft: 2,
						borderStyle: "round",
						borderColor: NILE,
					},
					React.createElement(
						Text,
						{ color: SAND, dimColor: true },
						`  ${DECORATIVE.eye} ${thinking.length > 150 ? "..." + thinking.slice(-150) : thinking}`,
					),
				),
			scrollIndicator &&
				React.createElement(Box, { justifyContent: "center" }, scrollIndicator),
			error && React.createElement(
				Box,
				{ marginTop: 1, paddingX: 1, borderStyle: "round", borderColor: RED },
				React.createElement(Text, { color: RED }, `${DECORATIVE.eyeOfHorus} ${error}`),
			),
			loading &&
				React.createElement(
					Box,
					{ marginTop: 1, paddingX: 1 },
					React.createElement(
						Text,
						{ color: GOLD },
						`${DECORATIVE.ibis} `
					),
					React.createElement(Text, { color: SAND, dimColor: true }, "consulting the scrolls..."),
				),
		),
		React.createElement(
			Box,
			{ paddingX: 1, borderStyle: "single", borderColor: SAND, flexDirection: "column" },
			loading
				? React.createElement(Text, { color: SAND, dimColor: true }, `  ${HIEROGLYPHS.loading[0]} channeling wisdom...`)
				: renderInput,
			commandSuggestions,
		),
		React.createElement(CommandPalette, {
			commands,
			onSelect: handleCommandPaletteSelect,
			onClose: handleCommandPaletteClose,
			visible: showCommandPalette,
		}),
	);
}

function App({
	apiKey,
	model,
	diffPreview,
	cfg,
	onExit,
}: {
	apiKey: string;
	model: string;
	diffPreview?: { showPreview: boolean; autoConfirm?: boolean };
	cfg: typeof DEFAULT_CONFIG;
	onExit: () => void;
}) {
	return React.createElement(ChatUI, { apiKey, model, diffPreview, cfg, onExit });
}

export function createProgram(): Command {
	const program = new Command();

	program
		.name("tehuti")
		.description("Tehuti CLI - Coding assistant powered by OpenRouter")
		.version("0.1.0", "-v, --version")
		.option("-m, --model <model>", "Override model")
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
		.argument("[prompt]", "One-shot prompt")
		.action(async (prompt, opts) => {
			if (opts.debug) {
				setDebugMode(true);
				debug.enable();
			}
			setupErrorHandlers(opts.debug);

			const cfg = await loadConfig();
			const tehuti = loadTehutiConfig();

			if (opts.resetKey) {
				fs.rmSync(CONFIG_PATH, { force: true });
				console.log("\x1b[38;5;214m  Config reset\x1b[0m\n");
			}

			const envApiKey = process.env.OPENROUTER_API_KEY || process.env.TEHUTI_API_KEY;
			const envModel = process.env.TEHUTI_MODEL;

			let apiKey = envApiKey || cfg.apiKey || tehuti.apiKey;
			let model = opts.model || envModel || cfg.model || tehuti.model || "z-ai/glm-4.5-air:free";

			if (!tehuti.initialized || !apiKey) {
				const result = await promptForKey();
				if (!result) {
					process.exit(1);
				}
				apiKey = result.apiKey;
				model = result.model;
			}

			cfg.apiKey = apiKey;
			cfg.model = model;
			configureHooks(cfg);

			const diffPreview = opts.diff
				? { showPreview: true, autoConfirm: false }
				: opts.diffAuto
					? { showPreview: true, autoConfirm: true }
					: undefined;

			if (cfg.mcp?.enabled && !opts.noMcp) {
				await mcpManager.connectAll(cfg);
			}

			if (!prompt && !process.stdout.isTTY) {
				consola.error("Interactive mode requires a TTY. Run 'tehuti --help' for usage.");
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
										outputManager?.writeLine("");
										outputManager?.writeLine(
											chalk.hex(CYAN)(`  ${toolDesc}`)
										);
									},
						onToolResult:
							opts.json || opts.quiet
								? undefined
								: (name, result) => {
										const success =
											result && typeof result === "object" && "success" in result
												? (result as { success: boolean }).success
												: true;
										const statusIcon = success ? chalk.green("✓") : chalk.red("✗");
										
										const resultPreview = formatToolResult(result, outputManager?.getTerminalWidth?.() || 80);
										
										if (resultPreview) {
											outputManager?.writeLine(
												chalk.dim(`  ┌─ ${name} result:`)
											);
											outputManager?.writeLine(chalk.dim(resultPreview));
											outputManager?.writeLine(chalk.dim("  └─"));
										} else {
											outputManager?.writeLine(
												chalk.dim(`  ${statusIcon} ${name} completed`)
											);
										}
									},
						onThinking:
							opts.json || opts.quiet
								? undefined
								: (content) => {
										if (content.length > 0) {
											outputManager?.writeLine(
												chalk.hex(PURPLE)(`  💭 Thinking...`)
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
				render(
					React.createElement(App, {
						apiKey,
						model,
						diffPreview,
						cfg,
						onExit: async () => {
							await mcpManager.disconnectAll();
						},
					}),
				);
			}
		});

	program
		.command("init")
		.description("Configure API key")
		.action(async () => {
			const result = await promptForKey();
			if (result) {
				consola.success("Configuration saved to ~/.tehuti.json");
				console.log();
			}
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
					console.log(chalk.gray(`    ${transport} ◆ ${statusInfo} ◆ ${toolCount} tools`));
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

	return program;
}
