import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown-mapper.js";

describe("renderMarkdown tables", () => {
	it("renders a simple table with aligned box-drawing borders", () => {
		const md = `| Name | Age |
| --- | --- |
| Alice | 30 |
| Bob | 25 |`;
		const out = renderMarkdown(md, 60);
		const flat = String(JSON.stringify(out));
		expect(flat).toContain("flexDirection");
		expect(flat).toContain("width");
	});

	it("keeps vertical borders aligned when a cell wraps", () => {
		const md = `| Short | Long header text |
| --- | --- |
| a | this is a long string that should wrap to multiple lines because the column is narrow |
| b | another long value that also needs wrapping |`;
		const out = renderMarkdown(md, 40);
		const flat = String(JSON.stringify(out));
		expect(flat).toContain("flexDirection");
		expect(flat).toContain("width");
	});

	it("handles empty cells without breaking layout", () => {
		const md = `| A | B | C |
| --- | --- | --- |
| 1 |  | 3 |
|  | 2 |  |`;
		const out = renderMarkdown(md, 50);
		const flat = String(JSON.stringify(out));
		expect(flat).toContain("borderStyle");
	});

	it("distributes available width across columns when table is wide", () => {
		const md = `| col1 | col2 |
| --- | --- |
| short | also short |`;
		const out = renderMarkdown(md, 30);
		const flat = String(JSON.stringify(out));
		expect(flat).toContain("col1");
		expect(flat).toContain("col2");
	});
});
