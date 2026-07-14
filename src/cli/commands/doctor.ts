import { existsSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import chalk from "chalk";
import { Command } from "commander";
import { BRANDING } from "../../branding/index.js";
import "../../agent/index.js";
import { getSkillsManager } from "../../agent/skills/manager.js";
import { getAllTools } from "../../agent/tools/registry.js";
import { listModelsForProvider } from "../../api/models.js";
import { loadConfig } from "../../config/index.js";
import { SOCKET_PATH } from "../../daemon/client.js";
import { mcpManager } from "../../mcp/index.js";
import { sessionManager } from "../../session/manager.js";

type DoctorStatus = "ok" | "warn" | "fail" | "info";

export interface DoctorCheck {
	name: string;
	status: DoctorStatus;
	detail: string;
}

function statusIcon(status: DoctorStatus): string {
	if (status === "ok") return chalk.green("✓");
	if (status === "fail") return chalk.red("✗");
	if (status === "warn") return chalk.yellow("!");
	return chalk.cyan("·");
}

function formatCheck(check: DoctorCheck): string {
	return `  ${statusIcon(check.status)} ${chalk.bold(check.name)} — ${check.detail}`;
}

async function probeDaemon(timeoutMs = 500): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = net.createConnection(SOCKET_PATH);
		let settled = false;
		const finish = (result: boolean) => {
			if (settled) return;
			settled = true;
			socket.destroy();
			resolve(result);
		};

		const timeout = setTimeout(() => finish(false), timeoutMs);
		socket.once("connect", () => {
			socket.write('{"type":"ping"}\n');
		});
		socket.on("data", (chunk: Buffer | string) => {
			if (String(chunk).includes("pong")) {
				clearTimeout(timeout);
				finish(true);
			}
		});
		socket.once("error", () => {
			clearTimeout(timeout);
			finish(false);
		});
		socket.once("close", () => {
			clearTimeout(timeout);
			if (!settled) finish(false);
		});
	});
}

function memoryDbPath(): string {
	return path.join(os.homedir(), ".config", "tehuti", "memory", "graph.db");
}

export async function collectDoctorChecks(
	options: { network?: boolean } = {},
): Promise<DoctorCheck[]> {
	const checks: DoctorCheck[] = [];
	const nodeMajor = Number.parseInt(
		process.versions.node.split(".")[0] || "0",
		10,
	);
	checks.push({
		name: "Runtime",
		status: nodeMajor >= 20 ? "ok" : "fail",
		detail: `Node.js ${process.versions.node} (required: >=20)`,
	});

	checks.push({
		name: "Build artifact",
		status: existsSync(path.resolve("dist/index.js")) ? "ok" : "warn",
		detail: existsSync(path.resolve("dist/index.js"))
			? "dist/index.js is present"
			: "dist/index.js is missing; source execution may still work via tsx",
	});

	let config: Awaited<ReturnType<typeof loadConfig>> | undefined;
	try {
		config = await loadConfig();
		checks.push({
			name: "Configuration",
			status: "ok",
			detail: `provider=${config.provider}, model=${config.model}`,
		});
	} catch (error) {
		checks.push({
			name: "Configuration",
			status: "fail",
			detail: error instanceof Error ? error.message : String(error),
		});
	}

	const sessionDir = sessionManager.getSessionsDir();
	const sessions = await sessionManager.listSessions().catch(() => []);
	checks.push({
		name: "Sessions",
		status: existsSync(sessionDir) ? "ok" : "warn",
		detail: `${sessions.length} saved session(s) at ${sessionDir}`,
	});

	const dbPath = memoryDbPath();
	checks.push({
		name: "Memory graph",
		status: existsSync(dbPath) ? "ok" : "warn",
		detail: existsSync(dbPath) ? dbPath : `not initialized at ${dbPath}`,
	});

	const skills = getSkillsManager().listSkills();
	checks.push({
		name: "Skills",
		status: "ok",
		detail: `${skills.length} loaded (${skills.filter((skill) => skill.active).length} active)`,
	});

	const tools = getAllTools();
	checks.push({
		name: "Built-in tools",
		status: tools.length > 0 ? "ok" : "fail",
		detail: `${tools.length} registered before dynamic MCP tools`,
	});

	const configuredMcp = Object.keys(config?.mcp?.servers ?? {});
	const mcpStatuses = mcpManager.getAllServerStatuses();
	const connectedMcp = mcpStatuses.filter(
		(server) => server.status === "connected",
	);
	const dynamicMcpTools = mcpManager.getAllTools().length;
	checks.push({
		name: "MCP",
		status:
			configuredMcp.length === 0 || connectedMcp.length === configuredMcp.length
				? "ok"
				: "warn",
		detail: `${configuredMcp.length} configured, ${connectedMcp.length} connected, ${dynamicMcpTools} discovered tools`,
	});

	const daemonSocketPresent = existsSync(SOCKET_PATH);
	const daemonReachable = daemonSocketPresent ? await probeDaemon() : false;
	checks.push({
		name: "Daemon",
		status: daemonReachable ? "ok" : daemonSocketPresent ? "warn" : "info",
		detail: daemonReachable
			? "socket responds to ping"
			: daemonSocketPresent
				? "socket exists but did not answer within 500ms"
				: "not running; socket is absent",
	});

	const nativePath = path.resolve("dist/tehuti-core.darwin-arm64.node");
	const nativeApplicable =
		process.platform === "darwin" && process.arch === "arm64";
	checks.push({
		name: "Native search accelerator",
		status: !nativeApplicable ? "info" : existsSync(nativePath) ? "ok" : "warn",
		detail: !nativeApplicable
			? `not applicable on ${process.platform}/${process.arch}`
			: existsSync(nativePath)
				? nativePath
				: "optional Rust module is missing; search fallback remains available",
	});

	if (config) {
		checks.push({
			name: "API configuration",
			status: config.apiKey ? "ok" : "warn",
			detail: config.apiKey
				? `${config.provider} API key is configured (value masked)`
				: "no direct API key found in the resolved config",
		});

		if (options.network) {
			try {
				const models = await listModelsForProvider(config.provider, {
					apiKey: config.apiKey,
					baseUrl: config.baseUrl,
				});
				checks.push({
					name: "API connectivity",
					status: "ok",
					detail: `${config.provider} returned ${models.length} model(s)`,
				});
			} catch (error) {
				checks.push({
					name: "API connectivity",
					status: "fail",
					detail: error instanceof Error ? error.message : String(error),
				});
			}
		} else {
			checks.push({
				name: "API connectivity",
				status: "info",
				detail: "not probed; rerun with --network",
			});
		}
	}

	return checks;
}

export function doctorCommand(): Command {
	return new Command("doctor")
		.description(
			"Inspect Tehuti runtime, configuration, integrations, and storage",
		)
		.option("--network", "Probe the configured provider's /models endpoint")
		.action(async (options: { network?: boolean }) => {
			console.log(chalk.hex(BRANDING.colors.primary)("  𓆣 Tehuti doctor"));
			console.log();

			const checks = await collectDoctorChecks(options);
			for (const check of checks) console.log(formatCheck(check));

			const failures = checks.filter((check) => check.status === "fail").length;
			const warnings = checks.filter((check) => check.status === "warn").length;
			console.log();
			console.log(
				failures > 0
					? chalk.red(`${failures} failure(s), ${warnings} warning(s)`)
					: chalk.green(`No hard failures; ${warnings} warning(s)`),
			);
			console.log();
			if (failures > 0) process.exitCode = 1;
		});
}
