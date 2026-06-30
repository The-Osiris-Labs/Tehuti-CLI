import React from "react";
import { Box, Text } from "ink";
import Gradient from "ink-gradient";
import BigText from "ink-big-text";
import { BRANDING, HIEROGLYPHS } from "../../../branding/index.js";

export interface TehutiHeaderProps {
	compact?: boolean;
}

export function TehutiHeader({ compact = false }: TehutiHeaderProps) {
	const { secondary: GOLD, sand: SAND, coral: CORAL } = BRANDING.colors;

	if (compact) {
		return (
			<Box flexDirection="row" alignItems="center" marginBottom={1} borderStyle="round" borderColor={GOLD} paddingX={2}>
				<Text color={GOLD} bold>𓆣 TEHUTI </Text>
				<Text color={SAND} dimColor> │ Scribe of Code Transformations │ </Text>
				<Text color={CORAL}>𓁹 Write • Edit • Transform</Text>
			</Box>
		);
	}

	return (
		<Box flexDirection="column" alignItems="center" marginBottom={1}>
			<Gradient colors={[GOLD, CORAL]}>
				<BigText text="TEHUTI" font="chrome" space={false} />
			</Gradient>
			<Box flexDirection="column" alignItems="center">
				<Box>
					<Text color={GOLD}>𓆣 </Text>
					<Text color={SAND} dimColor>T H O T H, T O N G U E O F R A</Text>
					<Text color={GOLD}> 𓆣</Text>
				</Box>
				<Text color={SAND} dimColor>Halls of Records • Balance of Ma'at • Architect</Text>
				<Text color={SAND} dimColor>𓁹 Write • Edit • Transform</Text>
			</Box>
		</Box>
	);
}
