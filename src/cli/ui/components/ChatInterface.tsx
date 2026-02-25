import { Box, render, Text, useApp, useInput } from "ink";
import type React from "react";
import { useState } from "react";
import type { AgentContext } from "../../../agent/context.js";

const CLAUDE_ORANGE = "#E67D22";

interface ChatInterfaceProps {
	context: AgentContext;
	onSubmit: (prompt: string) => Promise<void>;
}

export function ChatInterface({
	context,
	onSubmit,
}: ChatInterfaceProps): React.ReactElement {
	const [input, setInput] = useState("");
	const [isProcessing, setIsProcessing] = useState(false);
	const [messages, setMessages] = useState<
		Array<{ role: string; content: string }>
	>([]);
	const [currentOutput, setCurrentOutput] = useState("");
	const { exit } = useApp();

	useInput((char, key) => {
		if (isProcessing) return;

		if (key.return) {
			if (input.trim().toLowerCase() === "exit") {
				exit();
				return;
			}
			handleSubmit();
			return;
		}

		if (key.backspace || key.delete) {
			setInput((prev) => prev.slice(0, -1));
			return;
		}

		if (key.ctrl && char === "c") {
			exit();
			return;
		}

		setInput((prev) => prev + char);
	});

	const handleSubmit = async () => {
		if (!input.trim() || isProcessing) return;

		const prompt = input.trim();
		setInput("");
		setMessages((prev) => [...prev, { role: "user", content: prompt }]);
		setIsProcessing(true);
		setCurrentOutput("");

		try {
			await onSubmit(prompt);
		} finally {
			setIsProcessing(false);
		}
	};

	return (
		<Box flexDirection="column" padding={1}>
			<StatusBar model={context.config.model} isProcessing={isProcessing} />

			<Box flexDirection="column" marginY={1}>
				{messages.map((msg, i) => (
					<Box key={i} marginBottom={1}>
						<Text color={msg.role === "user" ? CLAUDE_ORANGE : "green"}>
							{msg.role === "user" ? "You: " : "Tehuti: "}
						</Text>
						<Text>{msg.content}</Text>
					</Box>
				))}

				{currentOutput && (
					<Box>
						<Text color="green">Tehuti: </Text>
						<Text>{currentOutput}</Text>
					</Box>
				)}
			</Box>

			<Box borderStyle="round" borderColor="gray" paddingX={1}>
				<Text color={CLAUDE_ORANGE}>{" > "} </Text>
				<Text>{input}</Text>
				{!isProcessing && <Text color="gray">|</Text>}
			</Box>

			{isProcessing && (
				<Box marginTop={1}>
					<Text dimColor>Thinking...</Text>
				</Box>
			)}
		</Box>
	);
}

interface StatusBarProps {
	model: string;
	isProcessing: boolean;
}

function StatusBar({
	model,
	isProcessing,
}: StatusBarProps): React.ReactElement {
	return (
		<Box justifyContent="space-between" width="100%">
			<Box>
				<Text bold color={CLAUDE_ORANGE}>
					Tehuti CLI
				</Text>
			</Box>
			<Box>
				<Text dimColor>Model: {model}</Text>
				{isProcessing && <Text color={CLAUDE_ORANGE}> (working)</Text>}
			</Box>
		</Box>
	);
}

export function renderChatInterface(
	context: AgentContext,
	onSubmit: (prompt: string) => Promise<void>,
): void {
	render(<ChatInterface context={context} onSubmit={onSubmit} />);
}
