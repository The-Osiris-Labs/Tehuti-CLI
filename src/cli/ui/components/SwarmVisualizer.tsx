// @ts-expect-error TS6133/TS6192: Unused variable
import chalk from "chalk";
import { Box, Text, useStdout } from "ink";
import type React from "react";
import { useEffect, useState } from "react";
import {
	type SubagentTask,
	swarmManager,
} from "../../../agent/swarm/manager.js";
import { BRANDING, DECORATIVE, HIEROGLYPHS, isAsciiMode, ASCII_DECORATIVE, ASCII_HIEROGLYPHS } from "../../../branding/index.js";
import { respectReducedMotion } from "../accessibility.js";

const COLORS = {
	gold: BRANDING.colors.primary,
	coral: BRANDING.colors.coral,
	sand: BRANDING.colors.gray,
	nile: BRANDING.colors.nile,
	green: BRANDING.colors.green,
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

export function SwarmVisualizer(): React.ReactElement {
	const ascii = isAsciiMode();
	const [agents, setAgents] = useState<SubagentState[]>(() =>
		swarmManager.listSubagents().map(mapTaskToState),
	);
	const [frame, setFrame] = useState(0);
	const { stdout } = useStdout();
	// @ts-expect-error TS6133/TS6192: Unused variable
	const termWidth = stdout?.columns || 80;

	useEffect(() => {
		const handleUpdate = (tasks: Omit<SubagentTask, "abortController">[]) => {
			setAgents(tasks.map(mapTaskToState));
		};

		swarmManager.on("update", handleUpdate);
		handleUpdate(swarmManager.listSubagents());

	const reduceMotion = respectReducedMotion();
	const tick = setInterval(() => {
		if (!reduceMotion) {
			setFrame((f) => (f + 1) % (ascii ? ASCII_HIEROGLYPHS.loading : HIEROGLYPHS.loading).length);
		}
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

	const headerRow = (
		<Box flexDirection="row" paddingX={2} gap={2} marginBottom={0}>
			<Box width={10}>
				<Text color={COLORS.gold} bold>
					AGENT ID
				</Text>
			</Box>
			<Box width={16}>
				<Text color={COLORS.gold} bold>
					STATUS
				</Text>
			</Box>
			<Box flexGrow={1}>
				<Text color={COLORS.gold} bold>
					CURRENT TASK
				</Text>
			</Box>
			<Box width={8} justifyContent="flex-end">
				<Text color={COLORS.gold} bold>
					TOOLS
				</Text>
			</Box>
			<Box width={10} justifyContent="flex-end">
				<Text color={COLORS.gold} bold>
					TOKENS
				</Text>
			</Box>
			<Box width={10} justifyContent="flex-end">
				<Text color={COLORS.gold} bold>
					ELAPSED
				</Text>
			</Box>
		</Box>
	);

	const rowElements =
		agents.length === 0 ? (
			<Box paddingX={2}>
				<Text color={COLORS.sand} italic>
					No active subagents in the swarm.
				</Text>
			</Box>
		) : (
			agents.map((agent) => {
				const elapsed = formatElapsed(now - agent.startedAt);

				let statusBg = "";
				let statusColor = "";
				let statusText = "";

				if (agent.status === "working") {
					statusBg = BRANDING.colors.bgWorking;
					statusColor = COLORS.gold;
					statusText = ` ${(ascii ? ASCII_HIEROGLYPHS.loading : HIEROGLYPHS.loading)[frame]} RUNNING `;
				} else if (agent.status === "idle") {
					statusBg = BRANDING.colors.bgSuccess;
					statusColor = COLORS.green;
					statusText = ` ${ascii ? ASCII_DECORATIVE.ankh : DECORATIVE.ankh} SUCCESS `;
				} else if (agent.status === "error") {
					statusBg = BRANDING.colors.bgError;
					statusColor = COLORS.coral;
					statusText = ` ${ascii ? ASCII_DECORATIVE.eyeOfHorus : DECORATIVE.eyeOfHorus} ERROR `;
				} else {
					statusBg = BRANDING.colors.bgKilled;
					statusColor = COLORS.sand;
					statusText = ` ✕ KILLED `;
				}

				const taskColor =
					agent.status === "idle" || agent.status === "killed"
						? COLORS.sand
						: undefined;

				return (
					<Box key={agent.id} flexDirection="row" paddingX={2} gap={2}>
						<Box width={10}>
							<Text color={COLORS.nile} wrap="truncate-end">
								{agent.id}
							</Text>
						</Box>
						<Box width={16}>
							<Text backgroundColor={statusBg} color={statusColor}>
								{statusText}
							</Text>
						</Box>
						<Box flexGrow={1}>
							<Text color={taskColor} wrap="truncate-end">
								{agent.currentTask.replace(/\n/g, " ")}
							</Text>
						</Box>
						<Box width={8} justifyContent="flex-end">
							<Text color={COLORS.nile} bold>
								{agent.toolCallCount}
							</Text>
						</Box>
						<Box width={10} justifyContent="flex-end">
							<Text color={COLORS.gold}>
								{agent.tokensUsed.toLocaleString()}
							</Text>
						</Box>
						<Box width={10} justifyContent="flex-end">
							<Text color={COLORS.sand} dimColor>
								{elapsed}
							</Text>
						</Box>
					</Box>
				);
			})
		);

	return (
		<Box
			flexDirection="column"
			borderStyle="round"
			borderColor={COLORS.nile}
			paddingX={1}
		>
			<Box marginBottom={1} gap={2}>
				<Text color={COLORS.nile} bold>
					{`${ascii ? ASCII_DECORATIVE.ibis : DECORATIVE.ibis} SWARM OBSERVABILITY DASHBOARD`}
				</Text>
				<Text color={COLORS.sand} dimColor>
					{`${workingCount} active • ${totalTokens.toLocaleString()} tokens`}
				</Text>
			</Box>
			<Box flexDirection="column" gap={0}>
				{headerRow}
				{rowElements}
			</Box>
		</Box>
	);
}
