import { Box, Text } from "ink";
import React from "react";
import { BRANDING } from "../../../branding/index.js";

const GOLD = BRANDING.colors?.primary || "#F5C518";
const SAND = BRANDING.colors?.sand || "#8B7355";

export const ProgressBar = ({
	value,
	label,
	width = 40,
}: {
	value: number;
	label?: string;
	width?: number;
}): React.ReactElement => {
	const filledWidth = Math.round((value / 100) * width);
	const filled = "━".repeat(filledWidth);
	const empty = "─".repeat(width - filledWidth);

	return React.createElement(
		Box,
		{ flexDirection: "column", marginY: 0.5 },
		label &&
			React.createElement(
				Box,
				{
					flexDirection: "row",
					justifyContent: "space-between",
					marginBottom: 0.25,
				},
				React.createElement(Text, { color: SAND, dimColor: true }, label),
				React.createElement(Text, { color: GOLD }, `${Math.round(value)}%`),
			),
		React.createElement(
			Box,
			{ flexDirection: "row" },
			React.createElement(Text, { color: GOLD }, filled),
			React.createElement(Text, { dimColor: true }, empty),
		),
	);
};
