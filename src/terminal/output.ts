import pc from "picocolors";
import stringWidth from "string-width";
import {
	getTerminalWidth,
	shouldUseColors,
	shouldUseHighContrast,
	shouldUseUnicode,
} from "./capabilities.js";
import { renderMarkdownToAnsi } from "./markdown.js";

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
		shouldUseColors()
			? `${shouldUseHighContrast() ? HIGH_CONTRAST_GOLD : GOLD}${text}\x1b[0m`
			: text,
	coral: (text: string) =>
		shouldUseColors()
			? `${shouldUseHighContrast() ? HIGH_CONTRAST_CORAL : CORAL}${text}\x1b[0m`
			: text,
	primary: (text: string) =>
		shouldUseColors()
			? `${shouldUseHighContrast() ? HIGH_CONTRAST_GOLD : GOLD}${text}\x1b[0m`
			: text,
	secondary: (text: string) => pc.dim(text),
	accent: (text: string) =>
		shouldUseColors()
			? `${shouldUseHighContrast() ? HIGH_CONTRAST_CORAL : CORAL}${text}\x1b[0m`
			: text,
	gold: (text: string) =>
		shouldUseColors()
			? `${shouldUseHighContrast() ? HIGH_CONTRAST_GOLD : GOLD}${text}\x1b[0m`
			: text,
	sand: (text: string) =>
		shouldUseColors()
			? `${shouldUseHighContrast() ? HIGH_CONTRAST_SAND : SAND}${text}\x1b[0m`
			: text,
	nile: (text: string) =>
		shouldUseColors()
			? `${shouldUseHighContrast() ? HIGH_CONTRAST_BLUE : NILE}${text}\x1b[0m`
			: text,
	green: (text: string) =>
		shouldUseColors()
			? shouldUseHighContrast()
				? `${HIGH_CONTRAST_GREEN}${text}\x1b[0m`
				: pc.green(text)
			: text,
	red: (text: string) =>
		shouldUseColors()
			? shouldUseHighContrast()
				? `${HIGH_CONTRAST_RED}${text}\x1b[0m`
				: pc.red(text)
			: text,
};

const IBIS = "\u{131A3}";
const _EYE = "\u{13075}";
const EYE_OF_HORUS = "\u{13080}";
const ANKH = "\u{13269}";
const WAS = "\u{13040}";
const _SCROLL = "\u{1331B}";
const _FEATHER = "\u{13184}";

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

function padEndWidth(text: string, width: number): string {
	const visibleWidth = stringWidth(text);
	if (visibleWidth >= width) return text;
	return text + " ".repeat(width - visibleWidth);
}

function padStartWidth(text: string, width: number): string {
	const visibleWidth = stringWidth(text);
	if (visibleWidth >= width) return text;
	return " ".repeat(width - visibleWidth) + text;
}

export function formatHeader(text: string): string {
	const width = getTerminalWidth();
	const textWidth = stringWidth(text);
	const padding = Math.max(0, Math.floor((width - textWidth - 4) / 2));
	const line = "─".repeat(width - 2);

	if (shouldUseColors()) {
		const centeredText = padEndWidth(
			padStartWidth(text, padding + textWidth),
			width - 4,
		);
		return `
${colors.orange(`╭${line}╮`)}
${colors.orange("│")} ${colors.coral(centeredText)} ${colors.orange("│")}
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
		Math.max(stringWidth(h), ...rows.map((r) => stringWidth(r[i] ?? ""))),
	);

	const border = colWidths.map((w) => "─".repeat(w + 2));

	const headerRow = headers
		.map((h, i) => padEndWidth(h, colWidths[i]))
		.join(" │ ");
	const separator = border.join("┼");
	const dataRows = rows.map((row) =>
		row.map((cell, i) => padEndWidth(cell ?? "", colWidths[i])).join(" │ "),
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

/**
 * Truncate `text` so its visible width is at most `maxLength` characters.
 *
 * Properly handles:
 *   - Wide characters (CJK, fullwidth) — measured by `stringWidth`.
 *   - Combining marks — counted as 0 width.
 *   - ANSI escape sequences — passed through untouched and a reset
 *     (`\x1b[0m`) is appended before the ellipsis so colors don't bleed.
 *   - Emoji and other astral chars — single grapheme width.
 *
 * `maxLength` defaults to `terminalWidth - 4`, matching the previous behavior.
 */
export function truncate(text: string, maxLength?: number): string {
	const limit = maxLength ?? getTerminalWidth() - 4;
	if (stringWidth(text) <= limit) return text;
	return `${sliceAnsi(text, Math.max(0, limit - 1))}…\x1b[0m`;
}

/**
 * Cut a string at a given visible-column limit, preserving ANSI escape
 * sequences intact. Trailing color codes get a reset appended.
 */
function sliceAnsi(text: string, limit: number): string {
	let visible = 0;
	let out = "";
	let lastEscapeEnd = 0;
	let i = 0;

	while (i < text.length) {
		if (text[i] === "\x1b") {
			const start = i;
			i++;
			while (i < text.length && !/[a-zA-Z]/.test(text[i])) i++;
			if (i < text.length) i++; // include terminator
			out += text.slice(start, i);
			lastEscapeEnd = out.length;
			continue;
		}

		// Read one full code point (handles surrogate pairs). stringWidth
		// returns 0 for a lone surrogate but 1+ for a complete grapheme,
		// so we MUST check the whole code point at once.
		const code = text.codePointAt(i);
		if (code === undefined) break;
		const ch = String.fromCodePoint(code);
		const codeUnits = ch.length; // 1 for BMP, 2 for surrogate pair
		const w = stringWidth(ch);
		if (visible + w > limit) {
			// Trim back to last escape boundary and append reset so the
			// caller's appended "…" doesn't inherit a color.
			if (lastEscapeEnd < out.length) {
				out = `${out.slice(0, lastEscapeEnd)}\x1b[0m`;
			}
			return out;
		}
		visible += w;
		out += ch;
		i += codeUnits;
	}
	return out;
}

function parseContentBlocks(
	content: string,
): Array<{ type: "text" | "reasoning"; content: string }> {
	const blocks: Array<{ type: "text" | "reasoning"; content: string }> = [];
	const regex = /<(think|thinking|reasoning)>([\s\S]*?)(?:<\/\1>|$)/g;

	let lastIndex = 0;
	let match: RegExpExecArray | null;

	while ((match = regex.exec(content)) !== null) {
		if (match.index > lastIndex) {
			blocks.push({
				type: "text",
				content: content.slice(lastIndex, match.index),
			});
		}

		blocks.push({ type: "reasoning", content: match[2] });
		lastIndex = regex.lastIndex;
	}

	if (lastIndex < content.length) {
		blocks.push({ type: "text", content: content.slice(lastIndex) });
	}

	return blocks;
}

function computeMarkdownLines(text: string, width: number): number {
	const rendered = renderMarkdownToAnsi(text);
	return wrap(rendered, width).split("\n").length;
}

function computeToolHeight(
	result: any,
	contentMaxWidth: number,
	isExpanded = false,
): number {
	let output: string;
	if (typeof result === "string") {
		output = result;
	} else if (
		typeof result === "object" &&
		result !== null &&
		"output" in result
	) {
		output = String((result as Record<string, unknown>).output);
	} else if (
		result &&
		typeof result === "object" &&
		("preview" in result || "full" in result)
	) {
		output = String(
			(result as { full?: unknown; preview?: unknown }).full ||
				(result as { full?: unknown; preview?: unknown }).preview ||
				JSON.stringify(result),
		);
	} else {
		output = JSON.stringify(result, null, 2);
	}

	if (output.length > 8000) {
		output = `${output.slice(0, 8000)}\n... [truncated]`;
	}

	const lines = output.split("\n").filter(Boolean);
	let wrappedLines = 0;
	for (const line of lines) {
		wrappedLines += wrap(line, contentMaxWidth - 4).split("\n").length;
	}
	const previewLines = isExpanded ? wrappedLines : Math.min(12, wrappedLines);
	// 2 lines borders + 1 line header + 2 lines marginY + previewLines + 1 line footer + 1 line marginBottom
	return 2 + 1 + 2 + previewLines + 1 + 1;
}

let lineCache = new WeakMap<any, number>();

if (typeof process !== "undefined" && process.stdout && process.stdout.on) {
	process.stdout.on("resize", () => {
		lineCache = new WeakMap<any, number>();
	});
}

export function computeMessageLines(msg: any, contentMaxWidth: number): number {
	if (lineCache.has(msg)) {
		return lineCache.get(msg)!;
	}

	let lines = 0;
	lines += 1; // Role header

	const blocks =
		msg.blocks && msg.blocks.length > 0
			? msg.blocks
			: Array.isArray(msg.content)
				? msg.content
				: typeof msg.content === "string"
					? parseContentBlocks(msg.content)
					: [];

	if (blocks && blocks.length > 0) {
		blocks.forEach((block: any) => {
			// Infer block type from shape when `.type` is missing. This
			// handles array-shaped msg.content that uses {text, ...} or
			// {content, ...} fragments rather than the canonical {type, content}.
			const blockType =
				block.type ||
				(block.text !== undefined || block.text !== undefined
					? "text"
					: undefined);

			if (blockType === "text") {
				let textContent = "";
				if (Array.isArray(block.content)) {
					textContent = block.content
						.map(
							(c: any) =>
								c.text || (typeof c === "string" ? c : JSON.stringify(c)),
						)
						.join("");
				} else if (typeof block.content === "string") {
					textContent = block.content;
				} else if (typeof block.text === "string") {
					textContent = block.text;
				} else {
					textContent = String(block.content || block.text || "");
				}
				lines += computeMarkdownLines(textContent, contentMaxWidth - 1); // -1 for paddingLeft
			} else if (blockType === "reasoning") {
				lines += 2; // Borders
				let reasoningContent = "";
				if (Array.isArray(block.content)) {
					reasoningContent = block.content
						.map(
							(c: any) =>
								c.text || (typeof c === "string" ? c : JSON.stringify(c)),
						)
						.join("");
				} else if (typeof block.content === "string") {
					reasoningContent = block.content;
				} else if (typeof block.text === "string") {
					reasoningContent = block.text;
				} else {
					reasoningContent = String(block.content || block.text || "");
				}
				lines += wrap(
					reasoningContent,
					Math.max(10, contentMaxWidth - 5),
				).split("\n").length;
			} else if (block.type === "tool") {
				lines += computeToolHeight(
					block.result,
					contentMaxWidth,
					block.isExpanded,
				);
			}
		});
	} else if (typeof msg.content === "string") {
		lines += computeMarkdownLines(msg.content, contentMaxWidth - 1);
	}

	if (msg.toolCalls && msg.toolCalls.length > 0) {
		const hasToolBlock = blocks?.some((b: any) => b.type === "tool");
		if (!hasToolBlock) {
			msg.toolCalls.forEach((tc: any) => {
				lines += computeToolHeight(tc.result, contentMaxWidth, tc.isExpanded);
			});
		}
	}

	lines += 1; // Margin bottom between messages
	lineCache.set(msg, lines);
	return lines;
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
		let currentStripped = "";
		const _inEscape = false;

		const words = splitIntoWords(textLine);

		for (const word of words) {
			const wordStripped = stripAnsi(word);
			const wordWidth = stringWidth(wordStripped);
			const currentWidth = stringWidth(currentStripped);

			if (currentWidth + wordWidth <= w) {
				currentLine += word;
				currentStripped += wordStripped;
			} else {
				if (wordStripped.trim() === "") {
					// Drop whitespace that would otherwise start a new line
					continue;
				}
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

function wrapLongWord(
	word: string,
	_stripped: string,
	width: number,
): string[] {
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

const ANSI_REGEX_GLOBAL = new RegExp(
	[
		"[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)",
		"(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))",
	].join("|"),
	"g",
);

function stripAnsi(str: string): string {
	return str.replace(ANSI_REGEX_GLOBAL, "");
}

export { colors, pc, symbols };
