import { execSync } from "node:child_process";
import { lookup } from "node:dns/promises";
import { z } from "zod";
import type {
	AnyToolExecutor,
	ToolContext,
	ToolDefinition,
	ToolResult,
} from "./registry.js";

/**
 * Well-known endpoints used for default connectivity checks.
 * Reused by the agent for health probing and for the /sysinfo command.
 */
export const DEFAULT_ENDPOINTS: ReadonlyArray<{
	label: string;
	url: string;
}> = [
	{ label: "OpenCode (provider)", url: "https://opencode.ai/zen/go/v1/models" },
	{ label: "OpenRouter", url: "https://openrouter.ai/api/v1/models" },
	{ label: "GitHub", url: "https://github.com" },
	{ label: "Docker Hub", url: "https://hub.docker.com" },
	{ label: "Anthropic API", url: "https://api.anthropic.com" },
	{ label: "OpenAI API", url: "https://api.openai.com" },
];

const PRIVATE_RANGES = [
	/^127\./,
	/^10\./,
	/^172\.(1[6-9]|2[0-9]|3[0-1])\./,
	/^192\.168\./,
	/^::1$/,
	/^fc[0-9a-f]{2}/i,
	/^fe80:/i,
	/^::ffff:127\./i,
	/^::ffff:10\./i,
	/^::ffff:192\.168\./i,
];

function isPrivateHost(host: string): boolean {
	const lower = host.toLowerCase();
	return (
		lower === "localhost" ||
		lower === "metadata.google.internal" ||
		PRIVATE_RANGES.some((rx) => rx.test(lower))
	);
}

async function checkOne(
	url: string,
	timeoutMs: number,
): Promise<{
	url: string;
	ok: boolean;
	status?: number;
	ms?: number;
	error?: string;
}> {
	const start = Date.now();
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			return { url, ok: false, error: "only http/https allowed" };
		}
		if (isPrivateHost(parsed.hostname)) {
			return { url, ok: false, error: "private host blocked" };
		}
		const controller = new AbortController();
		const tid = setTimeout(() => controller.abort(), timeoutMs);
		try {
			const res = await fetch(url, {
				method: "HEAD",
				signal: controller.signal,
				redirect: "follow",
			});
			clearTimeout(tid);
			return {
				url,
				ok: res.ok || (res.status >= 200 && res.status < 500),
				status: res.status,
				ms: Date.now() - start,
			};
		} catch (err) {
			clearTimeout(tid);
			return {
				url,
				ok: false,
				ms: Date.now() - start,
				error:
					(err as Error).name === "AbortError"
						? "timeout"
						: (err as Error).message,
			};
		}
	} catch (err) {
		return { url, ok: false, error: (err as Error).message };
	}
}

const NETWORK_CHECK_SCHEMA = z.object({
	endpoints: z
		.array(z.string().url())
		.optional()
		.describe(
			"URLs to probe (default: a curated set of provider/API endpoints).",
		),
	timeout_ms: z
		.number()
		.int()
		.min(500)
		.max(30000)
		.optional()
		.describe("Per-endpoint timeout in milliseconds (default: 5000)."),
	dns_lookup: z
		.string()
		.optional()
		.describe("Optional hostname to resolve via DNS (e.g. 'api.openai.com')."),
});

async function networkCheck(
	args: z.infer<typeof NETWORK_CHECK_SCHEMA>,
	_ctx: ToolContext,
): Promise<ToolResult> {
	const targets = (
		args.endpoints && args.endpoints.length > 0
			? args.endpoints.map((u) => ({ label: u, url: u }))
			: DEFAULT_ENDPOINTS
	) as ReadonlyArray<{ label: string; url: string }>;
	const timeoutMs = args.timeout_ms ?? 5000;
	const out: string[] = [`## Network Check`];

	if (args.dns_lookup) {
		try {
			const addrs = await lookup(args.dns_lookup, { all: true });
			out.push(
				`\n### DNS: ${args.dns_lookup}\n${addrs
					.map((a) => `  - ${a.address} (family ${a.family})`)
					.join("\n")}`,
			);
		} catch (err) {
			out.push(
				`\n### DNS: ${args.dns_lookup}\n  - failed: ${(err as Error).message}`,
			);
		}
	}

	out.push(`\n### HTTP Probes (timeout ${timeoutMs}ms)`);
	const results = await Promise.all(
		targets.map((t) => checkOne(t.url, timeoutMs)),
	);
	for (const r of results) {
		const label = targets.find((t) => t.url === r.url)?.label ?? r.url;
		if (r.ok) {
			out.push(
				`  ✓ ${label.padEnd(28)} ${String(r.status ?? "?").padStart(3)}  ${r.ms ?? 0}ms`,
			);
		} else {
			out.push(
				`  ✗ ${label.padEnd(28)} ${r.error ?? "unreachable"}${
					r.ms ? ` (${r.ms}ms)` : ""
				}`,
			);
		}
	}

	const reachable = results.filter((r) => r.ok).length;
	out.unshift(`${reachable}/${results.length} endpoints reachable.\n`);

	return {
		success: true,
		output: out.join("\n"),
		metadata: { reachable, total: results.length, timeoutMs },
	};
}

/**
 * Lightweight synchronous ping fallback using the system `ping` binary.
 * Used when a low-level TCP probe is acceptable and we want to avoid
 * pulling in the full network toolchain.
 */
export function pingHost(host: string, timeoutMs = 3000): boolean {
	try {
		const out = execSync(
			`ping -c 1 -W ${Math.max(1, Math.floor(timeoutMs / 1000))} ${host}`,
			{
				stdio: ["ignore", "pipe", "ignore"],
				timeout: timeoutMs + 1000,
				encoding: "utf8",
			},
		);
		return out.includes("1 received") || out.includes("1 packets received");
	} catch {
		return false;
	}
}

export const networkTools: ToolDefinition[] = [
	{
		name: "network_check",
		description: `Test connectivity to one or more URLs. Returns HTTP status, latency, and DNS resolution (optional). Default endpoints cover AI providers, GitHub, and Docker Hub. Private/localhost hosts are blocked for safety. Use this before assuming a service is down.`,
		parameters: NETWORK_CHECK_SCHEMA,
		execute: networkCheck as AnyToolExecutor,
		category: "system",
		requiresPermission: false,
		isReadonly: true,
	},
];
