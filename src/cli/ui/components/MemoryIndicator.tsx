import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import React, { useEffect, useState } from "react";
import { agentEventBus } from "../../../agent/events.js";
import { BRANDING } from "../../../branding/index.js";

const PURPLE = BRANDING.colors?.purple || "#A855F7";

export function MemoryIndicator() {
	const [activeEvent, setActiveEvent] = useState<{
		type: string;
		message: string;
	} | null>(null);

	useEffect(() => {
		const handleMemoryEvent = (event: { type: string; message: string }) => {
			if (event.type === "idle" || event.type === "success") {
				setActiveEvent(event);
				setTimeout(() => {
					setActiveEvent((current) =>
						current?.message === event.message ? null : current,
					);
				}, 3000);
			} else {
				setActiveEvent(event);
			}
		};

		agentEventBus.on("memoryEvent", handleMemoryEvent);

		return () => {
			agentEventBus.off("memoryEvent", handleMemoryEvent);
		};
	}, []);

	if (!activeEvent) {
		return null;
	}

	return (
		<Box marginBottom={1} marginLeft={2}>
			<Text color={PURPLE}>
				{activeEvent.type === "start" || activeEvent.type === "learning" ? (
					<Spinner type="dots" />
				) : activeEvent.type === "success" ? (
					"✓"
				) : (
					"ℹ"
				)}{" "}
				{activeEvent.message}
			</Text>
		</Box>
	);
}
