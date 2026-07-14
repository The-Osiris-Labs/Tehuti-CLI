import { Box, Text } from "ink";
import React, { useMemo } from "react";
import { BRANDING, DECORATIVE, HIEROGLYPHS, isAsciiMode, ASCII_DECORATIVE, ASCII_HIEROGLYPHS } from "../../../branding/index.js";
import { HieroglyphSpinner } from "./HieroglyphSpinner.js";

const GOLD = BRANDING.colors.gold;
const CORAL = BRANDING.colors.coral;
const SAND = BRANDING.colors.sand;
const CYAN = BRANDING.colors.cyan;
const GREEN = BRANDING.colors.green;
const RED = BRANDING.colors.red;

export interface ChatBarProps {
	input: string;
	cursorPos: number;
	selectionStart: number | null;
	selectionEnd: number | null;
	loading: boolean;
	historyIndex: number;
	historyLength: number;
	model: string;
	provider: string;
	companionMode?: boolean;
	tokensUsed?: number;
	sessionCost?: number;
	hideInput?: boolean;
	showSearch?: boolean;
	searchQuery?: string;
	searchMatchCount?: number;
	searchMatchIndex?: number;
	sendError?: string | null;
	completionText?: string;
}

export function ChatBar({
	input,
	cursorPos,
	selectionStart,
	selectionEnd,
	loading,
	historyIndex,
	historyLength,
	model,
	provider,
	companionMode = false,
	tokensUsed = 0,
	hideInput = false,
	showSearch = false,
	searchQuery = "",
	searchMatchCount = 0,
	searchMatchIndex = 0,
	sendError = null,
	completionText = "",
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
			? ` Sel ${Math.min(safeSelectionStart, safeSelectionEnd)}-${Math.max(safeSelectionStart, safeSelectionEnd)}`
			: "";
	const inputStatus = `Ln ${currentLine}/${lineCount} Col ${currentColumn}${selectionStatus}`;

	// Search bar overlay — replaces the entire chat input
	if (showSearch) {
		return React.createElement(
			Box,
			{ flexDirection: "column", marginTop: 1 },
			React.createElement(
				Box,
				{
					flexDirection: "row",
					borderStyle: "round",
					borderColor: GOLD,
					paddingX: 1,
					alignItems: "center",
				},
				React.createElement(Text, { color: GOLD }, "\uD83D\uDD0D "),
				React.createElement(
					Box,
					{ flexGrow: 1 },
					React.createElement(
						Text,
						{ color: SAND },
						searchQuery + (ascii ? "" : "\u2502"),
					),
				),
				React.createElement(
					Text,
					{ dimColor: true, color: SAND },
					`${searchMatchIndex + 1}/${searchMatchCount}`,
				),
			),
		);
	}

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
			loading ? null : React.createElement(Text, { color: GOLD }, "\u2588"),
			React.createElement(Text, { color: "white" }, after),
			completionText && !loading
				? React.createElement(Text, { color: "gray", dimColor: true }, completionText)
				: null,
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
		completionText,
	]);

	return React.createElement(
		Box,
		{ flexDirection: "column", marginTop: 1 },
		// Single-line metadata with model, status and shortcut hints
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
						"\u2022 COMPANION",
					),
				tokensUsed > 0 &&
					React.createElement(
						Text,
						{ color: SAND, dimColor: true },
						`\u2022 ${tokensUsed.toLocaleString()} tok`,
					),
				React.createElement(
					Text,
					{ color: "gray", dimColor: true },
					`\u00B7 ${inputStatus}`,
				),
			),
			React.createElement(
				Text,
				{ color: SAND, dimColor: true },
				"PgUp/PgDn Scroll \u2022 Ctrl+P Commands \u2022 /help",
			),
		),

		// Error indicator — 𓂀 Error in RED with auto-dismiss by parent
		sendError &&
			React.createElement(
				Box,
				{
					flexDirection: "row",
					marginBottom: 1,
					paddingX: 1,
					borderStyle: "round",
					borderColor: RED,
				},
				React.createElement(
					Text,
					{ color: RED, bold: true },
					`${ascii ? ASCII_HIEROGLYPHS.error : HIEROGLYPHS.error} Error: ${sendError}`,
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
				paddingX: 0.5,
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
							"Ctrl+C",
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
