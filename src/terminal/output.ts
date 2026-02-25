import pc from "picocolors";
import {
	getTerminalWidth,
	shouldUseColors,
	shouldUseUnicode,
} from "./capabilities.js";

const GOLD = "\x1b[38;5;178m";
const CORAL = "\x1b[38;5;174m";
const SAND = "\x1b[38;5;137m";

const colors = {
	orange: (text: string) =>
		shouldUseColors() ? `${GOLD}${text}\x1b[0m` : text,
	coral: (text: string) =>
		shouldUseColors() ? `${CORAL}${text}\x1b[0m` : text,
	primary: (text: string) =>
		shouldUseColors() ? `${GOLD}${text}\x1b[0m` : text,
	secondary: (text: string) => pc.dim(text),
	accent: (text: string) =>
		shouldUseColors() ? `${CORAL}${text}\x1b[0m` : text,
	gold: (text: string) =>
		shouldUseColors() ? `${GOLD}${text}\x1b[0m` : text,
	sand: (text: string) =>
		shouldUseColors() ? `${SAND}${text}\x1b[0m` : text,
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
		let visualWidth = 0;
		let inEscape = false;
		
		for (let i = 0; i < textLine.length; i++) {
			const char = textLine[i];
			
			if (char === "\x1b") {
				inEscape = true;
				currentLine += char;
				continue;
			}
			
			if (inEscape) {
				currentLine += char;
				if (/[a-zA-Z]/.test(char)) {
					inEscape = false;
				}
				continue;
			}
			
			currentLine += char;
			visualWidth++;
			
			if (visualWidth >= w && i < textLine.length - 1) {
				lines.push(currentLine);
				currentLine = "";
				visualWidth = 0;
			}
		}
		
		if (currentLine.length > 0) {
			lines.push(currentLine);
		}
	}

	return lines.join("\n");
}

const ANSI_REGEX_GLOBAL = /\x1b\[[0-9;]*[a-zA-Z]/g;

function stripAnsi(str: string): string {
	return str.replace(ANSI_REGEX_GLOBAL, "");
}

export { colors, symbols, pc };
