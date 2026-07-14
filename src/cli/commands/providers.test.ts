import { describe, expect, it } from "vitest";
import type { DeviceProviderCandidate } from "../../config/device-providers.js";
import type { CopilotBridgeResult } from "../../provider-sources/copilot-bridge.js";
import type { LocalProviderProbeResult } from "../../provider-sources/local-probe.js";
import {
	formatCopilotBridgeProbe,
	formatDeviceProviderCandidates,
	formatLocalProviderProbe,
} from "./providers.js";

const candidates: DeviceProviderCandidate[] = [
	{
		id: "openai-codex",
		provider: "openai",
		name: "OpenAI Codex",
		status: "cli-detected",
		transport: "cli-session",
		adoption: "explicit-probe-required",
		authentication: { status: "not-probed" },
		binary: { command: "codex", status: "present" },
	},
	{
		id: "ollama-local",
		provider: "ollama",
		name: "Ollama",
		status: "local-runtime-detected",
		transport: "local-http",
		adoption: "ready-to-configure",
		authentication: { status: "not-applicable" },
		binary: { command: "ollama", status: "present" },
	},
];

describe("providers command formatter", () => {
	it("explains runtime presence and adoption without credential provenance", () => {
		const output = formatDeviceProviderCandidates(candidates).join("\n");

		expect(output).toContain("OpenAI Codex");
		expect(output).toContain("explicit provider probe required");
		expect(output).toContain("Ollama");
		expect(output).toContain("ready to configure");
		expect(output.toLowerCase()).not.toContain("token value");
		expect(output.toLowerCase()).not.toContain("api key value");
		expect(output).not.toContain(".codex");
	});

	it("formats local probe outcomes without emitting endpoint URLs or raw errors", () => {
		const reachable: LocalProviderProbeResult = {
			sourceId: "ollama-local",
			endpoint: "ollama-default",
			status: "reachable",
			models: ["qwen2.5-coder:7b", "llama3.2"],
		};
		const failed: LocalProviderProbeResult = {
			sourceId: "ollama-local",
			endpoint: "ollama-default",
			status: "unreachable",
			models: [],
			error: "connection-failed",
		};

		expect(formatLocalProviderProbe(reachable)).toContain(
			"qwen2.5-coder:7b, llama3.2",
		);
		expect(formatLocalProviderProbe(failed)).toContain("connection-failed");
		expect(formatLocalProviderProbe(failed)).not.toContain("127.0.0.1");
	});

	it("formats Copilot bridge results without account identity or raw errors", () => {
		const result: CopilotBridgeResult = {
			sourceId: "github-copilot",
			status: "authenticated",
			authentication: "copilot-user",
			models: [
				{
					id: "gpt-5.4",
					name: "GPT-5.4",
					capabilities: { vision: true, reasoningEffort: true },
				},
			],
		};

		const output = formatCopilotBridgeProbe(result);
		expect(output).toContain("gpt-5.4");
		expect(output).toContain("copilot-user");
		expect(output).not.toContain("login");
		expect(output).not.toContain("token");
	});
});
