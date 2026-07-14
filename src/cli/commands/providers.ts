import chalk from "chalk";
import { Command } from "commander";
import { BRANDING } from "../../branding/index.js";
import {
	type DeviceProviderCandidate,
	discoverDeviceProviders,
} from "../../config/device-providers.js";
import {
	type CodexAppServerResult,
	probeCodexAppServer,
} from "../../provider-sources/codex-app-server.js";
import {
	type CopilotBridgeResult,
	probeCopilotBridge,
} from "../../provider-sources/copilot-bridge.js";
import {
	type LocalProviderProbeResult,
	probeLocalProvider,
} from "../../provider-sources/local-probe.js";

function describeCandidate(candidate: DeviceProviderCandidate): string {
	switch (candidate.status) {
		case "cli-detected":
			return "CLI detected; explicit provider probe required before Tehuti can use it";
		case "local-runtime-detected":
			return "local runtime detected; ready to configure";
		case "unavailable":
			return "not detected";
	}
}

/**
 * Human-readable passive device-provider discovery output.
 *
 * It intentionally reports executable/runtime presence only. Credential stores,
 * keychains, environment files, and vendor configuration are never inspected.
 */
export function formatDeviceProviderCandidates(
	candidates: DeviceProviderCandidate[],
): string[] {
	return candidates.map(
		(candidate) =>
			`  ${candidate.name} [${candidate.provider}] — ${describeCandidate(candidate)}`,
	);
}

/** Formats sanitized, loopback-only provider health without endpoint URLs. */
export function formatLocalProviderProbe(
	result: LocalProviderProbeResult,
): string {
	if (result.status === "reachable") {
		const models =
			result.models.length > 0 ? result.models.join(", ") : "none loaded";
		return `  ${result.sourceId} — reachable • models: ${models}`;
	}
	return `  ${result.sourceId} — ${result.status}${result.error ? ` • ${result.error}` : ""}`;
}

export function formatCodexAppServerProbe(
	result: CodexAppServerResult,
): string {
	if (result.status === "authenticated") {
		return `  openai-codex — authenticated via ${result.authentication}`;
	}
	return `  openai-codex — ${result.status}${result.error ? ` • ${result.error}` : ""}`;
}

export function formatCopilotBridgeProbe(result: CopilotBridgeResult): string {
	if (result.status === "authenticated") {
		const models =
			result.models.map((model) => model.id).join(", ") || "none available";
		return `  github-copilot — authenticated via ${result.authentication} • models: ${models}`;
	}
	return `  github-copilot — ${result.status}${result.error ? ` • ${result.error}` : ""}`;
}

export function providersCommand(): Command {
	const command = new Command("providers")
		.description(
			"Discover known provider and coding-CLI runtimes without inspecting credential stores",
		)
		.option("--format <format>", "Output format: text or json", "text")
		.option("--detected", "Only show candidates with a device signal")
		.action((options: { format?: string; detected?: boolean }) => {
			const candidates = discoverDeviceProviders();
			const displayed = options.detected
				? candidates.filter((candidate) => candidate.status !== "unavailable")
				: candidates;

			if (options.format === "json") {
				console.log(JSON.stringify(displayed, null, 2));
				return;
			}

			console.log();
			console.log(chalk.hex(BRANDING.colors.primary)("  𓆣 Device provider runtimes"));
			console.log(
				chalk.gray(
					"  Passive discovery only: Tehuti does not inspect credentials, keychains, environment files, or vendor configuration.",
				),
			);
			console.log();
			for (const line of formatDeviceProviderCandidates(displayed)) {
				console.log(line);
			}
			console.log();
			console.log(
				chalk.gray(
					"  A detected CLI is not an authenticated Tehuti provider. It needs an explicit, documented provider bridge before use.",
				),
			);
			console.log();
		});

	command.addCommand(
		new Command("probe")
			.description(
				"Opt in to official Copilot metadata or fixed-loopback local provider discovery",
			)
			.argument(
				"<source-id>",
				"openai-codex, github-copilot, ollama-local, or lmstudio-local",
			)
			.option("--output <format>", "Output format: text or json", "text")
			.action(async (sourceId: string, options: { output?: string }) => {
				if (sourceId === "openai-codex") {
					const result = await probeCodexAppServer();
					if (options.output === "json") {
						console.log(JSON.stringify(result, null, 2));
					} else {
						console.log();
						console.log(chalk.hex(BRANDING.colors.primary)("  𓆣 Provider probe"));
						console.log(formatCodexAppServerProbe(result));
						console.log();
					}
					if (result.status !== "authenticated") process.exitCode = 1;
					return;
				}

				if (sourceId === "github-copilot") {
					const result = await probeCopilotBridge();
					if (options.output === "json") {
						console.log(JSON.stringify(result, null, 2));
					} else {
						console.log();
						console.log(chalk.hex(BRANDING.colors.primary)("  𓆣 Provider probe"));
						console.log(formatCopilotBridgeProbe(result));
						console.log();
					}
					if (result.status !== "authenticated") process.exitCode = 1;
					return;
				}

				const result = await probeLocalProvider(sourceId);
				if (options.output === "json") {
					console.log(JSON.stringify(result, null, 2));
				} else {
					console.log();
					console.log(chalk.hex(BRANDING.colors.primary)("  𓆣 Provider probe"));
					console.log(formatLocalProviderProbe(result));
					console.log();
				}
				if (result.status !== "reachable") process.exitCode = 1;
			}),
	);

	return command;
}
