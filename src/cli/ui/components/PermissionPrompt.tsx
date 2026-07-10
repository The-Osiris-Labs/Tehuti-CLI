import { Box, Text, useInput } from "ink";
import React from "react";
import { BRANDING, HIEROGLYPHS } from "../../../branding/index.js";
import {
	buildPromptMessage,
	type PermissionRequest,
} from "../../../permissions/prompts.js";

const COLORS = {
	gold: BRANDING.colors?.primary || "#F5C518",
	coral: BRANDING.colors?.coral || "#FF6B35",
	sand: BRANDING.colors?.sand || "#8B7355",
	gray: BRANDING.colors?.gray || "#9CA3AF",
	green: BRANDING.colors?.green || "#22C55E",
	red: BRANDING.colors?.red || "#EF4444",
} as const;

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
		// For dangerous prompts the default is "no" so a stray Enter
		// does not approve a destructive operation.
		if (key.return) {
			onAnswer(!isDangerous);
		} else if (k.toLowerCase() === "y") {
			onAnswer(true);
		} else if (k.toLowerCase() === "n") {
			onAnswer(false);
		}
	});

	const messageLines = buildPromptMessage(
		request.toolName,
		request.args,
		isDangerous,
	).split("\n");

	const accent = isDangerous ? COLORS.coral : COLORS.gold;
	const accentText = isDangerous ? HIEROGLYPHS.error : HIEROGLYPHS.tool;
	const verb = isDangerous ? "BLOCK" : "ALLOW";
	const noun = isDangerous ? "DANGEROUS" : "PERMISSION";

	return React.createElement(
		Box,
		{
			flexDirection: "column",
			marginY: 1,
			paddingX: 1,
			borderStyle: "round",
			borderColor: accent,
		},
		// Header
		React.createElement(
			Box,
			{ gap: 1, marginBottom: 1 },
			React.createElement(Text, { color: accent, bold: true }, accentText),
			React.createElement(
				Text,
				{ color: accent, bold: true },
				`${noun} REQUIRED`,
			),
		),
		// Body
		...messageLines.map((line, index) =>
			React.createElement(Text, { key: index }, line),
		),
		// Footer / prompt
		React.createElement(
			Box,
			{ marginTop: 1, flexDirection: "column" },
			React.createElement(
				Box,
				{ gap: 1 },
				React.createElement(
					Text,
					{ color: accent, bold: true },
					`${verb} execution?`,
				),
				React.createElement(
					Text,
					{ color: COLORS.sand },
					isDangerous ? "[y/N]" : "[Y/n]",
				),
			),
			React.createElement(
				Box,
				{ marginTop: 0.5 },
				React.createElement(
					Text,
					{ dimColor: true, color: COLORS.gray },
					`Press Enter for ${isDangerous ? "deny (safer)" : "approve (default)"} • y to ${isDangerous ? "override-allow" : "approve"} • n to ${isDangerous ? "deny" : "reject"}`,
				),
			),
		),
	);
}
