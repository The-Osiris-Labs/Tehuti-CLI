import {
	useOnClick,
	useOnMouseEnter,
	useOnMouseLeave,
} from "@ink-tools/ink-mouse";
import { Box, Text, useInput } from "ink";
import React, { useEffect, useMemo, useRef, useState } from "react";
import stringWidth from "string-width";
// @ts-expect-error TS6133/TS6192: Unused variable
import { BRANDING, HIEROGLYPHS } from "../../../branding/index.js";
import { highlightToAnsi } from "../../../terminal/highlighter.js";
import { useVirtualScroll } from "../hooks/useVirtualScroll.js";
// @ts-expect-error TS6133/TS6192: Unused variable
import { GlobalInputState } from "../input-state.js";
import { StatusBadge } from "./StatusBadge.js";
import {
	ANSI_STRIP_REGEX,
	sliceAnsi,
} from "../../../utils/ansi.js";
import chalk from "chalk";

const disableMouse = process.env.NO_MOUSE || process.env.TEHUTI_DISABLE_MOUSE;

interface ExpandableToolOutputProps {
	toolName: string;
	toolArgs?: unknown;
	result: unknown;
	maxWidth: number;
	status?: "pending" | "success" | "error";
	isCached?: boolean;
	toolType?: "readonly" | "mutating";
	epistemicStatus?: "verified" | "speculative" | "unverified";
	defaultExpanded?: boolean;
	isParallel?: boolean;
}

export interface ToolOutputSummary {
	displayContent: string;
	isTruncated: boolean;
	lineCount: number;
	hiddenLineCount: number;
	rawLines: string[];
}
const MAX_RENDERED_OUTPUT_CHARS = 500000;

function safeStringify(value: unknown): string {
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

export function summarizeToolOutput(
	result: unknown,
	maxWidth: number,
	previewLines: number = 4,
): ToolOutputSummary {
	let output: string;
	if (typeof result === "string") {
		output = result;
	} else if (
		typeof result === "object" &&
		result !== null &&
		"uiOutput" in result &&
		typeof (result as Record<string, unknown>).uiOutput === "string"
	) {
		output = (result as Record<string, unknown>).uiOutput as string;
	} else if (
		typeof result === "object" &&
		result !== null &&
		"output" in result
	) {
		const record = result as Record<string, unknown>;
		const outputValue = String(record.output ?? "");
		const errValue = record.error !== undefined ? String(record.error) : null;
		if (record.success === false) {
			// Always show error prominently, with output as context below
			if (errValue && outputValue) {
				output = `[ERROR] ${errValue}\n\n${outputValue}`;
			} else if (errValue) {
				output = `[ERROR] ${errValue}`;
			} else {
				output = outputValue;
			}
		} else {
			output = outputValue;
		}
	} else if (
		result &&
		typeof result === "object" &&
		("preview" in result || "full" in result)
	) {
		output = String(
			(result as { full?: unknown; preview?: unknown }).full ||
				(result as { full?: unknown; preview?: unknown }).preview ||
				safeStringify(result),
		);
	} else {
		output = safeStringify(result);
	}

	if (output.trim() === "") {
		output = "(empty output)";
	}

	if (output.length > MAX_RENDERED_OUTPUT_CHARS) {
		output = `${output.slice(0, MAX_RENDERED_OUTPUT_CHARS)}\n... [truncated]`;
	}

	const lines = output.split("\n").filter(Boolean);
	const isTruncated = lines.length > previewLines;
	const formatLines = (lineArray: string[]): string =>
		lineArray
			.map((line) => {
				const truncated =
					stringWidth(line) > maxWidth - 4
						? `${sliceAnsi(line, maxWidth - 7)}...`
						: line;
				return truncated;
			})
			.join("\n");

	return {
		displayContent: formatLines(
			isTruncated ? lines.slice(0, previewLines) : lines,
		),
		isTruncated,
		lineCount: lines.length,
		hiddenLineCount: isTruncated ? lines.length - previewLines : 0,
		rawLines: lines,
	};
}

function stripAnsi(str: string): string {
	return str.replace(ANSI_STRIP_REGEX, "");
}
const FILE_OPS: Record<string, true> = {
	write: true,
	write_file: true,
	edit: true,
	edit_file: true,
	apply_diff: true,
	apply_patch: true,
};

interface DiffCounts {
	added: number;
	removed: number;
}

function countDiffLines(text: string): DiffCounts | null {
	const lines = text.split("\n");
	let added = 0;
	let removed = 0;
	for (const raw of lines) {
		const line = raw.trimEnd();
		if (line.startsWith("+") && !line.startsWith("+++")) added++;
		else if (line.startsWith("-") && !line.startsWith("---")) removed++;
	}
	return added > 0 || removed > 0 ? { added, removed } : null;
}

function formatDiffAnsi(line: string): string {
	const trimmed = line.trimStart();
	if (trimmed.startsWith("diff --git"))
		return chalk.bold.hex(BRANDING.colors.primary)(line);
	if (trimmed.startsWith("--- ") || trimmed.startsWith("+++ "))
		return chalk.hex(BRANDING.colors.sand)(line);
	if (trimmed.startsWith("@@")) return chalk.cyan(line);
	if (trimmed.startsWith("+") && !trimmed.startsWith("+++")) return chalk.green(line);
	if (trimmed.startsWith("-") && !trimmed.startsWith("---")) return chalk.red(line);
	return line;
}

function looksLikeDiff(text: string): boolean {
	const lines = text.split("\n");
	const checkCount = Math.min(lines.length, 15);
	for (let i = 0; i < checkCount; i++) {
		const line = lines[i];
		if (
			line.startsWith("diff --git") ||
			line.startsWith("--- ") ||
			line.startsWith("+++ ") ||
			/^@@ -\d+/.test(line)
		) {
			return true;
		}
	}
	return false;
}

function extractResultText(result: unknown): string {
	if (typeof result === "string") return result;
	if (result && typeof result === "object") {
		const obj = result as Record<string, unknown>;
		if (typeof obj.output === "string") return obj.output;
		if (typeof obj.content === "string") return obj.content;
		if (typeof obj.error === "string") return obj.error;
		return safeStringify(result);
	}
	return safeStringify(result);
}

function extractFilePath(args: unknown): string | null {
	if (!args || typeof args !== "object") return null;
	const obj = args as Record<string, unknown>;
	return (
		(obj.file_path as string | undefined) ??
		(obj.file as string | undefined) ??
		(obj.path as string | undefined) ??
		(obj.destination as string | undefined) ??
		null
	);
}



export const ExpandableToolOutput = React.memo(function ExpandableToolOutput({
	toolName,
	toolArgs,
	result,
	maxWidth,
	status,
	isCached = false,
	toolType,
	epistemicStatus,
	defaultExpanded = false,
}: ExpandableToolOutputProps): React.ReactElement {
	const [expanded, setExpanded] = useState(defaultExpanded);
	const startTimeRef = useRef<number>(Date.now());
	const [duration, setDuration] = useState<number | null>(null);
	const [isHovered, setIsHovered] = useState(false);
	const boxRef = useRef(null);

	useOnClick(boxRef, () => {
		setExpanded((prev: boolean) => !prev);
	});

	useOnMouseEnter(
		boxRef,
		disableMouse
			? () => {}
			: () => {
					setIsHovered(true);
				},
	);
	useOnMouseLeave(
		boxRef,
		disableMouse
			? () => {}
			: () => {
					setIsHovered(false);
				},
	);

	// @ts-expect-error TS6133/TS6192: Unused variable
	const DECORATIVE = {
		eye_ra: "𓁹",
		eye_horus: "𓂀",
		ankh: "𓋹",
	};

	useEffect(() => {
		if (status === "pending") {
			startTimeRef.current = Date.now();
			if (!expanded) return;
			const interval = setInterval(() => {
				setDuration((Date.now() - startTimeRef.current) / 1000);
			}, 100);
			return () => {
				clearInterval(interval);
			};
		} else {
			const finalDuration = (Date.now() - startTimeRef.current) / 1000;
			setDuration(finalDuration);
		}
	}, [status, expanded]);

	// ── File operation display ──
	const cleanName = toolName.toLowerCase();
	const isFileOp = FILE_OPS[cleanName] === true;
	const fileIcon = isFileOp
		? cleanName === "apply_diff" || cleanName === "apply_patch"
			? "\u{1FA79}"
			: "\u270F\uFE0F"
		: "";
	const filePath = isFileOp && toolArgs
		? extractFilePath(toolArgs)
		: null;
	const diffStats: DiffCounts | null = isFileOp && result
		? countDiffLines(extractResultText(result))
		: null;

	const { summary, borderTextColor } = useMemo(() => {
		const sum = summarizeToolOutput(result, maxWidth, expanded ? 10000 : 12);

		let borderColor: string = BRANDING.colors.sand;
		if (status === "pending") {
			borderColor = BRANDING.colors.gold;
		} else if (status === "error") {
			borderColor = BRANDING.colors.red;
		} else if (status === "success") {
			borderColor = BRANDING.colors.green;
		}

		return {
			summary: sum,
			borderTextColor: borderColor,
		};
	}, [result, maxWidth, expanded, status]);

	const {
		windowStart,
		windowEnd,
		scrollUp,
		scrollDown,
		scrollPageUp,
		scrollPageDown,
		moveToStart,
		moveToEnd,
	} = useVirtualScroll({
		totalItems: expanded ? summary.rawLines.length : 0,
		maxVisibleWindow: 40,
	});

	useInput((_input, key) => {
		if (!isHovered || !expanded) return;
		if (key.upArrow) scrollUp();
		if (key.downArrow) scrollDown();
		if (key.pageUp) scrollPageUp();
		if (key.pageDown) scrollPageDown();
		if ((key as any).home) moveToStart();
		if ((key as any).end) moveToEnd();
		if (_input === "q" || _input === "Q" || key.escape) {
			setExpanded(false);
		}
	});

	const durStr = duration !== null ? `${duration.toFixed(1)}s` : "";

	let headerStatusText = "";
	let headerColor = "";
	let badgeKind: "running" | "success" | "error" = "success";

	if (status === "pending") {
		badgeKind = "running";
		headerStatusText = `RUNNING • ${durStr}`;
		headerColor = BRANDING.colors.gold;
	} else if (status === "success") {
		badgeKind = "success";
		headerStatusText = isCached
			? `SUCCESS (CACHED) • ${durStr}`
			: `SUCCESS • ${durStr}`;
		headerColor = BRANDING.colors.green;
	} else {
		badgeKind = "error";
		headerStatusText = `FAILED • ${durStr}`;
		headerColor = BRANDING.colors.red;
	}

	const cleanToolName = stripAnsi(toolName);

	const maxToolNameWidth = Math.max(
		10,
		maxWidth - stringWidth(headerStatusText) - 15,
	);
	const truncatedToolName =
		stringWidth(cleanToolName) > maxToolNameWidth
			? `${sliceAnsi(cleanToolName, maxToolNameWidth - 3)}...`
			: cleanToolName;

	const language = useMemo(() => {
		const name = toolName.toLowerCase();
		if (name.includes("bash") || name.includes("cmd")) return "bash";
		if (name.includes("read") || name.includes("write")) {
			if (String(result).trim().startsWith("{")) return "json";
			return "typescript";
		}
		return undefined;
	}, [toolName, result]);

	const visibleLines = useMemo(() => {
		let lines = summary.rawLines;
		if (!expanded) {
			lines = lines.slice(0, 4);
		} else {
			lines = lines.slice(windowStart, windowEnd);
		}
		return lines.map((l) => l.replace(/\t/g, "  ").replace(/[\u202F\u00A0]/g, " "));
	}, [summary.rawLines, windowStart, windowEnd, expanded]);

	const highlightedLines = useMemo(() => {
		if (isFileOp) {
			return visibleLines.map((line) => formatDiffAnsi(line));
		}
		const text = visibleLines.join("\n");
		if (looksLikeDiff(text)) {
			return visibleLines.map((line) => formatDiffAnsi(line));
		}
		if (!language) return visibleLines;
		const ansi = highlightToAnsi(text, language);
		return ansi.split("\n");
	}, [visibleLines, language, isFileOp]);

	const blockWidth = Math.max(10, maxWidth - 6);
	const contentWidth = Math.max(2, blockWidth - 4); // '│ ' + ' │' takes 4 chars

	const renderedBlock = useMemo(() => {
		const top = `╭${"─".repeat(contentWidth + 2)}╮`;
		const bottom = `╰${"─".repeat(contentWidth + 2)}╯`;

		const lines = highlightedLines.map((line: string) => {
			const visualLen = stringWidth(stripAnsi(line));
			let padded: string;
			if (visualLen > contentWidth) {
				const sliced = sliceAnsi(line, contentWidth - 3);
				const slicedLen = stringWidth(stripAnsi(sliced));
				padded = `${sliced}...${" ".repeat(Math.max(0, contentWidth - slicedLen - 3))}`;
			} else {
				padded = `${line}${" ".repeat(Math.max(0, contentWidth - visualLen))}`;
			}
			return `│ ${padded} │`;
		});

		return [top, ...lines, bottom].join("\n");
	}, [highlightedLines, contentWidth]);

	const expandedIcon = expanded ? "▼" : "▶";

	const footerLabel =
		status === "pending"
			? "running..."
			: expanded && summary.rawLines.length > 40
				? `Lines ${windowStart + 1}-${windowEnd} of ${summary.lineCount} (hover & use ↑/↓/PgUp/PgDn/Home/End, q to close)`
				: summary.isTruncated && !expanded
					? `${summary.lineCount} lines total, ${summary.hiddenLineCount} hidden`
					: `completed`;

	const errorBlock = useMemo(() => {
		if (status !== "error") return null;
		const label = " FAILED ";
		const labelWidth = stringWidth(label);
		const sideLen = Math.max(0, Math.floor((contentWidth * 2 + 2 - labelWidth) / 2));
		const errTop = `╭${"─".repeat(sideLen)}${label}${"─".repeat(sideLen)}╮`;
		const errBot = `╰${"─".repeat(contentWidth * 2 + 2)}╯`;
		const lines = highlightedLines.map((line: string) => {
			const visualLen = stringWidth(stripAnsi(line));
			let padded: string;
			if (visualLen > contentWidth) {
				const sliced = sliceAnsi(line, contentWidth - 3);
				const slicedLen = stringWidth(stripAnsi(sliced));
				padded = `${sliced}...${" ".repeat(Math.max(0, contentWidth - slicedLen - 3))}`;
			} else {
				padded = `${line}${" ".repeat(Math.max(0, contentWidth - visualLen))}`;
			}
			return `│ ${padded} │`;
		});
		return [errTop, ...lines, errBot].join("\n");
	}, [status, highlightedLines, contentWidth]);

	const displayContent = errorBlock ?? renderedBlock;

	return (
		<Box
			ref={boxRef}
			flexDirection="column"
			marginTop={0}
			marginBottom={1}
			paddingLeft={1}
			borderStyle="single"
			borderLeft={status !== "error"}
			borderTop={status === "error"}
			borderRight={status === "error"}
			borderBottom={status === "error"}
			borderColor={borderTextColor}
			width={maxWidth}
			overflow="hidden"
		>
			<Box flexDirection="row" justifyContent="space-between" width="100%">
				<Box flexDirection="row" gap={1} alignItems="center">
					<Text color={borderTextColor}>{expandedIcon}</Text>
					<StatusBadge compact kind={badgeKind} />
					{fileIcon && <Text>{fileIcon}</Text>}
					<Text bold color={headerColor}>
						{truncatedToolName}
					</Text>
					{filePath && <Text dimColor>{filePath}</Text>}
					{diffStats && (
						<Text dimColor>
							(+{diffStats.added}/-{diffStats.removed})
						</Text>
					)}
					{isCached && (
						<StatusBadge compact={false} emphasize={true} kind="cached" />
					)}
					{toolType === "readonly" && (
						<StatusBadge compact={false} emphasize={true} kind="readonly" />
					)}
					{toolType === "mutating" && (
						<StatusBadge compact={false} emphasize={true} kind="mutating" />
					)}
					{epistemicStatus === "verified" && (
						<StatusBadge compact={false} emphasize={true} kind="verified" />
					)}
					{epistemicStatus === "speculative" && (
						<StatusBadge compact={false} emphasize={true} kind="speculative" />
					)}
				</Box>
				<Box>
					<Text
						bold
						dimColor={status === "success"}
						color={status === "success" ? undefined : headerColor}
					>
						{headerStatusText}
					</Text>
				</Box>
			</Box>

			<Box flexDirection="column" marginY={1} paddingLeft={2}>
				<Text dimColor={!expanded} wrap="truncate-end">{displayContent}</Text>
			</Box>

			<Box flexDirection="row" paddingLeft={2}>
				<Text dimColor>{footerLabel}</Text>
			</Box>
		</Box>
	);
});
