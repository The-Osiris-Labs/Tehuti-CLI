import {
	useOnClick,
	useOnMouseEnter,
	useOnMouseLeave,
} from "@ink-tools/ink-mouse";
import { Box, Text } from "ink";
import BigText from "ink-big-text";
import Gradient from "ink-gradient";
import { memo, useRef, useState } from "react";
import { BRANDING, DECORATIVE, HIEROGLYPHS, isAsciiMode, ASCII_DECORATIVE, ASCII_HIEROGLYPHS } from "../../../branding/index.js";

export interface TehutiHeaderProps {
	compact?: boolean;
	model?: string;
	provider?: string;
	version?: string;
	daemonStatus?: "connected" | "disconnected" | "none";
	companionMode?: boolean;
	isStreaming?: boolean;
	hasUpdate?: boolean;
	onModelClick?: () => void;
	onConfigClick?: () => void;
	onCommandClick?: (cmd: string) => void;
	activeSkills?: number;
	advisorEnabled?: boolean;
	contextUsage?: number;
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

export const TehutiHeader = memo(function TehutiHeader({
	compact = false,
	model,
	provider,
	version,
	daemonStatus = "none",
	companionMode = false,
	isStreaming = false,
	hasUpdate = false,
	onModelClick,
	onConfigClick,
	onCommandClick,
	activeSkills,
	contextUsage,
	advisorEnabled,
}: TehutiHeaderProps) {
	const ascii = isAsciiMode();
	const {
		secondary: GOLD,
		sand: SAND,
		coral: CORAL,
		green: GREEN,
		gray: GRAY,
	} = BRANDING.colors;

	const statusLabel = isStreaming
		? `${ascii ? ASCII_HIEROGLYPHS.loading[0] : HIEROGLYPHS.loading[0]} Thinking...`
		: companionMode
			? `${ascii ? ASCII_DECORATIVE.ibisBird : DECORATIVE.ibisBird} Companion`
			: daemonStatus === "connected"
				? `${ascii ? ASCII_DECORATIVE.ankh : DECORATIVE.ankh} Daemon Connected`
				: `${ascii ? ASCII_DECORATIVE.eye : DECORATIVE.eye} Idle`;

	const statusColor = isStreaming
		? GOLD
		: companionMode || daemonStatus === "connected"
			? GREEN
			: CORAL;

	if (compact) {
		return (
			<Box
				flexDirection="row"
				alignItems="center"
				marginBottom={0.5}
				paddingX={0}
			>
				<Text color={GOLD} bold>
					{ascii ? ASCII_DECORATIVE.ibis : DECORATIVE.ibis}
				</Text>
				<ClickableBadge
					label={model || "Unknown"}
					onClick={onModelClick}
					color={SAND}
					hoverColor={GOLD}
				/>
				<Box flexGrow={1} />
				{contextUsage !== undefined && (
					<Text color={GRAY} dimColor>
						{contextUsage}% ctx
					</Text>
				)}
			</Box>
		);
	}

	return (
		<Box
			flexDirection="column"
			alignItems="center"
			marginBottom={0.5}
			borderStyle="round"
			borderColor={GOLD}
			paddingX={2}
			paddingY={1}
		>
			{/* Gradient logo splash */}
			<Box flexDirection="column" alignItems="center">
				<Gradient colors={[GOLD, CORAL]}>
					<BigText text="TEHUTI" font="chrome" space={false} />
				</Gradient>
				<Box marginTop={1} flexDirection="row" alignItems="center">
					<Text color={GOLD}>{ascii ? ASCII_DECORATIVE.ibis : DECORATIVE.ibis}</Text>
					<Text color={SAND} bold>
						{" "}Scribe of Code Transformations{" "}
					</Text>
					<Text color="gray" dimColor>
						v{version || "?"}
					</Text>
					<Text color={GOLD}> {ascii ? ASCII_DECORATIVE.ibis : DECORATIVE.ibis}</Text>
				</Box>
			</Box>

			{/* Separator */}
			<Box marginTop={1}>
				<Text color="gray" dimColor>
					{"─".repeat(38)}
				</Text>
			</Box>

			{/* Model / Provider row */}
			<Box marginTop={1} flexDirection="row" gap={1}>
				<ClickableBadge
					label={`Model: ${model || "Unknown"}`}
					onClick={onModelClick}
					color={SAND}
					hoverColor={CORAL}
				/>
				<Text color="gray" dimColor>
					{" "}│{" "}
				</Text>
				<ClickableBadge
					label={`Provider: ${provider || "Unknown"}`}
					onClick={onConfigClick}
					color={SAND}
					hoverColor={CORAL}
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

			{/* Quick commands */}
			<Box
				marginTop={1}
				flexDirection="row"
				borderStyle="round"
				borderColor={SAND}
				paddingX={2}
				gap={1}
			>
				<ClickableBadge
					label="/help"
					onClick={() => onCommandClick?.("/help")}
					color={SAND}
					hoverColor={GOLD}
				/>
				<Text color={SAND} dimColor>•</Text>
				<ClickableBadge
					label="Ctrl+P palette"
					onClick={() => onCommandClick?.("palette")}
					color={SAND}
					hoverColor={GOLD}
				/>
				<Text color={SAND} dimColor>•</Text>
				<ClickableBadge
					label="/exit"
					onClick={() => onCommandClick?.("/exit")}
					color={SAND}
					hoverColor={GOLD}
				/>
			</Box>

			{/* Status & badges */}
			<Box marginTop={1} flexDirection="row" gap={1}>
				<Text color={statusColor} bold>
					{statusLabel}
				</Text>
				{(activeSkills !== undefined && activeSkills > 0) || advisorEnabled ? (
					<Text color="gray" dimColor> • </Text>
				) : null}
				{activeSkills !== undefined && activeSkills > 0 && (
					<Text color={SAND} dimColor>
						🎴 +{activeSkills}
					</Text>
				)}
				{advisorEnabled && (
					<Text color="cyan" bold>
						👁 Advisor
					</Text>
				)}
			</Box>
		</Box>
	);
});
