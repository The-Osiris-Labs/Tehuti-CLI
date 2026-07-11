import { Box, Text, useInput } from "ink";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { type TraceEvent, trace } from "../../../utils/trace.js";

interface TraceNode {
	event: TraceEvent;
	children: TraceNode[];
}

export function Profiler({ onClose }: { onClose: () => void }) {
	const [offset, setOffset] = useState(0);
	const [events, setEvents] = useState<TraceEvent[]>([]);

	useEffect(() => {
		// Fetch trace events; reverse to build hierarchy from chronological stream
		const allEvents = trace.recent(2000).reverse();
		setEvents(allEvents);
	}, []);

	const roots = useMemo(() => {
		const byId = new Map<string, TraceNode>();
		const rootNodes: TraceNode[] = [];

		for (const ev of events) {
			const node: TraceNode = { event: ev, children: [] };
			if (ev.correlationId) {
				byId.set(ev.correlationId, node);
			}

			if (ev.parentId && byId.has(ev.parentId)) {
				byId.get(ev.parentId)!.children.push(node);
			} else {
				rootNodes.push(node);
			}
		}
		// Return reversed so newest events appear at the top
		return rootNodes.reverse();
	}, [events]);

	useInput((input, key) => {
		if (key.escape || input.toLowerCase() === "q") {
			onClose();
			return;
		}
		if (key.upArrow) {
			setOffset((prev) => Math.max(0, prev - 1)); // Scrub backward in time
		}
		if (key.downArrow) {
			setOffset((prev) => Math.min(Math.max(0, roots.length - 1), prev + 1)); // Scrub forward
		}
	});

	const visibleRoots = roots.slice(offset, offset + 15);

	const renderNode = (node: TraceNode, depth: number = 0): React.ReactNode => {
		const indent = "  ".repeat(depth);
		const ev = node.event;

		const maxBarLength = 20;
		let bar = "";
		if (ev.durationMs) {
			const blocks = Math.min(
				maxBarLength,
				Math.ceil((ev.durationMs / 3000) * maxBarLength),
			);
			bar = "█".repeat(Math.max(1, blocks));
		}

		return (
			<Box
				key={ev.ts + (ev.correlationId || Math.random().toString())}
				flexDirection="column"
			>
				<Box flexDirection="row">
					<Text color="gray">
						{indent}
						{depth > 0 ? "├─ " : "■ "}
					</Text>
					<Text color="magenta">[{ev.actor.slice(0, 8).padEnd(8)}] </Text>
					<Text color="cyan">{ev.kind.padEnd(16)} </Text>
					<Text>{ev.summary.slice(0, 45).padEnd(45)} </Text>
					{ev.durationMs !== undefined && (
						<Text color="yellow">
							{" "}
							({String(ev.durationMs).padStart(4)}ms) {bar}
						</Text>
					)}
				</Box>
				{node.children.map((child) => renderNode(child, depth + 1))}
			</Box>
		);
	};

	return (
		<Box
			flexDirection="column"
			borderStyle="round"
			borderColor="magenta"
			padding={1}
			width="100%"
		>
			<Text color="cyan" bold>
				🔥 TraceVisualizer Flame Graph (Scrub backwards: Up/Down Arrows, Q/Esc
				to quit)
			</Text>
			<Box flexDirection="column" marginTop={1}>
				{visibleRoots.length === 0 ? (
					<Text color="gray">No trace data available.</Text>
				) : (
					visibleRoots.map((root) => renderNode(root, 0))
				)}
			</Box>
			<Box marginTop={1}>
				<Text color="gray" dimColor>
					Showing items {roots.length > 0 ? offset + 1 : 0}-
					{Math.min(roots.length, offset + 15)} of {roots.length} roots.
				</Text>
			</Box>
		</Box>
	);
}
