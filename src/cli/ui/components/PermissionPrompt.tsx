import React from "react";
import { Box, Text, useInput } from "ink";
import { BRANDING } from "../../../branding/index.js";
import { type PermissionRequest, buildPromptMessage } from "../../../permissions/prompts.js";

const GOLD = BRANDING.colors?.primary || "#F5C518";
const SAND = BRANDING.colors?.sand || "#8B7355";

export function PermissionPrompt({
	request,
	isDangerous,
	onAnswer,
}: {
	request: PermissionRequest;
	isDangerous: boolean;
	onAnswer: (allowed: boolean) => void;
}): React.ReactNode {
	useInput((k, key) => {
		if (key.return) {
			onAnswer(!isDangerous);
		} else if (k.toLowerCase() === "y") {
			onAnswer(true);
		} else if (k.toLowerCase() === "n") {
			onAnswer(false);
		}
	});

	const messageLines = buildPromptMessage(request.toolName, request.args, isDangerous).split("\n");

	return React.createElement(
		Box,
		{ flexDirection: "column", marginY: 1 },
		messageLines.map((line, index) =>
			React.createElement(Text, { key: index }, line)
		),
		React.createElement(
			Box,
			{ marginTop: 1, flexDirection: "row" },
			React.createElement(Text, { color: GOLD }, "Allow execution? "),
			React.createElement(Text, { color: SAND }, isDangerous ? "(y/N)" : "(Y/n)"),
			React.createElement(Text, { dimColor: true }, "  Press Enter for default"),
		)
	);
}
