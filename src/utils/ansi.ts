/**
 * Shared ANSI escape sequence utilities.
 * Extracted from ExpandableToolOutput.tsx and SwarmVisualizer.tsx
 * to eliminate code duplication.
 */

// biome-ignore lint/complexity/useRegexLiterals: literals with ESC bytes trigger noControlCharactersInRegex.
export const ANSI_SEQUENCE_REGEX = new RegExp("^\\x1b\\[[0-9;]*[a-zA-Z]");
// biome-ignore lint/complexity/useRegexLiterals: literals with ESC bytes trigger noControlCharactersInRegex.
export const ANSI_STRIP_REGEX = new RegExp(
	"[\\x1b\\x9b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]",
	"g",
);

export function stripAnsi(str: string): string {
	return str.replace(ANSI_STRIP_REGEX, "");
}

export function sliceAnsi(str: string, limit: number): string {
	let visibleWidth = 0;
	let output = "";
	let i = 0;

	while (i < str.length) {
		const remaining = str.slice(i);
		const match = remaining.match(ANSI_SEQUENCE_REGEX);
		if (match) {
			output += match[0];
			i += match[0].length;
		} else {
			const codePoint = str.codePointAt(i);
			if (codePoint === undefined) break;
			const charWidth = codePoint > 0xffff ? 2 : 1;
			if (visibleWidth + charWidth > limit) {
				break;
			}
			output += String.fromCodePoint(codePoint);
			visibleWidth += charWidth;
			i += codePoint > 0xffff ? 2 : 1;
			}
		}
		if (i < str.length) {
						output += "\x1b[0m";
		}
	return output;
}
