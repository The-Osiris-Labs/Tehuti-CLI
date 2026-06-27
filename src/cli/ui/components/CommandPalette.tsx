import { Box, Text, useInput, useStdout } from "ink";
import React, { useEffect, useMemo, useState } from "react";
import InkTextInput from "ink-text-input";
import { globalConfig } from "../../../config/index.js";
import { getAllProviders } from "../../../config/providers.js";
import { DECORATIVE } from "../../../branding/index.js";
import { isMouseSequence } from "../../../utils/mouse.js";

const GOLD = "#F5C518";
const CORAL = "#FF6B35";
const GRAY = "#9CA3AF";
const CYAN = "#06B6D4";
const GREEN = "#22C55E";
const SAND = "#8B7355";

export interface CommandItem {
	id: string;
	label: string;
	description: string;
	usage?: string;
	shortcut?: string;
	aliases?: string[];
	category: "session" | "model" | "help" | "recent";
	action: () => void;
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

function highlightMatch(text: string, indices: number[]): React.ReactNode[] {
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
					{ key: `text-${i}` },
					text.slice(lastIdx, idx),
				),
			);
		}
		elements.push(
			React.createElement(
				Text,
				{ key: `match-${i}`, color: GOLD, bold: true },
				text[idx],
			),
		);
		lastIdx = idx + 1;
	}

	if (lastIdx < text.length) {
		elements.push(
			React.createElement(Text, { key: "text-end" }, text.slice(lastIdx)),
		);
	}

	return elements;
}

export function CommandPalette({
	commands,
	onSelect,
	onClose,
	visible,
	initialQuery = "",
}: CommandPaletteProps): React.ReactElement | null {
	const [query, setQuery] = useState("");
	const [selectedIndex, setSelectedIndex] = useState<number>(0);
	const { stdout } = useStdout();
	const [terminalWidth, setTerminalWidth] = useState(stdout?.columns || 80);

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
			return commands.map((cmd) => ({ ...cmd, matchIndices: [] as number[], matchField: 'label' }));
		}

		const results = commands
			.map((cmd) => {
				const labelMatch = fuzzyMatch(cmd.label, query);
				const descMatch = fuzzyMatch(cmd.description, query);
				const idMatch = fuzzyMatch(cmd.id, query);
				const aliasesMatches = (cmd.aliases || []).map(alias => fuzzyMatch(alias, query));
				const bestAliasMatch = aliasesMatches.reduce(
					(best, curr) => (curr.score > best.score ? curr : best),
					{ score: -1, indices: [] }
				);

				const matches = [
					{ score: labelMatch.score, indices: labelMatch.indices, field: 'label' },
					{ score: descMatch.score, indices: descMatch.indices, field: 'description' },
					{ score: idMatch.score, indices: idMatch.indices, field: 'id' },
					{ score: bestAliasMatch.score, indices: bestAliasMatch.indices, field: 'aliases' }
				];

				const bestMatch = matches.reduce(
					(best, curr) => (curr.score > best.score ? curr : best),
					{ score: -1, indices: [], field: 'label' }
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
	}, [commands, query]);

	const groupedCommands = useMemo(() => {
		const groups: Record<string, typeof filteredCommands> = {};
		for (const cmd of filteredCommands) {
			const cat = cmd.category;
			if (!groups[cat]) groups[cat] = [];
			groups[cat].push(cmd);
		}
		return groups;
	}, [filteredCommands]);

	useEffect(() => {
		if (visible) {
			const initQ = initialQuery || "";
			setQuery(initQ);
			setSelectedIndex(0);
		}
	}, [visible, initialQuery]);

	useEffect(() => {
		setSelectedIndex(0);
	}, [filteredCommands]);

	useInput(
		(char, key) => {
			if (isMouseSequence(char)) return;
			if (!visible) return;

			if (key.escape) {
				onClose();
				return;
			}

			if (key.upArrow) {
				setSelectedIndex((prev) => Math.max(0, prev - 1));
				return;
			}

			if (key.downArrow) {
				setSelectedIndex((prev) => Math.min(filteredCommands.length - 1, prev + 1));
				return;
			}

			if (key.return && filteredCommands.length > 0) {
				const selected = filteredCommands[selectedIndex] || filteredCommands[0];
				if (selected) {
					onSelect(selected);
				}
				return;
			}

			// query editing handled by InkTextInput below - no manual char/backspace here to avoid conflict
		},
		{ isActive: visible },
	);

	if (!visible) return null;

	// Consistent fixed sizing, never random. Clamp only for tiny terminals.
	const paletteWidth = Math.min(62, Math.max(40, terminalWidth - 6));
	const MAX_DISPLAY = 9; // keep palette height predictable & best-in-class
	const displayCommands = filteredCommands.slice(0, MAX_DISPLAY);
	const hasMore = filteredCommands.length > MAX_DISPLAY;

	// Build ordered groups for deterministic categories (recent first)
	const orderedGroups = [
		["recent", groupedCommands["recent"] || []],
		["session", groupedCommands["session"] || []],
		["model", groupedCommands["model"] || []],
		["help", groupedCommands["help"] || []],
	].filter(([, cmds]) => (cmds as any[]).length > 0) as Array<[string, typeof filteredCommands]>;

	return React.createElement(
		Box,
		{
			flexDirection: "column",
			width: paletteWidth,
			borderStyle: "round",
			borderColor: GOLD,
			paddingX: 1,
			paddingY: 1,
		},
		React.createElement(
			Box,
			{ marginBottom: 1 },
			React.createElement(Text, { bold: true, color: GOLD }, `${DECORATIVE.ibis} COMMAND PALETTE `),
			React.createElement(Text, { color: GRAY }, "(type • ↑↓ • ⏎ • esc)"),
		),
		React.createElement(
			Box,
			{ borderStyle: "single", borderColor: CORAL, paddingX: 1, marginBottom: 1 },
			React.createElement(Text, { color: CORAL }, `${DECORATIVE.arrow} `),
			React.createElement(InkTextInput, {
				value: query,
				onChange: (val: string) => setQuery(val),
				placeholder: "filter commands or providers...",
				focus: visible,
			}),
		),
		filteredCommands.length === 0
			? React.createElement(
					Box,
					{ paddingY: 1, flexDirection: "column" },
					React.createElement(Text, { dimColor: true, color: CORAL }, `${DECORATIVE.eye} No match found.`),
					React.createElement(Text, { color: SAND }, "  Try: /models  /provider openrouter  /cost  /config  /compact"),
					React.createElement(Text, { color: GRAY, dimColor: true }, "  Dynamic providers loaded from registry. Esc to close."),
				)
			: React.createElement(
					Box,
					{ flexDirection: "column" },
					...orderedGroups.flatMap(([category, cmds]) => [
						React.createElement(
							Text,
							{ key: `cat-${category}`, dimColor: true, color: SAND, bold: true },
							`── ${CATEGORY_LABELS[category as keyof typeof CATEGORY_LABELS]?.glyph || ""} ${CATEGORY_LABELS[category as keyof typeof CATEGORY_LABELS]?.label || category}`,
						),
						...cmds.slice(0, MAX_DISPLAY).map((cmd) => {
							const cmdIndex = filteredCommands.findIndex((c) => c.id === cmd.id);
							const isSelected = cmdIndex === selectedIndex;
							const label = (query.trim() && cmd.matchIndices.length > 0 && cmd.matchField === 'label')
								? highlightMatch(cmd.label, cmd.matchIndices)
								: [cmd.label];

							return React.createElement(
								Box,
								{
									key: cmd.id,
									flexDirection: "column",
									paddingX: 1,
									backgroundColor: isSelected ? "blue" : undefined,
								},
								React.createElement(
									Text,
									{ color: isSelected ? "white" : CORAL, bold: isSelected },
									isSelected ? `${DECORATIVE.arrow} ` : "  ",
									...label,
									cmd.shortcut && React.createElement(Text, { color: CYAN }, ` ${cmd.shortcut}`),
								),
								React.createElement(
									Text,
									{ color: GRAY, dimColor: true },
									`    ${cmd.description}${cmd.usage ? `  ${cmd.usage}` : ''}`,
								),
							);
						}),
					]),
					hasMore && React.createElement(
						Text,
						{ color: GRAY, dimColor: true },
						`  … +${filteredCommands.length - MAX_DISPLAY} more — refine your filter`,
					),
				),
		React.createElement(
			Box,
			{ marginTop: 1, borderStyle: "single", borderColor: GRAY, paddingX: 1 },
			React.createElement(Text, { dimColor: true, color: SAND }, `${DECORATIVE.ibis} ↑↓  ⏎ run  ⎋ close  • Egyptian TUI`),
		),
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
		const filtered = recent.filter(id => id !== commandId);
		const updated = [commandId, ...filtered].slice(0, 5);
		globalConfig.set("recentCommands", updated);
	} catch {
	}
}

export function createCommands(options: {
	onCost: () => void;
	onModel: () => void;
	onClear: () => void;
	onExit: () => void;
	onHelp: () => void;
	onSessions: () => void;
	onModels: () => void;
	onSave?: () => void;
	onLoad?: () => void;
	onStats?: () => void;
	onCompact?: () => void;
	onThinking?: () => void;
	onPlan?: () => void;
	onSkills?: () => void;
	onActivateSkill?: (skillId: string) => void;
	onDeactivateSkill?: (skillId: string) => void;
	onGetSkill?: (skillId: string) => void;
	onConfig?: () => void;
	onProvider?: (provider?: string) => void;
	onProviders?: () => void;
}): CommandItem[] {
  const baseCommands = [
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
			usage: "[name]",
			category: "session",
			action: options.onSave || (() => {}),
		},
		{
			id: "/load",
			label: "/load",
			description: "Load a saved session",
			usage: "<id>",
			category: "session",
			action: options.onLoad || (() => {}),
		},
		{
			id: "/sessions",
			label: "/sessions",
			description: "List all saved sessions",
			category: "session",
			action: options.onSessions,
		},
		{
			id: "/search",
			label: "/search",
			description: "Search saved sessions by name, ID, or model",
			usage: "<query>",
			category: "session",
			action: () => {}, // Placeholder - will be handled in chat.ts
		},
		{
			id: "/model",
			label: "/model",
			description: "Switch to a different AI model",
			usage: "<name>",
			category: "model",
			action: options.onModel,
		},
		{
			id: "/models",
			label: "/models",
			description: "List available models from the current provider",
			category: "model",
			action: options.onModels,
		},
		{
			id: "/provider",
			label: "/provider",
			description: "Switch or view AI provider (openrouter/kilocode/custom). Supports OAuth/PATs",
			usage: "[name]",
			category: "model",
			action: options.onProvider || (() => {}),
		},
		{
			id: "/providers",
			label: "/providers",
			description: "List supported providers and their capabilities (OAuth, MCP)",
			category: "model",
			action: options.onProviders || (() => {}),
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
				id: "/exit",
				label: "/exit",
				description: "Exit Tehuti CLI",
				aliases: ["/quit", "/q"],
				category: "session",
				action: options.onExit,
			},
	];

	// Add recently used commands
	const recentIds = getRecentCommands();
	const recentCommands: CommandItem[] = [];
	
	for (const id of recentIds) {
		const command = baseCommands.find(cmd => cmd.id === id);
		if (command) {
			recentCommands.push({
				...command,
				category: "recent" as const,
			});
		}
	}

	// Enhanced command objects with recent tracking
	const commandsWithTracking: CommandItem[] = baseCommands.map(cmd => ({
		...cmd,
		category: cmd.category as "session" | "model" | "help" | "recent",
		action: () => {
			addRecentCommand(cmd.id);
			cmd.action();
		}
	}));

	// Dynamic providers for best UX - no hardcode in TUI, from registry
	const providerItems = getAllProviders().slice(0, 12).map(p => ({
		id: `/provider ${p.id}`,
		label: `/provider ${p.id}`,
		description: p.name + (p.oauthSupported ? " (OAuth supported)" : ""),
		usage: "",
		category: "model" as const,
		action: () => options.onProvider?.(p.id),
	}));

	return [...recentCommands, ...commandsWithTracking.filter(cmd => 
		!recentIds.includes(cmd.id)
	), ...providerItems.filter(p => !recentIds.includes(p.id)) ];
}

export function formatHelpOutput(): string {
	return `
╭──────────────────────────────────────────────────────────────────╮
│  𓆣 TEHUTI ─ Scribe of Code Transformations                       │
├──────────────────────────────────────────────────────────────────┤
│  SESSION                                                          │
│    /clear              Clear conversation                         │
│    /cost               Show tokens and cost                       │
│    /stats              Show performance metrics                   │
│    /compact            Compact context to free up token space     │
│    /save [name]        Save session                               │
│    /load <id>          Load session                               │
│    /sessions           List saved sessions                        │
│    /search <query>     Search sessions by name, ID, or model      │
│    /plan               Enter plan mode (read-only exploration)    │
│    /config             Open interactive configuration editor      │
│    /skills             List all available skills                  │
│    /help               Show this command reference                │
│    /exit               Exit Tehuti                                │
├──────────────────────────────────────────────────────────────────┤
│  MODEL                                                            │
│    /model <name>       Switch AI model                            │
│    /models             List models from current provider          │
│    /provider [name]    Switch or inspect provider                 │
│    /providers          List supported providers                   │
│    /thinking           Toggle extended thinking mode              │
├──────────────────────────────────────────────────────────────────┤
│  SHORTCUTS                                                        │
│    ⌃P    Open palette       ⌃L    Clear conversation              │
│    ⌃A    Move to start      ⌃E    Move to end                     │
│    ⌃U    Delete to start    ⌃W    Delete previous word            │
│    ⌃K    Delete to end      Tab   Complete slash command          │
│    ↑/↓   Prompt history     PgUp/PgDn scroll messages            │
│    ⌃↑/⌃↓ Scroll messages    ⌃C    Exit when input is empty        │
╰──────────────────────────────────────────────────────────────────╯
`.trim();
}

export function getCommandSuggestions(
	input: string,
	commands: CommandItem[],
): CommandItem[] {
	if (!input.startsWith("/")) return [];
	const query = input.toLowerCase();
	const queryWithoutSlash = input.slice(1).toLowerCase();

	return commands
		.filter((cmd) => {
			if (queryWithoutSlash === "") return true;

			const hasAliasMatch = cmd.aliases?.some(alias =>
				alias.toLowerCase().includes(query) ||
				alias.slice(1).toLowerCase().includes(queryWithoutSlash)
			);

			return (
				cmd.label.toLowerCase().includes(queryWithoutSlash) ||
				cmd.id.toLowerCase().includes(queryWithoutSlash) ||
				cmd.description.toLowerCase().includes(queryWithoutSlash) ||
				hasAliasMatch
			);
		})
		.slice(0, 5);
}
