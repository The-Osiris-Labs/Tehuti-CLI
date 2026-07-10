import { Exa } from "exa-js";
import TurndownService from "turndown";
import { z } from "zod";
import { debug } from "../../utils/debug.js";
import type {
	AnyToolExecutor,
	ToolContext,
	ToolDefinition,
	ToolResult,
} from "./registry.js";

// Track whether we've already shown the no-key hint this process, so we
// don't spam the user with the same message on every web_search call.
let noKeyHintShown = false;

interface ExaSearchResult {
	title?: string;
	url: string;
	text?: string;
}

interface ExaSearchResponse {
	results: ExaSearchResult[];
}

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

const _ALLOWED_DOMAINS = [
	"github.com",
	"npmjs.com",
	"docs.npmjs.com",
	"nodejs.org",
	"developer.mozilla.org",
	"typescriptlang.org",
	"react.dev",
	"vercel.com",
	"openrouter.ai",
	"anthropic.com",
	"openai.com",
	"stackoverflow.com",
	"stackoverflow.blog",
	"stackexchange.com",
	"medium.com",
	"dev.to",
	"stackoverflow.blog",
];

const BLOCKED_DOMAINS = [
	"facebook.com",
	"twitter.com",
	"x.com",
	"instagram.com",
	"tiktok.com",
	"pinterest.com",
];

const PRIVATE_IP_RANGES = [
	/^127\./,
	/^10\./,
	/^172\.(1[6-9]|2[0-9]|3[0-1])\./,
	/^192\.168\./,
	/^169\.254\./,
	/^0\.0\.0\.0$/,
	/^0$/,
	/^::$/,
	/^::1$/,
	/^(0{1,4}:){7}0{1,3}1$/,
	/^(0{1,4}:){7}0{1,4}$/,
	/^::ffff:(0:0:)?127\./i,
	/^::ffff:(0:0:)?10\./i,
	/^::ffff:(0:0:)?172\.(1[6-9]|2[0-9]|3[0-1])\./i,
	/^::ffff:(0:0:)?192\.168\./i,
	/^::ffff:(0:0:)?169\.254\./i,
	/^::ffff:(0:0:)?0\.0\.0\.0/i,
	/^fc[0-9a-f]{2}(:|$)/i,
	/^fd[0-9a-f]{2}(:|$)/i,
	/^fe80(:|$)/i,
	/^localhost$/i,
	/^metadata\.google\.internal$/i,
	/^metadata\.azure$/i,
];

const CLOUD_METADATA_IPS = ["169.254.169.254", "100.100.100.200"];

function isPrivateIP(ip: string): boolean {
	const cleanIp = ip.replace(/^\[|\]$/g, "");
	if (CLOUD_METADATA_IPS.includes(cleanIp)) {
		return true;
	}
	return PRIVATE_IP_RANGES.some((range) => range.test(cleanIp));
}

async function resolveDNS(hostname: string): Promise<string[]> {
	const { lookup } = await import("node:dns").then((m) => m.promises);
	try {
		const addresses = await lookup(hostname, { all: true });
		return addresses.map((addr) => addr.address);
	} catch {
		return [];
	}
}

async function resolveAndValidateUrl(
	url: string,
): Promise<{ allowed: boolean; reason?: string; resolvedHost?: string }> {
	try {
		const parsed = new URL(url);
		const hostname = parsed.hostname.toLowerCase();

		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			return {
				allowed: false,
				reason: `URL scheme '${parsed.protocol}' is not allowed. Only http and https are permitted.`,
			};
		}

		if (BLOCKED_DOMAINS.some((blocked) => hostname.includes(blocked))) {
			return { allowed: false, reason: `Domain ${hostname} is blocked` };
		}

		if (isPrivateIP(hostname)) {
			return {
				allowed: false,
				reason: `Access to private/internal IPs is not allowed: ${hostname}`,
			};
		}

		if (!/^[a-z0-9.-]+$/i.test(hostname)) {
			return { allowed: false, reason: `Invalid hostname format: ${hostname}` };
		}

		const resolvedIPs = await resolveDNS(hostname);
		if (resolvedIPs.length === 0) {
			return {
				allowed: false,
				reason: `DNS resolution failed for hostname: ${hostname}`,
			};
		}
		for (const ip of resolvedIPs) {
			if (isPrivateIP(ip)) {
				return {
					allowed: false,
					reason: `Hostname resolves to private IP: ${ip}`,
				};
			}
		}

		return { allowed: true, resolvedHost: hostname };
	} catch {
		return { allowed: false, reason: "Invalid URL" };
	}
}

async function webFetch(
	args: z.infer<typeof WEB_FETCH_SCHEMA>,
	_ctx: ToolContext,
): Promise<ToolResult> {
	const { url, format = "markdown", timeout = 30 } = args;

	const urlCheck = await resolveAndValidateUrl(url);
	if (!urlCheck.allowed) {
		return {
			success: false,
			output: "",
			error: `URL not allowed: ${urlCheck.reason}`,
		};
	}

	const controller = new AbortController();
	const timeoutId = setTimeout(
		() => controller.abort(),
		Math.min(timeout, 120) * 1000,
	);

	try {
		let currentUrl = url;
		let response: Response;
		let redirectCount = 0;
		const MAX_REDIRECTS = 5;

		while (true) {
			response = await fetch(currentUrl, {
				headers: {
					"User-Agent": "Tehuti-CLI/0.1.0 (https://tehuti.dev)",
					Accept:
						format === "html" ? "text/html" : "text/html,application/xhtml+xml",
				},
				signal: controller.signal,
				redirect: "manual",
			});

			if (
				response.status >= 300 &&
				response.status < 400 &&
				response.headers.get("location")
			) {
				redirectCount++;
				if (redirectCount > MAX_REDIRECTS) {
					return {
						success: false,
						output: "",
						error: `Too many redirects (max ${MAX_REDIRECTS})`,
					};
				}

				const redirectUrl = response.headers.get("location")!;
				let resolvedRedirect: string;

				try {
					resolvedRedirect = new URL(redirectUrl, currentUrl).toString();
				} catch {
					return {
						success: false,
						output: "",
						error: `Invalid redirect URL: ${redirectUrl}`,
					};
				}

				const redirectCheck = await resolveAndValidateUrl(resolvedRedirect);
				if (!redirectCheck.allowed) {
					return {
						success: false,
						output: "",
						error: `Redirect blocked: ${redirectCheck.reason}`,
					};
				}

				currentUrl = resolvedRedirect;
				continue;
			}

			break;
		}

		if (!response.ok) {
			return {
				success: false,
				output: "",
				error: `HTTP ${response.status}: ${response.statusText}`,
			};
		}

		const contentType = response.headers.get("content-type") ?? "";
		let content = await response.text();

		if (format === "markdown" && contentType.includes("text/html")) {
			content = htmlToMarkdown(content);
		}

		const truncated = content.length > 50000;
		if (truncated) {
			content = `${content.slice(0, 50000)}\n\n... (truncated)`;
		}

		return {
			success: true,
			output: content,
			metadata: {
				url,
				format,
				truncated,
				contentLength: content.length,
			},
		};
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") {
			return {
				success: false,
				output: "",
				error: `Request timed out after ${timeout} seconds`,
			};
		}
		return {
			success: false,
			output: "",
			error: `Failed to fetch URL: ${error instanceof Error ? error.message : String(error)}`,
		};
	} finally {
		clearTimeout(timeoutId);
	}
}

interface OpenRouterChoice {
	message?: { content?: string };
}
interface OpenRouterResponse {
	choices?: OpenRouterChoice[];
}

/**
 * Fallback web search using OpenRouter's :online model suffix.
 * Used when EXA_API_KEY is not set, OR when Exa returns an error.
 * Returns null on failure so the caller can decide what to do.
 */
async function openRouterWebSearch(
	query: string,
	numResults: number,
): Promise<ToolResult | null> {
	const apiKey = process.env.OPENROUTER_API_KEY;
	if (!apiKey) return null;

	const model = process.env.TEHUTI_WEB_SEARCH_MODEL ?? "openai/gpt-4o-mini:online";
	const endpoint = "https://openrouter.ai/api/v1/chat/completions";

	const systemPrompt = `You are a web-search assistant. The user will ask a question.
Use the model's online/web-search capabilities to find up-to-date information.
Return your answer as a numbered list. For each result provide:
- Title
- URL
- A 1-3 sentence excerpt

Return at most ${numResults} results. If you cannot find anything, say "No results found".
Do not include any other commentary.`;

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), 60_000);

	try {
		const response = await fetch(endpoint, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
				"HTTP-Referer": "https://tehuti.dev",
				"X-Title": "Tehuti-CLI",
			},
			body: JSON.stringify({
				model,
				messages: [
					{ role: "system", content: systemPrompt },
					{ role: "user", content: query },
				],
				max_tokens: 2000,
			}),
			signal: controller.signal,
		});

		if (!response.ok) {
			return null;
		}

		const data = (await response.json()) as OpenRouterResponse;
		const content = data.choices?.[0]?.message?.content;
		if (!content) return null;

		return {
			success: true,
			output: content,
			metadata: { query, provider: "openrouter", model },
		};
	} catch {
		return null;
	} finally {
		clearTimeout(timeoutId);
	}
}

async function webSearch(
	args: z.infer<typeof WEB_SEARCH_SCHEMA>,
	_ctx: ToolContext,
): Promise<ToolResult> {
	const {
		query,
		num_results = 8,
		type = "auto",
		livecrawl = "fallback",
	} = args;

	const apiKey = process.env.EXA_API_KEY;
	if (!apiKey) {
		// Fallback: use OpenRouter's :online models for web-grounded search.
		const fallback = await openRouterWebSearch(query, num_results);
		if (fallback) {
			return {
				...fallback,
				metadata: { ...fallback.metadata, num_results, fallback: true },
			};
		}
		if (!noKeyHintShown) {
			noKeyHintShown = true;
			debug.log(
				"tools",
				"web_search: no API key configured. Set EXA_API_KEY (https://exa.ai) for the best results, or set OPENROUTER_API_KEY to use the :online model fallback. This hint will not repeat.",
			);
		}
		return {
			success: false,
			output: "",
			error:
				"Web search requires an Exa API key (set EXA_API_KEY) OR an OpenRouter key (set OPENROUTER_API_KEY) to use the :online fallback.",
			metadata: { query, num_results },
		};
	}

	try {
		const exa = new Exa(apiKey);

		const response = (await exa.search(query, {
			numResults: num_results,
			type: type as
				| "auto"
				| "fast"
				| "keyword"
				| "neural"
				| "hybrid"
				| "instant",
			contents: {
				text: true,
				livecrawl: livecrawl as "always" | "fallback" | "never",
			},
		})) as ExaSearchResponse;

		const results = response.results
			.map((result, index) => {
				const text = result.text ?? "";
				const truncated = text.length > 1000;
				return `${index + 1}. **${result.title ?? "Untitled"}**
   URL: ${result.url}
   ${truncated ? `${text.slice(0, 1000)}... (truncated)` : text}`;
			})
			.join("\n\n---\n\n");

		return {
			success: true,
			output: results || "No results found",
			metadata: {
				query,
				num_results: response.results.length,
				type,
			},
		};
	} catch (error) {
		// Exa failed — try OpenRouter fallback before giving up.
		const fallback = await openRouterWebSearch(query, num_results);
		if (fallback) {
			return {
				...fallback,
				metadata: { ...fallback.metadata, num_results, fallback: true, exaError: String(error) },
			};
		}
		const errorMessage = `Web search failed: ${error instanceof Error ? error.message : String(error)}`;
		return {
			success: false,
			output: errorMessage,
			error: errorMessage,
			metadata: { query, num_results },
		};
	}
}

async function openRouterCodeSearch(
	query: string,
	tokensNum: number,
): Promise<ToolResult | null> {
	const apiKey = process.env.OPENROUTER_API_KEY;
	if (!apiKey) return null;

	const model = process.env.TEHUTI_CODE_SEARCH_MODEL ?? "openai/gpt-4o-mini";
	const endpoint = "https://openrouter.ai/api/v1/chat/completions";

	const systemPrompt = `You are a code search assistant. The user is asking for code examples,
API references, or library documentation. Use your knowledge and any retrieval
capabilities to provide accurate, up-to-date code snippets and explanations.
Be precise and include version-specific notes when relevant. Keep the response
under ${tokensNum} tokens. Format code blocks with triple backticks.`;

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), 60_000);

	try {
		const response = await fetch(endpoint, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
				"HTTP-Referer": "https://tehuti.dev",
				"X-Title": "Tehuti-CLI",
			},
			body: JSON.stringify({
				model,
				messages: [
					{ role: "system", content: systemPrompt },
					{ role: "user", content: query },
				],
				max_tokens: Math.min(Math.max(500, Math.floor(tokensNum * 0.75)), 4000),
			}),
			signal: controller.signal,
		});

		if (!response.ok) return null;

		const data = (await response.json()) as OpenRouterResponse;
		const content = data.choices?.[0]?.message?.content;
		if (!content) return null;

		return {
			success: true,
			output: content,
			metadata: { query, provider: "openrouter", model, fallback: true },
		};
	} catch {
		return null;
	} finally {
		clearTimeout(timeoutId);
	}
}

async function codeSearch(
	args: z.infer<typeof CODE_SEARCH_SCHEMA>,
	_ctx: ToolContext,
): Promise<ToolResult> {
	const { query, tokens_num = 5000 } = args;

	const apiKey = process.env.EXA_API_KEY;
	if (!apiKey) {
		const fallback = await openRouterCodeSearch(query, tokens_num);
		if (fallback) return fallback;
		return {
			success: false,
			output: "",
			error:
				"Code search requires an Exa API key (set EXA_API_KEY) OR an OpenRouter key (set OPENROUTER_API_KEY) for the fallback.",
			metadata: { query },
		};
	}

	try {
		const exa = new Exa(apiKey);

		const response = await exa.search(query, {
			type: "auto",
			numResults: 5,
			contents: {
				text: { maxCharacters: tokens_num },
			},
		});

		const results = response.results
			.map((result, _index) => {
				return `## ${result.title ?? "Code Reference"}
${result.url}
\`\`\`
${result.text ?? ""}
\`\`\``;
			})
			.join("\n\n");

		return {
			success: true,
			output: results || "No code examples found",
			metadata: {
				query,
				tokens_num,
				resultsCount: response.results.length,
			},
		};
	} catch (error) {
		// Try fallback before giving up
		const fallback = await openRouterCodeSearch(query, tokens_num);
		if (fallback) {
			return {
				...fallback,
				metadata: { ...fallback.metadata, exaError: String(error) },
			};
		}
		const errorMessage = `Code search failed: ${error instanceof Error ? error.message : String(error)}`;
		return {
			success: false,
			output: errorMessage,
			error: errorMessage,
			metadata: { query },
		};
	}
}

const turndownService = new TurndownService({
	headingStyle: "atx",
	codeBlockStyle: "fenced",
	bulletListMarker: "-",
});

turndownService.remove([
	"script",
	"style",
	"nav",
	"footer",
	"header",
	"aside",
	"noscript",
]);

function htmlToMarkdown(html: string): string {
	try {
		return turndownService.turndown(html);
	} catch {
		return html;
	}
}

export const webTools: ToolDefinition[] = [
	{
		name: "web_fetch",
		description:
			"Fetches content from a specified URL and converts to readable format. Supports markdown, text, and HTML output.",
		parameters: WEB_FETCH_SCHEMA,
		execute: webFetch as AnyToolExecutor,
		category: "web",
		requiresPermission: false,
		isReadonly: true,
	},
	{
		name: "web_search",
		description: `Search the web using Exa AI - performs real-time web searches and can scrape content from specific URLs
- Provides up-to-date information for current events and recent data
- Supports configurable result counts and returns the content from the most relevant websites
- Use this tool for accessing information beyond knowledge cutoff
- Searches are performed automatically within a single API call`,
		parameters: WEB_SEARCH_SCHEMA,
		execute: webSearch as AnyToolExecutor,
		category: "web",
		requiresPermission: false,
		isReadonly: true,
	},
	{
		name: "code_search",
		description: `Search and get relevant context for any programming task using Exa Code API
- Provides the highest quality and freshest context for libraries, SDKs, and APIs
- Returns comprehensive code examples, documentation, and API references
- Optimized for finding specific programming patterns and solutions
- Use this tool for ANY question or task related to programming`,
		parameters: CODE_SEARCH_SCHEMA,
		execute: codeSearch as AnyToolExecutor,
		category: "web",
		requiresPermission: false,
		isReadonly: true,
	},
];
