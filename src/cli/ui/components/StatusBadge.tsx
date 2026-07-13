// @ts-expect-error TS6133/TS6192: Unused variable
import { Box, Text } from "ink";
import type React from "react";
import { useEffect, useState } from "react";
import { BRANDING, HIEROGLYPHS } from "../../../branding/index.js";

const COLORS = {
	primary: BRANDING.colors?.primary || "#F5C518",
	green: BRANDING.colors?.green || "#22C55E",
	red: BRANDING.colors?.red || "#EF4444",
	sand: BRANDING.colors?.sand || "#8B7355",
	coral: BRANDING.colors?.coral || "#FF6B35",
	nile: BRANDING.colors?.nile || "#165DFF",
	gray: BRANDING.colors?.gray || "#9CA3AF",
} as const;

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
	 * Enable smooth transitions between states (default: true)
	 */
	animate?: boolean;
	/**
	 * Reduce motion for accessibility (default: false, respects env var)
	 */
	reduceMotion?: boolean;
}

const ICONS: Record<
	StatusKind,
	{ glyph: string; color: string; spin?: boolean }
> = {
	success: { glyph: HIEROGLYPHS.success, color: COLORS.green },
	error: { glyph: HIEROGLYPHS.error, color: COLORS.red },
	warning: { glyph: "𓁹", color: COLORS.primary }, // eye of Horus variant
	info: { glyph: "ⓘ", color: COLORS.nile },
	pending: { glyph: HIEROGLYPHS.loading[0], color: COLORS.gray, spin: true },
	running: { glyph: HIEROGLYPHS.loading[0], color: COLORS.primary, spin: true },
	idle: { glyph: "○", color: COLORS.gray },
	killed: { glyph: "✕", color: COLORS.coral },
	cached: { glyph: "𓏛", color: COLORS.sand },
	readonly: { glyph: "𓁹", color: COLORS.nile },
	mutating: { glyph: "⚡", color: COLORS.coral },
	verified: { glyph: HIEROGLYPHS.success, color: COLORS.green },
	speculative: { glyph: "𓂀", color: COLORS.primary },
	thinking: {
		glyph: HIEROGLYPHS.thinking[0],
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

// Accessibility role mapping for screen readers
const ARIA_ROLES: Record<StatusKind, string> = {
	success: "status",
	error: "alert",
	warning: "status",
	info: "status",
	pending: "status",
	running: "status",
	idle: "status",
	killed: "alert",
	cached: "status",
	readonly: "status",
	mutating: "status",
	verified: "status",
	speculative: "status",
	thinking: "status",
};

/**
 * StatusBadge — a single source of truth for status display across the TUI.
 *
 * Replaces ad-hoc emoji (`⏳`, `✅`, `❌`) and `ink-spinner` usages with
 * brand-consistent hieroglyphs and a uniform color palette. Optionally
 * animates a 150ms spinner for `running`/`pending`/`thinking` kinds.
 * 
 * Accessibility:
 * - ARIA roles for screen readers (alert for errors, status for others)
 * - Accessibility labels for non-visual consumption
 * - Respects reduce motion preferences
 */
export function StatusBadge({
	kind,
	label,
	compact = false,
	emphasize = false,
	animate = true,
	reduceMotion = process.env.TEHUTI_REDUCE_MOTION === "1",
}: StatusBadgeProps): React.ReactElement {
	const { glyph, color, spin } = ICONS[kind];
	const [frame, setFrame] = useState(0);

	// Hieroglyph spinner animation. We pick the right glyph set per kind
	// (loading vs. thinking) and update at 150ms, the same cadence as
	// `HieroglyphSpinner` and `ExpandableToolOutput`.
	useEffect(() => {
		if (!spin || reduceMotion) return;
		const frames =
			kind === "thinking" ? HIEROGLYPHS.thinking : HIEROGLYPHS.loading;
		const id = setInterval(() => {
			setFrame((f: number) => (f + 1) % frames.length);
		}, 150);
		return () => clearInterval(id);
	}, [spin, kind, reduceMotion]);

	const animatedGlyph = spin && !reduceMotion
		? (kind === "thinking" ? HIEROGLYPHS.thinking : HIEROGLYPHS.loading)[frame]
		: glyph;
	const text = label ?? DEFAULT_LABELS[kind];
	const ariaRole = ARIA_ROLES[kind];
	const ariaLabel = `${text} status`;

	if (compact) {
		return (
			<Text 
				color={color} 
				accessibilityLabel={ariaLabel}
				accessibilityRole={ariaRole}
			>
				{animatedGlyph}
			</Text>
		);
	}

	if (emphasize) {
		return (
			<Text 
				color={color} 
				inverse
				accessibilityLabel={ariaLabel}
				accessibilityRole={ariaRole}
			>
				{` ${animatedGlyph} ${text} `}
			</Text>
		);
	}

	return (
		<Box 
			flexDirection="row" 
			accessibilityLabel={ariaLabel}
			accessibilityRole={ariaRole}
		>
			<Text color={color}>{animatedGlyph}</Text>
			<Text color={color} dimColor={kind === "idle" || kind === "killed"}>
				{` ${text}`}
			</Text>
		</Box>
	);
}
