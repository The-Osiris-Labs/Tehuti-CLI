import { Box, Text } from "ink";
import type React from "react";

const CLAUDE_ORANGE = "#E67D22";

interface StatusBarProps {
	model: string;
	cwd: string;
	tokensUsed?: number;
	toolCalls?: number;
}

export function StatusBar({
	model,
	cwd,
	tokensUsed,
	toolCalls,
}: StatusBarProps): React.ReactElement {
	const shortCwd = cwd.split("/").slice(-2).join("/");

	return (
		<Box justifyContent="space-between" width="100%" paddingX={1}>
			<Box>
				<Text bold color={CLAUDE_ORANGE}>
					Tehuti
				</Text>
				<Text dimColor> | </Text>
				<Text dimColor>{shortCwd}</Text>
			</Box>

			<Box>
				<Text dimColor>Model: </Text>
				<Text color="cyan">{model}</Text>
				{tokensUsed !== undefined && (
					<>
						<Text dimColor> | Tokens: </Text>
						<Text>{tokensUsed.toLocaleString()}</Text>
					</>
				)}
				{toolCalls !== undefined && (
					<>
						<Text dimColor> | Tools: </Text>
						<Text>{toolCalls}</Text>
					</>
				)}
			</Box>
		</Box>
	);
}
