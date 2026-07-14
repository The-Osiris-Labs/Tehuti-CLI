import { Box, Text } from "ink";
import React, { useEffect, useState } from "react";
import { getTodos } from "../../../agent/tools/system.js";
import { BRANDING, HIEROGLYPHS, isAsciiMode, ASCII_HIEROGLYPHS } from "../../../branding/index.js";
import { GlobalInputState } from "../input-state.js";

const COLORS = {
	primary: BRANDING.colors?.primary || "#F5C518",
	nile: BRANDING.colors?.nile || "#3B82F6",
	green: BRANDING.colors?.green || "#22C55E",
	gray: BRANDING.colors?.gray || "#9CA3AF",
	red: BRANDING.colors?.red || "#F05050",
	sand: BRANDING.colors?.sand || "#A08860",
} as const;
const ascii = isAsciiMode();

interface TodoLike {
	id: string;
	content: string;
	status: "pending" | "in_progress" | "completed" | "cancelled";
	priority?: "high" | "medium" | "low";
	updatedAt?: string;
}

// Brand-aligned icons. The original used mixed emoji (`⏳`, `✅`, `🔄`,
// `❌`) which clash with the hieroglyphic theme of the rest of the UI.
const ICONS: Record<
	TodoLike["status"],
	{ glyph: string; color: string; spin: boolean }
> = {
	pending: { glyph: "○", color: COLORS.gray, spin: false },
	in_progress: {
		glyph: (ascii ? ASCII_HIEROGLYPHS.loading : HIEROGLYPHS.loading)[0],
		color: COLORS.nile,
		spin: true,
	},
	completed: { glyph: ascii ? ASCII_HIEROGLYPHS.success : HIEROGLYPHS.success, color: COLORS.green, spin: false },
	cancelled: { glyph: "✕", color: COLORS.red, spin: false },
};

const PRIORITY_COLORS: Record<NonNullable<TodoLike["priority"]>, string> = {
	high: COLORS.red,
	medium: COLORS.primary,
	low: COLORS.green,
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

export function TodoList(): React.ReactElement | null {
	const ascii = isAsciiMode();
	const [todos, setTodos] = useState<TodoLike[]>(
		() => getTodos() as TodoLike[],
	);
	const [frame, setFrame] = useState(0);

	// Data polling: every 1s, but only when no component is being hovered
	// (to avoid UI thrash while the user is interacting with another panel).
	// The same tick drives the in-progress spinner so we don't multiply
	// interval timers.
	useEffect(() => {
		const interval = setInterval(() => {
			if (GlobalInputState.hoveredComponentCount === 0) {
				setTodos(getTodos() as TodoLike[]);
			}
			setFrame((f) => (f + 1) % (ascii ? ASCII_HIEROGLYPHS.loading : HIEROGLYPHS.loading).length);
		}, 1000);
		return () => clearInterval(interval);
	}, []);

	if (!todos || todos.length === 0) {
		return null;
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
			...todos.map((todo) => {
				const def = ICONS[todo.status] ?? ICONS.pending;
				const glyph = def.spin ? (ascii ? ASCII_HIEROGLYPHS.loading : HIEROGLYPHS.loading)[frame] : def.glyph;
				const color = def.color;
				const priority = todo.priority ? PRIORITY_COLORS[todo.priority] : null;
				const ageText = formatAge(todo.updatedAt);

				return React.createElement(
					Box,
					{ key: todo.id, flexDirection: "row", gap: 1 },
					React.createElement(Text, { color }, glyph),
					React.createElement(
						Text,
						{ color: COLORS.gray, dimColor: true },
						`[${todo.id}]`,
					),
					priority &&
						React.createElement(Text, { color: priority, bold: true }, "●"),
					React.createElement(
						Text,
						{
							color,
							strikethrough: todo.status === "completed",
						},
						todo.content,
					),
					ageText &&
						React.createElement(
							Text,
							{ color: COLORS.gray, dimColor: true },
							ageText,
						),
				);
			}),
		),
	);
}
