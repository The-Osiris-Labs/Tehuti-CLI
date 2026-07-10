import { Box, Text, useStdout } from "ink";
import React, { useEffect, useState } from "react";
import chalk from "chalk";
import stringWidth from "string-width";
import {
	type SubagentTask,
	swarmManager,
} from "../../../agent/swarm/manager.js";
import { BRANDING, DECORATIVE, HIEROGLYPHS } from "../../../branding/index.js";

const COLORS = {
	gold: BRANDING.colors?.primary || "#F5C518",
	coral: BRANDING.colors?.coral || "#FF6B35",
	sand: BRANDING.colors?.gray || "#9CA3AF",
	nile: BRANDING.colors?.nile || "#165DFF",
	green: BRANDING.colors?.green || "#22C55E",
} as const;

export interface SubagentState {
	id: string;
	role: string;
	status: "working" | "idle" | "error" | "killed";
	currentTask: string;
	tokensUsed: number;
	toolCallCount: number;
	startedAt: number;
}

function mapTaskToState(
	task: Omit<SubagentTask, "abortController">,
): SubagentState {
	let status: SubagentState["status"] = "working";
	if (task.status === "completed") status = "idle";
	else if (task.status === "failed") status = "error";
	else if (task.status === "killed") status = "killed";

	return {
		id: task.id.split("-")[0] || task.id,
		role: "Subagent",
		status,
		currentTask: task.prompt,
		tokensUsed: task.tokensUsed || 0,
		toolCallCount: task.toolCallCount || 0,
		startedAt: task.startedAt?.getTime() ?? Date.now(),
	};
}

function formatElapsed(ms: number): string {
	if (ms < 0) ms = 0;
	const sec = Math.floor(ms / 1000);
	if (sec < 60) return `${sec}s`;
	const min = Math.floor(sec / 60);
	if (min < 60) return `${min}m ${sec % 60}s`;
	const hr = Math.floor(min / 60);
	return `${hr}h ${min % 60}m`;
}

// biome-ignore lint/complexity/useRegexLiterals: literals with ESC bytes trigger noControlCharactersInRegex.
const ANSI_STRIP_REGEX = new RegExp(
	"[\\x1b\\x9b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]",
	"g",
);

function stripAnsi(str: string): string {
	return str.replace(ANSI_STRIP_REGEX, "");
}

function padRight(str: string, width: number): string {
	const len = stringWidth(stripAnsi(str));
	if (len >= width) return str;
	return str + " ".repeat(width - len);
}

function padLeft(str: string, width: number): string {
	const len = stringWidth(stripAnsi(str));
	if (len >= width) return str;
	return " ".repeat(width - len) + str;
}

function sliceAnsi(str: string, limit: number): string {
	let visibleWidth = 0;
	let output = "";
	let i = 0;

	// biome-ignore lint/complexity/useRegexLiterals:
	const ANSI_SEQUENCE_REGEX = new RegExp("^\\x1b\\[[0-9;]*[a-zA-Z]");

	while (i < str.length) {
		const remaining = str.slice(i);
		const match = remaining.match(ANSI_SEQUENCE_REGEX);
		if (match) {
			output += match[0];
			i += match[0].length;
		} else {
			const char = str[i];
			const charWidth = stringWidth(char);
			if (visibleWidth + charWidth > limit) {
				break;
			}
			visibleWidth += charWidth;
			output += char;
			i++;
		}
	}
	if (i < str.length) {
		output += "\x1b[0m";
	}
	return output;
}

export function SwarmVisualizer(): React.ReactElement {
	const [agents, setAgents] = useState<SubagentState[]>(() =>
		swarmManager.listSubagents().map(mapTaskToState),
	);
	const [frame, setFrame] = useState(0);
	const { stdout } = useStdout();
	const termWidth = stdout?.columns || 80;

	useEffect(() => {
		const handleUpdate = (tasks: Omit<SubagentTask, "abortController">[]) => {
			setAgents(tasks.map(mapTaskToState));
		};

		swarmManager.on("update", handleUpdate);
		handleUpdate(swarmManager.listSubagents());

		const tick = setInterval(() => {
			setFrame((f) => (f + 1) % HIEROGLYPHS.loading.length);
			handleUpdate(swarmManager.listSubagents());
		}, 150);

		return () => {
			swarmManager.off("update", handleUpdate);
			clearInterval(tick);
		};
	}, []);

	const totalTokens = agents.reduce((s, a) => s + a.tokensUsed, 0);
	const workingCount = agents.filter((a) => a.status === "working").length;
	const now = Date.now();

	const W_ID = 10;
	const W_STATUS = 12;
	const W_TOOLS = 7;
	const W_TOKENS = 8;
	const W_ELAPSED = 8;
	const W_TASK = Math.max(10, termWidth - (W_ID + W_STATUS + W_TOOLS + W_TOKENS + W_ELAPSED + 18));

	const headerCols = [
		chalk.hex(COLORS.gold).bold(padRight("AGENT ID", W_ID)),
		chalk.hex(COLORS.gold).bold(padRight("STATUS", W_STATUS)),
		chalk.hex(COLORS.gold).bold(padRight("CURRENT TASK", W_TASK)),
		chalk.hex(COLORS.gold).bold(padLeft("TOOLS", W_TOOLS)),
		chalk.hex(COLORS.gold).bold(padLeft("TOKENS", W_TOKENS)),
		chalk.hex(COLORS.gold).bold(padLeft("ELAPSED", W_ELAPSED))
	];
	const headerStr = "  " + headerCols.join("  ");

	const rows: string[] = [];
	if (agents.length === 0) {
		rows.push("  " + chalk.hex(COLORS.sand).italic("No active subagents in the swarm."));
	} else {
		for (let i = 0; i < agents.length; i++) {
			const agent = agents[i];
			const elapsed = formatElapsed(now - agent.startedAt);
			
			let statusStr = "";
			if (agent.status === "working") {
				statusStr = chalk.hex(COLORS.gold).bgHex("#332200")(` ${HIEROGLYPHS.loading[frame]} RUNNING `);
			} else if (agent.status === "idle") {
				statusStr = chalk.hex(COLORS.green).bgHex("#001500")(` ${DECORATIVE.ankh} SUCCESS `);
			} else if (agent.status === "error") {
				statusStr = chalk.hex(COLORS.coral).bgHex("#220000")(` ${DECORATIVE.eyeOfHorus} ERROR `);
			} else {
				statusStr = chalk.hex(COLORS.sand).bgHex("#222222")(` ✕ KILLED `);
			}
			statusStr = padRight(statusStr, W_STATUS);

			let taskStr = agent.currentTask.replace(/\n/g, " ");
			if (stringWidth(taskStr) > W_TASK) {
				taskStr = sliceAnsi(taskStr, W_TASK - 3) + "...";
			} else {
				taskStr = padRight(taskStr, W_TASK);
			}
			if (agent.status === "idle" || agent.status === "killed") {
				taskStr = chalk.hex(COLORS.sand)(taskStr);
			}

			const cols = [
				chalk.hex(COLORS.nile)(padRight(agent.id, W_ID)),
				statusStr,
				taskStr,
				chalk.hex(COLORS.nile).bold(padLeft(String(agent.toolCallCount), W_TOOLS)),
				chalk.hex(COLORS.gold)(padLeft(agent.tokensUsed.toLocaleString(), W_TOKENS)),
				chalk.hex(COLORS.sand).dim(padLeft(elapsed, W_ELAPSED))
			];
			rows.push("  " + cols.join("  "));
		}
	}

	return (
		<Box
			flexDirection="column"
			borderStyle="round"
			borderColor={COLORS.nile}
			paddingX={1}
		>
			<Box marginBottom={1} gap={2}>
				<Text color={COLORS.nile} bold>
					{`${DECORATIVE.ibis} SWARM OBSERVABILITY DASHBOARD`}
				</Text>
				<Text color={COLORS.sand} dimColor>
					{`${workingCount} active • ${totalTokens.toLocaleString()} tokens`}
				</Text>
			</Box>
			<Box flexDirection="column" gap={0}>
				<Text>{headerStr}</Text>
				<Text>{rows.join("\n")}</Text>
			</Box>
		</Box>
	);
}
