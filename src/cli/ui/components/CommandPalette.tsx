import { Box, Text, useInput, useStdout } from "ink";
import React, { useEffect, useMemo, useState } from "react";

const GOLD = "#D4AF37";
const GRAY = "#6B7280";
const CORAL = "#D97757";
const CYAN = "#06B6D4";
const GREEN = "#10B981";
const SAND = "#C2B280";

export interface CommandItem {
	id: string;
	label: string;
	description: string;
	usage?: string;
	shortcut?: string;
	category: "session" | "model" | "help";
	action: () => void;
}

interface CommandPaletteProps {
	commands: CommandItem[];
	onSelect: (command: CommandItem) => void;
	onClose: () => void;
	visible: boolean;
}

const CATEGORY_LABELS: Record<CommandItem["category"], { label: string; color: string }> = {
	session: { label: "Session", color: GREEN },
	model: { label: "Model", color: CYAN },
	help: { label: "Help", color: GRAY },
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
}: CommandPaletteProps): React.ReactElement | null {
	const [query, setQuery] = useState("");
	const [selectedIndex, setSelectedIndex] = useState(0);
	const { stdout } = useStdout();
	const terminalWidth = stdout?.columns || 80;

	const filteredCommands = useMemo(() => {
		if (!query.trim()) {
			return commands.map((cmd) => ({ ...cmd, matchIndices: [] as number[] }));
		}

		const results = commands
			.map((cmd) => {
				const labelMatch = fuzzyMatch(cmd.label, query);
				const descMatch = fuzzyMatch(cmd.description, query);
				const idMatch = fuzzyMatch(cmd.id, query);

				const bestMatch = [labelMatch, descMatch, idMatch].reduce(
					(best, curr) => (curr.score > best.score ? curr : best),
					{ score: -1, indices: [] },
				);

				return {
					...cmd,
					matchScore: bestMatch.score,
					matchIndices: bestMatch.indices,
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
			setQuery("");
			setSelectedIndex(0);
		}
	}, [visible]);

	useEffect(() => {
		setSelectedIndex(0);
	}, [filteredCommands.length]);

	useInput(
		(char, key) => {
			if (!visible) return;

			if (key.escape) {
				onClose();
				return;
			}

			if (key.upArrow) {
				setSelectedIndex((i) => Math.max(0, i - 1));
				return;
			}

			if (key.downArrow) {
				setSelectedIndex((i) => Math.min(filteredCommands.length - 1, i + 1));
				return;
			}

			if (key.return && filteredCommands.length > 0) {
				const selected = filteredCommands[selectedIndex];
				if (selected) {
					onSelect(selected);
				}
				return;
			}

			if (key.backspace || key.delete) {
				setQuery((q) => q.slice(0, -1));
				return;
			}

			if (char && !key.ctrl && !key.meta && char.length === 1) {
				setQuery((q) => q + char);
			}
		},
		{ isActive: visible },
	);

	if (!visible) return null;

	const paletteWidth = Math.min(70, terminalWidth - 4);
	let flatIndex = -1;

	return React.createElement(
		Box,
		{
			flexDirection: "column",
			width: paletteWidth,
			borderStyle: "round",
			borderColor: GOLD,
			paddingX: 1,
		},
		React.createElement(
			Box,
			{ marginBottom: 1 },
			React.createElement(Text, { bold: true, color: GOLD }, "𓆣 "),
			React.createElement(Text, { color: SAND }, "Command"),
			React.createElement(Text, { color: CORAL }, query),
			React.createElement(Text, { backgroundColor: CORAL }, " "),
		),
		filteredCommands.length === 0
			? React.createElement(
					Box,
					{ paddingY: 1 },
					React.createElement(Text, { dimColor: true }, "No commands found"),
				)
			: React.createElement(
					Box,
					{ flexDirection: "column" },
					...Object.entries(groupedCommands).flatMap(([category, cmds]) => [
						React.createElement(
							Text,
							{ key: `cat-${category}`, dimColor: true, color: SAND },
							`── ${CATEGORY_LABELS[category as keyof typeof CATEGORY_LABELS]?.label || category}`,
						),
						...cmds.map((cmd) => {
							flatIndex++;
							const isSelected = flatIndex === selectedIndex;
							const labelElements =
								query.trim() && cmd.matchIndices.length > 0
									? highlightMatch(cmd.label, cmd.matchIndices)
									: [React.createElement(Text, { key: "label" }, cmd.label)];

							return React.createElement(
								Box,
								{ key: cmd.id, flexDirection: "column", paddingLeft: 1 },
								React.createElement(
									Box,
									null,
									React.createElement(
										Text,
										{ color: isSelected ? GOLD : GRAY },
										isSelected ? "▶ " : "  ",
									),
									...labelElements,
									cmd.usage &&
										React.createElement(
											Text,
											{ key: "usage", color: GRAY, dimColor: true },
											` ${cmd.usage}`,
										),
								),
								isSelected &&
									React.createElement(
										Box,
										{ paddingLeft: 2 },
										React.createElement(
											Text,
											{ dimColor: true, color: CYAN },
											cmd.description,
										),
									),
							);
						}),
					]),
				),
		React.createElement(
			Box,
			{ marginTop: 1, borderStyle: "single", borderColor: GRAY, paddingX: 1 },
			React.createElement(Text, { dimColor: true }, "↑↓ navigate"),
			React.createElement(Text, { dimColor: true }, "  Enter select"),
			React.createElement(Text, { dimColor: true }, "  Esc close"),
		),
	);
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
}): CommandItem[] {
	return [
		{
			id: "/clear",
			label: "/clear",
			description: "Clear conversation history and reset context",
			shortcut: "Ctrl+L",
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
			description: "List available free models on OpenRouter",
			category: "model",
			action: options.onModels,
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
			shortcut: "Ctrl+K",
			category: "help",
			action: options.onHelp,
		},
		{
			id: "/exit",
			label: "/exit",
			description: "Exit Tehuti CLI",
			shortcut: "Ctrl+C",
			category: "session",
			action: options.onExit,
		},
	];
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
│    /plan               Enter plan mode (read-only exploration)    │
│    /skills             List all available skills                   │
│    /exit               Exit Tehuti                                 │
├──────────────────────────────────────────────────────────────────┤
│  MODEL                                                            │
│    /model <name>       Switch AI model                            │
│    /models             List free models                           │
│    /thinking           Toggle extended thinking mode              │
├──────────────────────────────────────────────────────────────────┤
│  SHORTCUTS                                                        │
│    Ctrl+K    Command palette    Ctrl+L    Clear screen            │
│    Ctrl+U    Clear input        Ctrl+W    Delete word             │
│    ↑/↓       History           Ctrl+↑/↓  Scroll                   │
╰──────────────────────────────────────────────────────────────────╯
`.trim();
}

export function getCommandSuggestions(input: string, commands: CommandItem[]): CommandItem[] {
	if (!input.startsWith("/")) return [];
	const query = input.slice(1).toLowerCase();
	
	return commands.filter(cmd => {
		if (query === "") return true;
		return cmd.label.toLowerCase().includes(query) ||
		       cmd.id.toLowerCase().includes(query) ||
		       cmd.description.toLowerCase().includes(query);
	}).slice(0, 5);
}
