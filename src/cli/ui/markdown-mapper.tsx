import { Box, Text } from "ink";
import type { Token } from "marked";
import { marked } from "marked";
import markedKatex from "marked-katex-extension";
import React from "react";
import stringWidth from "string-width";
import { BRANDING } from "../../branding/index.js";

/**
 * Wrap `text` to a target visual width, breaking on whitespace when possible.
 * Preserves explicit \n boundaries. If a single token is wider than `width`,
 * it is hard-broken at the width boundary.
 */
function wrapText(text: string, width: number): string {
	if (width <= 0) return text;
	const out: string[] = [];
	for (const paragraph of text.split("\n")) {
		if (paragraph.length === 0) {
			out.push("");
			continue;
		}
		const words = paragraph.split(/(\s+)/);
		let line = "";
		let lineWidth = 0;
		for (const word of words) {
			if (word === "") continue;
			const wordWidth = stringWidth(word);
			if (lineWidth + wordWidth <= width) {
				line += word;
				lineWidth += wordWidth;
			} else if (lineWidth === 0) {
				// Word longer than width: hard-break it.
				let remaining = word;
				while (stringWidth(remaining) > width) {
					out.push(remaining.slice(0, Math.max(1, width)));
					remaining = remaining.slice(Math.max(1, width));
				}
				line = remaining;
				lineWidth = stringWidth(remaining);
			} else {
				out.push(line);
				line = word.trimStart();
				lineWidth = stringWidth(line);
			}
		}
		if (line) out.push(line);
	}
	return out.join("\n");
}

import {
	highlightToAnsi,
	isHighlighterReady,
} from "../../terminal/highlighter.js";
import { renderMarkdownToAnsi } from "../../terminal/markdown.js";
import { MediaViewer } from "./components/MediaViewer.js";

marked.use(markedKatex({ throwOnError: false }));

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
					borderColor: GOLD,
					width: codeWidth,
				},
				React.createElement(Text, { color: CORAL, bold: true }, `◆ ${lang}`),
				React.createElement(Text, { wrap: "wrap" }, formattedCode),
			);
		}

		case "heading": {
			const level = token.depth;
			const color = level === 1 ? GOLD : level === 2 ? CORAL : GREEN;
			const prefix = "=".repeat(Math.max(1, 7 - level));

			let heading;
			if (token.tokens && token.tokens.length > 0) {
				const inlineElements = renderInlineTokens(token.tokens, getKey);
				heading = React.createElement(
					Text,
					{ key: getKey(), bold: true, color, wrap: "wrap" },
					...inlineElements,
				);
			} else {
				heading = React.createElement(
					Text,
					{ key: getKey(), bold: true, color, wrap: "wrap" },
					token.text,
				);
			}

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
			if (token.tokens && token.tokens.length > 0) {
				const inlineElements = renderInlineTokens(token.tokens, getKey);
				return React.createElement(
					Text,
					{ key: getKey(), wrap: "wrap" },
					...inlineElements,
				);
			}
			return React.createElement(
				Text,
				{ key: getKey(), wrap: "wrap" },
				token.text,
			);
		}

		case "list": {
			const items: React.ReactNode[] = [];
			for (let i = 0; i < token.items.length; i++) {
				const item = token.items[i];
				const bullet = token.ordered ? `${i + 1}.` : "•";

				const innerBlocks = (item.tokens || []).map((t: Token) =>
					renderToken(t, getKey, maxWidth),
				);

				items.push(
					React.createElement(
						Box,
						{ key: getKey(), flexDirection: "row", paddingLeft: 1 },
						React.createElement(
							Box,
							{ marginRight: 1 },
							React.createElement(Text, { color: CORAL }, bullet),
						),
						React.createElement(
							Box,
							{ flexDirection: "column", flexGrow: 1, flexBasis: 0 },
							...innerBlocks,
						),
					),
				);
			}
			return React.createElement(
				Box,
				{ key: getKey(), flexDirection: "column", marginY: 0.5 },
				...items,
			);
		}

		case "blockquote": {
			const innerBlocks = (token.tokens || []).map((t: Token) =>
				renderToken(t, getKey, maxWidth),
			);
			return React.createElement(
				Box,
				{
					key: getKey(),
					paddingLeft: 1,
					borderLeft: true,
					borderStyle: "single",
					borderTop: false,
					borderBottom: false,
					borderRight: false,
					borderColor: GRAY,
					marginY: 0.5,
				},
				React.createElement(Box, { flexDirection: "column" }, ...innerBlocks),
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
			if (token.raw) {
				const ansiText = renderMarkdownToAnsi(token.raw);
				return React.createElement(
					Box,
					{ key: getKey(), flexDirection: "column", marginY: 1, paddingX: 1 },
					React.createElement(Text, { wrap: "truncate-end" }, ansiText)
				);
			}
			return null;
		}

		case "space": {
			return React.createElement(Text, { key: getKey() }, "\n");
		}

		case "text": {
			if (token.tokens && token.tokens.length > 0) {
				const inlineElements = renderInlineTokens(token.tokens, getKey);
				return React.createElement(
					Text,
					{ key: getKey(), wrap: "wrap" },
					...inlineElements,
				);
			}
			return React.createElement(
				Text,
				{ key: getKey(), wrap: "wrap" },
				token.text,
			);
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
			if (token.tokens && token.tokens.length > 0) {
				return renderInlineTokens(token.tokens, getKey);
			}
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

		case "inlineKatex": {
			return React.createElement(
				Text,
				{ key: getKey(), color: CYAN, italic: true },
				token.text || "",
			);
		}

		case "blockKatex": {
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
				React.createElement(
					Text,
					{ color: CYAN, italic: true },
					token.text || "",
				),
			);
		}

		case "html": {
			return React.createElement(
				Text,
				{ key: getKey(), wrap: "wrap" },
				token.text || "",
			);
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
