import React, { useState, useRef } from "react";
import { Box, Text } from "ink";
import { useOnClick, useOnMouseEnter, useOnMouseLeave } from "@ink-tools/ink-mouse";
import { SessionMetadata } from "../../../session/manager.js";
import { BRANDING } from "../../../branding/index.js";

interface SessionListProps {
	sessions: SessionMetadata[];
	onLoadSession: (id: string) => void;
}

function SessionRow({
	session,
	onClick,
}: {
	session: SessionMetadata;
	onClick: () => void;
}) {
	const ref = useRef<any>(null);
	const [isHovered, setIsHovered] = useState(false);

	useOnClick(ref, onClick);
	useOnMouseEnter(ref, () => setIsHovered(true));
	useOnMouseLeave(ref, () => setIsHovered(false));

	const { secondary: GOLD, coral: CORAL, sand: SAND } = BRANDING.colors;
	const dateStr = new Date(session.updatedAt).toLocaleDateString();
	
	const pad = (str: string, length: number) => str.padEnd(length).substring(0, length);
	
	const idText = pad(session.id, 8);
	const nameText = pad(session.name || "Unnamed", 20);
	const msgText = pad(String(session.messageCount || 0), 6);
	const tokenText = pad(String(session.tokensUsed || 0), 8);
	const modelText = pad(session.model || "Unknown", 20);
	const dateText = pad(dateStr, 12);

	return (
		<Box ref={ref} paddingX={1}>
			<Text color={isHovered ? "white" : "gray"}>│ </Text>
			<Text color={isHovered ? GOLD : CORAL}>{idText}</Text>
			<Text color={isHovered ? "white" : "gray"}> │ </Text>
			<Text color={isHovered ? "white" : SAND} bold={isHovered}>{nameText}</Text>
			<Text color={isHovered ? "white" : "gray"}> │ </Text>
			<Text color={isHovered ? "white" : "cyan"}>{msgText}</Text>
			<Text color={isHovered ? "white" : "gray"}> │ </Text>
			<Text color={isHovered ? "white" : "yellow"}>{tokenText}</Text>
			<Text color={isHovered ? "white" : "gray"}> │ </Text>
			<Text color={isHovered ? "white" : "blue"}>{modelText}</Text>
			<Text color={isHovered ? "white" : "gray"}> │ </Text>
			<Text color={isHovered ? "white" : "gray"}>{dateText}</Text>
			<Text color={isHovered ? "white" : "gray"}> │</Text>
		</Box>
	);
}

export function SessionList({ sessions, onLoadSession }: SessionListProps) {
	if (sessions.length === 0) {
		return <Box><Text dimColor>No sessions found.</Text></Box>;
	}

	return (
		<Box flexDirection="column" marginY={1}>
			<Box paddingX={1}>
				<Text color="gray">{"┌" + "─".repeat(84) + "┐"}</Text>
			</Box>
			<Box paddingX={1}>
				<Text color="gray">│ </Text>
				<Text bold>ID      </Text>
				<Text color="gray"> │ </Text>
				<Text bold>Name                </Text>
				<Text color="gray"> │ </Text>
				<Text bold>Msgs  </Text>
				<Text color="gray"> │ </Text>
				<Text bold>Tokens  </Text>
				<Text color="gray"> │ </Text>
				<Text bold>Model               </Text>
				<Text color="gray"> │ </Text>
				<Text bold>Date        </Text>
				<Text color="gray"> │</Text>
			</Box>
			<Box paddingX={1}>
				<Text color="gray">{"├" + "─".repeat(84) + "┤"}</Text>
			</Box>
			{sessions.map((session) => (
				<SessionRow
					key={session.id}
					session={session}
					onClick={() => onLoadSession(session.id)}
				/>
			))}
			<Box paddingX={1}>
				<Text color="gray">{"└" + "─".repeat(84) + "┘"}</Text>
			</Box>
			<Box marginTop={1} paddingX={1}>
				<Text dimColor>💡 Click a row to load the session</Text>
			</Box>
		</Box>
	);
}
