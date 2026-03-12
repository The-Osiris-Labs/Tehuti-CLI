import type { Token } from "marked";
import { marked } from "marked";
import { shouldUseColors, shouldUseHighContrast } from "./capabilities.js";
import { highlightToAnsi, isHighlighterReady, initHighlighter } from "./highlighter.js";

const ANSI = {
	reset: "\x1b[0m",
	bold: "\x1b[1m",
	dim: "\x1b[2m",
	italic: "\x1b[3m",
	underline: "\x1b[4m",
	blink: "\x1b[5m",
	inverse: "\x1b[7m",
	hidden: "\x1b[8m",
	strikethrough: "\x1b[9m",

	black: "\x1b[30m",
	red: "\x1b[31m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	blue: "\x1b[34m",
	magenta: "\x1b[35m",
	cyan: "\x1b[36m",
	white: "\x1b[37m",

	brightBlack: "\x1b[90m",
	brightRed: "\x1b[91m",
	brightGreen: "\x1b[92m",
	brightYellow: "\x1b[93m",
	brightBlue: "\x1b[94m",
	brightMagenta: "\x1b[95m",
	brightCyan: "\x1b[96m",
	brightWhite: "\x1b[97m",

	// High contrast colors (WCAG AA/AAA compliant)
	highContrastGold: "\x1b[38;5;220m", // Bright yellow/gold (WCAG AAA)
	highContrastCoral: "\x1b[38;5;202m", // Vibrant orange (high contrast)
	highContrastSand: "\x1b[38;5;130m", // Dark brown (high contrast)
	highContrastBlue: "\x1b[38;5;33m", // Bright blue (high contrast)
	highContrastGreen: "\x1b[38;5;34m", // Bright green (high contrast)
	highContrastRed: "\x1b[38;5;196m", // Bright red (high contrast)
	
	// Default colors (improved contrast)
	defaultGold: "\x1b[38;5;220m", // Bright gold (WCAG AA)
	defaultCoral: "\x1b[38;5;202m", // Vibrant coral (high contrast)
	defaultSand: "\x1b[38;5;130m", // Darker sand (better contrast)
	defaultNile: "\x1b[38;5;33m", // Bright blue (high contrast)
	defaultGreen: "\x1b[38;5;34m",
	defaultCyan: "\x1b[38;5;39m",
	defaultPurple: "\x1b[38;5;141m",
	defaultBlue: "\x1b[38;5;33m",
	defaultRed: "\x1b[38;5;196m",
};

function getColors() {
	if (shouldUseHighContrast()) {
		return {
			gold: ANSI.highContrastGold,
			coral: ANSI.highContrastCoral,
			sand: ANSI.highContrastSand,
			green: ANSI.highContrastGreen,
			cyan: ANSI.cyan,
			purple: ANSI.magenta,
			blue: ANSI.highContrastBlue,
			red: ANSI.highContrastRed,
		};
	}
	
	return {
		gold: ANSI.defaultGold,
		coral: ANSI.defaultCoral,
		sand: ANSI.defaultSand,
		green: ANSI.defaultGreen,
		cyan: ANSI.defaultCyan,
		purple: ANSI.defaultPurple,
		blue: ANSI.defaultBlue,
		red: ANSI.defaultRed,
	};
}

const COLORS = getColors();

function purple(text: string): string {
	return applyStyle(text, COLORS.purple);
}

function applyStyle(text: string, style: string): string {
	if (!shouldUseColors()) return text;
	return `${style}${text}${ANSI.reset}`;
}

function bold(text: string): string {
	return applyStyle(text, ANSI.bold);
}

function italic(text: string): string {
	return applyStyle(text, ANSI.italic);
}

function dim(text: string): string {
	return applyStyle(text, ANSI.dim);
}

function cyan(text: string): string {
	return applyStyle(text, ANSI.cyan);
}

function green(text: string): string {
	return applyStyle(text, COLORS.green);
}

function gold(text: string): string {
	return applyStyle(text, COLORS.gold);
}

function coral(text: string): string {
	return applyStyle(text, COLORS.coral);
}

function blue(text: string): string {
	return applyStyle(text, COLORS.blue);
}

function strikethrough(text: string): string {
	return applyStyle(text, ANSI.strikethrough);
}

function code(text: string): string {
	return applyStyle(text, ANSI.cyan);
}

function highlightCode(code: string, language?: string): string {
	if (!shouldUseColors()) return code;
	return highlightToAnsi(code, language);
}

function highlightJavaScript(line: string): string {
	// Keywords
	let result = line
		.replace(/\b(function|const|let|var|if|else|for|while|do|switch|case|break|continue|return|import|export|from|as|class|extends|super|new|this|typeof|instanceof|in|delete|void|throw|try|catch|finally|null|undefined|true|false|async|await|yield|let|const)\b/g, (match) => gold(match))
		// Strings
		.replace(/"([^"\\]|\\.)*"/g, (match) => green(match))
		.replace(/'([^'\\]|\\.)*'/g, (match) => green(match))
		// Comments
		.replace(/\/\/.*/g, (match) => dim(match))
		// Numbers
		.replace(/\b\d+(\.\d+)?\b/g, (match) => cyan(match))
		// Functions
		.replace(/\b[a-zA-Z_][a-zA-Z0-9_]*\(/g, (match) => blue(match.slice(0, -1)) + "(")
		// Regex
		.replace(/\/([^\/\\]|\\.)*\/[gimuy]*/g, (match) => purple(match));

	return result;
}

function highlightTypeScript(line: string): string {
	return highlightJavaScript(line);
}

function highlightPython(line: string): string {
	return line
		// Keywords
		.replace(/\b(and|as|assert|break|class|continue|def|del|elif|else|except|False|finally|for|from|global|if|import|in|is|lambda|None|nonlocal|not|or|pass|raise|return|True|try|while|with|yield|async|await)\b/g, (match) => gold(match))
		// Strings
		.replace(/"([^"\\]|\\.)*"/g, (match) => green(match))
		.replace(/'([^'\\]|\\.)*'/g, (match) => green(match))
		.replace(/'''[\s\S]*?'''/g, (match) => green(match))
		.replace(/"""[\s\S]*?"""/g, (match) => green(match))
		// Comments
		.replace(/#.*/g, (match) => dim(match))
		// Numbers
		.replace(/\b\d+(\.\d+)?\b/g, (match) => cyan(match))
		// Functions
		.replace(/\bdef\s+([a-zA-Z_][a-zA-Z0-9_]*)/g, (match) => gold("def") + " " + blue(match.slice(4)));
}

function highlightHTML(line: string): string {
	return line
		// Tags
		.replace(/<(\/?)([a-zA-Z0-9_:]+)/g, (match, close, tag) => gold(`<${close}${tag}`))
		// Attributes
		.replace(/(\w+)=("([^"]*)"|'([^']*)')/g, (match, attr, value) => cyan(attr) + "=" + green(value))
		// Comments
		.replace(/<!--.*?-->/g, (match) => dim(match));
}

function highlightCSS(line: string): string {
	return line
		// Selectors
		.replace(/([#.]?[a-zA-Z_][a-zA-Z0-9_:-]*)(?=[\s{])/g, (match) => blue(match))
		// Properties
		.replace(/([a-zA-Z-]+)(?=\s*:)/g, (match) => cyan(match))
		// Values
		.replace(/:[^;}]+/g, (match) => green(match))
		// Comments
		.replace(/\/\*.*?\*\//g, (match) => dim(match));
}

function highlightJSON(line: string): string {
	return line
		// Keys
		.replace(/"([^"\\]|\\.)*"(?=\s*:)/g, (match) => blue(match))
		// Strings
		.replace(/"([^"\\]|\\.)*"(?![\s:])/g, (match) => green(match))
		// Numbers
		.replace(/\b\d+(\.\d+)?\b/g, (match) => cyan(match))
		// Booleans
		.replace(/\b(true|false)\b/g, (match) => gold(match))
		// Null
		.replace(/\b(null)\b/g, (match) => purple(match));
}

function highlightBash(line: string): string {
	return line
		// Keywords
		.replace(/\b(if|then|else|elif|fi|for|in|do|done|while|until|case|esac|function)\b/g, (match) => gold(match))
		// Variables
		.replace(/\$[a-zA-Z_][a-zA-Z0-9_]*/g, (match) => blue(match))
		// Strings
		.replace(/"([^"\\]|\\.)*"/g, (match) => green(match))
		.replace(/'([^'\\]|\\.)*'/g, (match) => green(match))
		// Comments
		.replace(/#.*/g, (match) => dim(match))
		// Commands
		.replace(/\b(ls|cd|pwd|cp|mv|rm|mkdir|rmdir|cat|grep|find|xargs|awk|sed|sort|uniq|cut|tr|head|tail|less|more|ps|top|kill|echo|printf|test|expr|bc|date|time|which|whereis|whoami|id|uname|hostname|df|du|mount|umount|ping|traceroute|nslookup|dig|curl|wget|ssh|scp|ftp|telnet)\b/g, (match) => purple(match));
}

function codeBlock(code: string, language?: string): string {
	const highlighted = highlightCode(code, language);
	const lines = highlighted.split("\n");
	const lineNumWidth = Math.max(2, String(lines.length).length);

	const formatted = lines
		.map((line, i) => {
			const lineNum = String(i + 1).padStart(lineNumWidth);
			return `${dim(lineNum)} │ ${line}`;
		})
		.join("\n");

	return `\n${formatted}\n`;
}

function renderInlineTokens(tokens: Token[]): string {
	let result = "";

	for (const token of tokens) {
		switch (token.type) {
			case "text":
				result += token.text;
				break;
			case "strong":
				result += bold(renderInlineTokens(token.tokens || []));
				break;
			case "em":
				result += italic(renderInlineTokens(token.tokens || []));
				break;
			case "codespan":
				result += code(token.text);
				break;
			case "del":
				result += strikethrough(renderInlineTokens(token.tokens || []));
				break;
			case "link":
				result += blue(
					ANSI.underline + renderInlineTokens(token.tokens || []) + ANSI.reset,
				);
				break;
			case "br":
				result += "\n";
				break;
			case "escape":
				result += token.text;
				break;
			default:
				if ("text" in token && typeof token.text === "string") {
					result += token.text;
				} else if ("tokens" in token && Array.isArray(token.tokens)) {
					result += renderInlineTokens(token.tokens);
				}
		}
	}

	return result;
}

function renderToken(token: Token, indent: string = ""): string {
	switch (token.type) {
		case "paragraph":
			return `\n${indent}${renderInlineTokens(token.tokens || [])}\n`;

		case "heading": {
			const level = token.depth;
			const text = renderInlineTokens(token.tokens || []);
			const prefix = "=".repeat(Math.max(1, 7 - level));

			if (level === 1) {
				return `\n${gold(bold(text))}\n${dim(prefix.repeat(text.length))}\n`;
			} else if (level === 2) {
				return `\n${coral(bold(text))}\n${dim(prefix.repeat(text.length))}\n`;
			} else {
				return `\n${bold(text)}\n`;
			}
		}

		case "code":
			return `\n${dim("┌─ " + (token.lang || "code"))}${codeBlock(token.text, token.lang)}${dim("└─")}\n`;

		case "list": {
			const items = token.items || [];
			const bullet = token.ordered ? (i: number) => `${i + 1}.` : () => "•";

			let result = "\n";
			for (let i = 0; i < items.length; i++) {
				const item = items[i];
				const bulletStr = coral(bullet(i));
				const itemText = renderInlineTokens(item.tokens || []);
				result += `${indent}  ${bulletStr} ${itemText}\n`;
			}
			return result;
		}

		case "blockquote":
			return `\n${dim("│")} ${italic(renderInlineTokens(token.tokens || []))}\n`;

		case "hr":
			return `\n${dim("─".repeat(50))}\n`;

		case "space":
			return "\n";

		case "html":
			return `\n${token.text}\n`;

		case "table": {
			const header = token.header || [];
			const rows = token.rows || [];

			const widths: number[] = header.map((h: Token, i: number) => {
				const headerLen =
					"text" in h && typeof h.text === "string" ? h.text.length : 0;
				const rowLens = rows.map((r: Token[]) => {
					const cell = r[i];
					return cell && "text" in cell && typeof cell.text === "string"
						? cell.text.length
						: 0;
				});
				return Math.max(headerLen, ...rowLens);
			});

			const border: string[] = widths.map((w: number) => "─".repeat(w + 2));

			let result = "\n";
			result += `┌${border.join("┬")}┐\n`;

			const headerCells: string[] = header.map((h: Token, i: number) => {
				const text = "text" in h && typeof h.text === "string" ? h.text : "";
				const width = widths[i];
				return `│ ${bold(text.padEnd(width))} `;
			});
			result += headerCells.join("") + "│\n";

			result += `├${border.join("┼")}┤\n`;

			for (const row of rows) {
				const cells: string[] = row.map((cell: Token, i: number) => {
					const text =
						cell && "text" in cell && typeof cell.text === "string"
							? cell.text
							: "";
					const width = widths[i];
					return `│ ${text.padEnd(width)} `;
				});
				result += cells.join("") + "│\n";
			}

			result += `└${border.join("┴")}┘\n`;
			return result;
		}

		default:
			if ("text" in token && typeof token.text === "string") {
				return token.text;
			}
			if ("tokens" in token && Array.isArray(token.tokens)) {
				return renderInlineTokens(token.tokens);
			}
			return "";
	}
}

export function renderMarkdownToAnsi(markdown: string): string {
	try {
		const tokens = marked.lexer(markdown);
		let result = "";

		for (const token of tokens) {
			result += renderToken(token);
		}

		return result.trim();
	} catch {
		return markdown;
	}
}

export function renderInlineMarkdownToAnsi(markdown: string): string {
	try {
		const tokens = marked.lexer(markdown);
		const inlineTokens: Token[] = [];

		for (const token of tokens) {
			if (token.type === "paragraph" && token.tokens) {
				inlineTokens.push(...token.tokens);
			}
		}

		return renderInlineTokens(inlineTokens);
	} catch {
		return markdown;
	}
}

export function formatDiff(diffOutput: string, _filename?: string): string {
	const lines = diffOutput.split("\n");
	const formatted = lines
		.map((line) => {
			if (
				line.startsWith("+") &&
				!line.startsWith("+++") &&
				!line.startsWith("+@@")
			) {
				return green(line);
			} else if (
				line.startsWith("-") &&
				!line.startsWith("---") &&
				!line.startsWith("-@@")
			) {
				return `\x1b[31m${line}\x1b[0m`;
			} else if (line.startsWith("@@")) {
				return cyan(line);
			} else if (line.startsWith("diff --git") || line.startsWith("index ")) {
				return dim(line);
			} else if (line.startsWith("+++") || line.startsWith("---")) {
				return bold(line);
			}
			return line;
		})
		.join("\n");

	return formatted;
}

export {
	bold,
	italic,
	dim,
	cyan,
	green,
	gold,
	coral,
	blue,
	code,
	strikethrough,
	ANSI,
	COLORS,
};
