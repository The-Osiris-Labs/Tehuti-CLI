import { Box, Text } from "ink";
import type React from "react";
import { useEffect, useState } from "react";
import { BRANDING, DECORATIVE, HIEROGLYPHS, isAsciiMode, ASCII_DECORATIVE, ASCII_HIEROGLYPHS } from "../../../branding/index.js";
import { respectReducedMotion } from "../accessibility.js";

const COLORS = {
	primary: BRANDING.colors.primary,
	green: BRANDING.colors.green,
	red: BRANDING.colors.red,
	sand: BRANDING.colors.sand,
	coral: BRANDING.colors.coral,
	nile: BRANDING.colors.nile,
	gray: BRANDING.colors.gray,
} as const;
const ascii = isAsciiMode();

export type StatusKind =
	| "success"
	| "error"
	| "warning"
	| "info"
	| "pending"
	| "running"
	| "idle"
	| "killed"
	| "cached"
	| "readonly"
	| "mutating"
	| "verified"
	| "speculative"
	| "thinking";

export interface StatusBadgeProps {
	/** What semantic state to display. */
	kind: StatusKind;
	/**
	 * Short label shown next to the icon. When omitted we render the kind
	 * name capitalized ("Success", "Pending", etc.) as a sensible default.
	 */
	label?: string;
	/**
	 * Optional compact mode — drops the label and shows only the icon.
	 * Useful in dense lists like `SwarmVisualizer`.
	 */
	compact?: boolean;
	/**
	 * Show a subtle background pill around the label for emphasis.
	 */
	emphasize?: boolean;

	/**
	 * Reduce motion for accessibility (default: false, respects env var)
	 */
	reduceMotion?: boolean;
}

const ICONS: Record<
	StatusKind,
	{ glyph: string; color: string; spin?: boolean }
> = {
	success: { glyph: ascii ? ASCII_HIEROGLYPHS.success : HIEROGLYPHS.success, color: COLORS.green },
	error: { glyph: ascii ? ASCII_HIEROGLYPHS.error : HIEROGLYPHS.error, color: COLORS.red },
	warning: { glyph: ascii ? ASCII_DECORATIVE.eye : DECORATIVE.eye, color: COLORS.primary }, // eye of Horus variant
	info: { glyph: "ⓘ", color: COLORS.nile },
	pending: { glyph: (ascii ? ASCII_HIEROGLYPHS.loading : HIEROGLYPHS.loading)[0], color: COLORS.gray, spin: true },
	running: { glyph: (ascii ? ASCII_HIEROGLYPHS.loading : HIEROGLYPHS.loading)[0], color: COLORS.primary, spin: true },
	idle: { glyph: "○", color: COLORS.gray },
	killed: { glyph: "✕", color: COLORS.coral },
	cached: { glyph: ascii ? ASCII_DECORATIVE.scroll : DECORATIVE.scroll, color: COLORS.sand },
	readonly: { glyph: ascii ? ASCII_DECORATIVE.eye : DECORATIVE.eye, color: COLORS.nile },
	mutating: { glyph: "⚡", color: COLORS.coral },
	verified: { glyph: ascii ? ASCII_HIEROGLYPHS.success : HIEROGLYPHS.success, color: COLORS.green },
	speculative: { glyph: ascii ? ASCII_HIEROGLYPHS.error : HIEROGLYPHS.error, color: COLORS.primary },
	thinking: {
		glyph: (ascii ? ASCII_HIEROGLYPHS.thinking : HIEROGLYPHS.thinking)[0],
		color: COLORS.primary,
		spin: true,
	},
};

const DEFAULT_LABELS: Record<StatusKind, string> = {
	success: "Success",
	error: "Failed",
	warning: "Warning",
	info: "Info",
	pending: "Pending",
	running: "Running",
	idle: "Idle",
	killed: "Killed",
	cached: "Cached",
	readonly: "Read",
	mutating: "Mutate",
	verified: "Verified",
	speculative: "Speculative",
	thinking: "Thinking",
};


/**
 * StatusBadge — a single source of truth for status display across the TUI.
 *
 * Replaces ad-hoc emoji (`⏳`, `✅`, `❌`) and `ink-spinner` usages with
 * brand-consistent hieroglyphs and a uniform color palette. Optionally
 * animates a 150ms spinner for `running`/`pending`/`thinking` kinds.
 * Respects reduce motion preferences.
 */
export function StatusBadge({
	kind,
	label,
	compact = false,
	emphasize = false,
	reduceMotion = respectReducedMotion(),
}: StatusBadgeProps): React.ReactElement {
	const { glyph, color, spin } = ICONS[kind];
	const [frame, setFrame] = useState(0);

	// Hieroglyph spinner animation. We pick the right glyph set per kind
	// (loading vs. thinking) and update at 150ms, the same cadence as
	// `HieroglyphSpinner` and `ExpandableToolOutput`.
	useEffect(() => {
		if (!spin || reduceMotion) return;
		const frames =
			kind === "thinking"
				? (ascii ? ASCII_HIEROGLYPHS.thinking : HIEROGLYPHS.thinking)
				: (ascii ? ASCII_HIEROGLYPHS.loading : HIEROGLYPHS.loading);
		const id = setInterval(() => {
			setFrame((f: number) => (f + 1) % frames.length);
		}, 150);
		return () => clearInterval(id);
	}, [spin, kind, reduceMotion]);

		const animatedGlyph = spin && !reduceMotion
			? (kind === "thinking"
				? (ascii ? ASCII_HIEROGLYPHS.thinking : HIEROGLYPHS.thinking)
				: (ascii ? ASCII_HIEROGLYPHS.loading : HIEROGLYPHS.loading))[frame]
			: glyph;
	const text = label ?? DEFAULT_LABELS[kind];

	if (compact) {
		return (
			<Text color={color}>
				{animatedGlyph}
			</Text>
		);
	}

	if (emphasize) {
		return (
			<Text color={color} inverse>
				{` ${animatedGlyph} ${text} `}
			</Text>
		);
	}

	return (
		<Box flexDirection="row">
			<Text color={color}>{animatedGlyph}</Text>
			<Text color={color} dimColor={kind === "idle" || kind === "killed"}>
				{` ${text}`}
			</Text>
		</Box>
	);
}
