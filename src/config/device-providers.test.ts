import { describe, expect, it, vi } from "vitest";
import {
	type DeviceProviderDiscoveryDependencies,
	discoverDeviceProviders,
} from "./device-providers.js";

function discoverWith(
	commands: string[],
	options: Partial<DeviceProviderDiscoveryDependencies> = {},
) {
	const commandSet = new Set(commands);
	const commandExists = vi.fn((command: string) => commandSet.has(command));
	const providers = discoverDeviceProviders({ commandExists, ...options });
	return { providers, commandExists };
}

describe("device provider discovery", () => {
	it("detects a Codex executable without inspecting or claiming its authentication", () => {
		const { providers, commandExists } = discoverWith(["codex"]);

		const codex = providers.find((provider) => provider.id === "openai-codex");
		expect(codex).toMatchObject({
			provider: "openai",
			status: "cli-detected",
			transport: "cli-session",
			adoption: "explicit-probe-required",
			authentication: { status: "not-probed" },
			binary: { command: "codex", status: "present" },
		});
		expect(commandExists).toHaveBeenCalledWith("codex");
	});

	it("marks Ollama as a direct local runtime without requiring credentials", () => {
		const { providers } = discoverWith(["ollama"]);

		const ollama = providers.find((provider) => provider.id === "ollama-local");
		expect(ollama).toMatchObject({
			provider: "ollama",
			status: "local-runtime-detected",
			transport: "local-http",
			adoption: "ready-to-configure",
			authentication: { status: "not-applicable" },
			binary: { command: "ollama", status: "present" },
		});
	});

	it("returns every registered adapter as unavailable when no device signals exist", () => {
		const { providers } = discoverWith([]);

		expect(providers.map((provider) => provider.id)).toEqual([
			"openai-codex",
			"anthropic-claude",
			"google-gemini",
			"github-copilot",
			"opencode",
			"ollama-local",
			"lmstudio-local",
		]);
		expect(
			providers.every((provider) => provider.status === "unavailable"),
		).toBe(true);
	});

	it("does not require any home-directory, credential-store, or platform input", () => {
		const { commandExists } = discoverWith(["gemini"]);

		expect(commandExists).toHaveBeenCalledWith("gemini");
		expect(commandExists).not.toHaveBeenCalledWith("~/.gemini");
	});
});
