import { Box, Text, useInput, useStdout } from "ink";
import React, { useEffect, useMemo, useState } from "react";
import TextInput from "ink-text-input";
import { isMouseSequence } from "../../../utils/mouse.js";
import { BRANDING, ERROR_SYMBOL } from "../../../branding/index.js";

const GOLD = BRANDING.colors.gold;
const GRAY = "#6B7280";
const CORAL = BRANDING.colors.coral;
const NILE = BRANDING.colors.nile;
const SAND = BRANDING.colors.sand;
const RED = "#EF4444";

interface ConfigEditorProps {
	config: {
		apiKey?: string;
		model?: string;
		provider?: string;
		baseUrl?: string;
		temperature?: number;
		maxTokens?: number;
	};
	onSave: (updates: {
		apiKey?: string;
		model?: string;
		provider?: string;
		baseUrl?: string;
		temperature?: number;
		maxTokens?: number;
	}) => void;
	onCancel: () => void;
	width?: number;
}

type ConfigField = "apiKey" | "model" | "provider" | "baseUrl" | "temperature" | "maxTokens";
type EditorConfig = ConfigEditorProps["config"];

export function ConfigEditor({
	config,
	onSave,
	onCancel,
	width,
}: ConfigEditorProps): React.ReactElement {
	const [draftConfig, setDraftConfig] = useState<EditorConfig>(config);
	const [selectedField, setSelectedField] = useState<ConfigField>("provider");
	const [editingField, setEditingField] = useState<ConfigField | null>(null);
	const [editValue, setEditValue] = useState("");
	const [activeTab, setActiveTab] = useState<"API & Provider" | "Model Options">("API & Provider");
	const { stdout } = useStdout();
	const [validationError, setValidationError] = useState<string | null>(null);

	useEffect(() => {
		setDraftConfig(config);
	}, [config]);

	const allFields = useMemo<Array<{
		key: ConfigField;
		label: string;
		type: "string" | "number";
		min?: number;
		max?: number;
		description: string;
		category: "API & Provider" | "Model Options";
	}>>(() => [
		{
			key: "provider",
			label: "Provider",
			type: "string",
			description: "AI provider e.g. openrouter, opencode, ollama, xai, anthropic, custom",
			category: "API & Provider",
		},
		{
			key: "apiKey",
			label: "API Key",
			type: "string",
			description: "API key for the selected provider (or use env vars)",
			category: "API & Provider",
		},
		{
			key: "baseUrl",
			label: "Base URL (optional)",
			type: "string",
			description: "Override base URL for the provider's API endpoint (required for opencode etc)",
			category: "API & Provider",
		},
		{
			key: "model",
			label: "Default Model",
			type: "string",
			description: "Default AI model (e.g. minimax-m3 for opencode go)",
			category: "Model Options",
		},
		{
			key: "temperature",
			label: "Temperature",
			type: "number",
			min: 0,
			max: 2,
			description: "Creativity level (0.0 = deterministic, 2.0 = creative)",
			category: "Model Options",
		},
		{
			key: "maxTokens",
			label: "Max Tokens",
			type: "number",
			min: 1000,
			max: 128000,
			description: "Maximum tokens per response",
			category: "Model Options",
		},
	], []);

	const fields = allFields.filter(f => f.category === activeTab);

	const commitFieldEdit = (): void => {
		if (!editingField) return;

		const field = allFields.find((f) => f.key === editingField);
		let isValid = true;
		let parsedValue: string | number | undefined = editValue;

		if (field?.type === "number") {
			const num = parseFloat(editValue);
			if (isNaN(num)) {
				isValid = false;
				setValidationError("Must be a valid number");
			} else if (field.min !== undefined && num < field.min) {
				isValid = false;
				setValidationError(`Must be at least ${field.min}`);
			} else if (field.max !== undefined && num > field.max) {
				isValid = false;
				setValidationError(`Must be at most ${field.max}`);
			} else {
				parsedValue = num;
			}
		} else if (editValue.trim() === "") {
			parsedValue = undefined;
		}

		if (!isValid) {
			return;
		}

		setDraftConfig((current) => ({
			...current,
			[editingField]: parsedValue,
		}));
		setValidationError(null);
		setEditingField(null);
		setEditValue("");
	};

	useInput((char, key) => {
		if (isMouseSequence(char)) return;
		if (editingField) {
			if (key.return) {
				commitFieldEdit();
			} else if (key.escape) {
				setEditingField(null);
				setEditValue("");
				setValidationError(null);
			}
		} else {
			if (key.ctrl && (char === "s" || char === "S")) {
				onSave(draftConfig);
			} else if (key.escape) {
				onCancel();
			} else if (key.upArrow) {
				const currentIndex = fields.findIndex((f) => f.key === selectedField);
				const newIndex = (currentIndex - 1 + fields.length) % fields.length;
				setSelectedField(fields[newIndex].key);
			} else if (key.downArrow) {
				const currentIndex = fields.findIndex((f) => f.key === selectedField);
				const newIndex = (currentIndex + 1) % fields.length;
				setSelectedField(fields[newIndex].key);
			} else if (key.leftArrow || key.rightArrow || char === "\t") {
				setActiveTab(prev => prev === "API & Provider" ? "Model Options" : "API & Provider");
				setSelectedField(activeTab === "API & Provider" ? "model" : "provider");
			} else if (key.home) {
				setSelectedField(fields[0].key);
			} else if (key.end) {
				setSelectedField(fields[fields.length - 1].key);
			} else if (key.return || char === " ") {
				setEditingField(selectedField);
				setEditValue(String(draftConfig[selectedField] ?? ""));
				setValidationError(null);
			}
		}
	});

	const getFieldValue = (field: ConfigField): string => {
		const value = draftConfig[field];
		if (field === "apiKey" && value) {
			const strValue = String(value);
			return "••••••••" + strValue.slice(-4);
		}
		return value !== undefined && value !== null ? String(value) : "";
	};

	const terminalWidth = width || stdout?.columns || 80;
	const editorWidth = Math.min(80, terminalWidth - 4);

	return (
		<Box
			flexDirection="column"
			width={editorWidth}
			borderStyle="round"
			borderColor={GOLD}
			paddingX={1}
		>
			<Box marginBottom={1} justifyContent="space-between">
				<Text bold color={GOLD}>𓆣 Configuration Editor</Text>
				<Box>
					<Text color={activeTab === "API & Provider" ? GOLD : GRAY} bold={activeTab === "API & Provider"}>
						{activeTab === "API & Provider" ? " [ API & Provider ] " : " API & Provider "}
					</Text>
					<Text color={activeTab === "Model Options" ? GOLD : GRAY} bold={activeTab === "Model Options"}>
						{activeTab === "Model Options" ? " [ Model Options ] " : " Model Options "}
					</Text>
				</Box>
			</Box>
			{validationError && (
				<Box
					marginBottom={1}
					padding={1}
					borderStyle="single"
					borderColor={RED}
				>
					<Text color={RED}>{ERROR_SYMBOL} {validationError}</Text>
				</Box>
			)}
			<Box marginBottom={1} flexDirection="column">
				{fields.map((field) => {
					const isSelected = selectedField === field.key;
					const isEditing = editingField === field.key;

					return (
						<Box
							key={field.key}
							flexDirection="column"
							marginBottom={1}
							padding={isSelected ? 1 : 0}
							borderStyle={isSelected ? "single" : undefined}
							borderColor={GOLD}
						>
							<Box justifyContent="space-between" marginBottom={0.5}>
								<Text bold color={isSelected ? GOLD : GRAY}>{field.label}</Text>
								{isEditing ? (
									<Box borderStyle="single" borderColor={CORAL} paddingX={1}>
										<TextInput
											value={editValue}
											onChange={setEditValue}
											onSubmit={commitFieldEdit}
											focus={isEditing}
										/>
									</Box>
								) : (
									<Text color={isSelected ? CORAL : SAND}>{getFieldValue(field.key)}</Text>
								)}
							</Box>
							<Text dimColor color={SAND}>{field.description}</Text>
							{field.type === "number" && (
								<Text dimColor color={GRAY}>Range: {field.min} - {field.max}</Text>
							)}
						</Box>
					);
				})}
			</Box>
			<Box
				marginTop={1}
				borderStyle="single"
				borderColor={GRAY}
				paddingX={1}
				flexDirection="column"
			>
				<Text dimColor>
					{editingField
						? "Enter to apply field | Esc cancel field"
						: "↑↓ navigate | ↔ switch tab | Enter/Space edit | Ctrl+S save | Esc cancel"}
				</Text>
				<Text dimColor color={NILE}>
					Changes stay local until Ctrl+S saves them.
				</Text>
			</Box>
		</Box>
	);
}
