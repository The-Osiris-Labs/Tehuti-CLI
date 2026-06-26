import { Box, Text } from "ink";
import type React from "react";

interface ExpandableToolOutputProps {
	toolName: string;
	result: unknown;
	maxWidth: number;
	status?: "pending" | "success" | "error";
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

export function ExpandableToolOutput({
	toolName,
	result,
	maxWidth,
	status,
}: ExpandableToolOutputProps): React.ReactElement {
	const summary = summarizeToolOutput(result, maxWidth);

	return (
		<Box flexDirection="column" marginTop={0.25}>
			{status && (
				<Box>
					<Text color={status === "success" ? "green" : status === "error" ? "red" : "yellow"} dimColor>
						{status.toUpperCase()}
					</Text>
				</Box>
			)}
			<Box marginBottom={0}>
				<Text dimColor wrap="wrap">{summary.displayContent}</Text>
			</Box>
			{summary.isTruncated ? (
				<Box marginLeft={1}>
					<Text color="gray" dimColor>
						{`  └─ ${toolName} result preview (${summary.lineCount} lines total, ${summary.hiddenLineCount} hidden)`}
					</Text>
				</Box>
			) : summary.lineCount > 0 ? (
				<Box marginLeft={1}>
					<Text dimColor color="gray">  └─ {toolName} result ({summary.lineCount} lines)</Text>
				</Box>
			) : null}
		</Box>
	);
}
