import isCI from "is-ci";
import isInteractive from "is-interactive";
import isUnicodeSupported from "is-unicode-supported";
import supportsColor from "supports-color";
import supportsHyperlinks from "supports-hyperlinks";
import terminalSize from "terminal-size";

export interface TerminalCapabilities {
	colors: {
		supported: boolean;
		level: number;
		hasBasic: boolean;
		has256: boolean;
		has16m: boolean;
	};
	unicode: boolean;
	hyperlinks: boolean;
	interactive: boolean;
	ci: boolean;
	size: {
		columns: number;
		rows: number;
	};
	tty: boolean;
	windows: boolean;
}

export function detectTerminalCapabilities(): TerminalCapabilities {
	const colorSupport = supportsColor.stdout;
	const size = terminalSize();
	const unicode = isUnicodeSupported();

	return {
		colors: {
			supported: !!colorSupport,
			level:
				typeof colorSupport === "object" && colorSupport !== null
					? colorSupport.level
					: 0,
			hasBasic:
				typeof colorSupport === "object" && colorSupport !== null
					? (colorSupport.hasBasic ?? false)
					: false,
			has256:
				typeof colorSupport === "object" && colorSupport !== null
					? (colorSupport.has256 ?? false)
					: false,
			has16m:
				typeof colorSupport === "object" && colorSupport !== null
					? (colorSupport.has16m ?? false)
					: false,
		},
		unicode,
		hyperlinks: supportsHyperlinks.stdout,
		interactive: isInteractive(),
		ci: isCI,
		size,
		tty: process.stdout.isTTY ?? false,
		windows: process.platform === "win32",
	};
}

let cachedCapabilities: TerminalCapabilities | null = null;

export function getCapabilities(): TerminalCapabilities {
	if (!cachedCapabilities) {
		cachedCapabilities = detectTerminalCapabilities();
	}
	return cachedCapabilities;
}

export function refreshCapabilities(): void {
	cachedCapabilities = detectTerminalCapabilities();
}

export function shouldUseColors(): boolean {
	const caps = getCapabilities();
	return caps.colors.supported && !caps.ci;
}

export function shouldUseUnicode(): boolean {
	return getCapabilities().unicode;
}

export function shouldUseHyperlinks(): boolean {
	return getCapabilities().hyperlinks;
}

export function shouldUseInteractive(): boolean {
	return getCapabilities().interactive && !getCapabilities().ci;
}

export function getTerminalWidth(): number {
	return getCapabilities().size.columns || 80;
}

export function getTerminalHeight(): number {
	return getCapabilities().size.rows || 24;
}
