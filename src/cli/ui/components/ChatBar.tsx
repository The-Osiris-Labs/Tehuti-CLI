import { Box, Text } from "ink";
import React, { useMemo } from "react";
import { BRANDING, DECORATIVE, isAsciiMode, ASCII_DECORATIVE } from "../../../branding/index.js";
import { HieroglyphSpinner } from "./HieroglyphSpinner.js";

const GOLD = BRANDING.colors.gold;
const CORAL = BRANDING.colors.coral;
const SAND = BRANDING.colors.sand;
const CYAN = BRANDING.colors.cyan;
const GREEN = BRANDING.colors.green;

export interface ChatBarProps {
	input: string;
	cursorPos: number;
	selectionStart: number | null;
	selectionEnd: number | null;
	loading: boolean;
	historyIndex: number;
	historyLength: number;
	scrollOffset: number;
	scrollPercent: number;
	newMessageCount: number;
	model: string;
	provider: string;
	companionMode?: boolean;
	tokensUsed?: number;
	sessionCost?: number;
	hideInput?: boolean;
}



export function ChatBar({
	input,
	cursorPos,
	selectionStart,
	selectionEnd,
	loading,
	historyIndex,
	historyLength,
	scrollOffset,
	scrollPercent,
	newMessageCount,
	model,
	provider,
	companionMode = false,
	tokensUsed = 0,
	hideInput = false,
}: ChatBarProps): React.ReactElement {
	const ascii = isAsciiMode();
	const safeCursorPos = Math.max(0, Math.min(cursorPos, input.length));
	const safeSelectionStart =
		selectionStart === null ? null : Math.max(0, Math.min(selectionStart, input.length));
	const safeSelectionEnd =
		selectionEnd === null ? null : Math.max(0, Math.min(selectionEnd, input.length));
	const lineCount = input.split("\n").length;
	const beforeCursor = input.slice(0, safeCursorPos);
	const currentLine = beforeCursor.split("\n").length;
	const currentColumn = beforeCursor.length - beforeCursor.lastIndexOf("\n");
	const selectionStatus =
		safeSelectionStart !== null &&
		safeSelectionEnd !== null &&
		safeSelectionStart !== safeSelectionEnd
			? ` • Sel ${Math.min(safeSelectionStart, safeSelectionEnd)}-${Math.max(safeSelectionStart, safeSelectionEnd)}`
			: "";
	const inputStatus = `Ln ${currentLine}/${lineCount} • Col ${currentColumn} • ${lineCount} line${lineCount === 1 ? "" : "s"}${selectionStatus}`;

	// Render Prompt Line (Input + Selection + Cursor)
	const renderedInputText = useMemo(() => {
		const historyIndicator =
			historyIndex >= 0
				? React.createElement(
						Text,
						{ color: SAND, dimColor: true },
						` [${historyIndex + 1}/${historyLength}] `,
					)
				: null;

		if (
			safeSelectionStart !== null &&
			safeSelectionEnd !== null &&
			safeSelectionStart !== safeSelectionEnd
		) {
			const start = Math.min(safeSelectionStart, safeSelectionEnd);
			const end = Math.max(safeSelectionStart, safeSelectionEnd);
			const before = input.slice(0, start);
			const selected = input.slice(start, end);
			const after = input.slice(end);

			return React.createElement(
				Text,
				{ wrap: "wrap" },
				historyIndicator,
				before,
				React.createElement(Text, { inverse: true, color: GOLD }, selected),
				after,
			);
		}

		const before = input.slice(0, safeCursorPos);
		const after = input.slice(safeCursorPos);
		const hint =
			!loading && input.length === 0
				? React.createElement(
						Text,
						{ color: "gray", dimColor: true },
						"Type a prompt, or press / for slash commands...",
					)
				: null;

		return React.createElement(
			Text,
			{ wrap: "wrap" },
			historyIndicator,
			React.createElement(Text, { color: "white" }, before),
			loading ? null : React.createElement(Text, { color: GOLD }, "█"),
			React.createElement(Text, { color: "white" }, after),
			hint,
		);
	}, [
		input,
		cursorPos,
		historyIndex,
		historyLength,
		selectionStart,
		selectionEnd,
		loading,
	]);

	return React.createElement(
		Box,
		{ flexDirection: "column", marginTop: 1 },
		// Scroll Banner Warning (if scrolled up)
		scrollOffset > 0 && !hideInput
			? React.createElement(
					Box,
					{
						flexDirection: "row",
						borderStyle: "single",
						borderColor: CORAL,
						paddingX: 1,
						marginBottom: 1,
						justifyContent: "space-between",
					},
					React.createElement(
						Text,
						{ color: CORAL, bold: true },
						`↑ SCROLLED UP ${scrollOffset} LINE(S) (${scrollPercent}%)`,
					),
					newMessageCount > 0 &&
						React.createElement(
							Text,
							{ color: GOLD, bold: true },
							`↓ ${newMessageCount} NEW MESSAGE(S)`,
						),
					React.createElement(
						Text,
						{ color: SAND, dimColor: true },
						"Press End or PageDown to jump to bottom",
					),
				)
			: null,

		// Top Metadata Header Row (Model, Provider, Keybinding Hints)
		React.createElement(
			Box,
			{
				flexDirection: "row",
				justifyContent: "space-between",
				marginBottom: 0,
			},
			React.createElement(
				Box,
				{ flexDirection: "row", gap: 1 },
				React.createElement(
					Text,
					{ color: CYAN, bold: true },
					`${ascii ? ASCII_DECORATIVE.ibis : DECORATIVE.ibis} ${model.toUpperCase()}`,
				),
				React.createElement(
					Text,
					{ color: SAND, dimColor: true },
					`(${provider})`,
				),
				companionMode &&
					React.createElement(
						Text,
						{ color: GREEN, bold: true },
						"• COMPANION",
					),
				tokensUsed > 0 &&
					React.createElement(
						Text,
						{ color: SAND, dimColor: true },
						`• ${tokensUsed.toLocaleString()} tok`,
					),
			),
			React.createElement(
				Box,
				{ flexDirection: "column", alignItems: "flex-end" },
				React.createElement(
					Text,
					{ color: SAND, dimColor: true },
					inputStatus,
				),
				React.createElement(
					Text,
					{ color: SAND, dimColor: true },
					"PgUp/PgDn Scroll • Ctrl+P Commands • /help",
				),
			),
		),

		// Main Framed Chat Input Row
		hideInput
			? React.createElement(Box, { height: 3 })
			: React.createElement(
					Box,
					{
				flexDirection: "row",
				borderStyle: loading ? "double" : "round",
				borderColor: loading ? GOLD : CYAN,
				paddingX: 1,
				alignItems: "center",
				gap: 1,
			},
			loading
				? React.createElement(
						Box,
						{ flexDirection: "row", gap: 1 },
						React.createElement(HieroglyphSpinner, { color: GOLD }),
						React.createElement(
							Text,
							{ color: GOLD, bold: true },
							"Loading • Ctrl+C to interrupt",
						),
					)
				: React.createElement(
						Text,
						{ color: CORAL, bold: true },
						`${ascii ? ASCII_DECORATIVE.feather : DECORATIVE.feather} >`,
					),
			React.createElement(
				Box,
				{ flexGrow: 1, flexDirection: "row" },
				renderedInputText,
			),
			input.length > 40 &&
				React.createElement(
					Text,
					{ color: SAND, dimColor: true },
					`${input.length} chars`,
				),
		),
	);
}
