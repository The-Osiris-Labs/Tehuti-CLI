import { afterEach, describe, expect, it, vi } from "vitest";
import { listModelsForProvider } from "./models.js";

describe("listModelsForProvider", () => {
	const originalFetch = global.fetch;

	afterEach(() => {
		vi.restoreAllMocks();
		global.fetch = originalFetch;
	});

	it("uses raw non-Bearer auth headers for model listing", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ data: [{ id: "gemini-2.5-pro" }] }),
		});
		global.fetch = fetchMock as typeof fetch;

		const models = await listModelsForProvider("google", {
			apiKey: "google-key",
		});

		expect(models).toHaveLength(1);
		expect(fetchMock).toHaveBeenCalledWith(
			"https://generativelanguage.googleapis.com/v1beta/models",
			expect.objectContaining({
				headers: expect.objectContaining({
					"x-goog-api-key": "google-key",
				}),
			}),
		);
		const fetchCall = fetchMock.mock.calls[0];
		expect(fetchCall).toBeDefined();
		const requestInit = fetchCall?.[1] as
			| { headers: Record<string, string> }
			| undefined;
		expect(requestInit?.headers["x-goog-api-key"]).toBe("google-key");
	});

	it("resolves the active provider default host instead of reusing another provider default", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ data: [{ id: "minimax-m3" }] }),
		});
		global.fetch = fetchMock as typeof fetch;

		await listModelsForProvider("opencode", {
			apiKey: "opencode-key",
			baseUrl: "https://openrouter.ai/api/v1",
		});

		expect(fetchMock).toHaveBeenCalledWith(
			"https://opencode.ai/zen/go/v1/models",
			expect.any(Object),
		);
	});

	it("skips providers that do not advertise a model list endpoint", async () => {
		const fetchMock = vi.fn();
		global.fetch = fetchMock as typeof fetch;

		const models = await listModelsForProvider("huggingface", {
			apiKey: "hf-key",
		});

		expect(models).toEqual([]);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
