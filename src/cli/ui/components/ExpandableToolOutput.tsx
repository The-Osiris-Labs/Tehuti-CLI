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

const disableMouse = process.env.NO_MOUSE || process.env.TEHUTI_DISABLE_MOUSE;

interface ExpandableToolOutputProps {
	toolName: string;
	result: unknown;
	maxWidth: number;
	status?: "pending" | "success" | "error";
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
		output =
			record.success === false && !outputValue && record.error !== undefined
				? String(record.error)
				: outputValue;
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
					GlobalInputState.hoveredComponentCount++;
				},
	);
	useOnMouseLeave(
		boxRef,
		disableMouse
			? () => {}
			: () => {
					setIsHovered(false);
					GlobalInputState.hoveredComponentCount = Math.max(
						0,
						GlobalInputState.hoveredComponentCount - 1,
					);
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

	const width = Math.max(40, maxWidth);
	const summary = useMemo(
		() => summarizeToolOutput(result, width - 4, 4),
		[result, width],
	);

	const { windowStart, windowEnd, moveUp, moveDown } = useVirtualScroll({
		totalItems: expanded ? summary.rawLines.length : 0,
		maxVisibleWindow: 40,
	});

	useInput((_input, key) => {
		if (!isHovered || !expanded) return;
		if (key.upArrow) moveUp();
		if (key.downArrow) moveDown();
	});

	const durStr = duration !== null ? `${duration.toFixed(1)}s` : "";

	let headerIcon = "";
	let headerStatusText = "";
	let headerColor = "";

	if (status === "pending") {
		headerIcon = HIEROGLYPHS.loading[spinnerFrame];
		headerStatusText = `RUNNING • ${durStr}`;
		headerColor = BRANDING.colors.gold;
	} else if (status === "success") {
		headerIcon = DECORATIVE.ankh;
		headerStatusText = `SUCCESS • ${durStr}`;
		headerColor = BRANDING.colors.green;
	} else {
		headerIcon = DECORATIVE.eye_horus;
		headerStatusText = `FAILED • ${durStr}`;
		headerColor = BRANDING.colors.red;
	}

	const cleanToolName = stripAnsi(toolName);

	const maxToolNameWidth = Math.max(
		10,
		width - 20 - stringWidth(headerStatusText),
	);
	const truncatedToolName =
		cleanToolName.length > maxToolNameWidth
			? `${cleanToolName.slice(0, Math.max(3, maxToolNameWidth - 3))}...`
			: cleanToolName;

	const footerLabel =
		status === "pending"
			? "running..."
			: expanded && summary.rawLines.length > 40
				? `Lines ${windowStart + 1}-${windowEnd} of ${summary.lineCount} (hover & use ↑/↓ to scroll)`
				: summary.isTruncated && !expanded
					? `${summary.lineCount} lines total, ${summary.hiddenLineCount} hidden`
					: `completed`;

	const borderTextColor = isHovered
		? BRANDING.colors.coral
		: BRANDING.colors.gray;

	const language = useMemo(() => {
		if (
			toolName === "write_plan" ||
			(typeof result === "object" && result !== null && "uiOutput" in result)
		) {
			return "markdown";
		}
		try {
			if (typeof result !== "string") return "json";
			JSON.parse(summary.displayContent);
			return "json";
		} catch {
			return "text";
		}
	}, [summary.displayContent, result, toolName]);

	const displayContent = useMemo(() => {
		if (!expanded) return summary.displayContent;

		const visibleLines = summary.rawLines.slice(windowStart, windowEnd);
		const formatted = visibleLines
			.map((line) => {
				return stringWidth(line) > width - 4
					? `${sliceAnsi(line, width - 7)}...`
					: line;
			})
			.join("\n");

		return highlightToAnsi(formatted, language);
	}, [
		expanded,
		summary.displayContent,
		summary.rawLines,
		windowStart,
		windowEnd,
		width,
		language,
	]);

	const expandedIcon = expanded ? "▼" : "▶";

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
			<Box flexDirection="row" justifyContent="space-between">
				<Box gap={1}>
					<Text color={headerColor}>{headerIcon}</Text>
					<Text bold color={headerColor}>
						{truncatedToolName}
					</Text>
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
