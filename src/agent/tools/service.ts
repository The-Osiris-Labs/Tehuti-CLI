import { execSync } from "node:child_process";
import { z } from "zod";
import type {
	AnyToolExecutor,
	ToolContext,
	ToolDefinition,
	ToolResult,
} from "./registry.js";

/**
 * Known local service patterns. We probe each by attempting a TCP connection
 * to the conventional port; if that succeeds we report it as running.
 */
const KNOWN_SERVICES: ReadonlyArray<{
	name: string;
	host: string;
	port: number;
}> = [
	{ name: "PostgreSQL", host: "127.0.0.1", port: 5432 },
	{ name: "MySQL", host: "127.0.0.1", port: 3306 },
	{ name: "MongoDB", host: "127.0.0.1", port: 27017 },
	{ name: "Redis", host: "127.0.0.1", port: 6379 },
	{ name: "SSH", host: "127.0.0.1", port: 22 },
	{ name: "Docker daemon", host: "127.0.0.1", port: 2375 },
];

interface ProbeResult {
	name: string;
	host: string;
	port: number;
	reachable: boolean;
	latencyMs?: number;
	error?: string;
}

/**
 * Probes a TCP port using the Node `net` module. Returns quickly because
 * we don't speak the protocol — we only need to know the listener exists.
 */
async function probeTcp(
	host: string,
	port: number,
	timeoutMs = 1000,
): Promise<ProbeResult> {
	const net = await import("node:net");
	return new Promise((resolve) => {
		const start = Date.now();
		const socket = new net.Socket();
		let settled = false;
		const finish = (result: ProbeResult) => {
			if (settled) return;
			settled = true;
			socket.destroy();
			resolve(result);
		};
		socket.setTimeout(timeoutMs);
		socket.once("connect", () => {
			finish({
				name: "",
				host,
				port,
				reachable: true,
				latencyMs: Date.now() - start,
			});
		});
		socket.once("timeout", () => {
			finish({ name: "", host, port, reachable: false, error: "timeout" });
		});
		socket.once("error", (err: NodeJS.ErrnoException) => {
			finish({
				name: "",
				host,
				port,
				reachable: false,
				error: err.code ?? err.message,
			});
		});
		socket.connect(port, host);
	});
}

const SERVICE_STATUS_SCHEMA = z.object({
	services: z
		.array(z.string())
		.optional()
		.describe(
			"Restrict the report to a subset of services (e.g. ['PostgreSQL', 'Redis']). Default: all known services.",
		),
	include_docker: z
		.boolean()
		.optional()
		.describe("If true, also list running Docker containers (default: true)."),
	include_listening_ports: z
		.boolean()
		.optional()
		.describe("If true, list all local TCP listening ports (default: false)."),
	timeout_ms: z
		.number()
		.int()
		.min(100)
		.max(5000)
		.optional()
		.describe("Per-probe timeout in milliseconds (default: 1000)."),
});

async function listDockerContainers(): Promise<string | null> {
	try {
		const out = execSync(
			"docker ps --format 'table {{.Names}}\\t{{.Image}}\\t{{.Status}}\\t{{.Ports}}' 2>/dev/null",
			{ stdio: ["ignore", "pipe", "ignore"], timeout: 5000, encoding: "utf8" },
		).trim();
		return out;
	} catch {
		return null;
	}
}

function listListeningPorts(): string | null {
	try {
		// `lsof -nP -iTCP -sTCP:LISTEN` works on macOS and Linux; -P skips name
		// resolution and keeps the output stable.
		const out = execSync(
			"lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | awk 'NR>1 {print $1, $3, $9}' | sort -u",
			{ stdio: ["ignore", "pipe", "ignore"], timeout: 5000, encoding: "utf8" },
		).trim();
		return out;
	} catch {
		return null;
	}
}

async function serviceStatus(
	args: z.infer<typeof SERVICE_STATUS_SCHEMA>,
	_ctx: ToolContext,
): Promise<ToolResult> {
	const targets = args.services
		? KNOWN_SERVICES.filter((s) => args.services?.includes(s.name))
		: KNOWN_SERVICES;
	const timeoutMs = args.timeout_ms ?? 1000;
	const includeDocker = args.include_docker ?? true;
	const includePorts = args.include_listening_ports ?? false;

	const out: string[] = [`## Service Status`];

	out.push(`\n### Known Services`);
	const results = await Promise.all(
		targets.map(async (s): Promise<ProbeResult> => {
			const r = await probeTcp(s.host, s.port, timeoutMs);
			return { ...r, name: s.name };
		}),
	);
	for (const r of results) {
		if (r.reachable) {
			out.push(
				`  ✓ ${r.name.padEnd(18)} ${r.host}:${r.port}  (${r.latencyMs}ms)`,
			);
		} else {
			out.push(
				`  ✗ ${r.name.padEnd(18)} ${r.host}:${r.port}  (${r.error ?? "down"})`,
			);
		}
	}

	if (includeDocker) {
		const docker = await listDockerContainers();
		out.push(`\n### Docker Containers`);
		if (docker === null) {
			out.push(`  (docker CLI not available or daemon not running)`);
		} else if (docker.length === 0) {
			out.push(`  (no running containers)`);
		} else {
			out.push(docker);
		}
	}

	if (includePorts) {
		const ports = listListeningPorts();
		out.push(`\n### Listening Ports`);
		if (ports && ports.length > 0) {
			out.push(ports);
		} else {
			out.push(`  (none discovered)`);
		}
	}

	return {
		success: true,
		output: out.join("\n"),
		metadata: {
			probed: results.length,
			reachable: results.filter((r) => r.reachable).length,
		},
	};
}

export const serviceTools: ToolDefinition[] = [
	{
		name: "service_status",
		description: `Probe local services (databases, Docker, SSH, etc.) by TCP connect. Optionally list running Docker containers and all listening ports. Useful for health checks before assuming a service is down.`,
		parameters: SERVICE_STATUS_SCHEMA,
		execute: serviceStatus as AnyToolExecutor,
		category: "system",
		requiresPermission: false,
		isReadonly: true,
	},
];
