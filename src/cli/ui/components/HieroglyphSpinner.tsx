import { Box, Text } from "ink";
// @ts-expect-error TS6133/TS6192: Unused variable
import React, { useEffect, useState } from "react";
import { BRANDING, DECORATIVE, HIEROGLYPHS, isAsciiMode, ASCII_DECORATIVE, ASCII_HIEROGLYPHS } from "../../../branding/index.js";

const ascii = isAsciiMode();
export interface HieroglyphSpinnerProps {

	glyphs?: readonly string[];
	label?: string;
	color?: string;
	speedMs?: number;
}

export function HieroglyphSpinner({
	glyphs = ascii ? ASCII_HIEROGLYPHS.thinking : HIEROGLYPHS.thinking,
	label,
	color = BRANDING.colors.gold,
	speedMs = 150,
}: HieroglyphSpinnerProps) {
	const reduceMotion = process.env.TEHUTI_REDUCE_MOTION === "1";
	const [frame, setFrame] = useState(0);

	useEffect(() => {
		if (reduceMotion) return;
		const interval = setInterval(() => {
			setFrame((f) => (f + 1) % glyphs.length);
		}, speedMs);
		return () => clearInterval(interval);
	}, [glyphs, speedMs, reduceMotion]);

	const currentGlyph = glyphs[frame] ?? (ascii ? ASCII_DECORATIVE.ibis : DECORATIVE.ibis);

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
