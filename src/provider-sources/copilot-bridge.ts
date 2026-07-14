import { CopilotClient } from "@github/copilot-sdk";

export interface CopilotRuntimeModel {
	id: string;
	name: string;
	capabilities: {
		supports: {
			vision: boolean;
			reasoningEffort: boolean;
		};
	};
}

export interface CopilotRuntimeClient {
	start: () => Promise<void>;
	getAuthStatus: () => Promise<{
		isAuthenticated: boolean;
		authType?: "user" | "env" | "gh-cli" | "hmac" | "api-key" | "token";
	}>;
	listModels: () => Promise<CopilotRuntimeModel[]>;
	stop: () => Promise<unknown>;
}

export interface CopilotBridgeModel {
	id: string;
	name: string;
	capabilities: {
		vision: boolean;
		reasoningEffort: boolean;
	};
}

export interface CopilotBridgeResult {
	sourceId: "github-copilot";
	status: "authenticated" | "not-authenticated" | "unavailable";
	authentication?: "copilot-user" | "github-cli" | "sdk-managed";
	models: CopilotBridgeModel[];
	error?: "runtime-unavailable" | "model-list-unavailable";
}

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
const MAX_MODELS = 100;
const MAX_TEXT_LENGTH = 256;

/**
 * Copies only runtime basics to the SDK child process. In particular, this
 * prevents environment token precedence from silently crossing into Tehuti.
 */
export function buildCopilotRuntimeEnv(
	env: NodeJS.ProcessEnv = process.env,
): Record<string, string | undefined> {
	return Object.fromEntries(
		SAFE_RUNTIME_ENV_KEYS.flatMap((key) =>
			typeof env[key] === "string" ? [[key, env[key]]] : [],
		),
	);
}

function createDefaultClient(): CopilotRuntimeClient {
	return new CopilotClient({
		env: buildCopilotRuntimeEnv(),
		logLevel: "error",
		useLoggedInUser: true,
	});
}

function toAuthentication(
	authType:
		| "user"
		| "env"
		| "gh-cli"
		| "hmac"
		| "api-key"
		| "token"
		| undefined,
): CopilotBridgeResult["authentication"] {
	if (authType === "user") return "copilot-user";
	if (authType === "gh-cli") return "github-cli";
	return "sdk-managed";
}

function sanitizeModels(models: CopilotRuntimeModel[]): CopilotBridgeModel[] {
	return models
		.flatMap((model) => {
			if (typeof model.id !== "string" || typeof model.name !== "string")
				return [];
			const id = model.id.trim().slice(0, MAX_TEXT_LENGTH);
			const name = model.name.trim().slice(0, MAX_TEXT_LENGTH);
			if (!id || !name) return [];
			return [
				{
					id,
					name,
					capabilities: {
						vision: model.capabilities?.supports?.vision === true,
						reasoningEffort:
							model.capabilities?.supports?.reasoningEffort === true,
					},
				},
			];
		})
		.slice(0, MAX_MODELS);
}

/**
 * Explicitly probes the official Copilot SDK. It may use a pre-existing
 * Copilot/GitHub CLI sign-in, but never reads credential stores, forwards
 * token-bearing environment variables, creates a session, or sends a prompt.
 */
export async function probeCopilotBridge(
	options: { createClient?: () => CopilotRuntimeClient } = {},
): Promise<CopilotBridgeResult> {
	let client: CopilotRuntimeClient | undefined;
	try {
		client = (options.createClient ?? createDefaultClient)();
		await client.start();
		const auth = await client.getAuthStatus();
		if (!auth.isAuthenticated) {
			return {
				sourceId: "github-copilot",
				status: "not-authenticated",
				models: [],
			};
		}

		const authentication = toAuthentication(auth.authType);
		try {
			const models = sanitizeModels(await client.listModels());
			return {
				sourceId: "github-copilot",
				status: "authenticated",
				authentication,
				models,
			};
		} catch {
			return {
				sourceId: "github-copilot",
				status: "authenticated",
				authentication,
				models: [],
				error: "model-list-unavailable",
			};
		}
	} catch {
		return {
			sourceId: "github-copilot",
			status: "unavailable",
			models: [],
			error: "runtime-unavailable",
		};
	} finally {
		if (client) await client.stop().catch(() => undefined);
	}
}
