/**
 * Accessibility utilities for the Tehuti TUI.
 *
 * Opt-in features — none change behaviour unless the corresponding
 * environment variable is set.
 */

// ── Reduced Motion ──────────────────────────────────────────────────────────

/**
 * Check whether the user has requested reduced motion.
 *
 * Honours two env vars so the feature works for users of different
 * accessibility tooling:
 *   - `TEHUTI_REDUCE_MOTION=1`  (Tehuti-specific)
 *   - `NO_ANIMATION=1`          (community convention)
 */
export function respectReducedMotion(): boolean {
	return (
		process.env.TEHUTI_REDUCE_MOTION === "1" ||
		process.env.NO_ANIMATION === "1"
	);
}

// ── Contrast Ratio ──────────────────────────────────────────────────────────

/** Parse a hex colour like `#F5C518` or `#fff` into [r, g, b] (0–255). */
function parseHex(hex: string): [number, number, number] {
	const h = hex.replace("#", "");
	const full =
		h.length === 3
			? h
					.split("")
					.map((c) => c + c)
					.join("")
			: h;
	const n = parseInt(full, 16);
	return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/**
 * Compute the relative luminance of an sRGB colour.
 *
 * Uses the WCAG 2.1 definition:
 *   L = 0.2126·R' + 0.7152·G' + 0.0722·B'
 *
 * where each channel is linearised from the 0–255 sRGB value.
 */
function relativeLuminance(hex: string): number {
	const [r, g, b] = parseHex(hex).map((c) => {
		const s = c / 255;
		return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * WCAG 2.1 contrast ratio between two hex colours.
 *
 * Returns a number in [1, 21].  Ratios ≥ 4.5 pass AA for normal text;
 * ≥ 7.0 pass AAA.
 */
export function getContrastRatio(fg: string, bg: string): number {
	const l1 = relativeLuminance(fg);
	const l2 = relativeLuminance(bg);
	const lighter = Math.max(l1, l2);
	const darker = Math.min(l1, l2);
	return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Does a foreground colour meet the WCAG AA threshold on the given
 * background?  Defaults to the Tehuti dark theme background.
 */
export function meetsContrastAA(
	fg: string,
	bg = "#1A1A2E",
	threshold = 4.5,
): boolean {
	return getContrastRatio(fg, bg) >= threshold;
}

// ── High Contrast ───────────────────────────────────────────────────────────

/** Whether the user has opted in to high-contrast mode. */
export const HIGH_CONTRAST =
	process.env.TEHUTI_HIGH_CONTRAST === "1" || process.env.NO_COLOR === "undefined";


// ── Screen-Reader Announcements ─────────────────────────────────────────────

/**
 * Emit an attention signal for terminal screen readers.
 *
 * In a terminal context there is no live ARIA region, so we use the
 * BEL character (`\x07`) which most screen readers acknowledge with a
 * short beep or auditory cue.  Pair with a text label for the actual
 * information.
 */
export function announceToScreenReader(message: string): void {
	// BEL character followed by the message — screen readers treat BEL
	// as an attention marker and may read the subsequent text.
	process.stdout.write(`\x07${message}`);
}


// ── Keyboard Navigation Hints ───────────────────────────────────────────────

/** Standard keyboard hint strings for common TUI interactions. */
export const KEYBOARD_HINTS = {
	confirm: "Enter to confirm",
	cancel: "Esc to cancel",
	navigate: "↑/↓ to navigate",
	select: "Space to select",
	toggleExpand: "Space to expand/collapse",
	search: "/ to search",
	help: "? for help",
} as const;

/**
 * Build a compact keyboard-hint line for a TUI prompt.
 *
 * Joins the provided hint keys with a bullet separator.
 */
export function keyboardHintLine(
	...hints: Array<keyof typeof KEYBOARD_HINTS>
): string {
	return hints.map((k) => KEYBOARD_HINTS[k]).join(" • ");
}
