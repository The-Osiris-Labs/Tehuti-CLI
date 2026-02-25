import { Box, Text } from "ink";
import type React from "react";
import { symbols } from "../../../terminal/output.js";

interface PermissionPromptProps {
	toolName: string;
	args?: unknown;
	onAllow: () => void;
	onDeny: () => void;
}

export function PermissionPrompt({
	toolName,
	args,
	onAllow: _onAllow,
	onDeny: _onDeny,
}: PermissionPromptProps): React.ReactElement {
	const argsStr = args ? JSON.stringify(args).slice(0, 100) : "";

	return (
		<Box
			flexDirection="column"
			borderStyle="round"
			borderColor="yellow"
			padding={1}
		>
			<Box marginBottom={1}>
				<Text color="yellow" bold>
					{symbols.warning} Permission Required
				</Text>
			</Box>

			<Box marginBottom={1}>
				<Text>Allow Tehuti to use </Text>
				<Text bold color="cyan">
					{toolName}
				</Text>
				<Text>?</Text>
			</Box>

			{argsStr && (
				<Box marginBottom={1}>
					<Text dimColor>{argsStr}</Text>
				</Box>
			)}

			<Box>
				<Text color="green">[Y]</Text>
				<Text> Allow </Text>
				<Text color="red">[N]</Text>
				<Text> Deny</Text>
			</Box>
		</Box>
	);
}
