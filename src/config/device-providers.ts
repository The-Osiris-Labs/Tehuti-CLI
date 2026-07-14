import fs from "node:fs";
import path from "node:path";

export type DeviceProviderStatus =
	| "cli-detected"
	| "local-runtime-detected"
	| "unavailable";

export type DeviceProviderTransport = "cli-session" | "local-http";

export type DeviceProviderAdoption =
	| "explicit-probe-required"
	| "ready-to-configure"
	| "not-applicable";

export interface DeviceProviderDiscoveryDependencies {
	commandExists: (command: string) => boolean;
}

export interface DeviceProviderAuthentication {
	status: "not-probed" | "not-applicable";
}

export interface DeviceProviderBinary {
	command: string;
	status: "present" | "absent";
}

export interface DeviceProviderCandidate {
	id: string;
	provider: string;
	name: string;
	status: DeviceProviderStatus;
	transport: DeviceProviderTransport;
	adoption: DeviceProviderAdoption;
	authentication: DeviceProviderAuthentication;
	binary: DeviceProviderBinary;
}

type AdapterDefinition = {
	id: string;
	provider: string;
	name: string;
	command: string;
	transport: DeviceProviderTransport;
};

/**
 * Fixed, non-secret device runtime catalog. Keep this distinct from
 * KNOWN_PROVIDERS: a local CLI is not automatically an API provider.
 */
const ADAPTERS: AdapterDefinition[] = [
	{
		id: "openai-codex",
		provider: "openai",
		name: "OpenAI Codex",
		command: "codex",
		transport: "cli-session",
	},
	{
		id: "anthropic-claude",
		provider: "anthropic",
		name: "Anthropic Claude Code",
		command: "claude",
		transport: "cli-session",
	},
	{
		id: "google-gemini",
		provider: "google",
		name: "Google Gemini CLI",
		command: "gemini",
		transport: "cli-session",
	},
	{
		id: "github-copilot",
		provider: "github",
		name: "GitHub Copilot CLI",
		command: "copilot",
		transport: "cli-session",
	},
	{
		id: "opencode",
		provider: "opencode",
		name: "OpenCode",
		command: "opencode",
		transport: "cli-session",
	},
	{
		id: "ollama-local",
		provider: "ollama",
		name: "Ollama",
		command: "ollama",
		transport: "local-http",
	},
	{
		id: "lmstudio-local",
		provider: "lmstudio",
		name: "LM Studio",
		command: "lms",
		transport: "local-http",
	},
];

function defaultCommandExists(command: string): boolean {
	const pathValue = process.env.PATH ?? "";
	const extensions =
		process.platform === "win32"
			? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").filter(Boolean)
			: [""];

	return pathValue.split(path.delimiter).some((directory) =>
		extensions.some((extension) => {
			const candidate = path.join(directory, `${command}${extension}`);
			try {
				return fs.existsSync(candidate) && fs.statSync(candidate).isFile();
			} catch {
				return false;
			}
		}),
	);
}

function resolveDependencies(
	overrides: Partial<DeviceProviderDiscoveryDependencies>,
): DeviceProviderDiscoveryDependencies {
	return { commandExists: overrides.commandExists ?? defaultCommandExists };
}

function resolveStatus(
	transport: DeviceProviderTransport,
	binaryPresent: boolean,
): DeviceProviderStatus {
	if (!binaryPresent) return "unavailable";
	return transport === "local-http" ? "local-runtime-detected" : "cli-detected";
}

function resolveAdoption(
	transport: DeviceProviderTransport,
	status: DeviceProviderStatus,
): DeviceProviderAdoption {
	if (transport === "local-http") {
		return status === "local-runtime-detected"
			? "ready-to-configure"
			: "not-applicable";
	}
	return status === "cli-detected"
		? "explicit-probe-required"
		: "not-applicable";
}

/**
 * Passively discovers known device runtimes without reading credentials,
 * keychains, environment files, browser profiles, or vendor config stores.
 *
 * A detected coding CLI is deliberately not an authenticated Tehuti provider.
 * Its authentication is `not-probed` until an explicit, provider-specific,
 * documented bridge is selected by the user.
 */
export function discoverDeviceProviders(
	overrides: Partial<DeviceProviderDiscoveryDependencies> = {},
): DeviceProviderCandidate[] {
	const dependencies = resolveDependencies(overrides);

	return ADAPTERS.map((adapter) => {
		const binaryPresent = dependencies.commandExists(adapter.command);
		const status = resolveStatus(adapter.transport, binaryPresent);
		const localRuntime = adapter.transport === "local-http";

		return {
			id: adapter.id,
			provider: adapter.provider,
			name: adapter.name,
			status,
			transport: adapter.transport,
			adoption: resolveAdoption(adapter.transport, status),
			authentication: {
				status: localRuntime ? "not-applicable" : "not-probed",
			},
			binary: {
				command: adapter.command,
				status: binaryPresent ? "present" : "absent",
			},
		};
	});
}
