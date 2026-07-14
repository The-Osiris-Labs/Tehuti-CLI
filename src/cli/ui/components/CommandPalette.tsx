import {
	useOnClick,
	useOnMouseEnter,
	useOnMouseLeave,
} from "@ink-tools/ink-mouse";
import { Box, Text, useInput, useStdout } from "ink";
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import chalk from "chalk";
import {
	BRANDING,
	DECORATIVE,
	ROLE_COLORS,
	isAsciiMode,
	ASCII_DECORATIVE,
} from "../../../branding/index.js";
import { getAllProviders } from "../../../config/providers.js";
import { isEnterKey } from "../../../utils/keyboard.js";
import { isMouseSequence } from "../../../utils/mouse.js";
import { addRecentCommand, getRecentCommands } from "../commandPaletteRecent.js";
import { useVirtualScroll } from "../hooks/useVirtualScroll.js";
import { HIGH_CONTRAST, keyboardHintLine } from "../accessibility.js";
const GOLD = BRANDING.colors.gold;
const CORAL = BRANDING.colors.coral;
const GRAY = BRANDING.colors.gray;
const CYAN = BRANDING.colors.cyan;


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

const CATEGORY_ORDER: CommandItem["category"][] = [
	"submenu",
	"recent",
	"session",
	"model",
	"help",
];

interface CommandPaletteProps {
	commands: CommandItem[];
	onSelect: (command: CommandItem) => void;
	onClose: () => void;
	visible: boolean;
	initialQuery?: string;
	onQueryChange?: (q: string) => void;
}


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

  // Accessibility: Use high-contrast colors when enabled
	const labelColor = HIGH_CONTRAST ? "white" : CORAL;
	const descColor = HIGH_CONTRAST ? "white" : GRAY;
	const shortcutColor = HIGH_CONTRAST ? "cyan" : CYAN;

  const label =
    query.trim() &&
    cmd.matchIndices &&
    cmd.matchIndices.length > 0 &&
    cmd.matchField === "label"
      ? highlightMatch(cmd.label, cmd.matchIndices, active)
      : [
          React.createElement(
            Text,
            { key: "l", color: active ? "black" : labelColor, bold: active },
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
        { color: active ? "black" : labelColor, bold: active },
        active ? `${cmd.submenu ? "»" : DECORATIVE.arrow} ` : "  ",
      ),
      React.createElement(Text, null, ...label),
      cmd.shortcut &&
        React.createElement(
          Text,
          { color: active ? "black" : shortcutColor, dimColor: !active },
          `  ${cmd.shortcut}`,
        ),
    ),
    React.createElement(
      Box,
      { paddingLeft: 2 },
      React.createElement(
        Text,
        { color: active ? "black" : descColor, dimColor: !active },
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
	onQueryChange,
}: CommandPaletteProps): React.ReactElement | null {
	const query = initialQuery;
	const { stdout } = useStdout();


	const [menuStack, setMenuStack] = useState<
		{ title: string; commands: CommandItem[] }[]
	>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [_error, setError] = useState<string | null>(null);
	// Fuzzy match result cache keyed on cmd.id + query for fast repeated lookups
	const fuzzyCacheRef = useRef<Record<string, { score: number; indices: number[] }>>({});
	const getCachedFuzzy = useCallback(
		(text: string, cmdId: string, q: string) => {
			const key = `${cmdId}::${q}`;
			const cached = fuzzyCacheRef.current[key];
			if (cached) return cached;
			const result = fuzzyMatch(text, q);
			fuzzyCacheRef.current[key] = result;
			return result;
		},
		[fuzzyMatch],
	);
	useEffect(() => {
		// Resize handling for CommandPalette — currently empty but
		// registered to keep the pattern available for future use.
		if (!stdout) return;
		return () => {};
	}, [stdout]);

	const currentCommands =
		menuStack.length > 0 ? menuStack[menuStack.length - 1].commands : commands;

	const filteredCommands = useMemo(() => {
		const q = query;
		if (!q.trim()) {
			return currentCommands.map((cmd) => ({
				...cmd,
				matchScore: -1,
				matchIndices: [] as number[],
				matchField: "label",
			}));
		}

		const results = currentCommands
			.map((cmd) => {
				const labelMatch = getCachedFuzzy(cmd.label, cmd.id, q);
				const descMatch = getCachedFuzzy(cmd.description, cmd.id, q);
				const idMatch = getCachedFuzzy(cmd.id, cmd.id, q);
				const aliasesMatches = (cmd.aliases || []).map((alias) =>
					getCachedFuzzy(alias, cmd.id, q),
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
	}, [currentCommands, query, getCachedFuzzy]);
	// Group before virtualizing so a window is always a stable slice of the
	// complete category order rather than a post-window reordering.
	const groupedCommands = useMemo(() => {
		const groups = new Map<CommandItem["category"], typeof filteredCommands>();
		for (const command of filteredCommands) {
			const group = groups.get(command.category) ?? [];
			group.push(command);
			groups.set(command.category, group);
		}
		return CATEGORY_ORDER.flatMap((category) => groups.get(category) ?? []);
	}, [filteredCommands]);

	const MAX_DISPLAY = 9;

	const {
		selectedIndex,
		windowStart,
		moveUp,
		moveDown,
		getVisibleItems,
		setSelectedIndex,
	} = useVirtualScroll({
		totalItems: groupedCommands.length,
		maxVisibleWindow: MAX_DISPLAY,
	});

	const commandSetKey = useMemo(
		() => currentCommands.map((command) => command.id).join("\u0000"),
		[currentCommands],
	);

	// Query ownership stays with ChatBar. This component only owns which
	// matching command is selected, and resets that selection after its inputs
	// change rather than scheduling state while rendering.
	useEffect(() => {
		setSelectedIndex(0);
	}, [commandSetKey, query, setSelectedIndex]);

	const wasVisible = useRef(false);
	useEffect(() => {
		if (visible && !wasVisible.current) {
			setMenuStack([]);
			setIsLoading(false);
			setError(null);
			setSelectedIndex(0);
		}
		if (!visible && wasVisible.current) {
			setMenuStack([]);
			setIsLoading(false);
			setError(null);
			setSelectedIndex(0);
			onQueryChange?.("");
		}
		wasVisible.current = visible;
	}, [onQueryChange, setSelectedIndex, visible]);

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
				if (onQueryChange) onQueryChange("");
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

	useInput(
		(char, key) => {
			if (isMouseSequence(char)) return;
			if (!visible || isLoading) return;

			if (key.backspace || key.delete) {
				if (query.length === 0 && menuStack.length > 0) {
					setMenuStack((prev) => prev.slice(0, -1));
					onQueryChange?.("");
					setError(null);
				}
				// ChatBar owns text mutation, including deleting a search character.
				return;
			}

			if (key.escape || (key.ctrl && (char === "p" || char === ""))) {
				if (menuStack.length > 0) {
					// Pop stack
					setMenuStack((prev) => prev.slice(0, -1));
					if (onQueryChange) onQueryChange("");
					setError(null);
				} else {
					onClose();
				}
				return;
			}

			if (isEnterKey(char, key)) {
				const selected = groupedCommands[selectedIndex] ?? groupedCommands[0];
				if (selected) {
					void handleExecute(selected);
				}
				return;
			}

			if (query.length === 0 && (key.upArrow || char === "k")) {
				moveUp();
				return;
			}

			if (query.length === 0 && (key.downArrow || char === "j")) {
				moveDown();
				return;
			}
		},
		{ isActive: visible },
	);

	if (!visible) return null;



	const displayCommands = getVisibleItems(groupedCommands);
	const hasMore = groupedCommands.length > MAX_DISPLAY;

	const orderedGroups = CATEGORY_ORDER.map((category) => [
		category,
		displayCommands.filter((command) => command.category === category),
	] as const).filter(([, commands]) => commands.length > 0) as Array<
		[CommandItem["category"], typeof displayCommands]
	>;

	const breadcrumbs = menuStack.map((m) => m.title).join(" > ");
	const titleText = breadcrumbs
		? ` ${DECORATIVE.ibis} Palette > ${breadcrumbs} `
		: ` ${DECORATIVE.ibis} COMMAND PALETTE `;



	return (
		<Box
			flexDirection="column"
			width="100%"
		>
			{React.createElement(
				Box,
				{
					flexDirection: "column",
					width: "100%",
					borderStyle: "round",
					borderColor: CYAN,
					backgroundColor: "black",
					paddingX: 1,
					paddingY: 0,
					borderBottom: false,
				},
				React.createElement(
					Box,
					{ marginTop: 1, marginBottom: 1, justifyContent: "space-between" },
					React.createElement(
						Text,
						{ bold: true, color: menuStack.length > 0 ? CYAN : GOLD },
						titleText,
					),
					React.createElement(
						Text,
						{ color: GRAY, dimColor: true },
						isLoading ? "..." : keyboardHintLine("navigate", "confirm", "cancel"),
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
								orderedGroups.map(([category, items]) => {
									const isRecent = category === "recent";
									// Color by category
									const categoryColor =
										category === "session"
											? ROLE_COLORS.info
											: category === "model"
												? ROLE_COLORS.user
												: category === "help"
													? ROLE_COLORS.success
													: category === "recent"
														? ROLE_COLORS.warning
														: ROLE_COLORS.system;
									return React.createElement(Box, { key: `group-${category}`, flexDirection: "column" }, [
										React.createElement(
											Text,
											{ key: `header-${category}`, color: categoryColor, dimColor: true },
											`── ${isRecent ? "RECENT" : category.toUpperCase()} ──`,
										),
										...items.map((cmd) => {
											const cmdIndex = groupedCommands.findIndex(
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
									]);
								}),
								hasMore &&
									React.createElement(
										Text,
										{
											key: "more-indicator",
											color: GRAY,
											dimColor: true,
										},
										`  … showing ${windowStart + 1}-${windowStart + displayCommands.length} of ${groupedCommands.length} — refine your filter`,
									)
							)
			)}
		</Box>
	);
}

export function createCommands(options: {
	onCost: () => void;
	onModel: (model: string) => void;
	onClear: () => void;
	onExit: () => void;
	onHelp: () => void;
	onSessions: () => void;
	onModels: () => void;
	onRestart?: () => void;
	onSave?: () => void;
	onLoad?: (sessionId: string) => void;
	onStats?: () => void;
	onCompact?: () => void;
	onThinking?: () => void;
	onPlan?: () => void;
	onSkills?: () => void;
	onTools?: () => void;
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
			id: "/restart",
			label: "/restart",
			description: "Save session and start a fresh conversation (same cwd, new session ID)",
			category: "session",
			action: options.onRestart || (() => {}),
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
			id: "/tools",
			label: "/tools",
			description: "List all registered tools (built-in, MCP, and plugin)",
			category: "session",
			action: options.onTools || (() => {}),
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

/** Icon mapping for help command categories */
const HELP_CATEGORY_ICONS: Record<string, string> = {
	session: "\u{1F4CB}",
	model: "\u{1F916}",
	help: "\u2753",
};

const HELP_COMMAND_ICONS: Record<string, string> = {
	"/update": "\u{1F504}",
	"/config": "\u2699\uFE0F",
	"/clear": "\u{1F9F9}",
	"/cost": "\u{1F4B0}",
	"/stats": "\u{1F4CA}",
	"/compact": "\u{1F9F9}",
	"/restart": "\u{1F504}",
	"/save": "\u{1F4BE}",
	"/export": "\u{1F4E4}",
	"/load": "\u{1F4C2}",
	"/sessions": "\u{1F4C1}",
	"/model": "\u{1F4E1}",
	"/provider": "\u{1F504}",
	"/thinking": "\u{1F9E0}",
	"/plan": "\u{1F5FA}\uFE0F",
	"/skills": "\u{1F3B4}",
	"/tools": "\u{1F6E0}\uFE0F",
	"/help": "\u2753",
	"/dashboard": "\u{1F4CA}",
	"/exit": "\u{1F6AA}",
};

// Commands for help display, grouped by category — covers all registered slash commands
const HELP_COMMANDS: Array<{
	id: string;
	label: string;
	category: string;
	description: string;
	shortcut?: string;
	aliases?: string[];
}> = [
	// Session
	{ id: "/clear", label: "/clear", category: "session", description: "Clear conversation history and reset context", shortcut: "Ctrl+L", aliases: ["/cls", "/c"] },
	{ id: "/compact", label: "/compact", category: "session", description: "Compact context to free up token space" },
	{ id: "/config", label: "/config", category: "session", description: "Open interactive configuration editor" },
	{ id: "/copy", label: "/copy", category: "session", description: "Copy last assistant response to clipboard" },
	{ id: "/cost", label: "/cost", category: "session", description: "Show session cost, token usage, and cache savings" },
	{ id: "/dashboard", label: "/dashboard", category: "session", description: "Toggle Swarm Observability Dashboard" },
	{ id: "/exit", label: "/exit", category: "session", description: "Exit Tehuti CLI", aliases: ["/quit", "/q"] },
	{ id: "/export", label: "/export", category: "session", description: "Export session to Markdown or JSON" },
	{ id: "/help", label: "/help", category: "help", description: "Show all commands and keyboard shortcuts", aliases: ["/h"] },
	{ id: "/load", label: "/load", category: "session", description: "Load a saved session" },
	{ id: "/plan", label: "/plan", category: "session", description: "Enter plan mode (read-only exploration)" },
	{ id: "/restart", label: "/restart", category: "session", description: "Save session and start a fresh conversation" },
	{ id: "/save", label: "/save", category: "session", description: "Save current session for later" },
	{ id: "/sessions", label: "/sessions", category: "session", description: "List all saved sessions" },
	{ id: "/skills", label: "/skills", category: "session", description: "List all available skills" },
	{ id: "/stats", label: "/stats", category: "session", description: "Show performance metrics and optimization statistics" },
	{ id: "/tools", label: "/tools", category: "session", description: "List all registered tools (built-in, MCP, and plugin)" },
	{ id: "/update", label: "/update", category: "session", description: "Pull latest updates and rebuild the CLI" },
	// Model & Provider
	{ id: "/model", label: "/model", category: "model", description: "Switch to a different AI model" },
	{ id: "/provider", label: "/provider", category: "model", description: "Switch AI provider (openrouter/kilocode/custom)" },
	{ id: "/thinking", label: "/thinking", category: "model", description: "Toggle extended thinking mode for complex reasoning" },
];

export function formatHelpOutput(): string {
	const sections = new Map<string, typeof HELP_COMMANDS>();
	for (const cmd of HELP_COMMANDS) {
		const list = sections.get(cmd.category) ?? [];
		list.push(cmd);
		sections.set(cmd.category, list);
	}

	const sectionOrder = ["session", "model", "help"];
	const sectionLabels: Record<string, string> = {
		session: "SESSION",
		model: "MODEL & PROVIDER",
		help: "HELP",
	};
	const sectionColors: Record<string, string> = {
		session: ROLE_COLORS.info,
		model: ROLE_COLORS.user,
		help: ROLE_COLORS.success,
	};

	const ascii = isAsciiMode();
	const ibis = ascii ? ASCII_DECORATIVE.ibis : DECORATIVE.ibis;

	let output = "";

	// Header
	output += chalk.hex(ROLE_COLORS.assistant).bold(`  ${ibis} TEHUTI — Scribe of Code Transformations\n\n`);

	for (const cat of sectionOrder) {
		const commands = sections.get(cat);
		if (!commands || commands.length === 0) continue;

		const label = sectionLabels[cat] ?? cat.toUpperCase();
		const color = sectionColors[cat] ?? ROLE_COLORS.system;
		const icon = HELP_CATEGORY_ICONS[cat] ?? "";

		output += chalk.hex(color)(`  ${icon} ${label}\n`);

		for (const cmd of commands) {
			const cmdIcon = HELP_COMMAND_ICONS[cmd.id] ?? "\u{1F539}";
			const aliasText = cmd.aliases && cmd.aliases.length > 0
				? ` (${cmd.aliases.join(", ")})`
				: "";
			const shortcut = cmd.shortcut
				? ` [${cmd.shortcut}]`
				: "";
			output += `  ${cmdIcon} ${cmd.label}${aliasText}${shortcut}\n`;
			output += `    ${cmd.description}\n`;
		}

		output += "\n";
	}

	// Keyboard Shortcuts section
	output += `  \u{2328} KEYBOARD SHORTCUTS\n`;
	const shortcuts: Array<[string, string]> = [
		["/", "Open palette"],
		["Ctrl+P", "Open command palette"],
		["Ctrl+L", "Clear conversation"],
		["Ctrl+C", "Interrupt / exit empty"],
		["Enter", "Send message"],
		["Shift+Enter", "New line (multiline)"],
		["Ctrl+A", "Move to start"],
		["Ctrl+E", "Move to end"],
		["Ctrl+U", "Delete to start"],
		["Ctrl+K", "Delete to end"],
		["Ctrl+W", "Delete previous word"],
		["Ctrl+D", "Delete character forward"],
		["Ctrl+T", "Transpose characters"],
		["Ctrl+X", "Cut selection"],
		["Ctrl+Left/Right", "Word jump"],
		["Ctrl+Backspace/Del", "Delete word"],
		["Tab", "Complete slash command"],
		["Shift+Tab", "Cycle backward"],
		["Up/Down", "Prompt history"],
		["Ctrl+Up/Down", "Scroll line"],
		["PgUp/PgDn", "Scroll page"],
		["Home/End", "Scroll to top/bottom"],
		["Esc", "Clear input"],
	];
	for (const [key, action] of shortcuts) {
		output += `  \u{25B6} ${key}\n`;
		output += `    ${action}\n`;
	}

	return output;
}
