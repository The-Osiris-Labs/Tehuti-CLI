import { describe, expect, it } from "vitest";
import { summarizeToolOutput } from "./ExpandableToolOutput.js";

describe("summarizeToolOutput", () => {
	it("returns a preview summary for long tool output without interactive affordances", () => {
		const summary = summarizeToolOutput("a\nb\nc\nd\ne", 80, 4);

		expect(summary.isTruncated).toBe(true);
		expect(summary.lineCount).toBe(5);
		expect(summary.hiddenLineCount).toBe(1);
		expect(summary.displayContent).toContain("a\nb\nc\nd");
		expect(summary.displayContent).not.toContain("more");
	});

	it("truncates lines containing ANSI codes without color bleeding", () => {
		const summary = summarizeToolOutput("\x1b[31mHelloWorld\x1b[0m", 11, 4);
		expect(summary.displayContent).toContain("\x1b[31mHell\x1b[0m...");
	});
});
