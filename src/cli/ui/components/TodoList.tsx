import { Box, Text } from "ink";
import React, { useEffect, useState } from "react";
import { getTodos } from "../../../agent/tools/system.js";
import { BRANDING, DECORATIVE } from "../../../branding/index.js";

export function TodoList() {
	const [todos, setTodos] = useState(getTodos());

	useEffect(() => {
		const interval = setInterval(() => {
			setTodos(getTodos());
		}, 1000);
		return () => clearInterval(interval);
	}, []);

	if (!todos || todos.length === 0) {
		return null;
	}

	const GOLD = BRANDING.colors?.primary || "#F5C518";
	const NILE = BRANDING.colors?.nile || "#165DFF";
	const GREEN = BRANDING.colors?.green || "#22C55E";
	const GRAY = BRANDING.colors?.gray || "#9CA3AF";
	const RED = BRANDING.colors?.red || "#EF4444";

	return (
		<Box flexDirection="column" paddingY={1} paddingX={1}>
			<Box marginBottom={1}>
				<Text color={GOLD} bold>
					{DECORATIVE.scroll} Active Tasks
				</Text>
			</Box>
			<Box flexDirection="column" paddingLeft={2}>
				{todos.map((todo) => {
					let icon = "⏳";
					let color: string = GRAY;

					if (todo.status === "completed") {
						icon = "✅";
						color = GREEN;
					} else if (todo.status === "in_progress") {
						icon = "🔄";
						color = NILE;
					} else if (todo.status === "cancelled") {
						icon = "❌";
						color = RED;
					}

					let priorityMark = "";
					if (todo.priority === "high") priorityMark = " 🔴";
					if (todo.priority === "medium") priorityMark = " 🟡";
					if (todo.priority === "low") priorityMark = " 🟢";

					return (
						<Box key={todo.id} flexDirection="row">
							<Text color={color}>
								{icon} [{todo.id}]{priorityMark}{" "}
							</Text>
							<Text color={color}>{todo.content}</Text>
						</Box>
					);
				})}
			</Box>
		</Box>
	);
}
