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
	sessionName?: string;
	hasUpdate?: boolean;
	onModelClick?: () => void;
	onConfigClick?: () => void;
	onCommandClick?: (cmd: string) => void;
	activeSkills?: number;
	advisorEnabled?: boolean;
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
	sessionName,
	hasUpdate = false,
	onModelClick,
	onConfigClick,
	onCommandClick,
	advisorEnabled = false,
	activeSkills,
}: TehutiHeaderProps) {
	const ascii = isAsciiMode();
	const {
		secondary: GOLD,
		sand: SAND,
		coral: CORAL,
		green: GREEN,
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
				marginBottom={1}
				borderStyle="round"
				borderColor={GOLD}
				paddingX={2}
			>
				<Text color={GOLD} bold>
					{ascii ? ASCII_DECORATIVE.ibis : DECORATIVE.ibis} TEHUTI{" "}
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
				<Box>
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
						<Box>
							<Text color={SAND}>{ascii ? ASCII_DECORATIVE.scroll : DECORATIVE.scroll} {sessionName}</Text>
						</Box>
					</>
				)}
				{activeSkills !== undefined && activeSkills > 0 && (
					<>
						<Text color={SAND} dimColor>
							{" "}
							│{" "}
						</Text>
						<Text color={SAND} dimColor>
							🎴 +{activeSkills}
						</Text>
					</>
				)}
				{advisorEnabled && (
					<>
						<Text color={SAND} dimColor>
							{" "}
							│{" "}
						</Text>
						<Text color="cyan" bold>
							👁 Advisor
						</Text>
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
			paddingX={2}
			paddingY={1}
		>
			<Gradient colors={[GOLD, CORAL]}>
				<BigText text="TEHUTI" font="chrome" space={false} />
			</Gradient>
			<Box flexDirection="column" alignItems="center" marginTop={1}>
				<Box>
					<Text color={GOLD}>{ascii ? ASCII_DECORATIVE.ibis : DECORATIVE.ibis} </Text>
					<Text color={SAND} bold>
						T H O T H, T O N G U E O F R A
					</Text>
					<Text color={GOLD}> {ascii ? ASCII_DECORATIVE.ibis : DECORATIVE.ibis}</Text>
				</Box>
				<Box>
					<Text color="gray" dimColor>
						{"─".repeat(38)}
					</Text>
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
				{version && (
					<Box marginTop={1}>
						<Text color="gray" dimColor>
							v{version}
						</Text>
					</Box>
				)}
				{model && (
					<Box marginTop={1}>
						<Text color={SAND}>
							{ascii ? ASCII_DECORATIVE.ibis : DECORATIVE.ibis} {model} — ready
						</Text>
					</Box>
				)}

				<Box marginTop={1} flexDirection="row" gap={2}>
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
				{activeSkills !== undefined && activeSkills > 0 && (
					<Box marginTop={1}>
						<Text color={SAND} dimColor>
							🎴 +{activeSkills}
						</Text>
					</Box>
				)}
				{advisorEnabled && (
					<Box marginTop={1}>
						<Text color="cyan" bold>
							👁 Advisor
						</Text>
					</Box>
				)}
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
						label="/clear"
						onClick={() => onCommandClick?.("/clear")}
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
			</Box>
		</Box>
	);
});
