import { Box, Text } from "ink";
import React, { useEffect, useState } from "react";
import { getTodos } from "../../../agent/tools/system.js";
import { BRANDING, ROLE_COLORS, HIEROGLYPHS, isAsciiMode, ASCII_HIEROGLYPHS } from "../../../branding/index.js";
import { GlobalInputState } from "../input-state.js";

const COLORS = {
	primary: BRANDING.colors.primary,
	nile: BRANDING.colors.nile,
	gray: BRANDING.colors.gray,
	gold: BRANDING.colors.gold,
	sand: BRANDING.colors.sand,
} as const;

interface TodoLike {
	id: string;
	parentId?: string;
	content: string;
	status: "pending" | "in_progress" | "completed" | "cancelled";
	priority?: "high" | "medium" | "low";
	updatedAt?: string;
}

const ICONS: Record<
	TodoLike["status"],
	{ glyph: string; color: string; spin: boolean }
> = {
	pending: { glyph: "☐", color: COLORS.gray, spin: false },
	in_progress: { glyph: "◐", color: COLORS.gold, spin: false },
	completed: { glyph: "✓", color: ROLE_COLORS.success, spin: false },
	cancelled: { glyph: "✕", color: ROLE_COLORS.error, spin: false },
};

const PRIORITY_COLORS: Record<NonNullable<TodoLike["priority"]>, string> = {
	high: ROLE_COLORS.error,
	medium: COLORS.gold,
	low: ROLE_COLORS.success,
};

function formatAge(updatedAt: string | undefined): string {
	if (!updatedAt) return "";
	const updated = new Date(updatedAt);
	const ageMs = Date.now() - updated.getTime();
	const ageMin = Math.round(ageMs / 60_000);
	if (Number.isNaN(ageMin)) return "";
	if (ageMin > 60) return ` [${Math.round(ageMin / 60)}h ago]`;
	if (ageMin > 0) return ` [${ageMin}m ago]`;
	return " [just now]";
}

interface TreeNode extends TodoLike {
	children: TreeNode[];
}

function buildTree(todos: TodoLike[]): TreeNode[] {
	const nodeMap = new Map<string, TreeNode>();
	for (const todo of todos) {
		nodeMap.set(todo.id, { ...todo, children: [] });
	}
	const roots: TreeNode[] = [];
	for (const todo of todos) {
		const node = nodeMap.get(todo.id)!;
		if (todo.parentId && nodeMap.has(todo.parentId)) {
			nodeMap.get(todo.parentId)!.children.push(node);
		} else {
			roots.push(node);
		}
	}
	return roots;
}

export function TodoList(): React.ReactElement | null {
	const ascii = isAsciiMode();
	const [todos, setTodos] = useState<TodoLike[]>(
		() => getTodos() as TodoLike[],
	);
	const [frame, setFrame] = useState(0);

	// Data polling: every 2s, but only when no component is being hovered
	// (to avoid UI thrash while the user is interacting with another panel).
	useEffect(() => {
		const interval = setInterval(() => {
			if (GlobalInputState.hoveredComponentCount === 0) {
				setTodos(getTodos() as TodoLike[]);
			}
			setFrame((f) => (f + 1) % (ascii ? ASCII_HIEROGLYPHS.loading : HIEROGLYPHS.loading).length);
		}, 2000);
		return () => clearInterval(interval);
	}, []);

	if (!todos || todos.length === 0) {
		return null;
	}

	const tree = buildTree(todos);

	function renderTreeNodes(
		nodes: TreeNode[],
		prefix: string,
	): React.ReactElement[] {
		return nodes.flatMap((node, index) => {
			const isLast = index === nodes.length - 1;
			const connector = isLast ? "└─ " : "├─ ";
			const def = ICONS[node.status] ?? ICONS.pending;
			const glyph = def.spin
				? (ascii ? ASCII_HIEROGLYPHS.loading : HIEROGLYPHS.loading)[frame]
				: def.glyph;
			const color = def.color;
			const priority = node.priority
				? PRIORITY_COLORS[node.priority]
				: null;
			const ageText = formatAge(node.updatedAt);

			const elements: React.ReactElement[] = [
				React.createElement(
					Box,
					{ key: node.id, flexDirection: "row", gap: 1 },
					React.createElement(
						Text,
						{ color: COLORS.gray, dimColor: true },
						prefix + connector,
					),
					React.createElement(Text, { color }, glyph),
					React.createElement(
						Text,
						{ color: COLORS.gray, dimColor: true },
						`[${node.id}]`,
					),
					priority &&
						React.createElement(
							Text,
							{ color: priority, bold: true },
							"●",
						),
					React.createElement(
						Text,
						{
							color,
							strikethrough: node.status === "completed",
						},
						node.content,
					),
					ageText &&
						React.createElement(
							Text,
							{ color: COLORS.gray, dimColor: true },
							ageText,
						),
				),
			];

			if (node.children.length > 0) {
				const childPrefix = prefix + (isLast ? "   " : "│  ");
				elements.push(
					...renderTreeNodes(node.children, childPrefix),
				);
			}

			return elements;
		});
	}

	return React.createElement(
		Box,
		{
			flexDirection: "column",
			paddingY: 1,
			paddingX: 1,
			borderStyle: "single",
			borderColor: COLORS.sand,
		},
		React.createElement(
			Box,
			{ marginBottom: 1, gap: 1 },
			React.createElement(
				Text,
				{ color: COLORS.primary, bold: true },
				ascii ? ASCII_HIEROGLYPHS.tool : HIEROGLYPHS.tool,
			),
			React.createElement(
				Text,
				{ color: COLORS.primary, bold: true },
				"Active Tasks",
			),
			React.createElement(
				Text,
				{ color: COLORS.gray, dimColor: true },
				`(${todos.length})`,
			),
		),
		React.createElement(
			Box,
			{ flexDirection: "column", paddingLeft: 2 },
			...renderTreeNodes(tree, ""),
		),
	);
}
