import { describe, expect, it, vi } from "vitest";
import {
	buildCopilotRuntimeEnv,
	type CopilotRuntimeClient,
	probeCopilotBridge,
} from "./copilot-bridge.js";

function createClient(
	overrides: Partial<CopilotRuntimeClient> = {},
): CopilotRuntimeClient {
	return {
		start: vi.fn().mockResolvedValue(undefined),
		getAuthStatus: vi.fn().mockResolvedValue({
			isAuthenticated: true,
			authType: "user",
		}),
		listModels: vi.fn().mockResolvedValue([
			{
				id: "gpt-5.4",
				name: "GPT-5.4",
				capabilities: {
					supports: { vision: true, reasoningEffort: true },
				},
			},
		]),
		stop: vi.fn().mockResolvedValue([]),
		...overrides,
	};
}

describe("probeCopilotBridge", () => {
	it("uses the SDK status and model interfaces without creating a session", async () => {
		const client = createClient();

		const result = await probeCopilotBridge({ createClient: () => client });

		expect(client.start).toHaveBeenCalledOnce();
		expect(client.getAuthStatus).toHaveBeenCalledOnce();
		expect(client.listModels).toHaveBeenCalledOnce();
		expect(client.stop).toHaveBeenCalledOnce();
		expect(result).toEqual({
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
		});
	});

	it("does not request models when the SDK reports no authenticated user", async () => {
		const client = createClient({
			getAuthStatus: vi.fn().mockResolvedValue({ isAuthenticated: false }),
		});

		const result = await probeCopilotBridge({ createClient: () => client });

		expect(client.listModels).not.toHaveBeenCalled();
		expect(client.stop).toHaveBeenCalledOnce();
		expect(result).toEqual({
			sourceId: "github-copilot",
			status: "not-authenticated",
			models: [],
		});
	});

	it("normalizes runtime errors and still releases the SDK process", async () => {
		const client = createClient({
			start: vi
				.fn()
				.mockRejectedValue(new Error("token=secret startup failure")),
		});

		const result = await probeCopilotBridge({ createClient: () => client });

		expect(client.stop).toHaveBeenCalledOnce();
		expect(result).toEqual({
			sourceId: "github-copilot",
			status: "unavailable",
			models: [],
			error: "runtime-unavailable",
		});
		expect(JSON.stringify(result)).not.toContain("secret");
	});
});

describe("buildCopilotRuntimeEnv", () => {
	it("allows runtime basics but removes token-bearing environment variables", () => {
		const env = buildCopilotRuntimeEnv({
			PATH: "/usr/bin",
			HOME: "/home/test",
			LANG: "en_US.UTF-8",
			GH_TOKEN: "secret",
			GITHUB_TOKEN: "secret",
			COPILOT_GITHUB_TOKEN: "secret",
			CUSTOM: "not-inherited",
		});

		expect(env).toEqual({
			PATH: "/usr/bin",
			HOME: "/home/test",
			LANG: "en_US.UTF-8",
		});
		expect(JSON.stringify(env)).not.toContain("secret");
	});
});
