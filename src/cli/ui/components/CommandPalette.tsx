import {
	useOnClick,
	useOnMouseEnter,
	useOnMouseLeave,
} from "@ink-tools/ink-mouse";
import { Box, Text, useInput, useStdout } from "ink";
import Spinner from "ink-spinner";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { BRANDING, DECORATIVE } from "../../../branding/index.js";
import { globalConfig } from "../../../config/index.js";
import { getAllProviders } from "../../../config/providers.js";
import { isMouseSequence } from "../../../utils/mouse.js";
import { useVimInput } from "../hooks/useVimInput.js";
import { useVirtualScroll } from "../hooks/useVirtualScroll.js";
import { isEnterKey } from "../../../utils/keyboard.js";

const GOLD = BRANDING.colors.gold;
const CORAL = BRANDING.colors.coral;
const GRAY = BRANDING.colors.gray;
const CYAN = BRANDING.colors.cyan;
const GREEN = BRANDING.colors.green;
const SAND = BRANDING.colors.sand;
const _RED = BRANDING.colors.red;

export interface CommandItem {
	id: string;
	label: string;
	description: string;
	usage?: string;
	shortcut?: string;
	aliases?: string[];
	category: "session" | "model" | "help" | "recent" | "submenu";
	action?: () => void | Promise<void>;
	submenu?: () => Promise<CommandItem[]> | CommandItem[];
}

interface CommandPaletteProps {
	commands: CommandItem[];
	onSelect: (command: CommandItem) => void;
	onClose: () => void;
	visible: boolean;
	initialQuery?: string;
}

const CATEGORY_LABELS: Record<
	CommandItem["category"],
	{ label: string; color: string; glyph: string }
> = {
	session: { label: "SESSION", color: GREEN, glyph: DECORATIVE.scroll },
	model: { label: "MODEL", color: CYAN, glyph: DECORATIVE.ibis },
	help: { label: "HELP", color: GRAY, glyph: DECORATIVE.eye },
	recent: { label: "RECENT", color: SAND, glyph: DECORATIVE.ankh },
	submenu: { label: "OPTIONS", color: GOLD, glyph: "»" },
};

function fuzzyMatch(
	text: string,
	query: string,
): { score: number; indices: number[] } {
	const textLower = text.toLowerCase();
	const queryLower = query.toLowerCase();

	let score = 0;
	const indices: number[] = [];
	let queryIdx = 0;

	for (let i = 0; i < text.length && queryIdx < queryLower.length; i++) {
		if (textLower[i] === queryLower[queryIdx]) {
			score += queryIdx === 0 ? 3 : text[i] === query[queryIdx] ? 2 : 1;
			indices.push(i);
			queryIdx++;
		}
	}

	if (queryIdx < queryLower.length) {
		return { score: -1, indices: [] };
	}

	return { score, indices };
}

function highlightMatch(
	text: string,
	indices: number[],
	isSelected: boolean,
): React.ReactNode[] {
	if (indices.length === 0) {
		return [text];
	}

	const elements: React.ReactNode[] = [];
	let lastIdx = 0;

	for (let i = 0; i < indices.length; i++) {
		const idx = indices[i];
		if (idx > lastIdx) {
			elements.push(
				React.createElement(
					Text,
					{ key: `text-${i}`, color: isSelected ? "black" : CORAL },
					text.slice(lastIdx, idx),
				),
			);
		}
		elements.push(
			React.createElement(
				Text,
				{
					key: `match-${i}`,
					color: isSelected ? "black" : GOLD,
					bold: true,
					underline: !isSelected,
				},
				text[idx],
			),
		);
		lastIdx = idx + 1;
	}

	if (lastIdx < text.length) {
		elements.push(
			React.createElement(
				Text,
				{ key: "text-end", color: isSelected ? "black" : CORAL },
				text.slice(lastIdx),
			),
		);
	}

	return elements;
}

function CommandItemRow({
	cmd,
	cmdIndex,
	isSelected,
	query,
	onHover,
	onClick,
}: any) {
	const ref = useRef<any>(null);
	const [isMouseHovered, setIsMouseHovered] = useState(false);

	const disableMouse =
		process.env.TEHUTI_DISABLE_MOUSE === "1" || process.env.NO_MOUSE === "1";

	useOnClick(ref, disableMouse ? () => {} : () => onClick(cmd));
	useOnMouseEnter(
		ref,
		disableMouse
			? () => {}
			: () => {
					setIsMouseHovered(true);
					onHover(cmdIndex);
				},
	);
	useOnMouseLeave(
		ref,
		disableMouse ? () => {} : () => setIsMouseHovered(false),
	);

	const active = isSelected || isMouseHovered;

	const label =
		query.trim() &&
		cmd.matchIndices &&
		cmd.matchIndices.length > 0 &&
		cmd.matchField === "label"
			? highlightMatch(cmd.label, cmd.matchIndices, active)
			: [
					React.createElement(
						Text,
						{ key: "l", color: active ? "black" : CORAL, bold: active },
						cmd.label,
					),
				];

	return React.createElement(
		Box,
		{
			ref,
			flexDirection: "column",
			paddingX: 1,
			paddingY: 0,
			backgroundColor: active ? GOLD : undefined,
		},
		React.createElement(
			Box,
			{ flexDirection: "row" },
			React.createElement(
				Text,
				{ color: active ? "black" : CORAL, bold: active },
				active ? `${cmd.submenu ? "»" : DECORATIVE.arrow} ` : "  ",
			),
			React.createElement(Text, null, ...label),
			cmd.shortcut &&
				React.createElement(
					Text,
					{ color: active ? "black" : CYAN, dimColor: !active },
					`  ${cmd.shortcut}`,
				),
		),
		React.createElement(
			Box,
			{ paddingLeft: 2 },
			React.createElement(
				Text,
				{ color: active ? "black" : GRAY, dimColor: !active },
				`${cmd.description}${cmd.usage ? `  ${cmd.usage}` : ""}`,
			),
		),
	);
}

export function CommandPalette({
	commands,
	onSelect,
	onClose,
	visible,
	initialQuery = "",
}: CommandPaletteProps): React.ReactElement | null {
	const [query, setQuery] = useState("");
	const { stdout } = useStdout();
	const [terminalWidth, setTerminalWidth] = useState(stdout?.columns || 80);

	const [menuStack, setMenuStack] = useState<
		{ title: string; commands: CommandItem[] }[]
	>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [_error, setError] = useState<string | null>(null);

	const currentCommands =
		menuStack.length > 0 ? menuStack[menuStack.length - 1].commands : commands;

	useEffect(() => {
		const handleResize = () => {
			setTerminalWidth(stdout?.columns || 80);
		};
		stdout?.on("resize", handleResize);
		return () => {
			stdout?.off("resize", handleResize);
		};
	}, [stdout]);

	const filteredCommands = useMemo(() => {
		if (!query.trim()) {
			return currentCommands.map((cmd) => ({
				...cmd,
				matchIndices: [] as number[],
				matchField: "label",
			}));
		}

		const results = currentCommands
			.map((cmd) => {
				const labelMatch = fuzzyMatch(cmd.label, query);
				const descMatch = fuzzyMatch(cmd.description, query);
				const idMatch = fuzzyMatch(cmd.id, query);
				const aliasesMatches = (cmd.aliases || []).map((alias) =>
					fuzzyMatch(alias, query),
				);
				const bestAliasMatch = aliasesMatches.reduce(
					(best, curr) => (curr.score > best.score ? curr : best),
					{ score: -1, indices: [] },
				);

				const matches = [
					{
						score: labelMatch.score,
						indices: labelMatch.indices,
						field: "label",
					},
					{
						score: descMatch.score,
						indices: descMatch.indices,
						field: "description",
					},
					{ score: idMatch.score, indices: idMatch.indices, field: "id" },
					{
						score: bestAliasMatch.score,
						indices: bestAliasMatch.indices,
						field: "aliases",
					},
				];

				const bestMatch = matches.reduce(
					(best, curr) => (curr.score > best.score ? curr : best),
					{ score: -1, indices: [], field: "label" },
				);

				return {
					...cmd,
					matchScore: bestMatch.score,
					matchIndices: bestMatch.indices,
					matchField: bestMatch.field,
				};
			})
			.filter((cmd) => (cmd.matchScore ?? -1) >= 0);

		return results.sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0));
	}, [currentCommands, query]);

	const _groupedCommands = useMemo(() => {
		const groups: Record<string, typeof filteredCommands> = {};
		for (const cmd of filteredCommands) {
			const cat = cmd.category;
			if (!groups[cat]) groups[cat] = [];
			groups[cat].push(cmd);
		}
		return groups;
	}, [filteredCommands]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: setSelectedIndex from useVirtualScroll has stable identity across renders
	useEffect(() => {
		if (visible) {
			const initQ = initialQuery || "";
			// Only reset if we are opening fresh
			if (menuStack.length === 0 && !query) {
				setQuery(initQ);
			}
			setSelectedIndex(0);
			setError(null);
		} else {
			// Reset on close
			setMenuStack([]);
			setQuery("");
			setError(null);
		}
	}, [visible, initialQuery, menuStack.length, query]);

	const MAX_DISPLAY = 9;

	const {
		selectedIndex,
		windowStart,
		moveUp,
		moveDown,
		getVisibleItems,
		setSelectedIndex,
	} = useVirtualScroll({
		totalItems: filteredCommands.length,
		maxVisibleWindow: MAX_DISPLAY,
	});

	const [prevFilteredCommands, setPrevFilteredCommands] =
		useState(filteredCommands);
	if (filteredCommands !== prevFilteredCommands) {
		setSelectedIndex(0);
		setPrevFilteredCommands(filteredCommands);
	}

	const handleExecute = async (selected: CommandItem) => {
		if (selected.submenu) {
			setIsLoading(true);
			setError(null);
			try {
				const children = await selected.submenu();
				setMenuStack((prev) => [
					...prev,
					{ title: selected.label, commands: children },
				]);
				setQuery("");
			} catch (err: any) {
				setError(err.message || String(err));
			} finally {
				setIsLoading(false);
			}
		} else {
			// Track recently used command if it's a top-level command
			if (menuStack.length === 0) {
				addRecentCommand(selected.id);
			}
			onSelect(selected);
		}
	};

	useVimInput({
		isActive: visible && query.length === 0 && !isLoading,
		onUp: moveUp,
		onDown: moveDown,
	});

	useInput(
		(char, key) => {
			if (isMouseSequence(char)) return;
			if (!visible || isLoading) return;

			if (key.escape || (key.ctrl && (char === "p" || char === "\x10"))) {
				if (menuStack.length > 0) {
					// Pop stack
					setMenuStack((prev) => prev.slice(0, -1));
					setQuery("");
					setError(null);
				} else {
					onClose();
				}
				return;
			}

			if (key.backspace || key.delete) {
				if (query.length === 0 && menuStack.length > 0) {
					// Pop stack on backspace if query is empty
					setMenuStack((prev) => prev.slice(0, -1));
					setError(null);
					return;
				}
				if (query.length > 0) {
					setQuery((prev) => prev.slice(0, -1));
					return;
				}
			}

			if (isEnterKey(char, key)) {
				if (filteredCommands.length > 0) {
					const selected = filteredCommands[selectedIndex] || filteredCommands[0];
					if (selected) {
						void handleExecute(selected);
					}
				}
				return;
			}

			// Handle normal character input
			if (
				char &&
				!key.ctrl &&
				!key.meta &&
				!char.startsWith("\x1b") &&
				char !== "\r" &&
				char !== "\n" &&
				char !== "\t"
			) {
				if (
					isMouseSequence(char) ||
					char === "[" ||
					char === "<" ||
					char === "[[ " ||
					/^(?:\d+;)+\d+[Mm]?$/.test(char) ||
					/(?:\d+;\d+(?:;\d+)?[Mm])+/.test(char) ||
					char.includes("[<") ||
					char.includes("[M")
				) {
					return;
				}

				// Delegate j/k to useVimInput when query is empty
				if (query.length === 0 && (char === "j" || char === "k")) {
					return;
				}

				setQuery((prev) => prev + char);
			}

			if (key.upArrow) {
				moveUp();
				return;
			}

			if (key.downArrow) {
				moveDown();
				return;
			}
		},
		{ isActive: visible },
	);

	if (!visible) return null;

	const terminalHeight = stdout?.rows || 24;
	const paletteWidth = Math.min(80, terminalWidth - 4);
	const displayCommands = getVisibleItems(filteredCommands);
	const hasMore = filteredCommands.length > MAX_DISPLAY;

	const groupedDisplayCommands = {
		submenu: displayCommands.filter((c) => c.category === "submenu"),
		recent: displayCommands.filter((c) => c.category === "recent"),
		session: displayCommands.filter((c) => c.category === "session"),
		model: displayCommands.filter((c) => c.category === "model"),
		help: displayCommands.filter((c) => c.category === "help"),
	};

	const orderedGroups = [
		["submenu", groupedDisplayCommands.submenu],
		["recent", groupedDisplayCommands.recent],
		["session", groupedDisplayCommands.session],
		["model", groupedDisplayCommands.model],
		["help", groupedDisplayCommands.help],
	].filter(([, cmds]) => (cmds as any[]).length > 0) as Array<
		[string, typeof displayCommands]
	>;

	const breadcrumbs = menuStack.map((m) => m.title).join(" > ");
	const titleText = breadcrumbs
		? ` ${DECORATIVE.ibis} Palette > ${breadcrumbs} `
		: ` ${DECORATIVE.ibis} COMMAND PALETTE `;

	return (
		<Box
			position="absolute"
			flexDirection="column"
			width={terminalWidth}
			height={terminalHeight}
			justifyContent="center"
			alignItems="center"
		>
			{React.createElement(
				Box,
				{
					flexDirection: "column",
					width: paletteWidth,
					borderStyle: "double",
					borderColor: menuStack.length > 0 ? CYAN : GOLD,
					backgroundColor: "black",
					paddingX: 1,
					paddingY: 1,
				},
				React.createElement(
					Box,
					{ marginBottom: 1, justifyContent: "space-between" },
			React.createElement(
				Text,
				{ bold: true, color: menuStack.length > 0 ? CYAN : GOLD },
				titleText,
			),
			React.createElement(
				Text,
				{ color: GRAY, dimColor: true },
				isLoading ? "..." : "(type • ↑↓/jk • ⏎ • esc)",
			),
		),
		React.createElement(
			Box,
			{
				borderStyle: "single",
				borderColor: CORAL,
				paddingX: 1,
				marginBottom: 1,
			},
			React.createElement(Text, { color: CORAL }, `${DECORATIVE.arrow} `),
			isLoading
				? React.createElement(
						Text,
						{ color: CYAN },
						React.createElement(Spinner, { type: "dots" }),
						" Loading...",
					)
				: React.createElement(
						Text,
						null,
						query.length === 0
							? React.createElement(
									Text,
									{ color: "gray" },
									menuStack.length > 0
										? "filter options..."
										: "type a command...",
								)
							: React.createElement(Text, { color: "cyan" }, query),
						React.createElement(
							Text,
							{ backgroundColor: "white", color: "black" },
							" ",
						),
					),
		),
		!isLoading && filteredCommands.length === 0
			? React.createElement(
					Box,
					{ paddingY: 1, flexDirection: "column" },
					React.createElement(
						Text,
						{ dimColor: true, color: CORAL },
						`${DECORATIVE.eye} No match found.`,
					),
				)
			: !isLoading &&
					React.createElement(
						Box,
						{ flexDirection: "column" },
						...orderedGroups.flatMap(([category, cmds], groupIndex) => [
							React.createElement(
								Text,
								{
									key: `cat-${groupIndex}-${category}`,
									dimColor: true,
									color: SAND,
									bold: true,
								},
								`── ${CATEGORY_LABELS[category as keyof typeof CATEGORY_LABELS]?.glyph || ""} ${CATEGORY_LABELS[category as keyof typeof CATEGORY_LABELS]?.label || category}`,
							),
							...cmds.map((cmd) => {
								const cmdIndex = filteredCommands.findIndex(
									(c) => c.id === cmd.id,
								);
								const isSelected = cmdIndex === selectedIndex;

								return React.createElement(CommandItemRow, {
									key: `cmd-${category}-${cmdIndex}-${cmd.id}`,
									cmd,
									cmdIndex,
									isSelected,
									query,
									onHover: setSelectedIndex,
									onClick: handleExecute,
								});
							}),
						]),
						hasMore &&
							React.createElement(
								Text,
								{
									key: "more-indicator",
									color: GRAY,
									dimColor: true,
								},
								`  … showing ${windowStart + 1}-${windowStart + displayCommands.length} of ${filteredCommands.length} — refine your filter`,
							),
					),
			)}
		</Box>
	);
}

function getRecentCommands(): string[] {
	try {
		return globalConfig.get("recentCommands") || [];
	} catch {
		return [];
	}
}

function addRecentCommand(commandId: string): void {
	try {
		const recent = getRecentCommands();
		const filtered = recent.filter((id) => id !== commandId);
		const updated = [commandId, ...filtered].slice(0, 5);
		globalConfig.set("recentCommands", updated);
	} catch {}
}

export function createCommands(options: {
	onCost: () => void;
	onModel: (model: string) => void;
	onClear: () => void;
	onExit: () => void;
	onHelp: () => void;
	onSessions: () => void;
	onModels: () => void;
	onSave?: () => void;
	onLoad?: (sessionId: string) => void;
	onStats?: () => void;
	onCompact?: () => void;
	onThinking?: () => void;
	onPlan?: () => void;
	onSkills?: () => void;
	onActivateSkill?: (skillId: string) => void;
	onDeactivateSkill?: (skillId: string) => void;
	onGetSkill?: (skillId: string) => void;
		onConfig?: () => void;
	onDashboard?: () => void;
	onUpdate?: () => void;
	onProvider?: (provider: string) => void;
	onProviders?: () => void;
	getAvailableModels?: () => Promise<{ id: string; name: string }[]>;
	getSavedSessions?: () => Promise<
		{ id: string; name: string; date: string }[]
	>;
}): CommandItem[] {
	const baseCommands: CommandItem[] = [
		{
			id: "/update",
			label: "/update",
			description: "Pull latest updates and rebuild the CLI",
			category: "session",
			action: options.onUpdate || (() => {}),
		},
		{
			id: "/config",
			label: "/config",
			description: "Open interactive configuration editor",
			category: "session",
			action: options.onConfig || (() => {}),
		},
		{
			id: "/clear",
			label: "/clear",
			description: "Clear conversation history and reset context",
			shortcut: "Ctrl+L",
			aliases: ["/cls", "/c"],
			category: "session",
			action: options.onClear,
		},
		{
			id: "/cost",
			label: "/cost",
			description: "Show session cost, token usage, and cache savings",
			category: "session",
			action: options.onCost,
		},
		{
			id: "/stats",
			label: "/stats",
			description: "Show performance metrics and optimization statistics",
			category: "session",
			action: options.onStats || (() => {}),
		},
		{
			id: "/compact",
			label: "/compact",
			description: "Compact context to free up token space",
			category: "session",
			action: options.onCompact || (() => {}),
		},
		{
			id: "/save",
			label: "/save",
			description: "Save current session for later",
			category: "session",
			action: options.onSave || (() => {}),
		},
		{
			id: "/export",
			label: "/export",
			description: "Export session to Markdown or JSON",
			category: "session",
			action: () => {}, // Action handled in chat.ts
		},
		{
			id: "/load",
			label: "/load",
			description: "Load a saved session",
			category: "session",
			submenu: async () => {
				if (!options.getSavedSessions) return [];
				const sessions = await options.getSavedSessions();
				return sessions.map((s) => ({
					id: s.id,
					label: s.name || s.id,
					description: s.date,
					category: "submenu",
					action: () => options.onLoad?.(s.id),
				}));
			},
		},
		{
			id: "/sessions",
			label: "/sessions",
			description: "List all saved sessions",
			category: "session",
			action: options.onSessions,
		},
		{
			id: "/model",
			label: "/model",
			description: "Switch to a different AI model",
			category: "model",
			submenu: async () => {
				if (!options.getAvailableModels) return [];
				const models = await options.getAvailableModels();
				return models.map((m) => ({
					id: m.id,
					label: m.id,
					description: m.name,
					category: "submenu",
					action: () => options.onModel(m.id),
				}));
			},
		},
		{
			id: "/provider",
			label: "/provider",
			description: "Switch AI provider (openrouter/kilocode/custom)",
			category: "model",
			submenu: () => {
				return getAllProviders().map((p) => ({
					id: p.id,
					label: p.id,
					description: p.name + (p.oauthSupported ? " (OAuth supported)" : ""),
					category: "submenu",
					action: () => options.onProvider?.(p.id),
				}));
			},
		},
		{
			id: "/thinking",
			label: "/thinking",
			description: "Toggle extended thinking mode for complex reasoning",
			category: "model",
			action: options.onThinking || (() => {}),
		},
		{
			id: "/plan",
			label: "/plan",
			description: "Enter plan mode (read-only exploration)",
			category: "session",
			action: options.onPlan || (() => {}),
		},
		{
			id: "/skills",
			label: "/skills",
			description: "List all available skills",
			category: "session",
			action: options.onSkills || (() => {}),
		},
		{
			id: "/help",
			label: "/help",
			description: "Show all commands and keyboard shortcuts",
			aliases: ["/h"],
			category: "help",
			action: options.onHelp,
		},
		{
			id: "/dashboard",
			label: "/dashboard",
			description: "Toggle Swarm Observability Dashboard",
			category: "session",
			action: options.onDashboard || (() => {}),
		},
		{
			id: "/exit",
			label: "/exit",
			description: "Exit Tehuti CLI",
			aliases: ["/quit", "/q"],
			category: "session",
			action: options.onExit,
		},
	];

	const recentIds = getRecentCommands();
	const recentCommands: CommandItem[] = [];

	for (const id of recentIds) {
		const command = baseCommands.find((cmd) => cmd.id === id);
		if (command) {
			recentCommands.push({
				...command,
				category: "recent" as const,
			});
		}
	}

	return [
		...recentCommands,
		...baseCommands.filter((cmd) => !recentIds.includes(cmd.id)),
	];
}

export function formatHelpOutput(): string {
	return `
# 𓆣 TEHUTI ─ Scribe of Code Transformations

## SESSION
| Command | Description |
|---|---|
| \`/clear\` | Clear conversation |
| \`/cost\` | Show tokens and cost |
| \`/stats\` | Show performance metrics |
| \`/compact\` | Compact context to free up token space |
| \`/save [name]\` | Save session |
| \`/export [format]\` | Export session to Markdown or JSON |
| \`/load\` | Load session (Interactive Submenu) |
| \`/sessions\` | List saved sessions |
| \`/plan\` | Enter plan mode (read-only exploration) |
| \`/config\` | Open interactive configuration editor |
| \`/skills\` | List all available skills |
| \`/help\` | Show this command reference |
| \`/exit\` | Exit Tehuti |

## MODEL
| Command | Description |
|---|---|
| \`/model\` | Switch AI model (Interactive Submenu) |
| \`/provider\` | Switch provider (Interactive Submenu) |
| \`/thinking\` | Toggle extended thinking mode |

## SHORTCUTS
| Shortcut | Action | Shortcut | Action |
|---|---|---|---|
| \`/\` | Open palette | \`⌃L\` | Clear conversation |
| \`⌃A\` | Move to start | \`⌃E\` | Move to end |
| \`⌃U\` | Delete to start | \`⌃W\` | Delete previous word |
| \`⌃K\` | Delete to end | \`Tab\` | Complete slash command |
| \`↑ / ↓\` | Prompt history | \`PgUp/Dn\`| Scroll messages |
| \`⌃↑ / ⌃↓\`| Scroll messages | \`⌃C\` | Exit when input is empty |
`;
}
