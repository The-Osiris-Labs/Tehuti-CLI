import isCI from "is-ci";
import isInteractive from "is-interactive";
import isUnicodeSupported from "is-unicode-supported";
import supportsColor from "supports-color";
import supportsHyperlinks from "supports-hyperlinks";
import terminalSize from "terminal-size";

/**
 * Detects graphics protocol support (Sixel, Kitty, iTerm2 inline images).
 * Detection rules mirror chafa/terminal-image heuristics so the agent and
 * tools can reliably decide whether inline image rendering will work.
 */
function detectGraphicsProtocols(): {
	sixel: boolean;
	kitty: boolean;
	iterm: boolean;
} {
	const term = (process.env.TERM ?? "").toLowerCase();
	const termProgram = (process.env.TERM_PROGRAM ?? "").toLowerCase();
	const colorTerm = (process.env.COLORTERM ?? "").toLowerCase();

	// iTerm2: dedicated env vars or binary identifier
	const iterm =
		termProgram === "iterm.app" ||
		(process.env.TERM_PROGRAM_VERSION !== undefined &&
			termProgram.includes("iterm")) ||
		process.env.ITERM_SESSION_ID !== undefined ||
		process.env.ITERM_PROFILE !== undefined;

	// Kitty: dedicated env vars and terminal name
	const kitty =
		term === "xterm-kitty" ||
		process.env.KITTY_WINDOW_ID !== undefined ||
		process.env.KITTY_PID !== undefined ||
		termProgram === "kitty" ||
		termProgram === "kitty-terminal";

	// Sixel: advertised via terminfo, terminal name, or known-good emulators
	// with TrueColor + TTY (covers Ghostty, WezTerm, foot, mlterm, etc.)
	const sixel =
		term.includes("sixel") ||
		termProgram === "ghostty" ||
		termProgram === "wezterm" ||
		termProgram === "mlterm" ||
		termProgram === "foot" ||
		termProgram === "alacritty" ||
		process.env.SIXEL_SUPPORT !== undefined ||
		((colorTerm === "truecolor" || colorTerm === "24bit") &&
			process.stdout.isTTY === true);

	return { sixel, kitty, iterm };
}

/**
 * Resolves a stable, human-readable identifier for the host terminal emulator.
 */
function detectTerminalEmulator(): string {
	const tp = process.env.TERM_PROGRAM ?? "";
	if (tp) return tp;
	const term = process.env.TERM ?? "";
	if (term === "xterm-ghostty" || term.includes("ghostty")) return "Ghostty";
	if (term === "xterm-kitty" || term.includes("kitty")) return "Kitty";
	if (term.includes("iterm")) return "iTerm2";
	if (term.includes("alacritty")) return "Alacritty";
	if (term.includes("wezterm")) return "WezTerm";
	if (term.includes("vscode")) return "VS Code";
	if (term === "linux") return "Linux Console";
	return term || "unknown";
}

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
	graphics: {
		sixel: boolean;
		kitty: boolean;
		iterm: boolean;
		anySupported: boolean;
	};
	emulator: string;
	interactive: boolean;
	ci: boolean;
	size: {
		columns: number;
		rows: number;
	};
	tty: boolean;
	windows: boolean;
	shell: string;
	lang: string;
	colorterm: string;
}

export function detectTerminalCapabilities(): TerminalCapabilities {
	const colorSupport = supportsColor.stdout;
	const size = terminalSize();
	const unicode = isUnicodeSupported();
	const graphics = detectGraphicsProtocols();

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
		graphics: {
			...graphics,
			anySupported: graphics.sixel || graphics.kitty || graphics.iterm,
		},
		emulator: detectTerminalEmulator(),
		interactive: isInteractive(),
		ci: isCI,
		size,
		tty: process.stdout.isTTY ?? false,
		windows: process.platform === "win32",
		shell: process.env.SHELL ?? "unknown",
		lang: process.env.LANG ?? "unknown",
		colorterm: process.env.COLORTERM ?? "",
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

/**
 * Returns the best graphics protocol available, or null if none.
 * Order: Kitty > iTerm2 > Sixel (Kitty is highest fidelity, Sixel most compatible).
 */
export function detectBestGraphicsProtocol(): "kitty" | "iterm" | "sixel" | null {
	const g = getCapabilities().graphics;
	if (g.kitty) return "kitty";
	if (g.iterm) return "iterm";
	if (g.sixel) return "sixel";
	return null;
}

export function shouldUseInteractive(): boolean {
	return getCapabilities().interactive && !getCapabilities().ci;
}

export function shouldUseHighContrast(): boolean {
	// Check for accessibility settings in environment variables
	return (
		!!process.env.FORCE_HIGH_CONTRAST ||
		!!process.env.HIGH_CONTRAST ||
		process.env.COLORTERM === "highcontrast" ||
		process.env.TERM === "linux" || // Linux console has limited colors
		(!getCapabilities().colors.has256 && !getCapabilities().colors.has16m)
	);
}

export function getTerminalWidth(): number {
	return getCapabilities().size.columns || 80;
}

export function getTerminalHeight(): number {
	return getCapabilities().size.rows || 24;
}
