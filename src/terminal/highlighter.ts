import { createHighlighter, type Highlighter } from "shiki";
import { bundledLanguages, type BundledLanguage } from "shiki/langs";
import { shouldUseColors } from "./capabilities.js";

let highlighterInstance: Highlighter | null = null;
let highlighterPromise: Promise<Highlighter> | null = null;

const THEME = "github-dark";

function hexToAnsi(hex: string): string {
	const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
	if (!result) return "";
	const r = Number.parseInt(result[1], 16);
	const g = Number.parseInt(result[2], 16);
	const b = Number.parseInt(result[3], 16);
	return `\x1b[38;2;${r};${g};${b}m`;
}

const ANSI_RESET = "\x1b[0m";
const ANSI_BOLD = "\x1b[1m";
const ANSI_ITALIC = "\x1b[3m";
const ANSI_UNDERLINE = "\x1b[4m";

export async function initHighlighter(): Promise<Highlighter> {
	if (highlighterInstance) return highlighterInstance;
	if (highlighterPromise) return highlighterPromise;

	highlighterPromise = createHighlighter({
		themes: [THEME],
		langs: Object.keys(bundledLanguages),
	}).then((h) => {
		highlighterInstance = h;
		return h;
	});

	return highlighterPromise;
}

export function getHighlighter(): Highlighter | null {
	return highlighterInstance;
}

export function isHighlighterReady(): boolean {
	return highlighterInstance !== null;
}

export function highlightToAnsi(code: string, language?: string): string {
	if (!shouldUseColors() || !highlighterInstance) {
		return code;
	}

	const lang = (language && language in bundledLanguages ? language : "text") as BundledLanguage;

	try {
		const { tokens } = highlighterInstance.codeToTokens(code, {
			lang,
			theme: THEME,
		});

		const result: string[] = [];

		for (const line of tokens) {
			for (const token of line) {
				const styled = token.content;
				let prefix = "";
				let suffix = "";

				if (token.color) {
					prefix = hexToAnsi(token.color);
					suffix = ANSI_RESET;
				}

				if (token.fontStyle) {
					const styles: string[] = [];
					if (token.fontStyle & 1) styles.push(ANSI_BOLD);
					if (token.fontStyle & 2) styles.push(ANSI_ITALIC);
					if (token.fontStyle & 4) styles.push(ANSI_UNDERLINE);
					if (styles.length > 0) {
						prefix = styles.join("") + prefix;
						suffix = ANSI_RESET + suffix;
					}
				}

				result.push(prefix + styled + suffix);
			}
			result.push("\n");
		}

		return result.join("").slice(0, -1);
	} catch {
		return code;
	}
}
