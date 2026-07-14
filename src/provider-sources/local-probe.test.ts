import { describe, expect, it, vi } from "vitest";
import { probeLocalProvider } from "./local-probe.js";

function response(status: number, body: unknown) {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: vi.fn().mockResolvedValue(body),
	};
}

describe("probeLocalProvider", () => {
	it("probes Ollama only at its fixed loopback endpoint and returns bounded model names", async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			response(200, {
				models: [
					{ name: "qwen2.5-coder:7b" },
					{ name: "llama3.2" },
					{ name: "" },
				],
			}),
		);

		const result = await probeLocalProvider("ollama-local", { fetchImpl });

		expect(fetchImpl).toHaveBeenCalledWith(
			"http://127.0.0.1:11434/api/tags",
			expect.objectContaining({ method: "GET", redirect: "error" }),
		);
		expect(result).toMatchObject({
			sourceId: "ollama-local",
			endpoint: "ollama-default",
			status: "reachable",
			models: ["qwen2.5-coder:7b", "llama3.2"],
		});
	});

	it("probes LM Studio only at its fixed loopback endpoint", async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValue(
				response(200, { data: [{ id: "loaded-model" }, { id: 12 }] }),
			);

		const result = await probeLocalProvider("lmstudio-local", { fetchImpl });

		expect(fetchImpl).toHaveBeenCalledWith(
			"http://127.0.0.1:1234/v1/models",
			expect.objectContaining({ method: "GET", redirect: "error" }),
		);
		expect(result).toMatchObject({
			sourceId: "lmstudio-local",
			endpoint: "lmstudio-default",
			status: "reachable",
			models: ["loaded-model"],
		});
	});

	it("rejects non-local source IDs without launching a network request", async () => {
		const fetchImpl = vi.fn();

		const result = await probeLocalProvider("openai-codex", { fetchImpl });

		expect(fetchImpl).not.toHaveBeenCalled();
		expect(result).toEqual({
			sourceId: "openai-codex",
			status: "unsupported-source",
			models: [],
		});
	});

	it("normalizes connection failures without returning raw transport errors", async () => {
		const fetchImpl = vi
			.fn()
			.mockRejectedValue(new Error("connection refused token=secret"));

		const result = await probeLocalProvider("ollama-local", { fetchImpl });

		expect(result).toMatchObject({
			sourceId: "ollama-local",
			status: "unreachable",
			models: [],
			error: "connection-failed",
		});
		expect(JSON.stringify(result)).not.toContain("secret");
	});

	it("rejects malformed responses without exposing their contents", async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValue(response(200, { token: "secret" }));

		const result = await probeLocalProvider("lmstudio-local", { fetchImpl });

		expect(result).toMatchObject({
			sourceId: "lmstudio-local",
			status: "invalid-response",
			models: [],
			error: "invalid-response",
		});
		expect(JSON.stringify(result)).not.toContain("secret");
	});
});
