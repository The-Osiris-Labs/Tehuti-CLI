import { Box, Text } from "ink";
import React, { useEffect, useState } from "react";
import { BRANDING } from "../../../branding/index.js";

const COLORS = {
	primary: BRANDING.colors?.primary || "#F5C518",
	sand: BRANDING.colors?.sand || "#8B7355",
	green: BRANDING.colors?.green || "#22C55E",
	coral: BRANDING.colors?.coral || "#FF6B35",
	gray: BRANDING.colors?.gray || "#9CA3AF",
} as const;

export interface ProgressBarProps {
	/**
	 * 0..100. Values outside this range are clamped. When `null` or `NaN`
	 * the bar runs in `indeterminate` mode (a moving 25%-wide segment).
	 */
	value: number | null | undefined;
	/** Optional header label rendered above the bar. */
	label?: string;
	/** Bar width in visible columns. Defaults to 40. */
	width?: number;
	/** When true, a percent readout is shown on the right of the label. */
	showPercent?: boolean;
	/**
	 * Optional phase: shifts the bar color to convey state. `error` paints
	 * the filled portion coral, `success` green, `running` uses the
	 * default gold.
	 */
	phase?: "running" | "success" | "error" | "warning";
}

/**
 * ProgressBar — visual density fixed.
 *
 * The original used mixed `━` and `─` characters which have different
 * visible widths in many fonts, producing lopsided bars. We now use a
 * single block character (`█` for filled, `░` for empty) at the same
 * column, which guarantees pixel-precise alignment.
 *
 * Adds:
 *   - Indeterminate mode (animated segment) for loading states.
 *   - Phase coloring (success/error/warning).
 *   - Optional label + percent display above the bar.
 *   - Smooth numeric clamping.
 */
export const ProgressBar = ({
	value,
	label,
	width = 40,
	showPercent = true,
	phase = "running",
}: ProgressBarProps): React.ReactElement => {
	const safeWidth = Math.max(8, Math.min(200, Math.round(width)));

	// Indeterminate mode
	const indeterminate =
		value === null ||
		value === undefined ||
		(Number.isNaN(value) as boolean) ||
		(phase === "running" && false); // explicit opt-in
	const active = value !== null && value !== undefined && !Number.isNaN(value);

	const clamped = active ? Math.max(0, Math.min(100, value as number)) : 0;
	const filledWidth = Math.round((clamped / 100) * safeWidth);
	const emptyWidth = safeWidth - filledWidth;

	const filledChar = "█";
	const emptyChar = "░";

	const phaseColor =
		phase === "success"
			? COLORS.green
			: phase === "error"
				? COLORS.coral
				: phase === "warning"
					? COLORS.primary
					: COLORS.primary;

	// Indeterminate animation (smooth ping-pong oscillation)
	const segWidth = Math.max(3, Math.round(safeWidth * 0.25));
	const maxStep = Math.max(1, safeWidth - segWidth);
	const totalCycle = maxStep * 2;
	const [frame, setFrame] = useState(0);

	useEffect(() => {
		if (!indeterminate) return;
		const id = setInterval(() => setFrame((f) => (f + 1) % totalCycle), 60);
		return () => clearInterval(id);
	}, [indeterminate, totalCycle]);

	function renderIndeterminate(): React.ReactNode {
		const pos = frame % totalCycle;
		const start = pos <= maxStep ? pos : totalCycle - pos;
		const end = Math.min(safeWidth, start + segWidth);
		const head = emptyChar.repeat(start);
		const body = filledChar.repeat(end - start);
		const tail = emptyChar.repeat(Math.max(0, safeWidth - end));
		return React.createElement(
			Box,
			{ flexDirection: "row" },
			React.createElement(Text, { color: COLORS.gray }, head),
			React.createElement(Text, { color: phaseColor, bold: true }, body),
			React.createElement(Text, { color: COLORS.gray }, tail),
		);
	}

	function renderDeterminate(): React.ReactNode {
		return React.createElement(
			Box,
			{ flexDirection: "row" },
			React.createElement(
				Text,
				{ color: phaseColor, bold: phase !== "error" },
				filledChar.repeat(filledWidth),
			),
			React.createElement(
				Text,
				{ color: COLORS.gray, dimColor: true },
				emptyChar.repeat(emptyWidth),
			),
		);
	}

	const percentText = active ? `${Math.round(clamped)}%` : "…";

	return React.createElement(
		Box,
		{ flexDirection: "column", marginY: 0.5 },
		(label || showPercent) &&
			React.createElement(
				Box,
				{
					flexDirection: "row",
					justifyContent: "space-between",
					marginBottom: 0.25,
				},
				label
					? React.createElement(
							Text,
							{ color: COLORS.sand, dimColor: true },
							label,
						)
					: React.createElement(Text, null, ""),
				showPercent &&
					React.createElement(
						Text,
						{ color: phaseColor, bold: true },
						percentText,
					),
			),
		indeterminate ? renderIndeterminate() : renderDeterminate(),
	);
};
