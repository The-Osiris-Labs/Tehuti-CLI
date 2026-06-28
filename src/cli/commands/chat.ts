import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as readline from "node:readline";
import chalk from "chalk";
import { Command } from "commander";
import { consola } from "consola";
import { Box, render, Text, useApp, useInput, useStdout } from "ink";
import Spinner from "ink-spinner";
import type { Token } from "marked";
import { marked } from "marked";
import stringWidth from "string-width";
import { MouseProvider } from "@ink-tools/ink-mouse";
import React, {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";

// Progress Bar Component
const ProgressBar = ({ value, label, width = 40 }: { value: number; label?: string; width?: number }) => {
	const filledWidth = Math.round((value / 100) * width);
	const filled = "━".repeat(filledWidth);
	const empty = "─".repeat(width - filledWidth);

	return React.createElement(
		Box,
		{ flexDirection: "column", marginY: 0.5 },
		label &&
			React.createElement(
				Box,
				{
					flexDirection: "row",
					justifyContent: "space-between",
					marginBottom: 0.25,
				},
				React.createElement(Text, { color: SAND, dimColor: true }, label),
				React.createElement(Text, { color: GOLD }, `${Math.round(value)}%`),
			),
		React.createElement(
			Box,
			{ flexDirection: "row" },
			React.createElement(Text, { color: GOLD }, filled),
			React.createElement(Text, { dimColor: true }, empty),
		),
	);
};

// Status Indicator Component
const StatusIndicator = ({
	status,
}: {
	status: "success" | "error" | "loading";
}) => {
	if (status === "success") {
		return React.createElement(Text, { color: GREEN }, "✅");
	}
	if (status === "error") {
		return React.createElement(Text, { color: RED }, "❌");
	}
	return React.createElement(
		Text,
		{ color: GOLD },
		React.createElement(Spinner, { type: "dots" }),
	);
};

import { saveCacheToDisk } from "../../agent/cache/index.js";
import { compactContext, estimateTokens } from "../../agent/context.js";
import {
	type AgentContext,
	configureHooks,
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
import { costTracker } from "../../api/index.js";
import {
	ASCII_ART,
	BRANDING,
	DECORATIVE,
	HIEROGLYPHS,
	WELCOME_MESSAGE,
} from "../../branding/index.js";
import { DEFAULT_CONFIG, loadConfig, getGlobalConfig, saveGlobalConfig, runSetupWizard, configWarnings } from "../../config/index.js";
import {
	getAllProviders,
	getEnvApiKeyForProvider,
	getProviderInfo,
	resolveBaseUrlForProvider,
} from "../../config/providers.js";
import { mcpManager } from "../../mcp/index.js";
import { sessionManager } from "../../session/manager.js";
import { listModelsForProvider } from "../../api/models.js";
import {
	createStreamingOutputManager,
	type StreamingOutputManager,
} from "../../terminal/buffered-writer.js";
import {
	highlightToAnsi,
	isHighlighterReady,
	initHighlighter,
} from "../../terminal/highlighter.js";
import { renderMarkdownToAnsi } from "../../terminal/markdown.js";
import { MediaViewer } from "../ui/components/MediaViewer.js";
import { computeMessageLines } from "../../terminal/output.js";
import { debug } from "../../utils/debug.js";
import { setupErrorHandlers, APIError, AgentError, ConfigError } from "../../utils/errors.js";
import { setDebugMode } from "../../utils/logger.js";
import { getTelemetry, resetTelemetry } from "../../utils/telemetry.js";
import { isMouseSequence } from "../../utils/mouse.js";
import {
	type CommandItem,
	CommandPalette,
	createCommands,
	formatHelpOutput,
} from "../ui/components/CommandPalette.js";
import { ConfigEditor } from "../ui/components/ConfigEditor.js";
import { ExpandableToolOutput } from "../ui/components/ExpandableToolOutput.js";
import { TehutiHeader } from "../ui/components/TehutiHeader.js";
import { SwarmVisualizer } from "../ui/components/SwarmVisualizer.js";
import { useChatInput } from "../ui/hooks/useChatInput.js";
import { useChatState } from "../ui/hooks/useChatState.js";

const GOLD = BRANDING.colors?.primary || "#F5C518";
const CORAL = BRANDING.colors?.accent || "#FF6B35";
const GREEN = BRANDING.colors?.green || "#22C55E";
const GRAY = BRANDING.colors?.gray || "#9CA3AF";
const RED = BRANDING.colors?.red || "#EF4444";
const OBSIDIAN = BRANDING.colors?.obsidian || "#1A1A2E";
const CYAN = BRANDING.colors?.cyan || "#06B6D4";
const SAND = BRANDING.colors?.sand || "#8B7355";
const NILE = BRANDING.colors?.nile || "#165DFF";
const PAPYRUS = BRANDING.colors?.papyrus || "#F5E6C8";
const BLUE = BRANDING.colors?.blue || "#3B82F6";
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

function normalizeCustomProvider(
	value: unknown,
): RuntimeCustomProvider | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}

	const record = value as Record<string, unknown>;
	const name = typeof record.name === "string" ? record.name.trim() : "";
	const baseUrl = typeof record.baseUrl === "string" ? record.baseUrl.trim() : "";

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

function formatToolResult(result: unknown, maxWidth: number = 80, previewLinesCount: number = 5): FormattedToolResult {
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
		output = JSON.stringify(result);
	}

	const lines = output.split("\n");
	const isTruncated = lines.length > previewLinesCount;
	const displayLines = isTruncated ? lines.slice(0, previewLinesCount) : lines;

	const formatLines = (lineArray: string[]): string => {
		return lineArray
			.map((line) => {
				const truncated =
					line.length > maxWidth - 4 ? line.slice(0, maxWidth - 7) + "..." : line;
				return `  │ ${truncated}`;
			})
			.join("\n");
	};

	const preview = isTruncated 
		? `${formatLines(displayLines)}\n  │ ... (${lines.length - previewLinesCount} more lines)`
		: formatLines(displayLines);

	return {
		preview,
		full: formatLines(lines),
		isTruncated,
		linesCount: lines.length,
		truncatedLinesCount: isTruncated ? lines.length - previewLinesCount : 0,
	};
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

// Initialize highlighter early
initHighlighter().catch((err) => {
	console.error("Failed to initialize syntax highlighter:", err);
});

export function parseContentBlocks(content: string): Array<{ type: "text" | "reasoning"; content: string }> {
	const blocks: Array<{ type: "text" | "reasoning"; content: string }> = [];
	let remaining = content;

	while (remaining.length > 0) {
		const thinkStart = remaining.indexOf("<think>");
		if (thinkStart === -1) {
			blocks.push({ type: "text", content: remaining });
			break;
		}

		if (thinkStart > 0) {
			blocks.push({ type: "text", content: remaining.slice(0, thinkStart) });
		}

		const thinkEnd = remaining.indexOf("</think>", thinkStart + 7);
		if (thinkEnd === -1) {
			blocks.push({ type: "reasoning", content: remaining.slice(thinkStart + 7) });
			break;
		}

		blocks.push({ type: "reasoning", content: remaining.slice(thinkStart + 7, thinkEnd) });
		remaining = remaining.slice(thinkEnd + 8);
	}

	return blocks;
}

export function normalizeBlocks(
	blocks: Array<
		| { type: "text"; content: string }
		| { type: "reasoning"; content: string }
		| { type: "tool"; id: string; name: string; description: string; result: unknown }
	>
): Array<
	| { type: "text"; content: string }
	| { type: "reasoning"; content: string }
	| { type: "tool"; id: string; name: string; description: string; result: unknown }
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

function renderMarkdown(text: string, maxWidth?: number, keyPrefix: string = "md"): React.ReactNode[] {
	const elements: React.ReactNode[] = [];
	const tokens = marked.lexer(text);
	let keyCounter = 0;
	const getKey = () => `${keyPrefix}-${keyCounter++}`;

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
			const isPlain = ["text", "plain", "ascii", "none"].includes(lang.toLowerCase());

			if (isPlain) {
				return React.createElement(
					Box,
					{
						key: getKey(),
						flexDirection: "column",
						marginTop: 0.5,
						marginBottom: 0.5,
						paddingLeft: 0,
						paddingRight: 0,
					},
					React.createElement(Text, { wrap: "wrap" }, code),
				);
			}

			const highlighted = highlightSyntax(code, lang);
			const codeWidth = maxWidth ? Math.min(maxWidth - 4, 100) : 100;
			
			// Render code with line numbers for consistency
			const lines = highlighted.split("\n");
			const lineNumWidth = Math.max(2, String(lines.length).length);
			const formattedCode = lines
				.map((line, i) => {
					const lineNum = String(i + 1).padStart(lineNumWidth);
					return `${lineNum} │ ${line}`;
				})
				.join("\n");

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
				React.createElement(Text, { wrap: "wrap", dimColor: true }, formattedCode),
			);
		}

		case "heading": {
			const level = token.depth;
			const color = level === 1 ? GOLD : level === 2 ? CORAL : GREEN;
			const inlineElements = renderInlineTokens(token.tokens || [], getKey);
			const prefix = "=".repeat(Math.max(1, 7 - level));
			
			const heading = React.createElement(
				Text,
				{ key: getKey(), bold: true, color, wrap: "wrap" },
				...inlineElements,
			);
			
			if (level <= 2) {
				const underlineLength = maxWidth ? Math.min(maxWidth - 4, 80) : 80;
				const underline = React.createElement(
					Text,
					{ key: getKey(), dimColor: true },
					prefix.repeat(Math.floor(underlineLength / prefix.length)),
				);
				return [heading, React.createElement(Text, { key: getKey() }, "\n"), underline];
			}
			
			return heading;
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
			const lineLen = maxWidth ? Math.min(maxWidth - 4, 50) : 50;
			return React.createElement(
				Text,
				{ key: getKey(), dimColor: true, color: GRAY },
				"─".repeat(lineLen),
			);
		}

		case "table": {
			const header = token.header || [];
			const rows = token.rows || [];

			const widths: number[] = header.map((h: Token, i: number) => {
				const headerLen =
					"text" in h && typeof h.text === "string" ? stringWidth(h.text) : 0;
				const rowLens = rows.map((r: Token[]) => {
					const cell = r[i];
					return cell && "text" in cell && typeof cell.text === "string"
						? stringWidth(cell.text)
						: 0;
				});
				return Math.max(headerLen, ...rowLens);
			});

			const border: string[] = widths.map((w: number) => "─".repeat(w + 2));

			const padEndWidth = (text: string, width: number): string => {
				const visibleWidth = stringWidth(text);
				if (visibleWidth >= width) return text;
				return text + " ".repeat(width - visibleWidth);
			};

			let result = "\n";
			result += `┌${border.join("┬")}┐\n`;

			const headerCells: string[] = header.map((h: Token, i: number) => {
				const text = "text" in h && typeof h.text === "string" ? h.text : "";
				const width = widths[i];
				return `│ ${padEndWidth(text, width)} `;
			});
			result += headerCells.join("") + "│\n";

			result += `├${border.join("┼")}┤\n`;

			for (const row of rows) {
				const cells: string[] = row.map((cell: Token, i: number) => {
					const text =
						cell && "text" in cell && typeof cell.text === "string"
							? cell.text
							: "";
					const width = widths[i];
					return `│ ${padEndWidth(text, width)} `;
				});
				result += cells.join("") + "│\n";
			}

			result += `└${border.join("┴")}┘\n`;

			return React.createElement(Text, { key: getKey(), wrap: "wrap" }, result);
		}

		case "space": {
			return React.createElement(Text, { key: getKey() }, "\n");
		}

		default:
			return null;
	}
}

function renderInlineTokens(
	tokens: Token[],
	getKey: () => string,
): React.ReactNode[] {
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
		case "image": {
			return React.createElement(MediaViewer, {
				key: getKey(),
				src: token.href,
				alt: token.text,
			});
		}

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
			return React.createElement(Text, { key: getKey(), bold: true }, ...inner);
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
	provider?: string;
	baseUrl?: string;
}

interface OpenRouterErrorResponse {
	error?: { message: string };
}

function loadTehutiConfig(): TehutiConfig {
	const persisted = getGlobalConfig();
	return {
		apiKey: persisted.apiKey,
		model: persisted.model,
		initialized: persisted.initialized,
		provider: persisted.provider,
		baseUrl: persisted.baseUrl,
	};
}

function saveTehutiConfig(data: Record<string, unknown>) {
	saveGlobalConfig({
		apiKey: typeof data.apiKey === "string" ? data.apiKey : undefined,
		model: typeof data.model === "string" ? data.model : undefined,
		provider: typeof data.provider === "string" ? data.provider : undefined,
		baseUrl: typeof data.baseUrl === "string" ? data.baseUrl : undefined,
		temperature:
			typeof data.temperature === "number" ? data.temperature : undefined,
		maxTokens: typeof data.maxTokens === "number" ? data.maxTokens : undefined,
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
		if (isMouseSequence(k)) {
			return;
		}
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

function getEnhancedToolName(name: string, description?: string): string {
	const base = description || name || "unknown_tool";
	
	if (!name) return base;

	if (name === "store_insight" || name === "query_memory") {
		return `${base} 𓂀 [Deep Memory]`;
	}
	
	if (name.includes("aci_") || name.includes("sandbox") || name.includes("speculative")) {
		return `${base} 𓋹 [Sandbox/ACI]`;
	}
	
	if (name.includes("shadow_workspace")) {
		return `${base} 𓂝 [Shadow Workspace]`;
	}
	
	return base;
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
	const {
		messages, setMessages,
		input, setInput,
		cursorPos, setCursorPos,
		selectionStart, setSelectionStart,
		selectionEnd, setSelectionEnd,
		loading, setLoading,
		error, setError,
		ctxModel, setCtxModel,
		runtimeProvider, setRuntimeProvider,
		runtimeBaseUrl, setRuntimeBaseUrl,
		runtimeApiKey, setRuntimeApiKey,
		runtimeCustomProvider, setRuntimeCustomProvider,
		scrollOffset, setScrollOffset,
		history, setHistory,
		historyIndex, setHistoryIndex,
		sessionId, setSessionId,
		showWelcome, setShowWelcome,
		sessionCost, setSessionCost,
		thinking, setThinking,
		showThinking, setShowThinking,
		thinkingDots, setThinkingDots,
		showCommandPalette, setShowCommandPalette,
		showDashboard, setShowDashboard,
		pendingQuestion, setPendingQuestion,
		progress, setProgress,
		operationLabel, setOperationLabel,
		showConfigEditor, setShowConfigEditor,
		questionResolverRef
	} = useChatState(model, apiKey, cfg);
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
			const provider = targetProvider.trim().toLowerCase() || normalizedProvider;
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
				return (
					overrideCustomProvider?.apiKey ||
					runtimeCustomProvider?.apiKey
				);
			}

			if (provider === (cfg.provider || "openrouter")) {
				return cfg.apiKey;
			}

			return undefined;
		},
		[cfg.provider, cfg.apiKey, normalizedProvider, runtimeApiKey, runtimeCustomProvider],
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
					: explicitBaseUrl ?? runtimeBaseUrl,
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

	const applyRuntimeProviderState = useCallback((next: RuntimeProviderState) => {
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
	}, []);

	const persistRuntimeProviderState = useCallback((
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
	}, [ctxModel]);

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
	}, [
		cfg,
		ctxModel,
		resolveRuntimeProviderState,
	]);

	const ensureContext = useCallback(async () => {
		if (ctxRef.current) {
			return ctxRef.current;
		}

		const ctx = await createAgentContext(process.cwd(), getActiveConfig(), diffPreview);
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

	const resetConversation = useCallback(async (createNewSession = true) => {
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
		setLoading(false);
		setError("");
		setProgress(0);
		setOperationLabel("");
		costTracker.reset();
		resetTelemetry();
		ctxRef.current = null;
		if (createNewSession) {
			const id = await sessionManager.createSession(process.cwd(), ctxModel, undefined, {
				provider: normalizedProvider,
				baseUrl: runtimeBaseUrl,
				customProvider:
					normalizedProvider === "custom" ? runtimeCustomProvider : undefined,
			});
			setSessionId(id);
		}
	}, [
		ctxModel,
		pendingQuestion,
		normalizedProvider,
		runtimeBaseUrl,
		runtimeCustomProvider,
		abortActiveRequest,
	]);
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

	const terminalHeight = terminalSize.rows;
	const terminalWidth = terminalSize.columns;
	const headerHeight = 3;
	const inputHeight = 3;
	const shouldShowHeader = showWelcome && scrollOffset === 0 && messages.length > 0;
	const headerScrollHeight = shouldShowHeader ? 14 : 0;
	const warningsHeight = configWarnings.length * 4;

	messagesRef.current = messages;

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

	const handleCommandPaletteSelect = useCallback((cmd: CommandItem) => {
		setShowCommandPalette(false);
		if (cmd.action) cmd.action();
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
					"Use: /model <model-name> to switch models.\nExample: /model deepseek-v4-flash\n\nUse /models to see available free models.",
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
		void resetConversation();
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
	}, []);

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
	}, []);

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

  const handleConfig = useCallback(() => {
		setShowConfigEditor(true);
	}, []);

  const handleShowSessions = useCallback(async () => {
		setLoading(true);
		const sessions = await sessionManager.listSessions();
		const list = sessions
			.map((s, i) => {
				const date = new Date(s.updatedAt).toLocaleDateString();
				const time = new Date(s.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
				const msgs = `${s.messageCount} msgs`;
				const tokens = `${s.tokensUsed.toLocaleString()} tokens`;
				const model = s.model.split('/').pop()?.split(':')[0] || s.model;
				return `  ${i + 1}. ${s.name || s.id.slice(0, 8)} (${msgs}, ${tokens}, ${model} | ${date} ${time})`;
			})
			.join("\n");
		setMessages((m) => [
			...m,
			{
				id: msgIdRef.current++,
				role: "system",
				content:
					sessions.length > 0
						? `Saved sessions (${sessions.length} total):\n${list}\n\nUse: /load <id> | /search <query>`
						: "No saved sessions",
			},
		]);
		setLoading(false);
	}, []);


	const handleShowModels = useCallback(
		async (opts?: {
			provider?: string;
			apiKey?: string;
			baseUrl?: string;
		}) => {
		setLoading(true);
			const provider = opts?.provider?.trim().toLowerCase() || normalizedProvider;
			const resolved = resolveRuntimeProviderState(provider, {
				baseUrl: opts?.baseUrl,
				apiKey: opts?.apiKey,
			});
			const base = resolveBaseUrlForProvider(
				provider,
				resolved.baseUrl,
			);
		setMessages((m) => [
			...m,
			{
				id: msgIdRef.current++,
				role: "system",
				content: `Fetching live models + accurate specs for ${provider || "current"}...`,
			},
		]);

		try {
			const rich = await listModelsForProvider(
				provider || "openrouter",
				{
					apiKey: resolved.apiKey,
					baseUrl: base,
					headers: resolved.customProvider?.headers,
				},
			);

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
		}, [normalizedProvider, resolveRuntimeProviderState]);

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
						content:
							`Supported providers:\n${list}\n\nUse: /provider <id>   Then /models for current provider's catalog.`,
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
						? runtimeCustomProvider || normalizeCustomProvider(cfg.customProvider)
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
			ctxModel,
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
			const limit = 30;
			const displaySessions = sessions.slice(0, limit);
			const list = displaySessions
				.map((s, i) => `${i + 1}. ${s.name || s.id.slice(0, 8)} (${s.messageCount} msgs)`)
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
	}, []);

  const handleSearchSessions = useCallback(async (query: string) => {
		setLoading(true);
		const results = await sessionManager.searchSessions(query);
		const list = results
			.map((s, i) => {
				const date = new Date(s.updatedAt).toLocaleDateString();
				const time = new Date(s.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
				const msgs = `${s.messageCount} msgs`;
				const tokens = `${s.tokensUsed.toLocaleString()} tokens`;
				const model = s.model.split('/').pop()?.split(':')[0] || s.model;
				return `  ${i + 1}. ${s.name || s.id.slice(0, 8)} (${msgs}, ${tokens}, ${model} | ${date} ${time})`;
			})
			.join("\n");
		setMessages((m) => [
			...m,
			{
				id: msgIdRef.current++,
				role: "system",
				content:
					results.length > 0
						? `Search results for "${query}" (${results.length}):\n${list}\n\nUse: /load <id>`
						: `No sessions found for "${query}"`,
			},
		]);
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
					const apiKey = apiKeys[provider as keyof typeof apiKeys] as string | undefined;
					
					const liveModels = await listModelsForProvider(provider, { apiKey, baseUrl: globalConfig.get("apiBaseUrl") });
					return liveModels.map(m => ({ id: m.id, name: m.name || m.id }));
				},
				getSavedSessions: async () => {
					const { sessionManager } = await import("../../session/manager.js");
					const sessions = await sessionManager.listSessions();
					return sessions.map(s => ({
						id: s.id,
						name: s.name || s.id,
						date: new Date(s.updatedAt).toLocaleString()
					}));
				}
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
			ensureContext,
			resetConversation,
		],
	);

	// Calculate command suggestions count to dynamically adjust layout (now 0 because palette handles it)
	const suggestionsCount = 0;

	// Account for command palette height if open
	const paletteHeight = showCommandPalette ? 16 : 0;

	const chatViewportHeight = Math.max(
		3,
		terminalHeight - headerHeight - inputHeight - 4 - headerScrollHeight - warningsHeight - suggestionsCount - paletteHeight,
	);
	const contentMaxWidth = Math.min(terminalWidth - 4, 120);

	const totalMessageLines = useMemo(() => {
		let lines = messages.reduce((acc, msg) => acc + computeMessageLines(msg, contentMaxWidth), 0);
		if (showWelcome) {
			lines += messages.length > 0 ? 3 : 12; // Approximate height of the TehutiHeader (compact or full)
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
	}, [totalMessageLines, chatViewportHeight]);

	useEffect(() => {
		setHistory(loadHistory());

		let mounted = true;
		let controller = new AbortController();

		async function initSession() {
			try {
				const recentId = await sessionManager.getRecentSession(process.cwd());
				if (recentId && mounted && !controller.signal.aborted) {
					const data = await sessionManager.loadSession(recentId);
					if (data && data.messages.length > 0 && mounted && !controller.signal.aborted) {
						const loadedProvider = data.metadata.provider?.trim().toLowerCase();
						const loadedBaseUrl = data.metadata.baseUrl?.trim();
						const loadedCustomProvider = normalizeCustomProvider(data.metadata.customProvider);
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
							return;
						}
					}
				}

				if (mounted && !controller.signal.aborted) {
					const bootstrap = resolveRuntimeProviderState();
					const id = await sessionManager.createSession(process.cwd(), ctxModel, undefined, {
						provider: bootstrap.provider,
						baseUrl: bootstrap.baseUrl,
						customProvider:
							bootstrap.provider === "custom"
								? bootstrap.customProvider
								: undefined,
					});
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
		};
	}, []);

	useEffect(() => {
		let thinkingTimer: NodeJS.Timeout;
		if (showThinking) {
			let dotCount = 0;
			thinkingTimer = setInterval(() => {
				dotCount = (dotCount + 1) % 4;
				setThinkingDots(".".repeat(dotCount));
			}, 400);
		}

		return () => {
			if (batchTimerRef.current) {
				clearTimeout(batchTimerRef.current);
				batchTimerRef.current = null;
			}
			if (thinkingTimer) {
				clearInterval(thinkingTimer);
			}
		};
	}, [showThinking]);

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

	// For performance, we only render the messages that intersect the viewport plus a buffer
	// (we rely on Ink's overflow="hidden" + negative margin for the actual virtualization slice)
	const visibleMessages = useMemo(() => {
		const linesNeeded = chatViewportHeight + scrollOffset + 20; // 20 lines buffer
		let accumulatedLines = 0;
		let sliceIndex = messages.length;
		
		for (let i = messages.length - 1; i >= 0; i--) {
			accumulatedLines += computeMessageLines(messages[i], contentMaxWidth);
			sliceIndex = i;
			if (accumulatedLines >= linesNeeded) {
				break;
			}
		}
		
		// Always render at least 50 messages as a baseline
		return messages.slice(Math.min(sliceIndex, Math.max(0, messages.length - 50)));
	}, [messages, scrollOffset, chatViewportHeight, contentMaxWidth]);

	const scrollToBottom = useCallback(() => {
		messagesEndRef.current = true;
		setScrollOffset(0);
	}, []);

	const scrollToTop = useCallback(() => {
		messagesEndRef.current = false;
		setScrollOffset(Math.max(0, totalMessageLines - chatViewportHeight));
	}, [totalMessageLines, chatViewportHeight]);

	const scrollPageUp = useCallback(() => {
		messagesEndRef.current = false;
		const maxOff = Math.max(0, totalMessageLines - chatViewportHeight);
		setScrollOffset((off) => Math.min(maxOff, off + chatViewportHeight));
	}, [totalMessageLines, chatViewportHeight]);

	const scrollPageDown = useCallback(() => {
		setScrollOffset((off) => {
			const newOff = Math.max(0, off - chatViewportHeight);
			if (newOff <= 0) messagesEndRef.current = true;
			return newOff;
		});
	}, [chatViewportHeight]);

	const scrollLineUp = useCallback(() => {
		messagesEndRef.current = false;
		const maxOff = Math.max(0, totalMessageLines - chatViewportHeight);
		setScrollOffset((off) => Math.min(maxOff, off + 1));
	}, [totalMessageLines, chatViewportHeight]);

	const scrollLineDown = useCallback(() => {
		setScrollOffset((off) => {
			const newOff = Math.max(0, off - 1);
			if (newOff <= 0) messagesEndRef.current = true;
			return newOff;
		});
	}, []);

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
				const sessions = await sessionManager.listSessions();
				const limit = 30;
				const displaySessions = sessions.slice(0, limit);
				const list = displaySessions
					.map((s, i) => {
						const date = new Date(s.updatedAt).toLocaleDateString();
						const time = new Date(s.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
						const msgs = `${s.messageCount} msgs`;
						const tokens = `${s.tokensUsed.toLocaleString()} tokens`;
						const model = s.model.split('/').pop()?.split(':')[0] || s.model;
						return `  ${i + 1}. ${s.name || s.id.slice(0, 8)} (${msgs}, ${tokens}, ${model} | ${date} ${time})`;
					})
					.join("\n");
				setMessages((m) => [
					...m,
					{
						id: msgIdRef.current++,
						role: "system",
						content:
							sessions.length > 0
								? `Saved sessions (${sessions.length} total, showing recent ${displaySessions.length}):\n${list}\n\nUse: /load <id> | /search <query>`
								: "No saved sessions",
					},
				]);
				setLoading(false);
				return;
			}

			if (text.toLowerCase().startsWith("/search ")) {
				const query = text.slice(8).trim();
				await handleSearchSessions(query);
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
				const data = await sessionManager.loadSession(id);
			if (data && data.messages.length > 0) {
					const loadedProvider = data.metadata.provider?.trim().toLowerCase();
					const loadedBaseUrl = data.metadata.baseUrl?.trim();
					const loadedCustomProvider = normalizeCustomProvider(data.metadata.customProvider);
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
							content: `Session not found: ${id}`,
						},
					]);
				}
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

		setMessages((m) => [...m, { id: userMsgId, role: "user", content: text }]);
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
			let currentToolName = "";

			setMessages((m) => [
				...m.filter((msg) => msg.id !== assistantMsgId),
				{ id: assistantMsgId, role: "assistant", content: "", toolCalls: [], blocks: [] },
			]);

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

					setMessages((m) =>
						m.map((msg) => {
							if (msg.id !== assistantMsgId) return msg;
							const blocks = msg.blocks ? [...msg.blocks] : [];
							const lastBlock = blocks[blocks.length - 1];
							if (lastBlock && lastBlock.type === "text") {
								blocks[blocks.length - 1] = {
									...lastBlock,
									content: lastBlock.content + t,
								};
							} else {
								blocks.push({ type: "text", content: t });
							}
							return { ...msg, blocks };
						})
					);
				},
				onToolCall: (name, args) => {
					if (
						!isCurrentRequest(requestId, requestController.signal) ||
						requestController.signal.aborted
					) {
						return;
					}
					flushBatchedTokens();
					currentToolName = name;
					const toolDesc = formatToolCall(name, args);
					const toolCallId = `tool-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
					toolCallsInfo.push({
						id: toolCallId,
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
								id: toolCallId,
								name,
								description: toolDesc,
								result: null,
							});
							return { ...msg, toolCalls: [...toolCallsInfo], blocks };
						})
					);

					setThinking(`  ${toolDesc}`);
					setShowThinking(true);
				},
				onToolResult: (name, result) => {
					if (
						!isCurrentRequest(requestId, requestController.signal) ||
						requestController.signal.aborted
					) {
						return;
					}
					flushBatchedTokens();
					const success =
						result && typeof result === "object" && "success" in result
							? result.success
							: true;
					const formattedResult = formatToolResult(result, terminalWidth - 10);

					if (toolCallsInfo.length > 0) {
						toolCallsInfo[toolCallsInfo.length - 1].result = result;
					}

					setMessages((m) =>
						m.map((msg) => {
							if (msg.id !== assistantMsgId) return msg;
							const blocks = msg.blocks ? [...msg.blocks] : [];
							const lastToolIdx = [...blocks].reverse().findIndex((b) => b.type === "tool");
							if (lastToolIdx !== -1) {
								const idx = blocks.length - 1 - lastToolIdx;
								const toolBlock = blocks[idx];
								if (toolBlock.type === "tool") {
									blocks[idx] = { ...toolBlock, result };
								}
							}
							return { ...msg, toolCalls: [...toolCallsInfo], blocks };
						})
					);

					setThinking("");
					setShowThinking(false);
					currentToolName = "";
				},
				onThinking: (content) => {
					if (
						!isCurrentRequest(requestId, requestController.signal) ||
						requestController.signal.aborted
					) {
						return;
					}
					if (content.length > 0) {
						setThinking(`  💭 Thinking...`);
						setShowThinking(true);

						setMessages((m) =>
							m.map((msg) => {
								if (msg.id !== assistantMsgId) return msg;
								const blocks = msg.blocks ? [...msg.blocks] : [];
								const lastBlock = blocks[blocks.length - 1];
								if (lastBlock && lastBlock.type === "reasoning") {
									blocks[blocks.length - 1] = {
										...lastBlock,
										content: lastBlock.content + content,
									};
								} else {
									blocks.push({ type: "reasoning", content: content });
								}
								return { ...msg, blocks };
							})
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

			const finalContent = result.content || response;
			if ((!finalContent && !response) || (result.success === false && (result as any).error)) {
				setMessages((m) =>
					m.map((msg) =>
						msg.id === assistantMsgId
							? {
									...msg,
									content: (result as any).error ? `Error: ${(result as any).error}` : `No response received. Check your API key with /reset-key or verify network connectivity.`,
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
						return {
							...msg,
							content: finalContent || `Task completed.`,
							toolCalls: [...toolCallsInfo],
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
					"Run with --debug for more details"
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
			(requestController.signal.aborted && requestControllerRef.current === null);
		if (shouldFinalizeRequest) {
			setProgress(100);
			setLoading(false);
			setShowThinking(false);
			setOperationLabel("");
			requestControllerRef.current = null;
		}
	}

	const messageElements = useMemo(() => {
		return visibleMessages.map((m) => {
			let header: React.ReactNode;
			let content: React.ReactNode[];

			if (m.role === "user") {
				const label = `${DECORATIVE.feather} You`;
				const padLen = Math.max(10, contentMaxWidth - label.length - 2);
				const divider = "─".repeat(padLen);
				header = React.createElement(
					Box,
					{ flexDirection: "row", alignItems: "center", marginBottom: 0.5 },
					React.createElement(
						Text,
						{ bold: true, color: CORAL },
						`${label} `,
					),
					React.createElement(
						Text,
						{ color: CORAL, dimColor: true },
						divider,
					),
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
				const padLen = Math.max(10, contentMaxWidth - label.length - 2 - (m.status ? 10 : 0));
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
							React.createElement(StatusIndicator, { status: m.status })
						),
					React.createElement(
						Text,
						{ color: SAND, dimColor: true },
						divider,
					),
				);
				content = [
					React.createElement(
						Text,
						{ key: 0, dimColor: true, wrap: "wrap" },
						m.content,
					),
				];
			} else {
				const label = `${DECORATIVE.ibis} Tehuti`;
				const padLen = Math.max(10, contentMaxWidth - label.length - 2 - (m.status ? 10 : 0));
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
						{ bold: true, color: GREEN },
						`${label} `,
					),
					m.status &&
						React.createElement(
							Box,
							{ marginRight: 1 },
							React.createElement(StatusIndicator, { status: m.status })
						),
					React.createElement(
						Text,
						{ color: GREEN, dimColor: true },
						divider,
					),
				);

				if (m.blocks && m.blocks.length > 0) {
					content = [];
					m.blocks.forEach((block, bIdx) => {
						if (block.type === "text") {
							const subBlocks = parseContentBlocks(block.content);
							subBlocks.forEach((subBlock, sbIdx) => {
								if (subBlock.type === "text") {
									content.push(...renderMarkdown(subBlock.content, contentMaxWidth, `msg-${m.id}-blk-${bIdx}-sub-${sbIdx}`));
								} else if (subBlock.type === "reasoning") {
									const borderLine = "─".repeat(Math.max(10, contentMaxWidth - 22));
									content.push(
										React.createElement(
											Box,
											{ flexDirection: "column", marginTop: 0.5, marginBottom: 0.5, key: `reasoning-${bIdx}-${sbIdx}` },
											React.createElement(
												Box,
												{ flexDirection: "row", alignItems: "center" },
												React.createElement(Text, { color: "gray" }, "  ┌─[ "),
												React.createElement(Text, { color: "cyan" }, `${DECORATIVE.eye} Reasoning`),
												React.createElement(Text, { color: "gray" }, ` ]${borderLine}`),
											),
											React.createElement(
												Box,
												{ paddingLeft: 2, marginY: 0, flexDirection: "column" },
												...renderMarkdown(subBlock.content, contentMaxWidth - 4, `reasoning-${bIdx}-${sbIdx}-md`)
											),
											React.createElement(
												Box,
												{ flexDirection: "row" },
												React.createElement(Text, { color: "gray" }, `  └─${"─".repeat(Math.max(10, contentMaxWidth - 4))}`),
											),
										)
									);
								}
							});
						} else if (block.type === "reasoning") {
							const borderLine = "─".repeat(Math.max(10, contentMaxWidth - 22));
							content.push(
								React.createElement(
									Box,
									{ flexDirection: "column", marginTop: 0.5, marginBottom: 0.5, key: `reasoning-${bIdx}` },
									React.createElement(
										Box,
										{ flexDirection: "row", alignItems: "center" },
										React.createElement(Text, { color: "gray" }, "  ┌─[ "),
										React.createElement(Text, { color: "cyan" }, `${DECORATIVE.eye} Reasoning`),
										React.createElement(Text, { color: "gray" }, ` ]${borderLine}`),
									),
									React.createElement(
										Box,
										{ paddingLeft: 2, marginY: 0, flexDirection: "column" },
										...renderMarkdown(block.content, contentMaxWidth - 4, `reasoning-${bIdx}-md`)
									),
									React.createElement(
										Box,
										{ flexDirection: "row" },
										React.createElement(Text, { color: "gray" }, `  └─${"─".repeat(Math.max(10, contentMaxWidth - 4))}`),
									),
								)
							);
						} else if (block.type === "tool") {
							content.push(
								React.createElement(
									Box,
									{ flexDirection: "column", marginTop: 0.5, marginBottom: 0.5, key: block.id || `tool-${bIdx}` },
									React.createElement(ExpandableToolOutput, {
										toolName: getEnhancedToolName(block.name || "", block.description || ""),
										result: block.result,
										maxWidth: contentMaxWidth,
										status: block.result === null ? "pending" : block.result && typeof block.result === 'object' && 'success' in block.result && !(block.result as any).success ? "error" : "success"
									})
								)
							);
						}
					});
				} else {
					const subBlocks = parseContentBlocks(m.content);
					content = [];
					subBlocks.forEach((subBlock, sbIdx) => {
						if (subBlock.type === "text") {
							content.push(...renderMarkdown(subBlock.content, contentMaxWidth, `msg-${m.id}-sub-${sbIdx}`));
						} else if (subBlock.type === "reasoning") {
							const borderLine = "─".repeat(Math.max(10, contentMaxWidth - 22));
							content.push(
								React.createElement(
									Box,
									{ flexDirection: "column", marginTop: 0.5, marginBottom: 0.5, key: `reasoning-fallback-${sbIdx}` },
									React.createElement(
										Box,
										{ flexDirection: "row", alignItems: "center" },
										React.createElement(Text, { color: "gray" }, "  ┌─[ "),
										React.createElement(Text, { color: "cyan" }, `${DECORATIVE.eye} Reasoning`),
										React.createElement(Text, { color: "gray" }, ` ]${borderLine}`),
									),
									React.createElement(
										Box,
										{ paddingLeft: 2, marginY: 0, flexDirection: "column" },
										...renderMarkdown(subBlock.content, contentMaxWidth - 4, `reasoning-fallback-${sbIdx}-md`)
									),
									React.createElement(
										Box,
										{ flexDirection: "row" },
										React.createElement(Text, { color: "gray" }, `  └─${"─".repeat(Math.max(10, contentMaxWidth - 4))}`),
									),
								)
							);
						}
					});

					if (m.toolCalls && m.toolCalls.length > 0) {
						const toolElements = React.createElement(
							Box,
							{ flexDirection: "column", marginTop: 1, key: `tool-calls-${m.id}` },
							...m.toolCalls.map((tc, idx) =>
								React.createElement(ExpandableToolOutput, {
									key: tc.id || `tool-${idx}`,
									toolName: getEnhancedToolName(tc.name || "", tc.description || ""),
									result: tc.result,
									maxWidth: contentMaxWidth,
									status: tc.result === null ? "pending" : tc.result && typeof tc.result === 'object' && 'success' in tc.result && !(tc.result as any).success ? "error" : "success"
								})
							)
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
					...content,
				),
			);
		});
	}, [visibleMessages, contentMaxWidth]);

	const commandSuggestions = null;

	const renderInput = useMemo(() => {
		const historyIndicator = historyIndex >= 0 
			? React.createElement(Text, { color: SAND, dimColor: true }, ` [${historyIndex + 1}/${history.length}] `)
			: '';

		if (selectionStart !== null && selectionEnd !== null && selectionStart !== selectionEnd) {
			const start = Math.min(selectionStart, selectionEnd);
			const end = Math.max(selectionStart, selectionEnd);
			const before = input.slice(0, start);
			const selected = input.slice(start, end);
			const after = input.slice(end);

			return React.createElement(
				Text,
				{ color: CORAL },
				`${DECORATIVE.feather} >`,
				historyIndicator,
				" ",
				before,
				React.createElement(Text, { backgroundColor: "gray", color: "black" }, selected),
				after
			);
		}

		const before = input.slice(0, cursorPos);
		const after = input.slice(cursorPos);
		return React.createElement(
			Text,
			{ color: CORAL },
			`${DECORATIVE.feather} >`,
			historyIndicator,
			" ",
			before,
			"\u2588",
			after
		);
	}, [input, cursorPos, historyIndex, history.length, selectionStart, selectionEnd]);

	const scrollIndicator = useMemo(() => {
		if (totalMessageLines <= chatViewportHeight) return null;
		
		const currentPosition = messagesEndRef.current 
			? 0 
			: scrollOffset;
		
		// In our inverted setup, offset 0 means bottom, offset max means top
		const maxOff = Math.max(1, totalMessageLines - chatViewportHeight);
		const scrollPercent = 100 - Math.round((currentPosition / maxOff) * 100);
		const barWidth = 10;
		const filledWidth = Math.round((scrollPercent / 100) * barWidth);
		const filled = "█".repeat(filledWidth);
		const empty = "░".repeat(barWidth - filledWidth);
		
		const positionText = messagesEndRef.current || scrollOffset === 0
			? "end"
			: `${Math.round(scrollPercent)}%`;
		
		return React.createElement(
			Box,
			{ flexDirection: "row", alignItems: "center", gap: 1 },
			React.createElement(
				Text,
				{ dimColor: true },
				`${DECORATIVE.eye} ${positionText}`,
			),
			React.createElement(
				Text,
				{ color: GOLD },
				`[${filled}${empty}]`,
			),
		);
	}, [totalMessageLines, chatViewportHeight, scrollOffset]);

		return showConfigEditor ? (
			React.createElement(
			ConfigEditor,
				{
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
							updates.baseUrl !== undefined ? updates.baseUrl?.trim() : runtimeBaseUrl;
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

						if (updates.model !== undefined && updates.model.trim()) {
							setCtxModel(updates.model);
							if (ctxRef.current) {
								ctxRef.current.config.model = updates.model;
							}
						}
						const nextModel =
							updates.model && updates.model.trim()
								? updates.model.trim()
								: ctxModel;
						persistRuntimeProviderState(
							resolvedState,
							{ model: nextModel },
						);
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
				},
			)
		) : (
			React.createElement(
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
						marginBottom: 1
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
					{ flexDirection: "column", flexGrow: 1, paddingX: 1, overflow: "hidden" },
					...configWarnings.map((warn, idx) =>
						React.createElement(
							Box,
							{ key: idx, paddingY: 0, paddingX: 1, marginBottom: 1, borderStyle: "single", borderColor: "yellow" },
							React.createElement(Text, { color: "yellow", bold: true }, `𓂀  Warning: ${warn}`)
						)
					),
					showDashboard && React.createElement(SwarmVisualizer, null),
					messages.length === 0
						? React.createElement(
								Box,
								{ flexGrow: 1, flexDirection: "column", justifyContent: "center", alignItems: "center" },
								showWelcome && React.createElement(TehutiHeader, null),
								!showWelcome && React.createElement(Text, { color: SAND, dimColor: true }, "Type a message to begin")
							)
						: React.createElement(
								Box,
								{ flexDirection: "column", flexGrow: 1, overflow: "hidden", justifyContent: "flex-end" },
								React.createElement(
									Box,
									{ flexDirection: "column", marginBottom: -scrollOffset },
									showWelcome && React.createElement(
										Box,
										{ flexDirection: "column", alignItems: "center", marginBottom: 1 },
										React.createElement(TehutiHeader, { compact: true })
									),
									...messageElements,
								)
							),
					showThinking &&
						React.createElement(
							Box,
							{
								marginBottom: 1,
								paddingLeft: 2,
								flexDirection: "row",
								gap: 1,
							},
							React.createElement(
								Text,
								{ color: SAND, dimColor: true },
								React.createElement(Spinner, { type: "dots" }),
							),
							React.createElement(
								Text,
								{ color: SAND, dimColor: true },
								`${thinking.length > 150 ? "..." + thinking.slice(-150) : thinking}`,
							),
						),
					scrollIndicator &&
						React.createElement(Box, { justifyContent: "center" }, scrollIndicator),
					error &&
						React.createElement(
							Box,
							{ marginTop: 1, paddingX: 1, borderStyle: "round", borderColor: RED },
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
								width: Math.min(contentMaxWidth - 10, 40) 
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
					(showCommandPalette || showConfigEditor)
						? null
						: loading
						? React.createElement(
								Text,
								{ color: SAND, dimColor: true },
								`  ${HIEROGLYPHS.loading[0]} channeling wisdom...`,
							)
						: renderInput,
					(showCommandPalette || showConfigEditor) ? null : commandSuggestions,
				),
				React.createElement(CommandPalette, {
					commands,
					onSelect: handleCommandPaletteSelect,
					onClose: handleCommandPaletteClose,
					visible: showCommandPalette,
				}),
			)
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
	return React.createElement(
		MouseProvider,
		{ autoEnable: true },
		React.createElement(ChatUI, {
			apiKey,
			model,
			diffPreview,
			cfg,
			onExit,
		})
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
		.argument("[prompt]", "One-shot prompt")
		.action(async (prompt, opts) => {
			if (opts.debug) {
				setDebugMode(true);
				debug.enable();
			}
			setupErrorHandlers(opts.debug);

			let provider = opts.provider || process.env.TEHUTI_PROVIDER;

			const cfg = await loadConfig();
			const tehuti = loadTehutiConfig();

			if (opts.resetKey) {
				fs.rmSync(CONFIG_PATH, { force: true });
				console.log("\x1b[38;5;214m  Config reset\x1b[0m\n");
			}

			provider =
				opts.provider ||
				process.env.TEHUTI_PROVIDER ||
				cfg.provider ||
				tehuti.provider ||
				"openrouter";

			const envApiKey = getEnvApiKeyForProvider(provider);
			const envModel = process.env.TEHUTI_MODEL;

			let apiKey = envApiKey || cfg.apiKey || tehuti.apiKey;
			let model =
				opts.model || envModel || cfg.model || tehuti.model || DEFAULT_CONFIG.model;

			const info = getProviderInfo(provider);
			const needsKey = info ? info.requiresApiKey : true;

			if (!tehuti.initialized || (needsKey && !apiKey)) {
				if (prompt || !process.stdout.isTTY) {
					// In one-shot mode or non-interactive terminal, do not prompt for key.
					// Let the API client throw the missing API key error.
				} else {
					const wizardResult = await runSetupWizard();
					apiKey = wizardResult.apiKey;
					model = wizardResult.model;
					provider = wizardResult.provider;
					if (wizardResult.permissions) {
						cfg.permissions = wizardResult.permissions;
					}
					if (wizardResult.mcp) {
						cfg.mcp = wizardResult.mcp;
					}
				}
			}

			cfg.apiKey = apiKey;
			cfg.model = model;
			cfg.provider = provider as any;
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
										outputManager?.writeLine(chalk.hex(CYAN)(`  ${enhancedDesc}`));
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
											result,
											outputManager?.getTerminalWidth?.() || 80,
										);

										if (formattedResult.preview) {
											outputManager?.writeLine(
												chalk.dim(`  ┌─ ${name} result:`),
											);
											outputManager?.writeLine(chalk.dim(formattedResult.preview));
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
											outputManager?.writeLine(
												chalk.hex(PURPLE)(`  💭 Thinking...`),
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
				const { waitUntilExit } = render(
					React.createElement(App, {
						apiKey: apiKey || "",
						model,
						diffPreview,
						cfg,
						onExit: async () => {
							await mcpManager.disconnectAll();
						},
					}),
				);
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

	return program;
}
