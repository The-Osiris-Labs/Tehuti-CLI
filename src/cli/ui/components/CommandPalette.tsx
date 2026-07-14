import {
	useOnClick,
	useOnMouseEnter,
	useOnMouseLeave,
} from "@ink-tools/ink-mouse";
import { Box, Text, useInput, useStdout } from "ink";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { BRANDING, DECORATIVE } from "../../../branding/index.js";
import { getAllProviders } from "../../../config/providers.js";
import { isEnterKey } from "../../../utils/keyboard.js";
import { isMouseSequence } from "../../../utils/mouse.js";
import { addRecentCommand, getRecentCommands } from "../commandPaletteRecent.js";
import { useVirtualScroll } from "../hooks/useVirtualScroll.js";

const GOLD = BRANDING.colors.gold;
const CORAL = BRANDING.colors.coral;
const GRAY = BRANDING.colors.gray;
const CYAN = BRANDING.colors.cyan;
// @ts-expect-error TS6133/TS6192: Unused variable
const _RED = BRANDING.colors.red;

/** High-contrast mode detection for terminal accessibility */
const HIGH_CONTRAST = process.env.TEHUTI_HIGH_CONTRAST === "1" || process.env.NO_COLOR === undefined;

/** Get accessible color based on high-contrast preference */
function getAccessibleColor(normalColor: string, highContrastColor: string): string {
  return HIGH_CONTRAST ? highContrastColor : normalColor;
}

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
  const labelColor = getAccessibleColor(CORAL, "white");
  const descColor = getAccessibleColor(GRAY, "white");
  const shortcutColor = getAccessibleColor(CYAN, "cyan");

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

	const currentCommands =
		menuStack.length > 0 ? menuStack[menuStack.length - 1].commands : commands;

		useEffect(() => {
			// Resize handling for CommandPalette — currently empty but
			// registered to keep the pattern available for future use.
			if (!stdout) return;
			return () => {};
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
						isLoading ? "..." : "(↑↓/jk • ⏎ • esc)",
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
									return React.createElement(Box, { key: `group-${category}`, flexDirection: "column" }, [
										React.createElement(
											Text,
											{ key: `header-${category}`, dimColor: true },
											isRecent ? `── RECENT ` : `── ${category.toUpperCase()} `,
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
| \`/restart\` | Start a fresh conversation (new session ID) |
| \`/save [name]\` | Save session |
| \`/export [format]\` | Export session to Markdown or JSON |
| \`/load\` | Load session (Interactive Submenu) |
| \`/sessions\` | List saved sessions |
| \`/search <q>\` | Search saved sessions |
| \`/plan\` | Enter plan mode (read-only exploration) |
| \`/config\` | Open interactive configuration editor |
| \`/copy\` | Copy last assistant response to clipboard |
| \`/todos\` | Show task list |
| \`/dashboard\` | Toggle Swarm Observability Dashboard |
| \`/help\` | Show this command reference |
| \`/exit\` | Exit Tehuti |

## MODEL & PROVIDER
| Command | Description |
|---|---|
| \`/model\` | Switch AI model (Interactive Submenu) |
| \`/provider\` | Switch provider (Interactive Submenu) |
| \`/providers\` | List all available providers |
| \`/auth gemini\` | Authenticate Google for Gemini models |
| \`/thinking\` | Toggle extended thinking mode |

## TOOLS & SKILLS
| Command | Description |
|---|---|
| \`/tools\` | List all available tools (built-in + MCP) |
| \`/skills\` | List all available skills |

## SYSTEM
| Command | Description |
|---|---|
| \`/update\` | Pull latest updates and rebuild the CLI |
| \`/reset-key\` | Reset API key (clears config) |
| \`/mouse\` | Toggle mouse support |
| \`/profiler\` | Toggle trace profiler |

## SHORTCUTS
| Shortcut | Action | Shortcut | Action |
|---|---|---|---|
| \`/\` | Open palette | \`⌃P\` | Open command palette |
| \`⌃L\` | Clear conversation | \`⌃C\` | Interrupt / exit empty |
| \`↩\` | Send message | \`⇧↩\` | New line (multiline) |
| \`⌃A\` | Move to start | \`⌃E\` | Move to end |
| \`⌃U\` | Delete to start | \`⌃K\` | Delete to end |
| \`⌃W\` | Delete previous word | \`⌃D\` | Delete character forward |
| \`⌃T\` | Transpose characters | \`⌃X\` | Cut selection |
| \`⌃← / ⌃→\`| Word jump | \`⌃⌫ / ⌃⌦\`| Delete word |
| \`Tab\` | Complete slash command | \`⇧Tab\` | Cycle backward |
| \`↑ / ↓\` | Prompt history | \`⌃↑ / ⌃↓\`| Scroll line |
| \`PgUp / PgDn\`| Scroll page | \`Home / End\`| Scroll to top/bottom |
| \`Esc\` | Clear input | | |
`;
}
