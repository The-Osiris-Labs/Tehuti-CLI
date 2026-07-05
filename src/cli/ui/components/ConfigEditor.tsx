import { useOnClick, useOnMouseEnter } from "@ink-tools/ink-mouse";
import { Box, Text, useInput, useStdout } from "ink";
import TextInput from "ink-text-input";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { BRANDING, ERROR_SYMBOL } from "../../../branding/index.js";
import { isMouseSequence } from "../../../utils/mouse.js";

const GOLD = BRANDING.colors.gold;
const GRAY = BRANDING.colors.gray;
const CORAL = BRANDING.colors.coral;
const NILE = BRANDING.colors.nile;
const SAND = BRANDING.colors.sand;
const RED = BRANDING.colors.red;
const OBSIDIAN = BRANDING.colors.obsidian;

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

type ConfigField =
	| "apiKey"
	| "model"
	| "provider"
	| "baseUrl"
	| "temperature"
	| "maxTokens";
type EditorConfig = ConfigEditorProps["config"];

function ConfigTab({
	label,
	isActive,
	onClick,
}: {
	label: string;
	isActive: boolean;
	onClick: () => void;
}) {
	const ref = useRef<any>(null);
	useOnClick(ref, onClick);

	return (
		<Box
			ref={ref}
			paddingX={1}
			borderStyle="round"
			borderColor={isActive ? GOLD : GRAY}
			marginX={1}
		>
			<Text color={isActive ? GOLD : GRAY} bold={isActive}>
				{label}
			</Text>
		</Box>
	);
}

function ConfigFieldRow({
	field,
	isSelected,
	isEditing,
	editValue,
	fieldValue,
	onHover,
	onClick,
	onEditValueChange,
	onEditCommit,
}: {
	field: any;
	isSelected: boolean;
	isEditing: boolean;
	editValue: string;
	fieldValue: string;
	onHover: () => any;
	onClick: () => void;
	onEditValueChange: (v: string) => any;
	onEditCommit: () => void;
}) {
	const ref = useRef<any>(null);
	useOnMouseEnter(ref, onHover);
	useOnClick(ref, onClick);

	return (
		<Box
			ref={ref}
			flexDirection="column"
			marginBottom={1}
			padding={1}
			borderStyle="single"
			borderColor={isSelected ? GOLD : NILE}
			backgroundColor={isSelected && !isEditing ? OBSIDIAN : undefined}
		>
			<Box justifyContent="space-between" marginBottom={0.5}>
				<Text bold color={isSelected ? GOLD : GRAY}>
					{field.label}
				</Text>
				{isEditing ? (
					<Box borderStyle="single" borderColor={CORAL} paddingX={1}>
						<TextInput
							value={editValue}
							onChange={onEditValueChange}
							onSubmit={onEditCommit}
							focus={isEditing}
						/>
					</Box>
				) : (
					<Text color={isSelected ? CORAL : SAND}>{fieldValue}</Text>
				)}
			</Box>
			<Text dimColor color={SAND}>
				{field.description}
			</Text>
			{field.type === "number" && (
				<Text dimColor color={GRAY}>
					Range: {field.min} - {field.max}
				</Text>
			)}
		</Box>
	);
}

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
	const [activeTab, setActiveTab] = useState<
		"API & Provider" | "Model Options"
	>("API & Provider");
	const { stdout } = useStdout();
	const [validationError, setValidationError] = useState<string | null>(null);

	useEffect(() => {
		setDraftConfig(config);
	}, [config]);

	const allFields = useMemo<
		Array<{
			key: ConfigField;
			label: string;
			type: "string" | "number";
			min?: number;
			max?: number;
			description: string;
			category: "API & Provider" | "Model Options";
		}>
	>(
		() => [
			{
				key: "provider",
				label: "Provider",
				type: "string",
				description:
					"AI provider e.g. openrouter, opencode, ollama, xai, anthropic, custom",
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
				description:
					"Override base URL for the provider's API endpoint (required for opencode etc)",
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
		],
		[],
	);

	const fields = allFields.filter((f) => f.category === activeTab);

	const commitFieldEdit = (): void => {
		if (!editingField) return;

		const field = allFields.find((f) => f.key === editingField);
		let isValid = true;
		let parsedValue: string | number | undefined = editValue;

		if (field?.type === "number") {
			const num = parseFloat(editValue);
			if (Number.isNaN(num)) {
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
				setActiveTab((prev) =>
					prev === "API & Provider" ? "Model Options" : "API & Provider",
				);
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
			return `••••••••${strValue.slice(-4)}`;
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
				<Text bold color={GOLD}>
					𓆣 Configuration Editor
				</Text>
				<Box>
					<ConfigTab
						label="API & Provider"
						isActive={activeTab === "API & Provider"}
						onClick={() => {
							setActiveTab("API & Provider");
							setSelectedField("provider");
						}}
					/>
					<ConfigTab
						label="Model Options"
						isActive={activeTab === "Model Options"}
						onClick={() => {
							setActiveTab("Model Options");
							setSelectedField("model");
						}}
					/>
				</Box>
			</Box>
			{validationError && (
				<Box
					marginBottom={1}
					padding={1}
					borderStyle="single"
					borderColor={RED}
				>
					<Text color={RED}>
						{ERROR_SYMBOL} {validationError}
					</Text>
				</Box>
			)}
			<Box marginBottom={1} flexDirection="column">
				{fields.map((field) => {
					const isSelected = selectedField === field.key;
					const isEditing = editingField === field.key;

					return (
						<ConfigFieldRow
							key={field.key}
							field={field}
							isSelected={isSelected}
							isEditing={isEditing}
							editValue={editValue}
							fieldValue={getFieldValue(field.key)}
							onHover={() => setSelectedField(field.key)}
							onClick={() => {
								setSelectedField(field.key);
								setEditingField(field.key);
								setEditValue(String(draftConfig[field.key] ?? ""));
								setValidationError(null);
							}}
							onEditValueChange={(v) => setEditValue(v)}
							onEditCommit={commitFieldEdit}
						/>
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
