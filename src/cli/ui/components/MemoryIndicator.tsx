import { Box, Text } from "ink";
import { useEffect, useRef, useState } from "react";
import { agentEventBus } from "../../../agent/events.js";
import { BRANDING, DECORATIVE, isAsciiMode, ASCII_DECORATIVE } from "../../../branding/index.js";

const PURPLE = BRANDING.colors.purple;
const GREEN = BRANDING.colors.green;


export interface MemoryEvent {
	type: string;
	message: string;
}

export interface MemoryIndicatorProps {
	/** Duration (ms) to keep "success" events visible before fading (default 3000) */
	successDuration?: number;
	/** Number of animation frames for transition (default 3) */
	transitionFrames?: number;
}

export function MemoryIndicator({
	successDuration = 3000,
}: MemoryIndicatorProps) {
	const ascii = isAsciiMode();
	const [activeEvent, setActiveEvent] = useState<MemoryEvent | null>(null);
	const [, setOpacity] = useState<0 | 1>(0);
	const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		const handleMemoryEvent = (event: MemoryEvent) => {
			// Clear any pending fade
			if (fadeTimerRef.current) {
				clearTimeout(fadeTimerRef.current);
				fadeTimerRef.current = null;
			}

			if (event.type === "idle" || event.type === "success") {
				setActiveEvent(event);
				// Show instantly (or single-frame transition for reduce motion)
				setOpacity(1);
				fadeTimerRef.current = setTimeout(() => {
					setActiveEvent((current) =>
						current?.message === event.message ? null : current,
					);
					setOpacity(0);
				}, successDuration);
			} else {
				setActiveEvent(event);
				setOpacity(1);
			}
		};

		agentEventBus.on("memoryEvent", handleMemoryEvent);

		return () => {
			agentEventBus.off("memoryEvent", handleMemoryEvent);
			if (fadeTimerRef.current) {
				clearTimeout(fadeTimerRef.current);
			}
		};
	}, [successDuration]);

	if (!activeEvent) {
		return null;
	}

	const isError = activeEvent.type === "error";
	const isSuccess = activeEvent.type === "success" || activeEvent.type === "idle";
	const isLearning = activeEvent.type === "learning" || activeEvent.type === "start";

	const icon = isError
		? (ascii ? ASCII_DECORATIVE.eye : DECORATIVE.eye)
		: isSuccess
			? (ascii ? ASCII_DECORATIVE.ankh : DECORATIVE.ankh)
			: isLearning
				? (ascii ? ASCII_DECORATIVE.scroll : DECORATIVE.scroll)
				: (ascii ? ASCII_DECORATIVE.eyeOfHorus : DECORATIVE.eyeOfHorus);

	const color = isError ? BRANDING.colors.red : isSuccess ? GREEN : PURPLE;

	return (
		<Box marginBottom={1} marginLeft={2}>
			<Text color={color}>
				{icon}{" "}
				{activeEvent.message}
			</Text>
		</Box>
	);
}
