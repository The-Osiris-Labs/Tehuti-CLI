import { describe, expect, it, vi } from "vitest";
import { probeCodexAppServer } from "./codex-app-server.js";

describe("probeCodexAppServer", () => {
	it("performs only initialize, initialized, and a non-refreshing account read", async () => {
		const request = vi.fn().mockResolvedValue({
			account: {
				type: "chatgpt",
				email: "must-not-leak@example.com",
				planType: "pro",
			},
			requiresOpenaiAuth: true,
		});

		const result = await probeCodexAppServer({ request });

		expect(request).toHaveBeenCalledWith([
			expect.objectContaining({ method: "initialize", id: 0 }),
			{ method: "initialized", params: {} },
			{ method: "account/read", id: 1, params: { refreshToken: false } },
		]);
		expect(result).toEqual({
			sourceId: "openai-codex",
			status: "authenticated",
			authentication: "codex-managed-chatgpt",
		});
		expect(JSON.stringify(result)).not.toContain("example.com");
		expect(JSON.stringify(result)).not.toContain("pro");
	});

	it("reports no authenticated account without invoking login", async () => {
		const request = vi.fn().mockResolvedValue({
			account: null,
			requiresOpenaiAuth: true,
		});

		const result = await probeCodexAppServer({ request });

		expect(result).toEqual({
			sourceId: "openai-codex",
			status: "not-authenticated",
		});
		expect(JSON.stringify(request.mock.calls)).not.toContain("login");
	});

	it("normalizes app-server failures without returning process output", async () => {
		const result = await probeCodexAppServer({
			request: vi.fn().mockRejectedValue(new Error("auth token=secret failed")),
		});

		expect(result).toEqual({
			sourceId: "openai-codex",
			status: "unavailable",
			error: "app-server-unavailable",
		});
		expect(JSON.stringify(result)).not.toContain("secret");
	});
});
