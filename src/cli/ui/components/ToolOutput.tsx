import { Box, Text } from "ink";
import type React from "react";
import { symbols } from "../../../terminal/output.js";

interface ToolOutputProps {
	toolName: string;
	args?: Record<string, unknown>;
	result?: Record<string, unknown>;
	error?: string;
	isRunning?: boolean;
}

export function ToolOutput({
	toolName,
	args,
	result,
	error,
	isRunning,
}: ToolOutputProps): React.ReactElement {
	return (
		<Box flexDirection="column" marginY={1}>
			<Box>
				<Text color="cyan">{symbols.arrow} </Text>
				<Text bold color="yellow">
					{toolName}
				</Text>
				{isRunning && <Text dimColor> (running...)</Text>}
			</Box>

			{args && (
				<Box marginLeft={2}>
					<Text dimColor>
						{JSON.stringify(args).slice(0, 80)}
						{JSON.stringify(args).length > 80 ? "..." : ""}
					</Text>
				</Box>
			)}

			{error && (
				<Box marginLeft={2}>
					<Text color="red">
						{symbols.error} {error}
					</Text>
				</Box>
			)}

			{result && !error && (
				<Box marginLeft={2}>
					<Text color="green">{symbols.success} Completed</Text>
				</Box>
			)}
		</Box>
	);
}
