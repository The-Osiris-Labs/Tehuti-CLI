import { describe, expect, it } from "vitest";
import {
	formatForDiscord,
	formatForSlack,
	formatForTelegram,
	formatForWhatsApp,
	formatMessage,
} from "./formatters.js";

describe("Platform Message Formatters", () => {
	describe("Slack Formatter", () => {
		it("converts bold and italic correctly", () => {
			const input = "Here is **bold**, *italic*, and _italic_ text.";
			const expected = "Here is *bold*, _italic_, and _italic_ text.";
			expect(formatForSlack(input)).toBe(expected);
		});

		it("converts strikethrough", () => {
			expect(formatForSlack("~~strike~~")).toBe("~strike~");
		});

		it("converts links", () => {
			expect(formatForSlack("[Google](https://google.com)")).toBe(
				"<https://google.com|Google>",
			);
		});

		it("protects bare URLs without capturing trailing punctuation", () => {
			expect(formatForSlack("See http://google.com.")).toBe(
				"See http://google.com.",
			);
			expect(formatForSlack("(link: http://google.com)")).toBe(
				"(link: http://google.com)",
			);
		});

		it("handles nested bold and italic without artifacts", () => {
			expect(formatForSlack("**bold *italic***")).toBe("*bold _italic_*");
			expect(formatForSlack("***bold and italic***")).toBe(
				"*_bold and italic_*",
			);
		});
	});

	describe("Discord Formatter", () => {
		it("does not split short messages", () => {
			expect(formatForDiscord("Hello World").length).toBe(1);
			expect(formatForDiscord("Hello World")[0]).toBe("Hello World");
		});

		it("splits long messages and preserves code blocks", () => {
			const maxLen = 2000;
			const longPrefix = `${"a".repeat(1990)}\n`;
			const codeBlock = "```ts\nconsole.log('hello');\n```";
			const input = longPrefix + codeBlock;

			const chunks = formatForDiscord(input);
			expect(chunks.length).toBeGreaterThan(1);

			// First chunk should end with an open code block closed by our logic
			expect(chunks[0].endsWith("```")).toBe(true);

			// Second chunk should reopen the code block
			expect(chunks[1].startsWith("```ts\n")).toBe(true);

			// Second chunk should have the rest of the code block
			expect(chunks[1].includes("console.log")).toBe(true);
			expect(chunks[1].endsWith("```")).toBe(true);
		});

		it("does not split multi-byte emojis (surrogate pairs) across chunks", () => {
			// In formatForDiscord: maxTake = 2000 - prefix.length - 4 = 1996
			// We place a surrogate pair right at index 1995/1996
			const input = `${"a".repeat(1995)}🤔${"b".repeat(10)}`;
			const chunks = formatForDiscord(input);
			expect(chunks.length).toBe(2);

			// Chunk 0 should end before the emoji, length 1995
			expect(chunks[0].length).toBe(1995);
			const lastCharCode = chunks[0].charCodeAt(chunks[0].length - 1);
			expect(lastCharCode < 0xd800 || lastCharCode > 0xdbff).toBe(true); // Not a high surrogate

			// Chunk 1 should contain the full emoji at the start
			expect(chunks[1].startsWith("🤔")).toBe(true);
		});
	});

	describe("Telegram Formatter", () => {
		it("escapes HTML correctly", () => {
			expect(formatForTelegram("<script>")).toBe("&lt;script&gt;");
		});

		it("formats basic elements", () => {
			expect(formatForTelegram("**bold** _italic_")).toBe(
				"<b>bold</b> <i>italic</i>",
			);
			expect(formatForTelegram("`inline`")).toBe("<code>inline</code>");
		});

		it("formats links", () => {
			expect(formatForTelegram("[Link](http://example.com)")).toBe(
				'<a href="http://example.com">Link</a>',
			);
		});

		it("handles nested bold and italic without artifacts", () => {
			expect(formatForTelegram("**bold *italic***")).toBe(
				"<b>bold <i>italic</i></b>",
			);
			expect(formatForTelegram("***bold and italic***")).toBe(
				"<b><i>bold and italic</i></b>",
			);
		});
	});

	describe("WhatsApp Formatter", () => {
		it("converts bold and italic correctly", () => {
			const input = "Here is **bold**, *italic*, and _italic_ text.";
			const expected = "Here is *bold*, _italic_, and _italic_ text.";
			expect(formatForWhatsApp(input)).toBe(expected);
		});

		it("converts headers", () => {
			expect(formatForWhatsApp("# Header")).toBe("*Header*");
			expect(formatForWhatsApp("## Subheader")).toBe("*Subheader*");
		});

		it("handles nested bold and italic without artifacts", () => {
			expect(formatForWhatsApp("**bold *italic***")).toBe("*bold _italic_*");
			expect(formatForWhatsApp("***bold and italic***")).toBe(
				"*_bold and italic_*",
			);
		});
	});

	describe("Dispatcher", () => {
		it("formats according to platform", () => {
			expect(formatMessage("slack", "**bold**")).toBe("*bold*");
			expect(formatMessage("telegram", "**bold**")).toBe("<b>bold</b>");
		});
	});
});
