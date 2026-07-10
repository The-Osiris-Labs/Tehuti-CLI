import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { webTools } from "./web.js";

const webSearchTool = webTools.find((t) => t.name === "web_search");
const codeSearchTool = webTools.find((t) => t.name === "code_search");

const FAKE_CTX = {
	cwd: "/Users/youssefsala7",
	config: {} as any,
	metadata: { toolCalls: 0, tokensUsed: 0 },
	readFilesThisSession: new Set<string>(),
} as any;

// Minimal fetch mock that records calls.
function makeFetchMock(impl: (url: string, init?: RequestInit) => Promise<Response>) {
	return vi.fn(impl) as unknown as typeof fetch;
}

describe("web_search — OpenRouter fallback", () => {
	const originalFetch = globalThis.fetch;
	const originalExa = process.env.EXA_API_KEY;
	const originalOpenRouter = process.env.OPENROUTER_API_KEY;
	const originalModel = process.env.TEHUTI_WEB_SEARCH_MODEL;

	beforeEach(() => {
		delete process.env.EXA_API_KEY;
		process.env.OPENROUTER_API_KEY = "sk-test-openrouter";
		delete process.env.TEHUTI_WEB_SEARCH_MODEL;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		if (originalExa === undefined) delete process.env.EXA_API_KEY;
		else process.env.EXA_API_KEY = originalExa;
		if (originalOpenRouter === undefined) delete process.env.OPENROUTER_API_KEY;
		else process.env.OPENROUTER_API_KEY = originalOpenRouter;
		if (originalModel === undefined) delete process.env.TEHUTI_WEB_SEARCH_MODEL;
		else process.env.TEHUTI_WEB_SEARCH_MODEL = originalModel;
		vi.restoreAllMocks();
	});

	it("falls back to OpenRouter :online when EXA_API_KEY is missing", async () => {
		const mockFetch = makeFetchMock(async (url, init) => {
			expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
			const body = JSON.parse(init?.body as string);
			expect(body.model).toContain(":online");
			expect(body.messages[0].role).toBe("system");
			expect(body.messages[1].content).toContain("Hermes Agent");
			return new Response(
				JSON.stringify({
					choices: [
						{
							message: {
								content:
									"1. Hermes Agent\n   URL: https://nousresearch.com/hermes\n   An open-weights agent harness from Nous Research.",
							},
						},
					],
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		globalThis.fetch = mockFetch;

		const r = await webSearchTool!.execute(
			{ query: "What is Hermes Agent?", num_results: 3 },
			FAKE_CTX,
		);

		expect(r.success).toBe(true);
		expect(r.output).toContain("Hermes Agent");
		expect((r.metadata as any).fallback).toBe(true);
		expect((r.metadata as any).provider).toBe("openrouter");
		expect(mockFetch).toHaveBeenCalledTimes(1);
	});

	it("uses TEHUTI_WEB_SEARCH_MODEL override when set", async () => {
		process.env.TEHUTI_WEB_SEARCH_MODEL = "anthropic/claude-3.5-sonnet:online";
		const mockFetch = makeFetchMock(async (_url, init) => {
			const body = JSON.parse(init?.body as string);
			expect(body.model).toBe("anthropic/claude-3.5-sonnet:online");
			return new Response(
				JSON.stringify({
					choices: [{ message: { content: "ok" } }],
				}),
				{ status: 200 },
			);
		});
		globalThis.fetch = mockFetch;

		const r = await webSearchTool!.execute({ query: "test" }, FAKE_CTX);
		expect(r.success).toBe(true);
	});

	it("returns helpful error when neither Exa nor OpenRouter is available", async () => {
		delete process.env.OPENROUTER_API_KEY;
		const r = await webSearchTool!.execute({ query: "x" }, FAKE_CTX);
		expect(r.success).toBe(false);
		expect(r.error).toContain("EXA_API_KEY");
		expect(r.error).toContain("OPENROUTER_API_KEY");
	});

	it("returns null and re-errors when OpenRouter returns non-OK", async () => {
		const mockFetch = makeFetchMock(async () =>
			new Response("rate limited", { status: 429 }),
		);
		globalThis.fetch = mockFetch;

		// With Exa also missing, should still hit the dual-key error path
		// because the OpenRouter fallback returns null on non-OK.
		const r = await webSearchTool!.execute({ query: "x" }, FAKE_CTX);
		expect(r.success).toBe(false);
		expect(r.error).toContain("EXA_API_KEY");
	});
});

describe("code_search — OpenRouter fallback", () => {
	const originalFetch = globalThis.fetch;
	const originalExa = process.env.EXA_API_KEY;
	const originalOpenRouter = process.env.OPENROUTER_API_KEY;

	beforeEach(() => {
		delete process.env.EXA_API_KEY;
		process.env.OPENROUTER_API_KEY = "sk-test";
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		if (originalExa === undefined) delete process.env.EXA_API_KEY;
		else process.env.EXA_API_KEY = originalExa;
		if (originalOpenRouter === undefined) delete process.env.OPENROUTER_API_KEY;
		else process.env.OPENROUTER_API_KEY = originalOpenRouter;
		vi.restoreAllMocks();
	});

	it("falls back to OpenRouter chat model for code search", async () => {
		const mockFetch = makeFetchMock(async (_url, init) => {
			const body = JSON.parse(init?.body as string);
			expect(body.messages[0].content).toContain("code search assistant");
			return new Response(
				JSON.stringify({
					choices: [
						{
							message: {
								content:
									"```ts\nexport function hello() { return 'world'; }\n```",
							},
						},
					],
				}),
				{ status: 200 },
			);
		});
		globalThis.fetch = mockFetch;

		const r = await codeSearchTool!.execute(
			{ query: "TypeScript hello world function", tokens_num: 1000 },
			FAKE_CTX,
		);
		expect(r.success).toBe(true);
		expect(r.output).toContain("hello");
		expect((r.metadata as any).fallback).toBe(true);
	});

	it("errors when neither provider is configured", async () => {
		delete process.env.OPENROUTER_API_KEY;
		const r = await codeSearchTool!.execute({ query: "x" }, FAKE_CTX);
		expect(r.success).toBe(false);
		expect(r.error).toContain("EXA_API_KEY");
		expect(r.error).toContain("OPENROUTER_API_KEY");
	});
});

describe("web_search — no-key hint", () => {
	const originalExa = process.env.EXA_API_KEY;
	const originalOpenRouter = process.env.OPENROUTER_API_KEY;

	beforeEach(() => {
		delete process.env.EXA_API_KEY;
		delete process.env.OPENROUTER_API_KEY;
	});

	afterEach(() => {
		if (originalExa === undefined) delete process.env.EXA_API_KEY;
		else process.env.EXA_API_KEY = originalExa;
		if (originalOpenRouter === undefined) delete process.env.OPENROUTER_API_KEY;
		else process.env.OPENROUTER_API_KEY = originalOpenRouter;
		vi.restoreAllMocks();
	});

	it("returns the no-key error when no providers are configured", async () => {
		// Verifies the public error message. The internal hint log
		// only fires when TEHUTI_DEBUG=true, which we don't set here —
		// the assertion is on the returned error, not the log.
		const r = await webSearchTool!.execute({ query: "x" }, FAKE_CTX);
		expect(r.success).toBe(false);
		expect(r.error).toMatch(/EXA_API_KEY/);
		expect(r.error).toMatch(/OPENROUTER_API_KEY/);
	});
});
