import os from "node:os";
import { getCapabilities } from "../../terminal/capabilities.js";
import { addNode } from "./graph.js";

/**
 * The set of well-known API key env vars. We don't store values; we only
 * record presence so the model can reason about provider availability
 * across sessions without secrets leaking into the memory graph.
 */
const AI_KEY_ENV_VARS = [
	"OPENAI_API_KEY",
	"ANTHROPIC_API_KEY",
	"OPENROUTER_API_KEY",
	"OPENCODE_API_KEY",
	"GROQ_API_KEY",
	"GOOGLE_API_KEY",
	"GEMINI_API_KEY",
	"DASHSCOPE_API_KEY",
	"BAILIAN_API_KEY",
	"ALIBABA_ACCESS_KEY_ID",
	"HOSTINGER_API_TOKEN",
];

/**
 * Stable, human-readable node IDs derived from env state. We hash only
 * the *names* that are present (not values) so each (env, presence)
 * combination has a stable ID. This means a re-bootstrap with the same
 * env produces the same IDs and `ON CONFLICT DO UPDATE` keeps them fresh
 * without spamming the graph.
 */
function stableId(prefix: string, parts: string[]): string {
	return `${prefix}-${parts
		.sort()
		.join("-")
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, "")}`;
}

interface BootstrapResult {
	written: number;
	skipped: boolean;
	reason?: string;
}

/**
 * One-time per session: record a snapshot of the environment to long-term
 * memory so future sessions can see provider availability, terminal caps,
 * and shell context. Idempotent — re-running with the same env only
 * refreshes timestamps and content.
 */
export async function bootstrapEnvironmentMemory(
	cwd: string = process.cwd(),
): Promise<BootstrapResult> {
	let written = 0;
	const caps = getCapabilities();

	// Terminal + shell snapshot
	const terminalFacts = [
		`terminal=${caps.emulator}`,
		`size=${caps.size.columns}x${caps.size.rows}`,
		`colors=${caps.colors.has16m ? "TrueColor" : caps.colors.has256 ? "256" : "basic"}`,
		`graphics=${caps.graphics.sixel ? "sixel" : ""}${caps.graphics.kitty ? "+kitty" : ""}${caps.graphics.iterm ? "+iterm" : ""}` ||
			"graphics=none",
		`shell=${caps.shell.split("/").pop() ?? "unknown"}`,
		`platform=${os.platform()}-${os.arch()}`,
	];
	await addNode(
		stableId("env-terminal", terminalFacts),
		"critical_fact",
		`Terminal environment: ${terminalFacts.join(", ")}.`,
		cwd,
		2,
		3,
	);
	written++;

	// AI provider availability (presence only)
	const presentKeys = AI_KEY_ENV_VARS.filter((k) => !!process.env[k]);
	if (presentKeys.length > 0) {
		await addNode(
			stableId("env-providers", presentKeys),
			"project_rule",
			`AI provider API keys detected in environment: ${presentKeys.join(", ")}. The model may reference these as configured providers.`,
			cwd,
			2,
			4,
		);
		written++;
	}

	// Tehuti-specific runtime config
	const tehutiKeys = [
		process.env.TEHUTI_MODEL,
		process.env.TEHUTI_PROVIDER,
		process.env.TEHUTI_BASE_URL,
	]
		.filter(Boolean)
		.join("|");
	if (tehutiKeys) {
		await addNode(
			stableId("env-tehuti", [tehutiKeys]),
			"project_rule",
			`Tehuti runtime overrides: ${tehutiKeys.replace(/\|/g, ", ")}.`,
			cwd,
			1,
			3,
		);
		written++;
	}

	return { written, skipped: false };
}
