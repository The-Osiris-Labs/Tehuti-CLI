import stringWidth from "string-width";
import { describe, expect, it } from "vitest";
import { truncate, wrap } from "./output.js";

describe("truncate", () => {
	it("returns the input unchanged when it fits", () => {
		const out = truncate("hello", 10);
		// Output must not have an ellipsis when the string already fits.
		expect(out).toBe("hello");
	});

	it("truncates ASCII at visible width", () => {
		const out = truncate("hello world", 5);
		// Visible width should be at most 5.
		expect(stringWidth(out)).toBeLessThanOrEqual(5);
		expect(out).toContain("…");
	});

	it("counts wide characters as 2 cells", () => {
		const input = "你好世界hello"; // 4 CJK + 5 ASCII = 13 cells
		const out = truncate(input, 5);
		// Should be much shorter than 9 raw chars because of wide chars.
		expect(stringWidth(out)).toBeLessThanOrEqual(5);
	});

	it("preserves ANSI escape sequences when possible", () => {
		const ansi = "\x1b[31mred text\x1b[0m";
		const out = truncate(ansi, 80);
		// Reset should be preserved OR appended.
		expect(out).toMatch(/\x1b\[0m/);
	});

	it("appends a reset before the ellipsis to avoid color bleed", () => {
		const input = `\x1b[31m${"x".repeat(200)}\x1b[0m`;
		const out = truncate(input, 5);
		// The ellipsis must not be colored — we expect a reset right before it.
		expect(out).toMatch(/\x1b\[0m…/);
	});

	it("handles emoji and other astral characters", () => {
		const input = "𓁹𓂀𓆣𓊖𓋹𓂝𓃀𓆗"; // 8 hieroglyphs, each width 1 in this font
		const out = truncate(input, 3);
		expect(stringWidth(out)).toBeLessThanOrEqual(3);
	});

	it("uses sensible default when no maxLength is given", () => {
		const input = "x".repeat(10);
		// Default uses terminal width - 4, which is at least 0. The output
		// should be at most 10000 chars (sanity bound).
		const out = truncate(input);
		expect(out.length).toBeLessThan(10_000);
	});
});

describe("wrap", () => {
	it("does not break a line that already fits", () => {
		expect(wrap("hello", 80)).toBe("hello");
	});

	it("breaks a too-long line into multiple wrapped lines", () => {
		const out = wrap("a".repeat(20), 5);
		const lines = out.split("\n");
		expect(lines.length).toBeGreaterThan(1);
		// Each wrapped line should fit (or be one char that exceeded).
		for (const line of lines) {
			expect(stringWidth(line)).toBeLessThanOrEqual(5);
		}
	});

	it("preserves newlines", () => {
		expect(wrap("a\nb", 10)).toBe("a\nb");
	});

	it("does not split inside ANSI escape sequences", () => {
		// A "word" containing a long ANSI prefix should be wrapped as a unit
		// rather than have the escape broken.
		const out = wrap("\x1b[31mabcdefghij\x1b[0m", 5);
		// Should produce a result that still contains the reset at end.
		expect(out).toContain("\x1b[0m");
	});
});
