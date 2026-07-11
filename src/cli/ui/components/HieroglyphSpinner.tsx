import { Box, Text } from "ink";
// @ts-expect-error TS6133/TS6192: Unused variable
import React, { useEffect, useState } from "react";
import { BRANDING, HIEROGLYPHS } from "../../../branding/index.js";

export interface HieroglyphSpinnerProps {
	glyphs?: readonly string[];
	label?: string;
	color?: string;
	speedMs?: number;
}

export function HieroglyphSpinner({
	glyphs = HIEROGLYPHS.thinking,
	label,
	color = BRANDING.colors.gold,
	speedMs = 150,
}: HieroglyphSpinnerProps) {
	const [frame, setFrame] = useState(0);

	useEffect(() => {
		const interval = setInterval(() => {
			setFrame((f) => (f + 1) % glyphs.length);
		}, speedMs);
		return () => clearInterval(interval);
	}, [glyphs, speedMs]);

	const currentGlyph = glyphs[frame] ?? "𓆣";

	if (!label) {
		return <Text color={color}>{currentGlyph}</Text>;
	}

	return (
		<Box flexDirection="row" gap={1}>
			<Text color={color}>{currentGlyph}</Text>
			<Text color={color}>{label}</Text>
		</Box>
	);
}
