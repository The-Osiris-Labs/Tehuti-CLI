import { Box, Text } from "ink";
import React, { useEffect, useState } from "react";
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
		currentTask:
			task.prompt.length > 35
				? `${task.prompt.substring(0, 32)}...`
				: task.prompt,
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

function statusGlyph(status: SubagentState["status"], frame: number): string {
	switch (status) {
		case "working":
			return HIEROGLYPHS.loading[frame];
		case "idle":
			return HIEROGLYPHS.success;
		case "error":
			return HIEROGLYPHS.error;
		case "killed":
			return "✕";
	}
}

function statusColor(status: SubagentState["status"]): string {
	switch (status) {
		case "working":
			return COLORS.nile;
		case "idle":
			return COLORS.green;
		case "error":
			return COLORS.coral;
		case "killed":
			return COLORS.sand;
	}
}

export function SwarmVisualizer(): React.ReactElement {
	const [agents, setAgents] = useState<SubagentState[]>(() =>
		swarmManager.listSubagents().map(mapTaskToState),
	);
	const [frame, setFrame] = useState(0);

	useEffect(() => {
		const handleUpdate = (tasks: Omit<SubagentTask, "abortController">[]) => {
			setAgents(tasks.map(mapTaskToState));
		};

		swarmManager.on("update", handleUpdate);
		handleUpdate(swarmManager.listSubagents());

		// 150ms tick matches the hieroglyph spinner cadence so the
		// "working" glyph animates in lockstep with the rest of the UI.
		const tick = setInterval(() => {
			setFrame((f) => (f + 1) % HIEROGLYPHS.loading.length);
			// Re-emit a render every 5 ticks (~750ms) so elapsed time
			// stays fresh even when no subagent events fire.
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

	return React.createElement(
		Box,
		{
			flexDirection: "column",
			borderStyle: "round",
			borderColor: COLORS.nile,
			paddingX: 1,
		},
		React.createElement(
			Box,
			{ marginBottom: 1, gap: 2 },
			React.createElement(
				Text,
				{ color: COLORS.nile, bold: true },
				`${DECORATIVE.ibis} SWARM OBSERVABILITY DASHBOARD`,
			),
			React.createElement(
				Text,
				{ color: COLORS.sand, dimColor: true },
				`${workingCount} active • ${totalTokens.toLocaleString()} tokens`,
			),
		),

		React.createElement(
			Box,
			{ flexDirection: "row", marginBottom: 1 },
			React.createElement(
				Box,
				{ flexBasis: 10, flexGrow: 0, flexShrink: 0 },
				React.createElement(
					Text,
					{ color: COLORS.gold, bold: true },
					"AGENT ID",
				),
			),
			React.createElement(
				Box,
				{ flexBasis: 10, flexGrow: 0, flexShrink: 0 },
				React.createElement(Text, { color: COLORS.gold, bold: true }, "STATUS"),
			),
			React.createElement(
				Box,
				{ flexBasis: 18, flexGrow: 2, flexShrink: 1 },
				React.createElement(
					Text,
					{ color: COLORS.gold, bold: true },
					"CURRENT TASK",
				),
			),
			React.createElement(
				Box,
				{ flexBasis: 8, flexGrow: 0, flexShrink: 0 },
				React.createElement(Text, { color: COLORS.gold, bold: true }, "TOOLS"),
			),
			React.createElement(
				Box,
				{ flexBasis: 8, flexGrow: 0, flexShrink: 0 },
				React.createElement(Text, { color: COLORS.gold, bold: true }, "TOKENS"),
			),
			React.createElement(
				Box,
				{ flexBasis: 7, flexGrow: 0, flexShrink: 0 },
				React.createElement(
					Text,
					{ color: COLORS.gold, bold: true },
					"ELAPSED",
				),
			),
		),

		agents.length === 0
			? React.createElement(
					Box,
					{ padding: 1 },
					React.createElement(
						Text,
						{ color: COLORS.sand, italic: true },
						"No active subagents in the swarm.",
					),
				)
			: React.createElement(
					Box,
					{ flexDirection: "column" },
					...agents.map((agent) => {
						const color = statusColor(agent.status);
						const elapsed = formatElapsed(now - agent.startedAt);
						return React.createElement(
							Box,
							{ key: agent.id, flexDirection: "row", marginBottom: 0 },
							React.createElement(
								Box,
								{ flexBasis: 10, flexGrow: 0, flexShrink: 0 },
								React.createElement(Text, { color: COLORS.nile }, agent.id),
							),
							React.createElement(
								Box,
								{ flexBasis: 10, flexGrow: 0, flexShrink: 0, gap: 1 },
								React.createElement(
									Text,
									{ color },
									statusGlyph(agent.status, frame),
								),
								React.createElement(Text, { color }, agent.status),
							),
							React.createElement(
								Box,
								{ flexBasis: 18, flexGrow: 2, flexShrink: 1 },
								React.createElement(
									Text,
									{
										dimColor:
											agent.status === "idle" || agent.status === "killed",
									},
									agent.currentTask,
								),
							),
							React.createElement(
								Box,
								{ flexBasis: 8, flexGrow: 0, flexShrink: 0 },
								React.createElement(
									Text,
									{ color: COLORS.nile, bold: true },
									String(agent.toolCallCount),
								),
							),
							React.createElement(
								Box,
								{ flexBasis: 8, flexGrow: 0, flexShrink: 0 },
								React.createElement(
									Text,
									{ color: COLORS.gold },
									agent.tokensUsed.toLocaleString(),
								),
							),
							React.createElement(
								Box,
								{ flexBasis: 7, flexGrow: 0, flexShrink: 0 },
								React.createElement(
									Text,
									{ color: COLORS.sand, dimColor: true },
									elapsed,
								),
							),
						);
					}),
				),
	);
}
