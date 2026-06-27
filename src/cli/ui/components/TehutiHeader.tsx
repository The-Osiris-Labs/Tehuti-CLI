import React from "react";
import { Box, Text } from "ink";
import Gradient from "ink-gradient";
import BigText from "ink-big-text";
import { HIEROGLYPHS } from "../../../branding/index.js";

export function TehutiHeader() {
	return (
		<Box flexDirection="column" alignItems="center" marginBottom={1}>
			<Gradient colors={["#D4AF37", "#D97757"]}>
				<BigText text="TEHUTI" font="chrome" space={false} />
			</Gradient>
			<Box flexDirection="column" alignItems="center">
				<Box>
					<Text color="#D4AF37">{HIEROGLYPHS.IBIS} </Text>
					<Text color="#8B7355" dimColor>T H O T H, T O N G U E O F R A</Text>
					<Text color="#D4AF37"> {HIEROGLYPHS.IBIS}</Text>
				</Box>
				<Text color="#8B7355" dimColor>Halls of Records • Balance of Ma'at • Architect</Text>
				<Text color="#8B7355" dimColor>𓁹 Write • Edit • Transform</Text>
			</Box>
		</Box>
	);
}
