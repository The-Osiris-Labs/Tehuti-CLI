import { Box, Text } from "ink";
import React, { useState, useRef, useEffect } from "react";
import stringWidth from "string-width";
import { useOnClick, useOnMouseEnter, useOnMouseLeave } from "@ink-tools/ink-mouse";

interface ExpandableToolOutputProps {
	toolName: string;
	result: unknown;
	maxWidth: number;
	status?: "pending" | "success" | "error";
	defaultExpanded?: boolean;
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
					line.length > maxWidth - 6 ? `${line.slice(0, maxWidth - 9)}...` : line;
				return `  │ ${truncated}`;
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

export function ExpandableToolOutput({
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
	const summary = summarizeToolOutput(result, expanded ? 1000 : width, expanded ? 10000 : 4);

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
	
	// Dynamic header part calculations to prevent wrapping in small terminals
	const staticHeaderWidth = 15 + stringWidth(headerIcon) + stringWidth(headerStatusText);
	const maxToolNameWidth = Math.max(10, width - staticHeaderWidth);
	const truncatedToolName = cleanToolName.length > maxToolNameWidth
		? (cleanToolName.slice(0, Math.max(3, maxToolNameWidth - 3)) + "...")
		: cleanToolName;

	// Left part string calculation for width using truncated name
	const leftStr = `  ┌─[ ${headerIcon} ${truncatedToolName} ]`;
	const leftWidth = stringWidth(leftStr);

	// Right part string calculation for width
	const rightStr = ` [ ${headerStatusText} ]`;
	const rightWidth = stringWidth(rightStr);

	// padLen is the number of "─" to connect them
	const padLen = Math.max(2, width - leftWidth - rightWidth);
	const borderLine = "─".repeat(padLen);

	// Dynamic bottom border calculations
	let footerLabel = summary.isTruncated
		? ` ${summary.lineCount} lines total, ${summary.hiddenLineCount} hidden (click to expand) `
		: expanded
			? ` completed (click to collapse) `
			: ` completed `;

	// Ensure bottom label fits within terminal width to prevent wrapping
	if (8 + stringWidth(footerLabel) > width) {
		footerLabel = summary.isTruncated
			? ` ${summary.lineCount} lines (click to expand) `
			: expanded
				? ` done (click to collapse) `
				: ` done `;
	}
	if (8 + stringWidth(footerLabel) > width) {
		footerLabel = summary.isTruncated
			? ` ${summary.lineCount} lines `
			: ` done `;
	}
	if (8 + stringWidth(footerLabel) > width) {
		footerLabel = summary.isTruncated ? ` ... ` : ``;
	}

	const footerLeft = `  └─[${footerLabel}]`;
	const footerLeftWidth = stringWidth(footerLeft);
	const footerPad = Math.max(2, width - footerLeftWidth);
	const footerLine = `${footerLeft}${"─".repeat(footerPad)}`;

	const borderTextColor = isHovered ? "white" : "gray";

	return (
		<Box ref={boxRef} flexDirection="column" marginTop={0.25} marginBottom={0.25}>
			{/* Top Border & Header */}
			<Box flexDirection="row" alignItems="center">
				<Text color={borderTextColor}>  ┌─[ </Text>
				<Text color={headerColor}>{headerIcon} </Text>
				<Text bold color={headerColor}>{truncatedToolName}</Text>
				<Text color={borderTextColor}> ]{borderLine}[ </Text>
				<Text bold color={headerColor}>{headerStatusText}</Text>
				<Text color={borderTextColor}> ]</Text>
			</Box>

			{/* Tool Output Body */}
			<Box flexDirection="column" marginY={0}>
				<Text dimColor wrap="wrap">{summary.displayContent}</Text>
			</Box>

			{/* Bottom Border */}
			<Box flexDirection="row" alignItems="center">
				<Text color={borderTextColor}>{footerLine}</Text>
			</Box>
		</Box>
	);
}
