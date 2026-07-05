import { Box, Text, useInput, useStdout } from "ink";
import React, { useState } from "react";
import type { QuestionData } from "../../../agent/tools/system.js";
import { BRANDING } from "../../../branding/index.js";
import { isMouseSequence } from "../../../utils/mouse.js";

const GOLD = BRANDING.colors?.primary || "#F5C518";
const GRAY = BRANDING.colors?.gray || "#9CA3AF";
const CORAL = BRANDING.colors?.accent || "#FF6B35";

export function QuestionPrompt({
	question,
	onAnswer,
	onCancel,
}: {
	question: QuestionData;
	onAnswer: (answer: string | string[]) => void;
	onCancel: () => void;
}): React.ReactNode {
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [customMode, setCustomMode] = useState(false);
	const [customInput, setCustomInput] = useState("");
	const [selectedMultiple, setSelectedMultiple] = useState<Set<number>>(
		new Set(),
	);
	const { stdout } = useStdout();

	useInput((k, key) => {
		if (isMouseSequence(k)) {
			return;
		}
		if (customMode) {
			if (key.return) {
				onAnswer(customInput);
				return;
			}
			if (key.escape) {
				setCustomMode(false);
				setCustomInput("");
				return;
			}
			if (key.backspace || key.delete || k === "\x7f" || k === "\b") {
				setCustomInput((prev) => prev.slice(0, -1));
				return;
			}
			if (k && k.length === 1 && !key.ctrl && !key.meta) {
				setCustomInput((prev) => prev + k);
			}
			return;
		}

		if (key.upArrow) {
			const maxIdx = question.options.length;
			setSelectedIndex((prev) => (prev - 1 + maxIdx + 1) % (maxIdx + 1));
			return;
		}

		if (key.downArrow) {
			const maxIdx = question.options.length;
			setSelectedIndex((prev) => (prev + 1) % (maxIdx + 1));
			return;
		}

		if (key.return) {
			if (selectedIndex === question.options.length) {
				setCustomMode(true);
				return;
			}

			if (question.multiple) {
				const answers = Array.from(selectedMultiple).map(
					(i) => question.options[i].label,
				);
				if (answers.length === 0) {
					const current = selectedIndex;
					if (!selectedMultiple.has(current)) {
						onAnswer([question.options[current].label]);
					} else {
						onAnswer(answers);
					}
				} else {
					onAnswer(answers);
				}
			} else {
				onAnswer(question.options[selectedIndex].label);
			}
			return;
		}

		if (key.escape) {
			onCancel();
			return;
		}

		if (
			question.multiple &&
			k === " " &&
			selectedIndex < question.options.length
		) {
			setSelectedMultiple((prev) => {
				const next = new Set(prev);
				if (next.has(selectedIndex)) {
					next.delete(selectedIndex);
				} else {
					next.add(selectedIndex);
				}
				return next;
			});
		}
	});

	if (customMode) {
		return React.createElement(
			Box,
			{
				flexDirection: "column",
				paddingX: 1,
				borderStyle: "round",
				borderColor: GOLD,
			},
			React.createElement(Text, { bold: true, color: GOLD }, question.header),
			React.createElement(Text, { color: GRAY }, "Type your answer:"),
			React.createElement(Text, { color: CORAL }, `> ${customInput}\u2588`),
			React.createElement(
				Text,
				{ dimColor: true },
				"Enter to confirm | Esc to cancel",
			),
		);
	}

	return React.createElement(
		Box,
		{
			flexDirection: "column",
			paddingX: 1,
			borderStyle: "round",
			borderColor: GOLD,
		},
		React.createElement(Text, { bold: true, color: GOLD }, question.header),
		React.createElement(Text, null, question.question),
		React.createElement(Text, null, ""),
		...question.options.map((opt, idx) =>
			React.createElement(
				Box,
				{ key: idx },
				React.createElement(
					Text,
					{
						color: selectedIndex === idx ? CORAL : GRAY,
						bold: selectedIndex === idx,
					},
					question.multiple
						? `${selectedMultiple.has(idx) ? "[x]" : "[ ]"} ${selectedIndex === idx ? "> " : "  "}${opt.label}`
						: `${selectedIndex === idx ? "> " : "  "}${opt.label}`,
				),
				opt.description &&
					React.createElement(
						Text,
						{ dimColor: true, color: GRAY },
						` - ${opt.description}`,
					),
			),
		),
		React.createElement(
			Box,
			{ key: "custom" },
			React.createElement(
				Text,
				{
					color: selectedIndex === question.options.length ? CORAL : GRAY,
					bold: selectedIndex === question.options.length,
				},
				`${selectedIndex === question.options.length ? "> " : "  "}Type custom answer`,
			),
		),
		React.createElement(
			Text,
			{ dimColor: true },
			`\n↑↓ navigate | Enter select${question.multiple ? " | Space toggle" : ""} | Esc cancel`,
		),
	);
}
