import React from "react";
import { Text } from "ink";
import Spinner from "ink-spinner";
import { BRANDING } from "../../../branding/index.js";

const GOLD = BRANDING.colors?.primary || "#F5C518";
const GREEN = BRANDING.colors?.green || "#22C55E";
const RED = BRANDING.colors?.red || "#EF4444";

export const StatusIndicator = ({
	status,
}: {
	status: "success" | "error" | "loading";
}) => {
	if (status === "success") {
		return React.createElement(Text, { color: GREEN }, "✅");
	}
	if (status === "error") {
		return React.createElement(Text, { color: RED }, "❌");
	}
	return React.createElement(
		Text,
		{ color: GOLD },
		React.createElement(Spinner, { type: "dots" }),
	);
};
