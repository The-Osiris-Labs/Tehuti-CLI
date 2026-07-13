import {
	useOnClick,
	useOnMouseEnter,
	useOnMouseLeave,
} from "@ink-tools/ink-mouse";
import { Box, Text, useInput, useStdout } from "ink";
// @ts-expect-error TS6133/TS6192: Unused variable
import React, { useRef, useState } from "react";
import { BRANDING } from "../../../branding/index.js";
import type { SessionMetadata } from "../../../session/manager.js";
import { useVimInput } from "../hooks/useVimInput.js";
import { useVirtualScroll } from "../hooks/useVirtualScroll.js";

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
		// @ts-expect-error TS6133/TS6192: Unused variable
		nile: NILE,
	} = BRANDING.colors;
	const dateStr = new Date(session.updatedAt).toLocaleDateString();

	const idText = session.id.substring(0, 8);
	const nameText = session.name || "Unnamed";
	const msgText = String(session.messageCount || 0);
	const tokenText = String(session.tokensUsed || 0);
	const modelText = session.model || "Unknown";

	// Accessibility: build descriptive label for screen readers
	const ariaLabel = `Session ${nameText}, ${msgText} messages, ${tokenText} tokens, model ${modelText}, last updated ${dateStr}${active ? ", currently selected" : ""}`;

	return (
		<Box 
			ref={ref} 
			paddingX={1} 
			width="100%" 
			flexDirection="row"
			accessibilityLabel={ariaLabel}
			accessibilityRole="listitem"
		>
			<Box width={3}>
				<Text color={active ? GOLD : "gray"}>{active ? "▶" : "│"}</Text>
			</Box>
			<Box width={10}>
				<Text color={active ? GOLD : CORAL}>{idText}</Text>
			</Box>
			<Box flexGrow={1} flexBasis={0} paddingRight={1}>
				<Text color={active ? "white" : SAND} bold={active} wrap="truncate-end">
					{nameText}
				</Text>
			</Box>
			<Box width={8}>
				<Text color={active ? "white" : "cyan"}>{msgText}</Text>
			</Box>
			<Box width={10}>
				<Text color={active ? "white" : "yellow"}>{tokenText}</Text>
			</Box>
			<Box flexGrow={1} flexBasis={0} paddingRight={1}>
				<Text color={active ? "white" : "blue"} wrap="truncate-end">
					{modelText}
				</Text>
			</Box>
			<Box width={12}>
				<Text color={active ? "white" : "gray"}>{dateStr}</Text>
			</Box>
			<Box width={2}>
				<Text color={active ? GOLD : "gray"}>│</Text>
			</Box>
		</Box>
	);
}

export function SessionList({
	sessions,
	onLoadSession,
	onClose,
}: SessionListProps) {
	const PAGE_SIZE = 15;
	const { stdout } = useStdout();
	const terminalWidth = stdout?.columns || 80;
	const terminalHeight = stdout?.rows || 24;

	const {
		selectedIndex,
		windowStart,
		moveUp,
		moveDown,
		getVisibleItems,
		setSelectedIndex,
	} = useVirtualScroll({
		totalItems: sessions.length,
		maxVisibleWindow: PAGE_SIZE,
	});

	useVimInput({
		isActive: true,
		onUp: moveUp,
		onDown: moveDown,
		onSelect: () => {
			if (sessions.length > 0) {
				onLoadSession(sessions[selectedIndex].id);
			}
		},
		onDelete: () => {
			// Stub for future delete support
		},
		onRename: () => {
			// Stub for future rename support
		},
	});

	// Keyboard navigation
	useInput((_input, key) => {
		if (key.escape) {
			onClose();
			return;
		}
	});

	// Accessibility: build navigation help
	const navigationHelp = `Navigate: ↑/↓ or j/k arrows, Enter to select, Esc to close. Showing ${windowStart + 1} to ${Math.min(windowStart + PAGE_SIZE, sessions.length)} of ${sessions.length} sessions.`;

	if (sessions.length === 0) {
		return (
			<Box
				position="absolute"
				flexDirection="column"
				width={terminalWidth}
				height={terminalHeight}
				justifyContent="center"
				alignItems="center"
				accessibilityRole="dialog"
				accessibilityLabel="No sessions found"
			>
				<Box
					flexDirection="column"
					width={Math.min(80, terminalWidth - 4)}
					borderStyle="double"
					borderColor={BRANDING.colors.gold}
					backgroundColor="black"
					paddingX={1}
					paddingY={1}
				>
					<Text color={BRANDING.colors.gold} bold>
						𓁹 Saved Sessions
					</Text>
					<Text dimColor>No sessions found.</Text>
				</Box>
			</Box>
		);
	}

	const visibleSessions = getVisibleItems(sessions);

	const { secondary: GOLD } = BRANDING.colors;

	return (
		<Box
			position="absolute"
			flexDirection="column"
			width={terminalWidth}
			height={terminalHeight}
			justifyContent="center"
			alignItems="center"
			accessibilityRole="dialog"
			accessibilityLabel={`Session list: ${sessions.length} sessions. ${navigationHelp}`}
		>
			<Box
				flexDirection="column"
				width={Math.min(100, terminalWidth - 4)}
				borderStyle="double"
				borderColor={GOLD}
				backgroundColor="black"
				paddingX={1}
				paddingY={1}
			>
				<Box paddingX={1} marginBottom={1} marginTop={1}>
					<Text color={GOLD} bold>
						𓁹 Saved Sessions
					</Text>
				</Box>
				<Box flexDirection="row" paddingX={1} paddingBottom={1}>
					<Box width={3} />
					<Box width={10}>
						<Text color="gray" bold>
							ID
						</Text>
					</Box>
					<Box flexGrow={1} flexBasis={0} paddingRight={1}>
						<Text color="gray" bold>
							NAME
						</Text>
					</Box>
					<Box width={8}>
						<Text color="gray" bold>
							MSGS
						</Text>
					</Box>
					<Box width={10}>
						<Text color="gray" bold>
							TOKENS
						</Text>
					</Box>
					<Box flexGrow={1} flexBasis={0} paddingRight={1}>
						<Text color="gray" bold>
							MODEL
						</Text>
					</Box>
					<Box width={12}>
						<Text color="gray" bold>
							DATE
						</Text>
					</Box>
					<Box width={2} />
				</Box>
				<Box accessibilityRole="list">
					{visibleSessions.map((session: SessionMetadata, i: number) => {
						const actualIndex = windowStart + i;
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
				</Box>
				<Box
					marginTop={1}
					paddingX={1}
					flexDirection="row"
					justifyContent="space-between"
					width="100%"
				>
					<Text dimColor>↑/↓: Navigate • Enter/Click: Select • Esc: Close</Text>
					<Text dimColor>
						Showing {windowStart + 1}-
						{Math.min(windowStart + PAGE_SIZE, sessions.length)} of{" "}
						{sessions.length}
					</Text>
				</Box>
			</Box>
		</Box>
	);
}
