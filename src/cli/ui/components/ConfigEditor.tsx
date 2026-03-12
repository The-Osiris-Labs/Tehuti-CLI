import { Box, Text, useInput, useStdout } from "ink";
import React, { useState } from "react";

const GOLD = "#D4AF37";
const GRAY = "#6B7280";
const CORAL = "#D97757";
const CYAN = "#06B6D4";
const GREEN = "#10B981";
const SAND = "#C2B280";
const RED = "#EF4444";

interface ConfigEditorProps {
	config: {
		apiKey?: string;
		model?: string;
		temperature?: number;
		maxTokens?: number;
	};
	onSave: (updates: {
		apiKey?: string;
		model?: string;
		temperature?: number;
		maxTokens?: number;
	}) => void;
	onCancel: () => void;
}

type ConfigField = "apiKey" | "model" | "temperature" | "maxTokens";

export function ConfigEditor({
	config,
	onSave,
	onCancel,
}: ConfigEditorProps): React.ReactElement {
	const [selectedField, setSelectedField] = useState<ConfigField>("apiKey");
	const [editingField, setEditingField] = useState<ConfigField | null>(null);
	const [editValue, setEditValue] = useState("");
	const { stdout } = useStdout();

	const fields: Array<{
		key: ConfigField;
		label: string;
		type: "string" | "number";
		min?: number;
		max?: number;
		description: string;
	}> = [
		{
			key: "apiKey",
			label: "API Key",
			type: "string",
			description: "OpenRouter API key for accessing AI models",
		},
		{
			key: "model",
			label: "Default Model",
			type: "string",
			description: "Default AI model to use",
		},
		{
			key: "temperature",
			label: "Temperature",
			type: "number",
			min: 0,
			max: 2,
			description: "Creativity level (0.0 = deterministic, 2.0 = creative)",
		},
		{
			key: "maxTokens",
			label: "Max Tokens",
			type: "number",
			min: 1000,
			max: 128000,
			description: "Maximum tokens per response",
		},
	];

	useInput((char, key) => {
		if (editingField) {
			if (key.return) {
				const field = fields.find((f) => f.key === editingField);
				let isValid = true;
				let parsedValue: string | number = editValue;

				if (field?.type === "number") {
					const num = parseFloat(editValue);
					if (isNaN(num)) {
						isValid = false;
					} else if (field.min !== undefined && num < field.min) {
						isValid = false;
					} else if (field.max !== undefined && num > field.max) {
						isValid = false;
					} else {
						parsedValue = num;
					}
				}

				if (isValid) {
					const updates: any = {};
					updates[editingField] = parsedValue;
					onSave(updates);
				}

				setEditingField(null);
				setEditValue("");
			} else if (key.escape) {
				setEditingField(null);
				setEditValue("");
			} else if (key.backspace || key.delete) {
				setEditValue((v) => v.slice(0, -1));
			} else if (char && !key.ctrl && !key.meta && char.length === 1) {
				setEditValue((v) => v + char);
			}
		} else {
			if (key.escape) {
				onCancel();
			} else if (key.upArrow) {
				const currentIndex = fields.findIndex((f) => f.key === selectedField);
				const newIndex = (currentIndex - 1 + fields.length) % fields.length;
				setSelectedField(fields[newIndex].key);
			} else if (key.downArrow) {
				const currentIndex = fields.findIndex((f) => f.key === selectedField);
				const newIndex = (currentIndex + 1) % fields.length;
				setSelectedField(fields[newIndex].key);
			} else if (key.return || char === " ") {
				setEditingField(selectedField);
				setEditValue(String(config[selectedField] || ""));
			}
		}
	});

	const getFieldValue = (field: ConfigField): string => {
		const value = config[field];
		if (field === "apiKey" && value) {
			const strValue = String(value);
			return "••••••••" + strValue.slice(-4);
		}
		return value !== undefined && value !== null ? String(value) : "";
	};

	const terminalWidth = stdout?.columns || 80;
	const editorWidth = Math.min(80, terminalWidth - 4);

	return React.createElement(
		Box,
		{
			flexDirection: "column",
			width: editorWidth,
			borderStyle: "round",
			borderColor: GOLD,
			paddingX: 1,
		},
		React.createElement(
			Box,
			{ marginBottom: 1 },
			React.createElement(Text, { bold: true, color: GOLD }, "𓆣 Configuration Editor"),
		),
		React.createElement(
			Box,
			{ marginBottom: 1, flexDirection: "column" },
			...fields.map((field) => {
				const isSelected = selectedField === field.key;
				const isEditing = editingField === field.key;

				return React.createElement(
					Box,
					{
						key: field.key,
						flexDirection: "column",
						marginBottom: 1,
						padding: isSelected ? 1 : 0,
						borderStyle: isSelected ? "single" : undefined,
						borderColor: GOLD,
					},
					React.createElement(
						Box,
						{ justifyContent: "space-between", marginBottom: 0.5 },
						React.createElement(
							Text,
							{ bold: true, color: isSelected ? GOLD : GRAY },
							field.label,
						),
						React.createElement(
							Text,
							{ color: isSelected ? CORAL : SAND },
							isEditing ? (
								React.createElement(
									Box,
									null,
									React.createElement(Text, null, editValue),
									React.createElement(Text, { backgroundColor: CORAL }, " "),
								)
							) : (
								getFieldValue(field.key)
							),
						),
					),
					React.createElement(Text, { dimColor: true, color: SAND }, field.description),
					field.type === "number" &&
						React.createElement(
							Text,
							{ dimColor: true, color: GRAY },
							`Range: ${field.min} - ${field.max}`,
						),
				);
			}),
		),
		React.createElement(
			Box,
			{
				marginTop: 1,
				borderStyle: "single",
				borderColor: GRAY,
				paddingX: 1,
				flexDirection: "column",
			},
			React.createElement(
				Text,
				{ dimColor: true },
				editingField
					? "Enter to save | Esc to cancel"
					: "↑↓ navigate | Enter/Space edit | Esc cancel",
			),
		),
	);
}