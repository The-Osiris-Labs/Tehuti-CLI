import {
	useOnClick,
	useOnMouseEnter,
	useOnMouseLeave,
} from "@ink-tools/ink-mouse";
import { Box, Text } from "ink";
import BigText from "ink-big-text";
import Gradient from "ink-gradient";
import { memo, useRef, useState } from "react";
import { BRANDING } from "../../../branding/index.js";

export interface TehutiHeaderProps {
	compact?: boolean;
	model?: string;
	provider?: string;
	daemonStatus?: "connected" | "disconnected" | "none";
	companionMode?: boolean;
	isStreaming?: boolean;
	sessionName?: string;
	hasUpdate?: boolean;
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
		<Box 
			ref={ref}
			accessibilityRole="button"
			accessibilityLabel={label}
		>
			<Text color={isHovered ? hoverColor : color}>{label}</Text>
		</Box>
	);
}

export const TehutiHeader = memo(function TehutiHeader({
	compact = false,
	model,
	provider,
	daemonStatus = "none",
	companionMode = false,
	isStreaming = false,
	sessionName,
	hasUpdate = false,
	onModelClick,
	onConfigClick,
	onCommandClick,
}: TehutiHeaderProps) {
	const {
		secondary: GOLD,
		sand: SAND,
		coral: CORAL,
		green: GREEN,
	} = BRANDING.colors;

	const statusLabel = isStreaming
		? "𓆗 Thinking..."
		: companionMode
			? "𓅞 Companion"
			: daemonStatus === "connected"
				? "𓋹 Daemon Connected"
				: "𓁹 Idle";

	const statusColor = isStreaming
		? GOLD
		: companionMode || daemonStatus === "connected"
			? GREEN
			: CORAL;

	// Accessibility: build descriptive status label
	const statusDescription = isStreaming
		? "Currently thinking"
		: companionMode
			? "Companion mode active"
			: daemonStatus === "connected"
				? "Daemon connected"
				: "Idle";

	if (compact) {
		return (
			<Box
				flexDirection="row"
				alignItems="center"
				marginBottom={1}
				borderStyle="round"
				borderColor={GOLD}
				paddingX={2}
				accessibilityRole="banner"
			>
				<Text color={GOLD} bold>
					𓆣 TEHUTI{" "}
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
				<Box accessibilityRole="status" accessibilityLabel={statusDescription}>
					<Text color={statusColor} bold>
						{statusLabel}
					</Text>
				</Box>
				{sessionName && (
					<>
						<Text color={SAND} dimColor>
							{" "}
							│{" "}
						</Text>
						<Box accessibilityLabel={`Session: ${sessionName}`}>
							<Text color={SAND}>𓏛 {sessionName}</Text>
						</Box>
					</>
				)}
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
			accessibilityRole="banner"
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
					{hasUpdate && (
						<Box marginLeft={1}>
							<ClickableBadge
								label="[UPDATE]"
								onClick={() => onCommandClick?.("update")}
								color={BRANDING.colors.nile}
								hoverColor={BRANDING.colors.gold}
							/>
						</Box>
					)}
				</Box>

				<Box 
					marginTop={1} 
					flexDirection="row" 
					gap={2}
					accessibilityRole="status"
					accessibilityLabel={statusDescription}
				>
					<Text color={statusColor} bold>
						{statusLabel}
					</Text>
					<Text color={SAND} dimColor>
						•
					</Text>
					<Text color={CORAL} bold>
						Write • Edit • Transform
					</Text>
				</Box>
				<Box 
					marginTop={1} 
					flexDirection="row" 
					gap={1}
				>
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
});
