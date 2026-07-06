import {
	useOnClick,
	useOnMouseEnter,
	useOnMouseLeave,
} from "@ink-tools/ink-mouse";
import { Box, Text, useInput } from "ink";
import React, { useRef, useState } from "react";
import { BRANDING } from "../../../branding/index.js";
import type { SessionMetadata } from "../../../session/manager.js";

interface SessionListProps {
	sessions: SessionMetadata[];
	onLoadSession: (id: string) => void;
	onClose: () => void;
}

function SessionRow({
	session,
	isFocused,
	onClick,
	onHover,
}: {
	session: SessionMetadata;
	isFocused: boolean;
	onClick: () => void;
	onHover: () => void;
}) {
	const ref = useRef<any>(null);
	const [isMouseHovered, setIsMouseHovered] = useState(false);

	const disableMouse =
		process.env.TEHUTI_DISABLE_MOUSE === "1" || process.env.NO_MOUSE === "1";

	useOnClick(ref, disableMouse ? () => {} : onClick);
	useOnMouseEnter(
		ref,
		disableMouse
			? () => {}
			: () => {
					setIsMouseHovered(true);
					onHover();
				},
	);
	useOnMouseLeave(
		ref,
		disableMouse ? () => {} : () => setIsMouseHovered(false),
	);

	const active = isFocused || isMouseHovered;

	const {
		secondary: GOLD,
		coral: CORAL,
		sand: SAND,
		nile: NILE,
	} = BRANDING.colors;
	const dateStr = new Date(session.updatedAt).toLocaleDateString();

	const pad = (str: string, length: number) =>
		str.padEnd(length).substring(0, length);

	const idText = pad(session.id, 8);
	const nameText = pad(session.name || "Unnamed", 20);
	const msgText = pad(String(session.messageCount || 0), 6);
	const tokenText = pad(String(session.tokensUsed || 0), 8);
	const modelText = pad(session.model || "Unknown", 20);
	const dateText = pad(dateStr, 12);

	return (
		<Box ref={ref} paddingX={1}>
			<Text color={active ? GOLD : "gray"}>{active ? "▶" : "│"} </Text>
			<Text color={active ? GOLD : CORAL}>{idText}</Text>
			<Text color={active ? GOLD : "gray"}> │ </Text>
			<Text color={active ? "white" : SAND} bold={active}>
				{nameText}
			</Text>
			<Text color={active ? GOLD : "gray"}> │ </Text>
			<Text color={active ? "white" : "cyan"}>{msgText}</Text>
			<Text color={active ? GOLD : "gray"}> │ </Text>
			<Text color={active ? "white" : "yellow"}>{tokenText}</Text>
			<Text color={active ? GOLD : "gray"}> │ </Text>
			<Text color={active ? "white" : "blue"}>{modelText}</Text>
			<Text color={active ? GOLD : "gray"}> │ </Text>
			<Text color={active ? "white" : "gray"}>{dateText}</Text>
			<Text color={active ? GOLD : "gray"}> │</Text>
		</Box>
	);
}

export function SessionList({
	sessions,
	onLoadSession,
	onClose,
}: SessionListProps) {
	const [selectedIndex, setSelectedIndex] = useState(0);
	const PAGE_SIZE = 15;

	// Keyboard navigation
	useInput((_input, key) => {
		if (key.escape) {
			onClose();
			return;
		}

		if (key.upArrow) {
			setSelectedIndex((prev) => Math.max(0, prev - 1));
			return;
		}

		if (key.downArrow) {
			setSelectedIndex((prev) => Math.min(sessions.length - 1, prev + 1));
			return;
		}

		if (key.return) {
			if (sessions.length > 0) {
				onLoadSession(sessions[selectedIndex].id);
			}
			return;
		}
	});

	if (sessions.length === 0) {
		return (
			<Box flexDirection="column" marginY={1} paddingX={1}>
				<Text color={BRANDING.colors.gold} bold>
					𓁹 Saved Sessions
				</Text>
				<Text dimColor>No sessions found.</Text>
			</Box>
		);
	}

	const startIdx = Math.max(
		0,
		Math.min(
			selectedIndex - Math.floor(PAGE_SIZE / 2),
			sessions.length - PAGE_SIZE,
		),
	);
	const visibleSessions = sessions.slice(startIdx, startIdx + PAGE_SIZE);

	const { secondary: GOLD } = BRANDING.colors;

	return (
		<Box flexDirection="column" marginY={1}>
			<Box paddingX={1} marginBottom={1}>
				<Text color={GOLD} bold>
					𓁹 Saved Sessions
				</Text>
			</Box>
			<Box paddingX={1}>
				<Text color="gray">{`┌${"─".repeat(84)}┐`}</Text>
			</Box>
			<Box paddingX={1}>
				<Text color="gray">│ </Text>
				<Text bold>ID </Text>
				<Text color="gray"> │ </Text>
				<Text bold>Name </Text>
				<Text color="gray"> │ </Text>
				<Text bold>Msgs </Text>
				<Text color="gray"> │ </Text>
				<Text bold>Tokens </Text>
				<Text color="gray"> │ </Text>
				<Text bold>Model </Text>
				<Text color="gray"> │ </Text>
				<Text bold>Date </Text>
				<Text color="gray"> │</Text>
			</Box>
			<Box paddingX={1}>
				<Text color="gray">{`├${"─".repeat(84)}┤`}</Text>
			</Box>
			{visibleSessions.map((session, i) => {
				const actualIndex = startIdx + i;
				return (
					<SessionRow
						key={session.id}
						session={session}
						isFocused={actualIndex === selectedIndex}
						onClick={() => onLoadSession(session.id)}
						onHover={() => setSelectedIndex(actualIndex)}
					/>
				);
			})}
			<Box paddingX={1}>
				<Text color="gray">{`└${"─".repeat(84)}┘`}</Text>
			</Box>
			<Box
				marginTop={1}
				paddingX={1}
				flexDirection="row"
				justifyContent="space-between"
				width={86}
			>
				<Text dimColor>↑/↓: Navigate • Enter/Click: Select • Esc: Close</Text>
				<Text dimColor>
					Showing {startIdx + 1}-
					{Math.min(startIdx + PAGE_SIZE, sessions.length)} of {sessions.length}
				</Text>
			</Box>
		</Box>
	);
}
