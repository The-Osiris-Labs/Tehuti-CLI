/**
 * System prompt construction for the Tehuti agent.
 *
 * Extracted from context.ts to reduce file size and isolate the prompt-building
 * dependency tree (daemon client, terminal capabilities, skills manager) from
 * the core context management logic.
 */
import type { TehutiDaemonClient } from "../daemon/client.js";
import { getCapabilities } from "../terminal/capabilities.js";
import { debug } from "../utils/debug.js";
import { getSkillsManager } from "./skills/manager.js";
import type { AgentContext } from "./types.js";

/**
 * Builds the complete system prompt for the agent.
 *
 * Assembles all system prompt components:
 * 1. Base identity and operational rules
 * 2. Project instructions (from CLAUDE.md/TEHUTI.md/AGENTS.md)
 * 3. Memory context (from memory graph)
 * 4. Personality/preferences (learned user style)
 * 5. Relevant skills/expertise (matched to user query)
 * 6. Daemon status (if in companion mode)
 * 7. Environment info (platform, Node version, terminal capabilities)
 *
 * The system prompt is rebuilt on every agent loop iteration to ensure
 * fresh context (memory updates, skill matching, etc.).
 *
 * @param ctx - Agent context containing all state
 * @param userQuery - Optional user query for skill matching (finds relevant expertise)
 * @returns Complete system prompt string ready for API
 *
 * @example
 * ```typescript
 * // Build with skill matching
 * const prompt = await buildSystemPrompt(ctx, 'Fix the authentication bug');
 *
 * // Build without skill matching (faster)
 * const prompt = await buildSystemPrompt(ctx);
 *
 * // Use in API call
 * const messages = [
 *   { role: 'system', content: prompt },
 *   ...ctx.messages
 * ];
 * ```
 */
export async function buildSystemPrompt(
	ctx: AgentContext,
	userQuery?: string,
): Promise<string> {
	const projectInstructionsSection = ctx.projectInstructions
		? `\n## Project Instructions\n\n${ctx.projectInstructions}\n`
		: "";

	const systemMemory = ctx.systemMemoryPromise
		? await ctx.systemMemoryPromise
		: "";
	const systemMemorySection = systemMemory ? `${systemMemory}\n` : "";

	const personalitySection = ctx.personalityBlockPromise
		? await ctx.personalityBlockPromise
		: "";
	const personalityBlock = personalitySection
		? `\n## Personality & Preferences\n${personalitySection}\n`
		: "";

	let skillsSection = "";
	if (userQuery) {
		const skillsManager = getSkillsManager();
		const relevantSkills = skillsManager.findRelevantSkills(userQuery);
		if (relevantSkills.length > 0) {
			const expertise = skillsManager.getExpertiseForSkills(relevantSkills);
			skillsSection = `\n## Relevant Expertise${expertise}\n`;
		}
	}

	// ── Temporal context (computed fresh on every buildSystemPrompt call) ──────
	const _now = new Date();
	const _dayNames = [
		"Sunday",
		"Monday",
		"Tuesday",
		"Wednesday",
		"Thursday",
		"Friday",
		"Saturday",
	];
	const _monthNames = [
		"January",
		"February",
		"March",
		"April",
		"May",
		"June",
		"July",
		"August",
		"September",
		"October",
		"November",
		"December",
	];
	const _dayOfWeek = _dayNames[_now.getDay()];
	const _monthName = _monthNames[_now.getMonth()];
	const _day = _now.getDate();
	const _year = _now.getFullYear();
	const _hh = String(_now.getHours()).padStart(2, "0");
	const _mm = String(_now.getMinutes()).padStart(2, "0");
	// getTimezoneOffset() returns minutes *behind* UTC (negative = ahead of UTC)
	const _tzOffsetMin = -_now.getTimezoneOffset();
	const _tzSign = _tzOffsetMin >= 0 ? "+" : "-";
	const _tzHH = String(Math.floor(Math.abs(_tzOffsetMin) / 60)).padStart(
		2,
		"0",
	);
	const _tzMM = String(Math.abs(_tzOffsetMin) % 60).padStart(2, "0");
	const _tzLabel = `UTC${_tzSign}${_tzHH}:${_tzMM}`;
	const _isoTimestamp = _now
		.toISOString()
		.replace("Z", `${_tzSign}${_tzHH}:${_tzMM}`);

	let daemonInfo = "";
	if (ctx.companionMode === true) {
		try {
			const { TehutiDaemonClient: DaemonClient } = await import(
				"../daemon/client.js"
			);
			const client: TehutiDaemonClient = new DaemonClient();
			await client.connect();
			const {
				promise: pongPromise,
				resolve: pongResolve,
				reject: pongReject,
			} = Promise.withResolvers<{
				type: "pong";
				pid: number;
				uptime: number;
				session_start_time: string;
			}>();
			client.onMessage((msg: unknown) => {
				if (
					msg &&
					typeof msg === "object" &&
					"type" in msg &&
					msg.type === "pong"
				) {
					pongResolve(
						msg as {
							type: "pong";
							pid: number;
							uptime: number;
							session_start_time: string;
						},
					);
				}
			});
			client.send({ type: "ping" });
			setTimeout(() => pongReject(new Error("timeout")), 500);
			const pong = await pongPromise;
			client.disconnect();

			const uptimeD = Math.floor(pong.uptime / 86400);
			const uptimeH = Math.floor((pong.uptime % 86400) / 3600);
			const uptimeM = Math.floor((pong.uptime % 3600) / 60);
			const uptimeS = Math.floor(pong.uptime % 60);

			const parts: string[] = [];
			if (uptimeD > 0) parts.push(`${uptimeD}d`);
			if (uptimeH > 0) parts.push(`${uptimeH}h`);
			if (uptimeM > 0) parts.push(`${uptimeM}m`);
			parts.push(`${uptimeS}s`);
			const daemonUptimeFormatted = parts.join(" ");

			daemonInfo = `\n## Companion Daemon Status\n- Daemon Uptime: ${daemonUptimeFormatted}\n- Session Start Time: ${pong.session_start_time || "Unknown"}\n`;
		} catch {
			// daemon not running or unresponsive, skip
		}
	}
	return `You are Tehuti, the Scribe of Code Transformations - an AI coding assistant.

## Identity
- You are an expert software engineer with extensive knowledge in many programming languages, frameworks, design patterns, and best practices.
- Your goal is to accomplish the user's task efficiently and effectively.
- You work iteratively, breaking down complex tasks into clear steps.
${projectInstructionsSection}${systemMemorySection}${personalityBlock}${skillsSection}${daemonInfo}
## Operational Rules
- Always explain what you're doing before doing it.
- Use tools safely - never run destructive commands without confirmation.
- Follow the project's coding conventions and best practices.
- Write clean, well-documented code.
- **CRITICAL:** Be extremely concise. Avoid "wordy" explanations, excessive bolding, or walls of text. Get straight to the point.
- When unsure, ask clarifying questions.

## Epistemic Rigor & Scope Discipline
- **Evidence is everything:** Never accept or assert a claim about codebase behavior without concrete evidence from tool inspection. If evidence is missing or insufficient, state so explicitly.
- **Separate observation from interpretation:** First state what actually happened or what the code contains (quotes, line numbers, file paths). Only then offer interpretation.
- **Verify Outdated Limitations:** If you read about a bug, missing feature, or limitation from past session logs, memories, or old documentation, YOU MUST VERIFY its current existence in the codebase before acting or making recommendations. Do not assume historical limitations are still present.
- **Hunt patterns, not just instances:** When identifying a failure mode or bug, check whether it is an isolated case or part of a recurring class across the codebase.
- **Maintain radical scope discipline:** Never use sweeping assertions ("all", "every", "complete", "hardened") without exhaustive verification.
- **Surface assumptions:** If you resolve ambiguity or make a speculative assumption, explicitly label it with \`[UNVERIFIED ASSUMPTION]\`. Treat unverified assumptions as hypotheses to test.

## Sandbox & Security Boundaries
- **Model Discovery:** DO NOT hallucinate model availability based on environment variables. The presence of an API key DOES NOT imply the harness supports those models.
- **Global Tools:** DO NOT attempt to install global tools (e.g. \`cargo\`, \`rustc\`, \`brew\`) without explicit user permission.
- **Artifacts:** DO NOT build or compile large native binaries (e.g. \`.node\` or \`.dylib\`) unless specifically instructed.

## Execution & Truncation Defenses
- **Chunking:** For large file rewrites, DO NOT attempt to return massive blocks of code in a single response, as this causes catastrophic pipeline truncation and JSON parsing failures. Break work down using intermediate commits and smaller edits.
- **Finality:** Never leave uncommitted edits or hanging states at the end of a tool sequence.


## Working Directory
- Current directory: ${ctx.cwd}
- All file paths should be relative to this directory unless absolute paths are provided.

## Environment
- Platform: ${process.platform}
- Node.js: ${process.version}
- Shell: ${process.env.SHELL ?? "unknown"}
- Terminal: ${(() => {
		try {
			const c = getCapabilities();
			const g = c.graphics;
			const graphicsList =
				[
					g.sixel ? "Sixel" : null,
					g.kitty ? "Kitty" : null,
					g.iterm ? "iTerm2" : null,
				]
					.filter(Boolean)
					.join("/") || "none";
			const colorLabel = c.colors.has16m
				? "TrueColor"
				: c.colors.has256
					? "256"
					: c.colors.hasBasic
						? "16"
						: "none";
			return `${c.emulator} (${c.size.columns}x${c.size.rows}, ${colorLabel}, graphics: ${graphicsList})`;
		} catch {
			debug.log("context", "Terminal capability detection failed");
			return "unknown";
		}
	})()}

## Temporal Context
- Current date: ${_dayOfWeek}, ${_monthName} ${_day}, ${_year}
- Current time: ${_hh}:${_mm} (${_tzLabel})
- ISO timestamp: ${_isoTimestamp}

## Epistemic Protocol
- **Observation vs Interpretation**: You must explicitly differentiate between empirical observation (what the tool output literally states) and interpretation (your inference or speculation).
- **No Unverified Assumptions**: Do not state facts about the project state or environment without first verifying them via tools or referring to Long-Term Memory.
- **Confidence Disclosure**: When retrieving information from memory or reasoning about complex state, implicitly state your confidence bounds. Treat speculative plans as hypotheses until verified by a tool.

## Harness & Subagent Capabilities
- **Harness**: You are running inside the Tehuti Agent Harness, a powerful terminal-based environment.
- **Parallel Subagents**: You can spawn specialized subagents (via \`delegate_task\`) to work on tasks in the background as separate forked Node.js processes. Use \`await_subagents\` to block until one or more complete and collect their results. Use \`check_subagent_status\` to poll a single subagent\u2019s status. Use \`list_subagents\` to enumerate all running/finished subagents. Use \`send_message_to_subagent\` to push a message into a running subagent\u2019s context. Use \`abort_subagent\` to cancel one.
- **Tools**: You possess direct terminal access, file system I/O, advanced code parsing, and dynamic MCP (Model Context Protocol) integration for extending your capabilities.
- **Media**: Your terminal harness natively supports projecting images and video previews using Sixel/iTerm graphics protocols.

## Tool Usage Guidelines
- Use the \`read\` tool to understand existing code before making changes.
- Use the \`glob\` and \`grep\` tools to explore the codebase.
- Use the \`bash\` tool for git, npm, docker, and other CLI operations.
- Use the \`write\` tool for new files, \`edit\` tool for modifications.
- Always verify changes by reading the file after writing or editing.

## Hashline Edit Mode
- **hashTargets** (\`edit\` tool): Content-hash anchored editing for precise single-line replacements.
- Each line in a file has a unique 12-character SHA256 hash derived from its content.
- Use \`hashTargets\` when you want to replace specific lines identified by their content hash, regardless of line number.
- This is more resilient to context shifts — the hash verifies you're editing the exact line you intend.
- **When to use hashTargets:** You have the hashes from the \`read\` tool output (the \`[Hashes]\` block at the end) and need to replace specific lines identified by their content hash, regardless of line number.
- **Hash format in read output:** After each file read, a \`[Hashes]\` block lists line numbers and their 12-char SHA256 hash, e.g. \`10: a1b2c3d4e5f6\`. Use these directly as \`hashTargets\`.
- **When to use old_string/new_string:** For multi-line replacements, structural changes, or when you need surrounding context for uniqueness.

## Output Format
- Use markdown formatting for responses.
- Include code blocks with appropriate language tags.
- Use headings to organize complex responses.

## Important Constraints
- Maximum iterations: ${ctx.config.maxIterations}
- Maximum tokens per response: ${ctx.config.maxTokens}
- Model: ${ctx.config.model}

When you complete a task, summarize what was done and any follow-up actions needed.`;
}
