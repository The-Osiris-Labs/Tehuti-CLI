import { Box, Text } from "ink";
import React, { useMemo } from "react";
import { BRANDING, DECORATIVE, HIEROGLYPHS } from "../../../branding/index.js";
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
}

interface SlashSuggestion {
	cmd: string;
	description: string;
	category: string;
}

const SLASH_COMMANDS: SlashSuggestion[] = [
	{ cmd: "/help", description: "Show command reference", category: "GENERAL" },
	{
		cmd: "/clear",
		description: "Clear conversation & tasks",
		category: "SESSION",
	},
	{
		cmd: "/config",
		description: "Interactive config editor",
		category: "SETTINGS",
	},
	{ cmd: "/model", description: "Switch AI model", category: "MODEL" },
	{ cmd: "/provider", description: "Switch provider", category: "MODEL" },
	{
		cmd: "/compact",
		description: "Compact context tokens",
		category: "SESSION",
	},
	{ cmd: "/cost", description: "Show tokens and cost", category: "SESSION" },
	{
		cmd: "/stats",
		description: "Show performance metrics",
		category: "GENERAL",
	},
	{
		cmd: "/update",
		description: "Check for and apply Tehuti updates",
		category: "SYSTEM",
	},
	{ cmd: "/sessions", description: "List saved sessions", category: "SESSION" },
	{ cmd: "/save", description: "Save current session", category: "SESSION" },
	{ cmd: "/load", description: "Load saved session", category: "SESSION" },
	{ cmd: "/skills", description: "List available skills", category: "SKILLS" },
	{ cmd: "/plan", description: "Enter read-only plan mode", category: "MODE" },
	{ cmd: "/todos clear", description: "Clear active tasks", category: "TASKS" },
	{ cmd: "/exit", description: "Exit Tehuti", category: "GENERAL" },
];

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
	sessionCost = 0,
}: ChatBarProps): React.ReactElement {
	// 1. Live Slash Command Suggestions when user types "/"
	const suggestions = useMemo(() => {
		if (loading || !input.startsWith("/")) return [];
		const query = input.trim().toLowerCase();
		return SLASH_COMMANDS.filter((s) => s.cmd.startsWith(query)).slice(0, 4);
	}, [input, loading]);

	// 2. Render Prompt Line (Input + Selection + Cursor)
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
			selectionStart !== null &&
			selectionEnd !== null &&
			selectionStart !== selectionEnd
		) {
			const start = Math.min(selectionStart, selectionEnd);
			const end = Math.max(selectionStart, selectionEnd);
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

		const before = input.slice(0, cursorPos);
		const after = input.slice(cursorPos);
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
		scrollOffset > 0
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
					`𓆣 ${model.toUpperCase()}`,
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
				Text,
				{ color: SAND, dimColor: true },
				"PgUp/PgDn Scroll • Ctrl+P Commands • /help",
			),
		),

		// Main Framed Chat Input Row
		React.createElement(
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
				? React.createElement(HieroglyphSpinner, { color: GOLD })
				: React.createElement(
						Text,
						{ color: CORAL, bold: true },
						`${DECORATIVE.feather} >`,
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

		// Live Autocomplete Slash Command Suggestions Row
		suggestions.length > 0 &&
			React.createElement(
				Box,
				{
					flexDirection: "row",
					gap: 2,
					paddingX: 1,
					marginTop: 0,
				},
				...suggestions.map((s) =>
					React.createElement(
						Box,
						{ key: s.cmd, flexDirection: "row", gap: 1 },
						React.createElement(Text, { color: GOLD, bold: true }, s.cmd),
						React.createElement(
							Text,
							{ color: SAND, dimColor: true },
							s.description,
						),
					),
				),
			),
	);
}
