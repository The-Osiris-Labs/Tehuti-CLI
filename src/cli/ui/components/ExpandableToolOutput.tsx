import {
	useOnClick,
	useOnMouseEnter,
	useOnMouseLeave,
} from "@ink-tools/ink-mouse";
import { Box, Text, useInput } from "ink";
import React, { useEffect, useMemo, useRef, useState } from "react";
import stringWidth from "string-width";
import { BRANDING, HIEROGLYPHS } from "../../../branding/index.js";
import { highlightToAnsi } from "../../../terminal/highlighter.js";
import { useVirtualScroll } from "../hooks/useVirtualScroll.js";
import { GlobalInputState } from "../input-state.js";
import { StatusBadge } from "./StatusBadge.js";

const disableMouse = process.env.NO_MOUSE || process.env.TEHUTI_DISABLE_MOUSE;

interface ExpandableToolOutputProps {
	toolName: string;
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
// biome-ignore lint/complexity/useRegexLiterals: literals with ESC bytes trigger noControlCharactersInRegex.
const ANSI_SEQUENCE_REGEX = new RegExp("^\\x1b\\[[0-9;]*[a-zA-Z]");
// biome-ignore lint/complexity/useRegexLiterals: literals with ESC bytes trigger noControlCharactersInRegex.
const ANSI_STRIP_REGEX = new RegExp(
	"[\\x1b\\x9b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]",
	"g",
);

function safeStringify(value: unknown): string {
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

function sliceAnsi(str: string, limit: number): string {
	let visibleWidth = 0;
	let output = "";
	let i = 0;

	while (i < str.length) {
		const remaining = str.slice(i);
		const match = remaining.match(ANSI_SEQUENCE_REGEX);
		if (match) {
			output += match[0];
			i += match[0].length;
		} else {
			const char = str[i];
			const charWidth = stringWidth(char);
			if (visibleWidth + charWidth > limit) {
				break;
			}
			visibleWidth += charWidth;
			output += char;
			i++;
		}
	}
	if (i < str.length) {
		output += "\x1b[0m";
	}
	return output;
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

export const ExpandableToolOutput = React.memo(function ExpandableToolOutput({
	toolName,
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
	const [spinnerFrame, setSpinnerFrame] = useState(0);
	const [isHovered, setIsHovered] = useState(false);
	const boxRef = useRef(null);

	useOnClick(boxRef, () => {
		setExpanded((prev) => !prev);
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

	const DECORATIVE = {
		eye_ra: "𓁹",
		eye_horus: "𓂀",
		ankh: "𓋹",
	};

	useEffect(() => {
		if (status === "pending") {
			startTimeRef.current = Date.now();
			const interval = setInterval(() => {
				setDuration((Date.now() - startTimeRef.current) / 1000);
			}, 100);
			const spinnerInterval = setInterval(() => {
				setSpinnerFrame((f) => (f + 1) % HIEROGLYPHS.loading.length);
			}, 150);
			return () => {
				clearInterval(interval);
				clearInterval(spinnerInterval);
			};
		} else {
			const finalDuration = (Date.now() - startTimeRef.current) / 1000;
			setDuration(finalDuration);
		}
	}, [status]);

	const { summary, borderTextColor } = useMemo(() => {
		const sum = summarizeToolOutput(
			String(result ?? ""),
			maxWidth,
			expanded ? 10000 : 12,
		);

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
		moveUp,
		moveDown,
		movePageUp,
		movePageDown,
		moveToStart,
		moveToEnd,
	} = useVirtualScroll({
		totalItems: expanded ? summary.rawLines.length : 0,
		maxVisibleWindow: 40,
	});

	useInput((_input, key) => {
		if (!isHovered || !expanded) return;
		if (key.upArrow) moveUp();
		if (key.downArrow) moveDown();
		if (key.pageUp) movePageUp();
		if (key.pageDown) movePageDown();
		if (key.home) moveToStart();
		if (key.end) moveToEnd();
		if (_input === "q" || _input === "Q" || key.escape) {
			setExpanded(false);
		}
	});

	const durStr = duration !== null ? `${duration.toFixed(1)}s` : "";

	let headerIcon = "";
	let headerStatusText = "";
	let headerColor = "";
	let badgeKind: "running" | "success" | "error" = "success";

	if (status === "pending") {
		badgeKind = "running";
		headerIcon = HIEROGLYPHS.loading[spinnerFrame];
		headerStatusText = `RUNNING • ${durStr}`;
		headerColor = BRANDING.colors.gold;
	} else if (status === "success") {
		badgeKind = "success";
		headerIcon = DECORATIVE.ankh;
		headerStatusText = isCached
			? `SUCCESS (CACHED) • ${durStr}`
			: `SUCCESS • ${durStr}`;
		headerColor = BRANDING.colors.green;
	} else {
		badgeKind = "error";
		headerIcon = DECORATIVE.eye_horus;
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
			? `${cleanToolName.substring(0, maxToolNameWidth - 3)}...`
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
		return summary.rawLines.slice(windowStart, windowEnd);
	}, [summary.rawLines, windowStart, windowEnd]);

	const highlightedLines = useMemo(() => {
		const text = visibleLines.join("\n");
		if (!language) return visibleLines;
		const ansi = highlightToAnsi(text, language);
		return ansi.split("\n");
	}, [visibleLines, language]);

	const width = maxWidth - 4;
	const renderedLines = useMemo(() => {
		return highlightedLines.map((line) => {
			const visualLen = stringWidth(stripAnsi(line));
			if (visualLen <= width) return line;
			return `${line.slice(0, width - 3)}...`;
		});
	}, [highlightedLines, width]);

	const expandedIcon = expanded ? "▼" : "▶";

	const footerLabel =
		status === "pending"
			? "running..."
			: expanded && summary.rawLines.length > 40
				? `Lines ${windowStart + 1}-${windowEnd} of ${summary.lineCount} (hover & use ↑/↓/PgUp/PgDn/Home/End, q to close)`
				: summary.isTruncated && !expanded
					? `${summary.lineCount} lines total, ${summary.hiddenLineCount} hidden`
					: `completed`;

	const displayContent = renderedLines.join("\n");

	return (
		<Box
			ref={boxRef}
			flexDirection="column"
			marginTop={0}
			marginBottom={1}
			paddingLeft={1}
			borderStyle="single"
			borderLeft={true}
			borderTop={false}
			borderRight={false}
			borderBottom={false}
			borderColor={borderTextColor}
		>
			<Box flexDirection="row" justifyContent="space-between" width="100%">
				<Box flexDirection="row" gap={1} alignItems="center">
					<Text color={borderTextColor}>{expandedIcon}</Text>
					<StatusBadge compact kind={badgeKind} />
					<Text bold color={headerColor}>
						{truncatedToolName}
					</Text>
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
				<Text dimColor={!expanded} wrap="wrap">
					{displayContent}
				</Text>
			</Box>

			<Box flexDirection="row" paddingLeft={2}>
				<Text dimColor>{footerLabel}</Text>
			</Box>
		</Box>
	);
});
