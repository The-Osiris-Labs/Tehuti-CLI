import { Box, Text } from "ink";
import type React from "react";
import { useState } from "react";

interface ExpandableToolOutputProps {
	toolName: string;
	result: unknown;
	maxWidth: number;
}

export function ExpandableToolOutput({
	toolName,
	result,
	maxWidth,
}: ExpandableToolOutputProps): React.ReactElement {
	const [isExpanded, setIsExpanded] = useState(false);

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
	const PREVIEW_LINES = 5;
	const isTruncated = lines.length > PREVIEW_LINES;

	const formatLines = (lineArray: string[]): string => {
		return lineArray
			.map((line) => {
				const truncated =
					line.length > maxWidth - 4 ? line.slice(0, maxWidth - 7) + "..." : line;
				return `  │ ${truncated}`;
			})
			.join("\n");
	};

	const displayLines = isExpanded ? lines : lines.slice(0, PREVIEW_LINES);
	const displayContent = formatLines(displayLines);

	return (
		<Box flexDirection="column">
			<Box marginBottom={0.5}>
				<Text dimColor>{displayContent}</Text>
			</Box>
			{isTruncated && (
				<Box marginLeft={2}>
					<Text 
						color="cyan"
						underline
					>
						{isExpanded 
							? `▼ Show less (hide ${lines.length - PREVIEW_LINES} lines)` 
							: `▶ Show more (${lines.length - PREVIEW_LINES} more lines)`}
					</Text>
				</Box>
			)}
		</Box>
	);
}
