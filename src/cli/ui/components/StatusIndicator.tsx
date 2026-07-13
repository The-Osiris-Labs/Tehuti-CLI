// @ts-expect-error TS6133/TS6192: Unused variable
import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { StatusBadge } from "./StatusBadge.js";

export interface StatusIndicatorProps {
	status: "success" | "error" | "loading";
	label?: string;
	/** Enable fade-in animation (default: true) */
	animate?: boolean;
}

export const StatusIndicator = ({
	status,
	label,
	animate = true,
}: StatusIndicatorProps) => {
	const [visible, setVisible] = useState(!animate);

	useEffect(() => {
		if (animate) {
			// Small delay for fade-in effect
			const timer = setTimeout(() => setVisible(true), 50);
			return () => clearTimeout(timer);
		}
	}, [animate]);

	const badgeKind = status === "loading" ? "running" : status;

	return (
		<Box
			flexDirection="row"
			alignItems="center"
			gap={1}
			accessibilityLabel={`Status: ${status}${label ? ` - ${label}` : ""}`}
			accessibilityRole="status"
		>
			<StatusBadge compact kind={badgeKind} />
			{label && (
				<Text
					dimColor={status === "loading"}
					color={
						status === "success"
							? "green"
							: status === "error"
								? "red"
								: "yellow"
					}
				>
					{label}
				</Text>
			)}
		</Box>
	);
};
