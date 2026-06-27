import { Box, Text } from "ink";
import React, { useState, useRef, useEffect, useMemo } from "react";
import stringWidth from "string-width";
import { useOnClick, useOnMouseEnter, useOnMouseLeave } from "@ink-tools/ink-mouse";
import { highlightToAnsi } from "../../../terminal/highlighter.js";

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
		"output" in result
	) {
		output = String((result as Record<string, unknown>).output);
	} else if (
		result &&
		typeof result === "object" &&
		("preview" in result || "full" in result)
	) {
		output = String(
			(result as { full?: unknown; preview?: unknown }).full ||
				(result as { full?: unknown; preview?: unknown }).preview ||
				JSON.stringify(result),
		);
	} else {
		output = JSON.stringify(result, null, 2);
	}

	if (output.length > 8000) {
		output = `${output.slice(0, 8000)}\n... [truncated]`;
	}

	const lines = output.split("\n").filter(Boolean);
	const isTruncated = lines.length > previewLines;
	const formatLines = (lineArray: string[]): string =>
		lineArray
			.map((line) => {
				const truncated =
					line.length > maxWidth - 4 ? `${line.slice(0, maxWidth - 7)}...` : line;
				return truncated;
			})
			.join("\n");

	return {
		displayContent: formatLines(isTruncated ? lines.slice(0, previewLines) : lines),
		isTruncated,
		lineCount: lines.length,
		hiddenLineCount: isTruncated ? lines.length - previewLines : 0,
	};
}

function stripAnsi(str: string): string {
	return str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, "");
}

export const ExpandableToolOutput = React.memo(function ExpandableToolOutput({
	toolName,
	result,
	maxWidth,
	status,
	defaultExpanded = false,
	isParallel = false,
}: ExpandableToolOutputProps): React.ReactElement {
	const [expanded, setExpanded] = useState(defaultExpanded);
	const startTimeRef = useRef<number>(Date.now());
	const [duration, setDuration] = useState<number | null>(null);
	const [spinnerFrame, setSpinnerFrame] = useState(0);
	const [isHovered, setIsHovered] = useState(false);
	const boxRef = useRef<any>(null);

	useOnClick(boxRef, () => {
		setExpanded((prev) => !prev);
	});

	useOnMouseEnter(boxRef, () => setIsHovered(true));
	useOnMouseLeave(boxRef, () => setIsHovered(false));

	const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
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
				setSpinnerFrame((f) => (f + 1) % SPINNER_FRAMES.length);
			}, 80);
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
	const summary = useMemo(() => 
		summarizeToolOutput(result, expanded ? 10000 : width - 4, expanded ? 10000 : 4),
	[result, expanded, width]);

	const durStr = duration !== null ? `${duration.toFixed(1)}s` : "";

	let headerIcon = "";
	let headerStatusText = "";
	let headerColor = "";

	if (status === "pending") {
		headerIcon = SPINNER_FRAMES[spinnerFrame];
		headerStatusText = `RUNNING • ${durStr}`;
		headerColor = "yellow";
	} else if (status === "success") {
		headerIcon = DECORATIVE.ankh;
		headerStatusText = `SUCCESS • ${durStr}`;
		headerColor = "green";
	} else {
		headerIcon = DECORATIVE.eye_horus;
		headerStatusText = `FAILED • ${durStr}`;
		headerColor = "red";
	}

	const cleanToolName = stripAnsi(toolName);
	
	const maxToolNameWidth = Math.max(10, width - 20 - stringWidth(headerStatusText));
	const truncatedToolName = cleanToolName.length > maxToolNameWidth
		? (cleanToolName.slice(0, Math.max(3, maxToolNameWidth - 3)) + "...")
		: cleanToolName;

	let footerLabel = summary.isTruncated
		? `${summary.lineCount} lines total, ${summary.hiddenLineCount} hidden (click to expand)`
		: expanded
			? `completed (click to collapse)`
			: `completed`;

	const borderTextColor = isHovered ? "coral" : "gray";

	const isJson = useMemo(() => {
		try {
			if (typeof result !== "string") return true;
			JSON.parse(summary.displayContent);
			return true;
		} catch {
			return false;
		}
	}, [summary.displayContent, result]);

	const displayContent = useMemo(() => {
		if (!expanded) return summary.displayContent;
		return highlightToAnsi(summary.displayContent, isJson ? "json" : "text");
	}, [expanded, summary.displayContent, isJson]);

	return (
		<Box ref={boxRef} flexDirection="column" marginTop={0} marginBottom={1} paddingX={1} borderStyle="round" borderColor={borderTextColor}>
			<Box flexDirection="row" justifyContent="space-between">
				<Box>
					<Text color={headerColor}>{headerIcon} </Text>
					<Text bold color={headerColor}>{truncatedToolName}</Text>
				</Box>
				<Box>
					<Text bold color={headerColor}>{headerStatusText}</Text>
				</Box>
			</Box>

			<Box flexDirection="column" marginY={1}>
				<Text dimColor={!expanded} wrap="wrap">{displayContent}</Text>
			</Box>

			<Box flexDirection="row">
				<Text dimColor>{footerLabel}</Text>
			</Box>
		</Box>
	);
});

