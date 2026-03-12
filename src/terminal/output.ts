import pc from "picocolors";
import {
	getTerminalWidth,
	shouldUseColors,
	shouldUseUnicode,
	shouldUseHighContrast,
} from "./capabilities.js";

// High contrast colors (WCAG AA/AAA compliant)
const HIGH_CONTRAST_GOLD = "\x1b[38;5;220m"; // Bright yellow/gold (WCAG AAA)
const HIGH_CONTRAST_CORAL = "\x1b[38;5;202m"; // Vibrant orange (high contrast)
const HIGH_CONTRAST_SAND = "\x1b[38;5;130m"; // Dark brown (high contrast)
const HIGH_CONTRAST_BLUE = "\x1b[38;5;33m"; // Bright blue (high contrast)
const HIGH_CONTRAST_GREEN = "\x1b[38;5;34m"; // Bright green (high contrast)
const HIGH_CONTRAST_RED = "\x1b[38;5;196m"; // Bright red (high contrast)

// Default colors (improved contrast)
const GOLD = "\x1b[38;5;220m"; // Bright gold (WCAG AA)
const CORAL = "\x1b[38;5;202m"; // Vibrant coral (high contrast)
const SAND = "\x1b[38;5;130m"; // Darker sand (better contrast)
const NILE = "\x1b[38;5;33m"; // Bright blue (high contrast)

const colors = {
	orange: (text: string) =>
		shouldUseColors() ? `${shouldUseHighContrast() ? HIGH_CONTRAST_GOLD : GOLD}${text}\x1b[0m` : text,
	coral: (text: string) =>
		shouldUseColors() ? `${shouldUseHighContrast() ? HIGH_CONTRAST_CORAL : CORAL}${text}\x1b[0m` : text,
	primary: (text: string) =>
		shouldUseColors() ? `${shouldUseHighContrast() ? HIGH_CONTRAST_GOLD : GOLD}${text}\x1b[0m` : text,
	secondary: (text: string) => pc.dim(text),
	accent: (text: string) =>
		shouldUseColors() ? `${shouldUseHighContrast() ? HIGH_CONTRAST_CORAL : CORAL}${text}\x1b[0m` : text,
	gold: (text: string) => (shouldUseColors() ? `${shouldUseHighContrast() ? HIGH_CONTRAST_GOLD : GOLD}${text}\x1b[0m` : text),
	sand: (text: string) => (shouldUseColors() ? `${shouldUseHighContrast() ? HIGH_CONTRAST_SAND : SAND}${text}\x1b[0m` : text),
	nile: (text: string) => (shouldUseColors() ? `${shouldUseHighContrast() ? HIGH_CONTRAST_BLUE : NILE}${text}\x1b[0m` : text),
	green: (text: string) => (shouldUseColors() ? `${shouldUseHighContrast() ? HIGH_CONTRAST_GREEN : pc.green(text)}` : text),
	red: (text: string) => (shouldUseColors() ? `${shouldUseHighContrast() ? HIGH_CONTRAST_RED : pc.red(text)}` : text),
};

const IBIS = "\u{131A3}";
const EYE = "\u{13075}";
const EYE_OF_HORUS = "\u{13080}";
const ANKH = "\u{13269}";
const WAS = "\u{13040}";
const SCROLL = "\u{1331B}";
const FEATHER = "\u{13184}";

const symbols = {
	success: shouldUseUnicode() ? ANKH : "[OK]",
	error: shouldUseUnicode() ? EYE_OF_HORUS : "[X]",
	warning: shouldUseUnicode() ? "\u{13000}" : "[!]",
	info: shouldUseUnicode() ? IBIS : "[i]",
	arrow: shouldUseUnicode() ? "\u{13009}" : "->",
	bullet: shouldUseUnicode() ? "\u{1330B}" : "*",
	check: shouldUseUnicode() ? ANKH : "[v]",
	cross: shouldUseUnicode() ? EYE_OF_HORUS : "[x]",
	pointer: shouldUseUnicode() ? WAS : ">",
	spinner: shouldUseUnicode()
		? ["\u{13197}", "\u{13198}", "\u{13199}", "\u{1319A}", "\u{1319B}"]
		: ["-", "\\", "|", "/"],
};

export function formatOutput(
	text: string,
	type: "success" | "error" | "warning" | "info" = "info",
): string {
	if (!shouldUseColors()) {
		return `[${type.toUpperCase()}] ${text}`;
	}

	const icon = symbols[type];
	
	if (shouldUseHighContrast()) {
		const colorFn = {
			success: colors.green,
			error: colors.red,
			warning: colors.orange,
			info: colors.nile,
		}[type];
		return colorFn(`${icon} ${text}`);
	}

	const colorFn = {
		success: pc.green,
		error: pc.red,
		warning: pc.yellow,
		info: pc.blue,
	}[type];

	return colorFn(`${icon} ${text}`);
}

export function formatHeader(text: string): string {
	const width = getTerminalWidth();
	const padding = Math.max(0, Math.floor((width - text.length - 4) / 2));
	const line = "─".repeat(width - 2);

	if (shouldUseColors()) {
		return `
${colors.orange(`╭${line}╮`)}
${colors.orange("│")} ${colors.coral(text.padStart(padding + text.length / 2).padEnd(width - 4))} ${colors.orange("│")}
${colors.orange(`╰${line}╯`)}
`;
	}

	return `
${line}
  ${text}
${line}
`;
}

export function formatToolCall(
	toolName: string,
	args?: Record<string, unknown>,
): string {
	const argsPreview = args ? JSON.stringify(args, null, 2).slice(0, 200) : "";
	const truncated = args && JSON.stringify(args, null, 2).length > 200;

	if (shouldUseColors()) {
		return `\n${colors.coral(`<${toolName}>`)}\n${pc.dim(argsPreview)}${truncated ? pc.dim("...") : ""}\n${colors.coral(`</${toolName}>`)}\n`;
	}
	return `\n<${toolName}>\n${argsPreview}${truncated ? "..." : ""}\n</${toolName}>\n`;
}

export function formatCodeBlock(code: string, _language?: string): string {
	const lines = code.split("\n");
	const lineNumWidth = Math.max(2, String(lines.length).length);

	return lines
		.map((line, i) => {
			const lineNum = String(i + 1).padStart(lineNumWidth);
			if (shouldUseColors()) {
				return `${pc.dim(lineNum)} │ ${line}`;
			}
			return `${lineNum} | ${line}`;
		})
		.join("\n");
}

export function formatTable(headers: string[], rows: string[][]): string {
	const colWidths = headers.map((h, i) =>
		Math.max(h.length, ...rows.map((r) => r[i]?.length ?? 0)),
	);

	const border = colWidths.map((w) => "─".repeat(w + 2));

	const headerRow = headers.map((h, i) => h.padEnd(colWidths[i])).join(" │ ");
	const separator = border.join("┼");
	const dataRows = rows.map((row) =>
		row.map((cell, i) => (cell ?? "").padEnd(colWidths[i])).join(" │ "),
	);

	if (shouldUseColors()) {
		return [
			`┌ ${border.join(" ┬ ")} ┐`,
			`│ ${pc.bold(headerRow)} │`,
			`├ ${separator} ┤`,
			...dataRows.map((r) => `│ ${r} │`),
			`└ ${border.join(" ┴ ")} ┘`,
		].join("\n");
	}

	return [headerRow, separator, ...dataRows].join("\n");
}

export function formatProgress(
	current: number,
	total: number,
	label: string,
): string {
	const percent = Math.round((current / total) * 100);
	const barWidth = 30;
	const filled = Math.round((percent / 100) * barWidth);
	const empty = barWidth - filled;

	const bar = shouldUseUnicode()
		? `${"█".repeat(filled)}${"░".repeat(empty)}`
		: `${"#".repeat(filled)}${"-".repeat(empty)}`;

	if (shouldUseColors()) {
		return `${colors.orange(label)} [${pc.green(bar)}] ${pc.bold(`${percent}%`)}`;
	}

	return `${label} [${bar}] ${percent}%`;
}

export function truncate(text: string, maxLength?: number): string {
	const limit = maxLength ?? getTerminalWidth() - 4;
	if (text.length <= limit) return text;
	return `${text.slice(0, limit - 3)}...`;
}

import stringWidth from "string-width";

export function wrap(text: string, width?: number): string {
	const w = width ?? getTerminalWidth() - 4;
	const lines: string[] = [];

	const textLines = text.split("\n");

	for (const textLine of textLines) {
		const stripped = stripAnsi(textLine);
		if (stripped.length <= w) {
			lines.push(textLine);
			continue;
		}

		let currentLine = "";
		let currentStripped = "";
		let inEscape = false;

		const words = splitIntoWords(textLine);

		for (const word of words) {
			const wordStripped = stripAnsi(word);
			const wordWidth = stringWidth(wordStripped);
			const currentWidth = stringWidth(currentStripped);

			if (currentWidth + wordWidth <= w) {
				currentLine += word;
				currentStripped += wordStripped;
			} else {
				if (currentLine) {
					lines.push(currentLine.trimEnd());
				}
				if (wordWidth > w) {
					const wrappedWord = wrapLongWord(word, wordStripped, w);
					lines.push(...wrappedWord.slice(0, -1));
					const lastPart = wrappedWord[wrappedWord.length - 1];
					currentLine = lastPart;
					currentStripped = stripAnsi(lastPart);
				} else {
					currentLine = word;
					currentStripped = wordStripped;
				}
			}
		}

		if (currentLine) {
			lines.push(currentLine.trimEnd());
		}
	}

	return lines.join("\n");
}

function splitIntoWords(text: string): string[] {
	const words: string[] = [];
	let current = "";
	let inEscape = false;
	let inWord = false;

	for (let i = 0; i < text.length; i++) {
		const char = text[i];

		if (char === "\x1b") {
			inEscape = true;
			current += char;
			continue;
		}

		if (inEscape) {
			current += char;
			if (/[a-zA-Z]/.test(char)) {
				inEscape = false;
			}
			continue;
		}

		if (char.trim() === "") {
			if (inWord) {
				words.push(current);
				inWord = false;
				current = "";
			}
			words.push(char);
		} else {
			current += char;
			inWord = true;
		}
	}

	if (current) {
		words.push(current);
	}

	return words;
}

function wrapLongWord(word: string, stripped: string, width: number): string[] {
	const lines: string[] = [];
	let current = "";
	let currentStripped = "";
	let inEscape = false;

	for (let i = 0; i < word.length; i++) {
		const char = word[i];

		if (char === "\x1b") {
			inEscape = true;
			current += char;
			continue;
		}

		if (inEscape) {
			current += char;
			if (/[a-zA-Z]/.test(char)) {
				inEscape = false;
			}
			continue;
		}

		const charWidth = stringWidth(char);
		if (stringWidth(currentStripped) + charWidth <= width) {
			current += char;
			currentStripped += char;
		} else {
			lines.push(current);
			current = char;
			currentStripped = char;
		}
	}

	if (current) {
		lines.push(current);
	}

	return lines;
}

const ANSI_REGEX_GLOBAL = /\x1b\[[0-9;]*[a-zA-Z]/g;

function stripAnsi(str: string): string {
	return str.replace(ANSI_REGEX_GLOBAL, "");
}

export { colors, symbols, pc };
