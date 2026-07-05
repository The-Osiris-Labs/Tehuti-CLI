import { Box, Text } from "ink";
import type { Token } from "marked";
import { marked } from "marked";
import React from "react";
import stringWidth from "string-width";
import { BRANDING } from "../../branding/index.js";
import {
	highlightToAnsi,
	isHighlighterReady,
} from "../../terminal/highlighter.js";
import { MediaViewer } from "./components/MediaViewer.js";

const GOLD = BRANDING.colors?.primary || "#F5C518";
const CORAL = BRANDING.colors?.accent || "#FF6B35";
const GREEN = BRANDING.colors?.green || "#22C55E";
const GRAY = BRANDING.colors?.gray || "#9CA3AF";
const CYAN = BRANDING.colors?.cyan || "#06B6D4";

function highlightSyntax(code: string, language?: string): string {
	if (isHighlighterReady()) {
		return highlightToAnsi(code, language);
	}
	return code;
}

export function renderMarkdown(
	text: string,
	maxWidth?: number,
	keyPrefix: string = "md",
): React.ReactNode[] {
	const elements: React.ReactNode[] = [];
	const tokens = marked.lexer(text);
	let keyCounter = 0;
	const getKey = () => `${keyPrefix}-${keyCounter++}`;

	for (const token of tokens) {
		const rendered = renderToken(token, getKey, maxWidth);
		if (rendered) {
			if (Array.isArray(rendered)) {
				elements.push(...rendered);
			} else {
				elements.push(rendered);
			}
		}
	}

	return elements;
}

export function renderToken(
	token: Token,
	getKey: () => string,
	maxWidth?: number,
): React.ReactNode | React.ReactNode[] | null {
	switch (token.type) {
		case "code": {
			const lang = token.lang || "text";
			const code = token.text.trim();
			const isPlain = ["text", "plain", "ascii", "none"].includes(
				lang.toLowerCase(),
			);

			if (isPlain) {
				return React.createElement(
					Box,
					{
						key: getKey(),
						flexDirection: "column",
						marginTop: 0.5,
						marginBottom: 0.5,
						paddingLeft: 0,
						paddingRight: 0,
					},
					React.createElement(Text, { wrap: "wrap" }, code),
				);
			}

			const highlighted = highlightSyntax(code, lang);
			const codeWidth = maxWidth ? Math.max(10, maxWidth - 4) : 100;

			// Render code with line numbers for consistency
			const lines = highlighted.split("\n");
			const lineNumWidth = Math.max(2, String(lines.length).length);
			const formattedCode = lines
				.map((line, i) => {
					const lineNum = String(i + 1).padStart(lineNumWidth);
					return `${lineNum} │ ${line}`;
				})
				.join("\n");

			return React.createElement(
				Box,
				{
					key: getKey(),
					flexDirection: "column",
					marginTop: 1,
					marginBottom: 1,
					paddingLeft: 1,
					paddingRight: 1,
					borderStyle: "round",
					borderColor: GRAY,
					width: codeWidth,
				},
				React.createElement(Text, { dimColor: true }, lang),
				React.createElement(
					Text,
					{ wrap: "wrap", dimColor: true },
					formattedCode,
				),
			);
		}

		case "heading": {
			const level = token.depth;
			const color = level === 1 ? GOLD : level === 2 ? CORAL : GREEN;
			const inlineElements = renderInlineTokens(token.tokens || [], getKey);
			const prefix = "=".repeat(Math.max(1, 7 - level));

			const heading = React.createElement(
				Text,
				{ key: getKey(), bold: true, color, wrap: "wrap" },
				...inlineElements,
			);

			if (level <= 2) {
				const underlineLength = maxWidth ? Math.max(10, maxWidth - 4) : 80;
				const underline = React.createElement(
					Text,
					{ key: getKey(), dimColor: true },
					prefix.repeat(Math.floor(underlineLength / prefix.length)),
				);
				return [
					heading,
					React.createElement(Text, { key: getKey() }, "\n"),
					underline,
				];
			}

			return heading;
		}

		case "paragraph": {
			const inlineElements = renderInlineTokens(token.tokens || [], getKey);
			return React.createElement(
				Text,
				{ key: getKey(), wrap: "wrap" },
				...inlineElements,
			);
		}

		case "list": {
			const items: React.ReactNode[] = [];
			for (let i = 0; i < token.items.length; i++) {
				const item = token.items[i];
				const inlineElements = renderInlineTokens(item.tokens || [], getKey);
				const bullet = token.ordered ? `${i + 1}.` : "•";
				items.push(
					React.createElement(
						Text,
						{ key: getKey(), wrap: "wrap" },
						React.createElement(Text, { color: CORAL }, `${bullet} `),
						...inlineElements,
					),
				);
			}
			return items;
		}

		case "blockquote": {
			const innerElements = renderInlineTokens(token.tokens || [], getKey);
			return React.createElement(
				Box,
				{
					key: getKey(),
					paddingLeft: 2,
					borderStyle: "single" as const,
					borderColor: GRAY,
				},
				React.createElement(
					Text,
					{ dimColor: true, italic: true, wrap: "wrap" },
					...innerElements,
				),
			);
		}

		case "hr": {
			const lineLen = maxWidth ? Math.max(10, maxWidth - 4) : 50;
			return React.createElement(
				Text,
				{ key: getKey(), dimColor: true, color: GRAY },
				"─".repeat(lineLen),
			);
		}

		case "table": {
			const header = token.header || [];
			const rows = token.rows || [];

			const widths: number[] = header.map((h: Token, i: number) => {
				const headerLen =
					"text" in h && typeof h.text === "string" ? stringWidth(h.text) : 0;
				const rowLens = rows.map((r: Token[]) => {
					const cell = r[i];
					return cell && "text" in cell && typeof cell.text === "string"
						? stringWidth(cell.text)
						: 0;
				});
				return Math.max(headerLen, ...rowLens);
			});

			const border: string[] = widths.map((w: number) => "─".repeat(w + 2));

			const padEndWidth = (text: string, width: number): string => {
				const visibleWidth = stringWidth(text);
				if (visibleWidth >= width) return text;
				return text + " ".repeat(width - visibleWidth);
			};

			let result = "\n";
			result += `┌${border.join("┬")}┐\n`;

			const headerCells: string[] = header.map((h: Token, i: number) => {
				const text = "text" in h && typeof h.text === "string" ? h.text : "";
				const width = widths[i];
				return `│ ${padEndWidth(text, width)} `;
			});
			result += `${headerCells.join("")}│\n`;

			result += `├${border.join("┼")}┤\n`;

			for (const row of rows) {
				const cells: string[] = row.map((cell: Token, i: number) => {
					const text =
						cell && "text" in cell && typeof cell.text === "string"
							? cell.text
							: "";
					const width = widths[i];
					return `│ ${padEndWidth(text, width)} `;
				});
				result += `${cells.join("")}│\n`;
			}

			result += `└${border.join("┴")}┘\n`;

			return React.createElement(Text, { key: getKey(), wrap: "wrap" }, result);
		}

		case "space": {
			return React.createElement(Text, { key: getKey() }, "\n");
		}

		default:
			return null;
	}
}

export function renderInlineTokens(
	tokens: Token[],
	getKey: () => string,
): React.ReactNode[] {
	const elements: React.ReactNode[] = [];

	for (const token of tokens) {
		const rendered = renderInlineToken(token, getKey);
		if (rendered) {
			if (Array.isArray(rendered)) {
				elements.push(...rendered);
			} else {
				elements.push(rendered);
			}
		}
	}

	return elements;
}

export function renderInlineToken(
	token: Token,
	getKey: () => string,
): React.ReactNode | React.ReactNode[] | null {
	switch (token.type) {
		case "image": {
			return React.createElement(MediaViewer, {
				key: getKey(),
				src: token.href,
				alt: token.text,
			});
		}

		case "text": {
			return token.text;
		}

		case "codespan": {
			return React.createElement(
				Text,
				{ key: getKey(), color: CYAN, backgroundColor: "#1e293b" },
				` ${token.text} `,
			);
		}

		case "strong": {
			const inner = renderInlineTokens(token.tokens || [], getKey);
			return React.createElement(Text, { key: getKey(), bold: true }, ...inner);
		}

		case "em": {
			const inner = renderInlineTokens(token.tokens || [], getKey);
			return React.createElement(
				Text,
				{ key: getKey(), italic: true },
				...inner,
			);
		}

		case "link": {
			const inner = renderInlineTokens(token.tokens || [], getKey);
			return React.createElement(
				Text,
				{ key: getKey(), color: CYAN, underline: true },
				...inner,
			);
		}

		case "br": {
			return React.createElement(Text, { key: getKey() }, "\n");
		}

		case "del": {
			const inner = renderInlineTokens(token.tokens || [], getKey);
			return React.createElement(
				Text,
				{ key: getKey(), strikethrough: true },
				...inner,
			);
		}

		case "escape": {
			return token.text;
		}

		default:
			if ("text" in token && typeof token.text === "string") {
				return token.text;
			}
			if ("tokens" in token && Array.isArray(token.tokens)) {
				return renderInlineTokens(token.tokens, getKey);
			}
			return null;
	}
}
