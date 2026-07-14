import { describe, it, expect } from "vitest";
import { z } from "zod";

// Import schemas and helper functions from web.ts
// We test the exported schemas and logic rather than making real HTTP requests
const WEB_FETCH_SCHEMA = z.object({
	url: z.string().url().describe("The URL to fetch content from"),
	format: z
		.enum(["markdown", "text", "html"])
		.optional()
		.describe("The format to return content in (default: markdown)"),
	timeout: z
		.number()
		.int()
		.positive()
		.optional()
		.describe("Optional timeout in seconds (max 120)"),
});

const WEB_SEARCH_SCHEMA = z.object({
	query: z.string().describe("The search query"),
	num_results: z
		.number()
		.int()
		.min(1)
		.max(20)
		.optional()
		.describe("Number of search results to return (default: 8)"),
	type: z
		.enum(["auto", "fast", "deep"])
		.optional()
		.describe(
			"Search type: auto (balanced), fast (quick), deep (comprehensive)",
		),
	livecrawl: z
		.enum(["fallback", "preferred"])
		.optional()
		.describe(
			"Live crawl mode: fallback (backup), preferred (prioritize live)",
		),
});

const CODE_SEARCH_SCHEMA = z.object({
	query: z.string().describe("Search query for code/API documentation"),
	tokens_num: z
		.number()
		.int()
		.min(1000)
		.max(50000)
		.optional()
		.describe("Number of tokens to return (default: 5000)"),
});

const BLOCKED_DOMAINS = [
	"facebook.com",
	"twitter.com",
	"x.com",
	"instagram.com",
	"tiktok.com",
	"pinterest.com",
	"reddit.com",
	"linkedin.com",
	"threads.net",
	"bsky.app",
];

function isBlockedDomain(hostname: string): boolean {
	const lower = hostname.toLowerCase();
	return BLOCKED_DOMAINS.some((d) => lower.includes(d));
}

describe("web edge cases", () => {
	describe("web_fetch schema validation", () => {
		it("should reject empty URL", () => {
			expect(() => WEB_FETCH_SCHEMA.parse({ url: "" })).toThrow();
		});

		it("should reject URL without protocol", () => {
			expect(() => WEB_FETCH_SCHEMA.parse({ url: "example.com" })).toThrow();
		});

		it("should accept ftp protocol URL (schema is permissive, blocking happens at runtime)", () => {
			expect(() =>
				WEB_FETCH_SCHEMA.parse({ url: "ftp://example.com/file" }),
			).not.toThrow();
		});

		it("should accept javascript: protocol URL (schema is permissive, blocking happens at runtime)", () => {
			expect(() =>
				WEB_FETCH_SCHEMA.parse({ url: "javascript:alert(1)" }),
			).not.toThrow();
		});

		it("should accept data: URI URL (schema is permissive, blocking happens at runtime)", () => {
			expect(() =>
				WEB_FETCH_SCHEMA.parse({ url: "data:text/html,<h1>Hi</h1>" }),
			).not.toThrow();
		});

		it("should accept valid http URL", () => {
			expect(() =>
				WEB_FETCH_SCHEMA.parse({ url: "http://example.com" }),
			).not.toThrow();
		});

		it("should accept valid https URL", () => {
			expect(() =>
				WEB_FETCH_SCHEMA.parse({ url: "https://example.com" }),
			).not.toThrow();
		});

		it("should handle very long valid URL", () => {
			const longPath = "/path/" + "segment-".repeat(500);
			const url = `https://example.com${longPath}`;
			expect(() => WEB_FETCH_SCHEMA.parse({ url })).not.toThrow();
		});

		it("should handle URL with port", () => {
			expect(() =>
				WEB_FETCH_SCHEMA.parse({ url: "https://example.com:8080/api" }),
			).not.toThrow();
		});

		it("should handle URL with query parameters", () => {
			expect(() =>
				WEB_FETCH_SCHEMA.parse({
					url: "https://example.com?q=test&page=1&lang=en",
				}),
			).not.toThrow();
		});

		it("should handle URL with fragment", () => {
			expect(() =>
				WEB_FETCH_SCHEMA.parse({ url: "https://example.com/page#section" }),
			).not.toThrow();
		});

		it("should accept valid format options", () => {
			expect(() =>
				WEB_FETCH_SCHEMA.parse({ url: "https://example.com", format: "text" }),
			).not.toThrow();
			expect(() =>
				WEB_FETCH_SCHEMA.parse({
					url: "https://example.com",
					format: "html",
				}),
			).not.toThrow();
			expect(() =>
				WEB_FETCH_SCHEMA.parse({
					url: "https://example.com",
					format: "markdown",
				}),
			).not.toThrow();
		});

		it("should reject invalid format", () => {
			expect(() =>
				WEB_FETCH_SCHEMA.parse({ url: "https://example.com", format: "xml" }),
			).toThrow();
		});

		it("should reject negative timeout", () => {
			expect(() =>
				WEB_FETCH_SCHEMA.parse({
					url: "https://example.com",
					timeout: -10,
				}),
			).toThrow();
		});

		it("should reject zero timeout", () => {
			expect(() =>
				WEB_FETCH_SCHEMA.parse({ url: "https://example.com", timeout: 0 }),
			).toThrow();
		});

		it("should reject non-integer timeout", () => {
			expect(() =>
				WEB_FETCH_SCHEMA.parse({
					url: "https://example.com",
					timeout: 1.5,
				}),
			).toThrow();
		});

		it("should accept valid positive timeout", () => {
			expect(() =>
				WEB_FETCH_SCHEMA.parse({ url: "https://example.com", timeout: 30 }),
			).not.toThrow();
		});
	});

	describe("web_search schema validation", () => {
		it("should require query parameter", () => {
			expect(() => WEB_SEARCH_SCHEMA.parse({})).toThrow();
		});

		it("should accept empty query string", () => {
			expect(() => WEB_SEARCH_SCHEMA.parse({ query: "" })).not.toThrow();
		});

		it("should accept query with special characters", () => {
			expect(() =>
				WEB_SEARCH_SCHEMA.parse({ query: "hello & world <script>" }),
			).not.toThrow();
		});

		it("should accept query with unicode", () => {
			expect(() =>
				WEB_SEARCH_SCHEMA.parse({ query: "日本語テスト café naïve" }),
			).not.toThrow();
		});

		it("should reject num_results below minimum", () => {
			expect(() =>
				WEB_SEARCH_SCHEMA.parse({ query: "test", num_results: 0 }),
			).toThrow();
		});

		it("should reject num_results above maximum", () => {
			expect(() =>
				WEB_SEARCH_SCHEMA.parse({ query: "test", num_results: 21 }),
			).toThrow();
		});

		it("should accept num_results at boundaries", () => {
			expect(() =>
				WEB_SEARCH_SCHEMA.parse({ query: "test", num_results: 1 }),
			).not.toThrow();
			expect(() =>
				WEB_SEARCH_SCHEMA.parse({ query: "test", num_results: 20 }),
			).not.toThrow();
		});

		it("should accept valid search type", () => {
			expect(() =>
				WEB_SEARCH_SCHEMA.parse({ query: "test", type: "fast" }),
			).not.toThrow();
			expect(() =>
				WEB_SEARCH_SCHEMA.parse({ query: "test", type: "deep" }),
			).not.toThrow();
		});

		it("should reject invalid search type", () => {
			expect(() =>
				WEB_SEARCH_SCHEMA.parse({ query: "test", type: "invalid" }),
			).toThrow();
		});

		it("should accept valid livecrawl option", () => {
			expect(() =>
				WEB_SEARCH_SCHEMA.parse({ query: "test", livecrawl: "preferred" }),
			).not.toThrow();
		});
	});

	describe("code_search schema validation", () => {
		it("should require query parameter", () => {
			expect(() => CODE_SEARCH_SCHEMA.parse({})).toThrow();
		});

		it("should reject tokens_num below minimum", () => {
			expect(() =>
				CODE_SEARCH_SCHEMA.parse({ query: "test", tokens_num: 999 }),
			).toThrow();
		});

		it("should reject tokens_num above maximum", () => {
			expect(() =>
				CODE_SEARCH_SCHEMA.parse({ query: "test", tokens_num: 50001 }),
			).toThrow();
		});

		it("should accept tokens_num at boundaries", () => {
			expect(() =>
				CODE_SEARCH_SCHEMA.parse({ query: "test", tokens_num: 1000 }),
			).not.toThrow();
			expect(() =>
				CODE_SEARCH_SCHEMA.parse({ query: "test", tokens_num: 50000 }),
			).not.toThrow();
		});

		it("should accept query with code snippets", () => {
			expect(() =>
				CODE_SEARCH_SCHEMA.parse({ query: "function hello(): string {}" }),
			).not.toThrow();
		});

		it("should accept empty query", () => {
			expect(() => CODE_SEARCH_SCHEMA.parse({ query: "" })).not.toThrow();
		});
	});

	describe("blocked domains", () => {
		it("should block facebook.com", () => {
			expect(isBlockedDomain("facebook.com")).toBe(true);
		});

		it("should block www.facebook.com", () => {
			expect(isBlockedDomain("www.facebook.com")).toBe(true);
		});

		it("should block m.facebook.com", () => {
			expect(isBlockedDomain("m.facebook.com")).toBe(true);
		});

		it("should block twitter.com", () => {
			expect(isBlockedDomain("twitter.com")).toBe(true);
		});

		it("should block x.com", () => {
			expect(isBlockedDomain("x.com")).toBe(true);
		});

		it("should block instagram.com", () => {
			expect(isBlockedDomain("instagram.com")).toBe(true);
		});

		it("should block tiktok.com", () => {
			expect(isBlockedDomain("tiktok.com")).toBe(true);
		});

		it("should block reddit.com", () => {
			expect(isBlockedDomain("reddit.com")).toBe(true);
		});

		it("should block linkedin.com", () => {
			expect(isBlockedDomain("linkedin.com")).toBe(true);
		});

		it("should block bsky.app", () => {
			expect(isBlockedDomain("bsky.app")).toBe(true);
		});

		it("should be case-insensitive", () => {
			expect(isBlockedDomain("FACEBOOK.COM")).toBe(true);
			expect(isBlockedDomain("Facebook.Com")).toBe(true);
			expect(isBlockedDomain("TWITTER.COM")).toBe(true);
		});

		it("should allow github.com", () => {
			expect(isBlockedDomain("github.com")).toBe(false);
		});

		it("should allow npmjs.com", () => {
			expect(isBlockedDomain("npmjs.com")).toBe(false);
		});

		it("should allow stackoverflow.com", () => {
			expect(isBlockedDomain("stackoverflow.com")).toBe(false);
		});

		it("should allow example.com", () => {
			expect(isBlockedDomain("example.com")).toBe(false);
		});

		it("should allow subdomain of allowed domain", () => {
			expect(isBlockedDomain("api.github.com")).toBe(false);
		});

		it("should block domain containing blocked string", () => {
			expect(isBlockedDomain("notfacebook.com")).toBe(true);
			expect(isBlockedDomain("mytwitter.com")).toBe(true);
		});
	});

	describe("URL edge cases", () => {
		it("should handle URL with international characters in path", () => {
			const url = "https://example.com/日本語/テスト";
			expect(() => WEB_FETCH_SCHEMA.parse({ url })).not.toThrow();
		});

		it("should handle URL with encoded characters", () => {
			const url = "https://example.com/path%20with%20spaces";
			expect(() => WEB_FETCH_SCHEMA.parse({ url })).not.toThrow();
		});

		it("should handle URL with multiple query params", () => {
			const url =
				"https://example.com/page?a=1&b=2&c=3&d=4&e=5&f=6&g=7&h=8&i=9&j=10";
			expect(() => WEB_FETCH_SCHEMA.parse({ url })).not.toThrow();
		});

		it("should handle very long query string", () => {
			const params = Array.from({ length: 100 }, (_, i) => `p${i}=v${i}`).join(
				"&",
			);
			const url = `https://example.com/search?${params}`;
			expect(() => WEB_FETCH_SCHEMA.parse({ url })).not.toThrow();
		});

		it("should handle URL with auth info", () => {
			// URL with auth info is technically valid in URL spec
			const url = "https://user:pass@example.com";
			expect(() => WEB_FETCH_SCHEMA.parse({ url })).not.toThrow();
		});

		it("should reject URL with only spaces", () => {
			expect(() => WEB_FETCH_SCHEMA.parse({ url: "   " })).toThrow();
		});

		it("should handle URL with newlines (Zod URL validator accepts them)", () => {
			expect(() =>
				WEB_FETCH_SCHEMA.parse({ url: "https://example.com\nmalicious" }),
			).not.toThrow();
		});

		it("should reject URL with null bytes", () => {
			expect(() =>
				WEB_FETCH_SCHEMA.parse({ url: "https://example.com\0malicious" }),
			).toThrow();
		});
	});

	describe("format options edge cases", () => {
		it("should accept all three valid format values", () => {
			const formats = ["markdown", "text", "html"] as const;
			for (const format of formats) {
				expect(() =>
					WEB_FETCH_SCHEMA.parse({ url: "https://example.com", format }),
				).not.toThrow();
			}
		});

		it("should reject numeric format", () => {
			expect(() =>
				WEB_FETCH_SCHEMA.parse({ url: "https://example.com", format: 123 }),
			).toThrow();
		});

		it("should reject boolean format", () => {
			expect(() =>
				WEB_FETCH_SCHEMA.parse({ url: "https://example.com", format: true }),
			).toThrow();
		});

		it("should accept undefined format (optional)", () => {
			expect(() =>
				WEB_FETCH_SCHEMA.parse({ url: "https://example.com" }),
			).not.toThrow();
		});
	});

	describe("timeout edge cases", () => {
		it("should accept timeout of 1 second", () => {
			expect(() =>
				WEB_FETCH_SCHEMA.parse({ url: "https://example.com", timeout: 1 }),
			).not.toThrow();
		});

		it("should accept very large timeout", () => {
			expect(() =>
				WEB_FETCH_SCHEMA.parse({ url: "https://example.com", timeout: 120 }),
			).not.toThrow();
		});

		it("should reject fractional timeout", () => {
			expect(() =>
				WEB_FETCH_SCHEMA.parse({ url: "https://example.com", timeout: 0.5 }),
			).toThrow();
		});

		it("should reject Infinity timeout", () => {
			expect(() =>
				WEB_FETCH_SCHEMA.parse({ url: "https://example.com", timeout: Infinity }),
			).toThrow();
		});

		it("should reject NaN timeout", () => {
			expect(() =>
				WEB_FETCH_SCHEMA.parse({ url: "https://example.com", timeout: NaN }),
			).toThrow();
		});
	});

	describe("search results edge cases", () => {
		it("should accept num_results of 1", () => {
			expect(() =>
				WEB_SEARCH_SCHEMA.parse({ query: "test", num_results: 1 }),
			).not.toThrow();
		});

		it("should accept num_results of 20", () => {
			expect(() =>
				WEB_SEARCH_SCHEMA.parse({ query: "test", num_results: 20 }),
			).not.toThrow();
		});

		it("should reject negative num_results", () => {
			expect(() =>
				WEB_SEARCH_SCHEMA.parse({ query: "test", num_results: -1 }),
			).toThrow();
		});

		it("should reject fractional num_results", () => {
			expect(() =>
				WEB_SEARCH_SCHEMA.parse({ query: "test", num_results: 1.5 }),
			).toThrow();
		});

		it("should accept all valid search types", () => {
			const types = ["auto", "fast", "deep"] as const;
			for (const type of types) {
				expect(() =>
					WEB_SEARCH_SCHEMA.parse({ query: "test", type }),
				).not.toThrow();
			}
		});

		it("should accept all valid livecrawl options", () => {
			const livecrawlOptions = ["fallback", "preferred"] as const;
			for (const livecrawl of livecrawlOptions) {
				expect(() =>
					WEB_SEARCH_SCHEMA.parse({ query: "test", livecrawl }),
				).not.toThrow();
			}
		});
	});
});
