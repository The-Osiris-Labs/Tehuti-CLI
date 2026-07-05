import { Box, Text } from "ink";
import { useEffect, useState } from "react";
import {
	type SubagentTask,
	swarmManager,
} from "../../../agent/swarm/manager.js";
import { BRANDING, DECORATIVE } from "../../../branding/index.js";

const {
	gold: GOLD,
	coral: CORAL,
	sand: GRAY,
	nile: CYAN,
	primary: GREEN,
} = BRANDING.colors;

export interface SubagentState {
	id: string;
	role: string;
	status: "idle" | "working" | "error";
	currentTask: string;
	tokensUsed: number;
}

function mapTaskToState(
	task: Omit<SubagentTask, "abortController">,
): SubagentState {
	let status: SubagentState["status"] = "working";
	if (task.status === "completed" || task.status === "killed") status = "idle";
	if (task.status === "failed") status = "error";

	return {
		id: task.id.split("-")[0] || task.id,
		role: "Subagent",
		status,
		currentTask:
			task.prompt.length > 35
				? `${task.prompt.substring(0, 32)}...`
				: task.prompt,
		tokensUsed: task.tokensUsed || 0,
	};
}

export function SwarmVisualizer() {
	const [agents, setAgents] = useState<SubagentState[]>(() =>
		swarmManager.listSubagents().map(mapTaskToState),
	);

	useEffect(() => {
		const handleUpdate = (tasks: Omit<SubagentTask, "abortController">[]) => {
			setAgents(tasks.map(mapTaskToState));
		};

		swarmManager.on("update", handleUpdate);
		handleUpdate(swarmManager.listSubagents());

		return () => {
			swarmManager.off("update", handleUpdate);
		};
	}, []);

	return (
		<Box
			flexDirection="column"
			borderStyle="round"
			borderColor={CYAN}
			paddingX={1}
		>
			<Box marginBottom={1}>
				<Text color={CYAN} bold>
					{DECORATIVE.ibis} SWARM OBSERVABILITY DASHBOARD
				</Text>
			</Box>

			<Box flexDirection="row" marginBottom={1}>
				<Box flexBasis={12} flexGrow={0} flexShrink={0}>
					<Text color={GOLD} bold>
						AGENT ID
					</Text>
				</Box>
				<Box flexBasis={15} flexGrow={1} flexShrink={1}>
					<Text color={GOLD} bold>
						ROLE
					</Text>
				</Box>
				<Box flexBasis={10} flexGrow={0} flexShrink={0}>
					<Text color={GOLD} bold>
						STATUS
					</Text>
				</Box>
				<Box flexBasis={20} flexGrow={2} flexShrink={1}>
					<Text color={GOLD} bold>
						CURRENT TASK
					</Text>
				</Box>
				<Box flexBasis={10} flexGrow={0} flexShrink={0}>
					<Text color={GOLD} bold>
						TOKENS
					</Text>
				</Box>
			</Box>

			{agents.length === 0 ? (
				<Box padding={1}>
					<Text color={GRAY} italic>
						No active subagents in the swarm.
					</Text>
				</Box>
			) : (
				agents.map((agent) => {
					const statusColor =
						agent.status === "working"
							? GREEN
							: agent.status === "error"
								? CORAL
								: GRAY;
					return (
						<Box key={agent.id} flexDirection="row" marginBottom={0}>
							<Box flexBasis={12} flexGrow={0} flexShrink={0}>
								<Text color={CYAN}>{agent.id}</Text>
							</Box>
							<Box flexBasis={15} flexGrow={1} flexShrink={1}>
								<Text>{agent.role}</Text>
							</Box>
							<Box flexBasis={10} flexGrow={0} flexShrink={0}>
								<Text color={statusColor}>{agent.status}</Text>
							</Box>
							<Box flexBasis={20} flexGrow={2} flexShrink={1}>
								<Text dimColor={agent.status === "idle"}>
									{agent.currentTask}
								</Text>
							</Box>
							<Box flexBasis={10} flexGrow={0} flexShrink={0}>
								<Text color={GOLD}>{agent.tokensUsed.toLocaleString()}</Text>
							</Box>
						</Box>
					);
				})
			)}
		</Box>
	);
}
