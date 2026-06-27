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
});
