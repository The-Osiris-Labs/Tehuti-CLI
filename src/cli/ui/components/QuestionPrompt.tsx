import { Box, Text, useInput } from "ink";
import React, { useState } from "react";
import type { QuestionData } from "../../../agent/tools/system.js";
import { BRANDING, DECORATIVE, HIEROGLYPHS } from "../../../branding/index.js";
import { isMouseSequence } from "../../../utils/mouse.js";

const COLORS = {
	gold: BRANDING.colors?.primary || "#F5C518",
	coral: BRANDING.colors?.coral || "#FF6B35",
	sand: BRANDING.colors?.sand || "#8B7355",
	gray: BRANDING.colors?.gray || "#9CA3AF",
	nile: BRANDING.colors?.nile || "#165DFF",
	green: BRANDING.colors?.green || "#22C55E",
} as const;

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
	const [filter, setFilter] = useState("");

	// The selected row is an index into the visible list, never the source array.
	// Preserve original indices only for multi-select state and final answer mapping.
	const lcFilter = filter.toLowerCase();
	const visibleOptions = question.options
		.map((opt, originalIndex) => ({ opt, originalIndex }))
		.filter(({ opt }) =>
			!lcFilter ||
			opt.label.toLowerCase().includes(lcFilter) ||
			(opt.description?.toLowerCase().includes(lcFilter) ?? false),
		);

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

		// Live filter typing (when there's no modifier and we haven't
		// hit an arrow key)
		if (
			k &&
			k.length === 1 &&
			!key.ctrl &&
			!key.meta &&
			!key.upArrow &&
			!key.downArrow &&
			!key.return &&
			!key.escape &&
			k !== " "
		) {
			setFilter((prev) => prev + k);
			setSelectedIndex(0);
			return;
		}
		if ((key.backspace || k === "\x7f" || k === "\b") && filter.length > 0) {
			setFilter((prev) => prev.slice(0, -1));
			setSelectedIndex(0);
			return;
		}

		const totalRows = visibleOptions.length + 1; // +1 for "Type custom answer"

		if (key.upArrow) {
			setSelectedIndex((prev) => (prev - 1 + totalRows) % totalRows);
			return;
		}

		if (key.downArrow) {
			setSelectedIndex((prev) => (prev + 1) % totalRows);
			return;
		}

		if (key.return) {
			if (selectedIndex === visibleOptions.length) {
				setCustomMode(true);
				return;
			}

			const selected = visibleOptions[selectedIndex];
			if (!selected) return;
			const optionIndex = selected.originalIndex;

			if (question.multiple) {
				const answers = Array.from(selectedMultiple).map(
					(i) => question.options[i].label,
				);
				if (answers.length === 0) {
					if (!selectedMultiple.has(optionIndex)) {
						onAnswer([selected.opt.label]);
					} else {
						onAnswer(answers);
					}
				} else {
					onAnswer(answers);
				}
			} else {
				onAnswer(selected.opt.label);
			}
			return;
		}

		if (key.escape) {
			if (filter.length > 0) {
				setFilter("");
				setSelectedIndex(0);
				return;
			}
			onCancel();
			return;
		}

		if (
			question.multiple &&
			k === " " &&
			selectedIndex < visibleOptions.length
		) {
			const optionIndex = visibleOptions[selectedIndex]?.originalIndex;
			if (optionIndex === undefined) return;
			setSelectedMultiple((prev) => {
				const next = new Set(prev);
				if (next.has(optionIndex)) {
					next.delete(optionIndex);
				} else {
					next.add(optionIndex);
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
				paddingY: 1,
				borderStyle: "round",
				borderColor: COLORS.gold,
			},
			React.createElement(
				Box,
				{ gap: 1 },
				React.createElement(
					Text,
					{ bold: true, color: COLORS.gold },
					HIEROGLYPHS.tool,
				),
				React.createElement(
					Text,
					{ bold: true, color: COLORS.gold },
					question.header,
				),
			),
			React.createElement(
				Box,
				{ marginTop: 1, marginBottom: 1 },
				React.createElement(Text, null, question.question),
			),
			React.createElement(
				Box,
				{ gap: 1 },
				React.createElement(Text, { color: COLORS.coral }, "▌"),
				React.createElement(Text, null, "Type your answer:"),
			),
			React.createElement(
				Box,
				{ marginLeft: 1, marginTop: 1 },
				React.createElement(
					Text,
					{ color: COLORS.gold, bold: true },
					`> ${customInput}`,
				),
				React.createElement(Text, { color: COLORS.gold }, "█"),
			),
			React.createElement(
				Box,
				{ marginTop: 1 },
				React.createElement(
					Text,
					{ dimColor: true, color: COLORS.gray },
					"Enter to confirm • Esc to cancel",
				),
			),
		);
	}

	return React.createElement(
		Box,
		{
			flexDirection: "column",
			paddingX: 1,
			paddingY: 1,
			borderStyle: "round",
			borderColor: COLORS.gold,
		},
		React.createElement(
			Box,
			{ gap: 1 },
			React.createElement(
				Text,
				{ bold: true, color: COLORS.gold },
				HIEROGLYPHS.tool,
			),
			React.createElement(
				Text,
				{ bold: true, color: COLORS.gold },
				question.header,
			),
			question.multiple &&
				React.createElement(
					Text,
					{ color: COLORS.nile, dimColor: true },
					"(multi-select)",
				),
		),
		React.createElement(
			Box,
			{ marginTop: 1, marginBottom: 1 },
			React.createElement(Text, null, question.question),
		),
		filter.length > 0 &&
			React.createElement(
				Box,
				{ marginBottom: 1 },
				React.createElement(
					Text,
					{ color: COLORS.nile, dimColor: true },
					`${DECORATIVE.eye} Filter: ${filter}`,
				),
			),
		...visibleOptions.map(({ opt, originalIndex }, visibleIndex) => {
			const isSelected = selectedIndex === visibleIndex;
			const isChecked = selectedMultiple.has(originalIndex);
			return React.createElement(
				Box,
				{ key: originalIndex, flexDirection: "row" },
				React.createElement(
					Text,
					{
						color: isSelected ? COLORS.coral : COLORS.gray,
						bold: isSelected,
					},
					question.multiple
						? `${isChecked ? HIEROGLYPHS.success : "○"} ${isSelected ? "▸" : "  "}`
						: `${isSelected ? "▸" : "  "}`,
				),
				React.createElement(
					Text,
					{
						color: isSelected ? COLORS.coral : undefined,
						bold: isSelected,
					},
					` ${opt.label}`,
				),
				opt.description &&
					React.createElement(
						Text,
						{ dimColor: true, color: COLORS.gray },
						` — ${opt.description}`,
					),
			);
		}),
		React.createElement(
			Box,
			{ key: "custom" },
			React.createElement(
				Text,
				{
					color:
						selectedIndex === visibleOptions.length
							? COLORS.coral
							: COLORS.gray,
					bold: selectedIndex === visibleOptions.length,
				},
				`${selectedIndex === visibleOptions.length ? "▸" : "  "}  ✎  Type custom answer`,
			),
		),
		React.createElement(
			Box,
			{ marginTop: 1 },
			React.createElement(
				Text,
				{ dimColor: true, color: COLORS.gray },
				`↑↓ navigate • type to filter${question.multiple ? " • Space toggle" : ""} • Enter select • Esc cancel`,
			),
		),
	);
}
