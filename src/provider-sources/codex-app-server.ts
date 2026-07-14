import { spawn } from "node:child_process";

export interface CodexAppServerResult {
	sourceId: "openai-codex";
	status: "authenticated" | "not-authenticated" | "unavailable";
	authentication?:
		| "codex-managed-chatgpt"
		| "codex-api-key"
		| "codex-managed-bedrock"
		| "aws-managed-bedrock"
		| "codex-managed";
	error?: "app-server-unavailable" | "app-server-timeout" | "app-server-closed";
}

type JsonRpcMessage = {
	method: string;
	id?: number;
	params: Record<string, unknown>;
};

export type CodexAppServerRequest = (
	messages: JsonRpcMessage[],
) => Promise<unknown>;

const PROBE_TIMEOUT_MS = 10_000;
const SAFE_RUNTIME_ENV_KEYS = [
	"HOME",
	"LANG",
	"LC_ALL",
	"LOGNAME",
	"PATH",
	"SHELL",
	"TMPDIR",
	"USER",
	"XDG_CONFIG_HOME",
] as const;

function buildCodexRuntimeEnv(): Record<string, string | undefined> {
	return Object.fromEntries(
		SAFE_RUNTIME_ENV_KEYS.flatMap((key) =>
			typeof process.env[key] === "string" ? [[key, process.env[key]]] : [],
		),
	);
}

const READ_ONLY_PROBE_MESSAGES: JsonRpcMessage[] = [
	{
		method: "initialize",
		id: 0,
		params: {
			clientInfo: {
				name: "tehuti",
				title: "Tehuti",
				version: "1.2.1",
			},
		},
	},
	{ method: "initialized", params: {} },
	{ method: "account/read", id: 1, params: { refreshToken: false } },
];

async function requestCodexAppServer(
	messages: JsonRpcMessage[],
): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const process = spawn("codex", ["app-server", "--stdio"], {
			env: buildCodexRuntimeEnv(),
			stdio: ["pipe", "pipe", "ignore"],
		});
		let settled = false;
		let initialized = false;
		let buffer = "";

		const stop = () => {
			process.stdin.end();
			if (!process.killed) process.kill();
		};
		const succeed = (value: unknown) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			stop();
			resolve(value);
		};
		const fail = (error: Error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			stop();
			reject(error);
		};
		const timeout = setTimeout(
			() => fail(new Error("Codex app-server probe timed out")),
			PROBE_TIMEOUT_MS,
		);

		process.on("error", fail);
		process.on("close", () => {
			if (!settled)
				fail(new Error("Codex app-server closed before account/read"));
		});
		process.stdout.setEncoding("utf8");
		process.stdout.on("data", (chunk: string) => {
			buffer += chunk;
			let lineEnd = buffer.indexOf("\n");
			while (lineEnd >= 0) {
				const line = buffer.slice(0, lineEnd);
				buffer = buffer.slice(lineEnd + 1);
				lineEnd = buffer.indexOf("\n");
				try {
					const message = JSON.parse(line) as { id?: number; result?: unknown };
					if (message.id === 0 && "result" in message && !initialized) {
						initialized = true;
						process.stdin.write(`${JSON.stringify(messages[1])}\n`);
						process.stdin.write(`${JSON.stringify(messages[2])}\n`);
					}
					if (message.id === 1 && "result" in message) succeed(message.result);
				} catch {
					// Ignore non-JSON protocol noise; stderr is never surfaced by this probe.
				}
			}
		});

		process.stdin.write(`${JSON.stringify(messages[0])}\n`);
	});
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: undefined;
}

function normalizeAuthentication(
	account: Record<string, unknown>,
): CodexAppServerResult["authentication"] {
	if (account.type === "chatgpt") return "codex-managed-chatgpt";
	if (account.type === "apiKey") return "codex-api-key";
	if (account.type === "amazonBedrock") {
		return account.credentialSource === "awsManaged"
			? "aws-managed-bedrock"
			: "codex-managed-bedrock";
	}
	return "codex-managed";
}

/**
 * Uses only Codex App Server's documented read-only account protocol. It never
 * starts authentication, refreshes a token, creates a thread, or submits a turn.
 */
export async function probeCodexAppServer(
	options: { request?: CodexAppServerRequest } = {},
): Promise<CodexAppServerResult> {
	try {
		const result = await (options.request ?? requestCodexAppServer)(
			READ_ONLY_PROBE_MESSAGES,
		);
		const account = getRecord(getRecord(result)?.account);
		if (!account)
			return { sourceId: "openai-codex", status: "not-authenticated" };
		return {
			sourceId: "openai-codex",
			status: "authenticated",
			authentication: normalizeAuthentication(account),
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : "";
		const failure = message.includes("timed out")
			? "app-server-timeout"
			: message.includes("closed before")
				? "app-server-closed"
				: "app-server-unavailable";
		return {
			sourceId: "openai-codex",
			status: "unavailable",
			error: failure,
		};
	}
}
