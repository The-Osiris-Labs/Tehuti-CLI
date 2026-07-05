import {
	useOnClick,
	useOnMouseEnter,
	useOnMouseLeave,
} from "@ink-tools/ink-mouse";
import { Box, Text } from "ink";
import BigText from "ink-big-text";
import Gradient from "ink-gradient";
import { useRef, useState } from "react";
import { BRANDING } from "../../../branding/index.js";

export interface TehutiHeaderProps {
	compact?: boolean;
	model?: string;
	provider?: string;
	onModelClick?: () => void;
	onConfigClick?: () => void;
	onCommandClick?: (cmd: string) => void;
}

function ClickableBadge({
	label,
	onClick,
	color = "gray",
	hoverColor = "white",
}: {
	label: string;
	onClick?: () => void;
	color?: string;
	hoverColor?: string;
}) {
	const ref = useRef<any>(null);
	const [isHovered, setIsHovered] = useState(false);

	useOnClick(ref, () => {
		if (onClick) onClick();
	});

	useOnMouseEnter(ref, () => setIsHovered(true));
	useOnMouseLeave(ref, () => setIsHovered(false));

	return (
		<Box ref={ref}>
			<Text color={isHovered ? hoverColor : color}>{label}</Text>
		</Box>
	);
}

export function TehutiHeader({
	compact = false,
	model,
	provider,
	onModelClick,
	onConfigClick,
	onCommandClick,
}: TehutiHeaderProps) {
	const { secondary: GOLD, sand: SAND, coral: CORAL } = BRANDING.colors;

	if (compact) {
		return (
			<Box
				flexDirection="row"
				alignItems="center"
				marginBottom={1}
				borderStyle="round"
				borderColor={GOLD}
				paddingX={2}
			>
				<Text color={GOLD} bold>
					𓆣 TEHUTI{" "}
				</Text>
				<Text color={SAND} dimColor>
					{" "}
					│{" "}
				</Text>
				<ClickableBadge
					label={`Model: ${model || "Unknown"}`}
					onClick={onModelClick}
					color={SAND}
					hoverColor={GOLD}
				/>
				<Text color={SAND} dimColor>
					{" "}
					│{" "}
				</Text>
				<ClickableBadge
					label={`API: ${provider || "Unknown"}`}
					onClick={onConfigClick}
					color={SAND}
					hoverColor={GOLD}
				/>
				<Text color={SAND} dimColor>
					{" "}
					│{" "}
				</Text>
				<Text color={CORAL}>𓁹 Write • Edit</Text>
			</Box>
		);
	}

	return (
		<Box
			flexDirection="column"
			alignItems="center"
			marginBottom={1}
			borderStyle="round"
			borderColor={GOLD}
			paddingX={4}
			paddingY={1}
		>
			<Gradient colors={[GOLD, CORAL]}>
				<BigText text="TEHUTI" font="chrome" space={false} />
			</Gradient>
			<Box flexDirection="column" alignItems="center" marginTop={1}>
				<Box>
					<Text color={GOLD}>𓆣 </Text>
					<Text color={SAND} bold>
						T H O T H, T O N G U E O F R A
					</Text>
					<Text color={GOLD}> 𓆣</Text>
				</Box>

				<Box marginTop={1} flexDirection="row" gap={2}>
					<ClickableBadge
						label={`Model: ${model || "Unknown"}`}
						onClick={onModelClick}
						color={SAND}
						hoverColor={GOLD}
					/>
					<Text color={SAND} dimColor>
						•
					</Text>
					<ClickableBadge
						label={`API: ${provider || "Unknown"}`}
						onClick={onConfigClick}
						color={SAND}
						hoverColor={GOLD}
					/>
				</Box>

				<Box marginTop={1}>
					<Text color={CORAL} bold>
						𓁹 Write • Edit • Transform
					</Text>
				</Box>
				<Box marginTop={1} flexDirection="row" gap={1}>
					<ClickableBadge
						label="/help"
						onClick={() => onCommandClick?.("/help")}
						color="gray"
						hoverColor="white"
					/>
					<Text color="gray">•</Text>
					<ClickableBadge
						label="/clear"
						onClick={() => onCommandClick?.("/clear")}
						color="gray"
						hoverColor="white"
					/>
					<Text color="gray">•</Text>
					<ClickableBadge
						label="/exit"
						onClick={() => onCommandClick?.("/exit")}
						color="gray"
						hoverColor="white"
					/>
				</Box>
			</Box>
		</Box>
	);
}
