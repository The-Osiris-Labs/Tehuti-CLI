import { createReadStream } from "node:fs";
import * as readline from "node:readline";
import type { TraceEvent } from "./trace.js";

/**
 * A strictly typed node representing an entity (e.g., a subagent or tool execution)
 * in the swarm lifecycle tree, parsed from a collection of trace events.
 */
export interface SwarmProfileNode {
	id: string;
	parentId: string | null;
	name: string;
	ts: number;
	durationMs: number;
	events: TraceEvent[];
	children: SwarmProfileNode[];
}

/**
 * Parses a trace.jsonl file into a strictly typed hierarchical tree
 * suitable for the Swarm Profiler.
 *
 * @param filePath The absolute path to the trace.jsonl file.
 */
export async function parseTraceFile(
	filePath: string,
): Promise<SwarmProfileNode[]> {
	const events: TraceEvent[] = [];
	const fileStream = createReadStream(filePath);
	const rl = readline.createInterface({
		input: fileStream,
		crlfDelay: Infinity,
	});

	for await (const line of rl) {
		if (!line.trim()) continue;
		try {
			events.push(JSON.parse(line));
		} catch (e) {
			// Silently ignore malformed JSON lines
		}
	}

	return correlateTraceEvents(events);
}

/**
 * Correlates arrays of TraceEvents into a hierarchical tree based on
 * ts, durationMs, and parentId fields.
 */
export function correlateTraceEvents(events: TraceEvent[]): SwarmProfileNode[] {
	const nodesById = new Map<string, SwarmProfileNode>();
	const standaloneNodes: SwarmProfileNode[] = [];

	// First pass: Group events by their distinct trace ID (correlationId or subagentId)
	for (const event of events) {
		const id = event.correlationId ?? event.subagentId;

		if (!id) {
			// Standalone event (no ID to correlate with other events)
			standaloneNodes.push({
				id: `standalone-${Math.random().toString(36).slice(2)}`,
				parentId: event.parentId ?? null,
				name: event.summary,
				ts: event.ts,
				durationMs: event.durationMs ?? 0,
				events: [event],
				children: [],
			});
			continue;
		}

		let node = nodesById.get(id);
		if (!node) {
			node = {
				id,
				parentId: event.parentId ?? null,
				name: event.summary,
				ts: event.ts,
				durationMs: event.durationMs ?? 0,
				events: [],
				children: [],
			};
			nodesById.set(id, node);
		}

		node.events.push(event);

		// Reconcile parentId (take the first non-null parentId encountered in the group)
		if (!node.parentId && event.parentId) {
			node.parentId = event.parentId;
		}

		// Reconcile ts (earliest timestamp in the group)
		if (event.ts < node.ts) {
			node.ts = event.ts;
		}

		// Reconcile durationMs (take the explicit durationMs if available and larger)
		if (event.durationMs !== undefined && event.durationMs > node.durationMs) {
			node.durationMs = event.durationMs;
		}

		// Prefer naming the node after its spawn or start event for better semantics
		if (event.kind.includes("spawn") || event.kind.includes("start")) {
			node.name = event.summary;
		}
	}

	// Calculate implicit durationMs for nodes that didn't have one explicitly set,
	// based on the time delta between its first and last correlated event.
	for (const node of nodesById.values()) {
		if (node.durationMs === 0 && node.events.length > 1) {
			const maxTs = Math.max(...node.events.map((e) => e.ts));
			node.durationMs = maxTs - node.ts;
		}
	}

	// Second pass: Link children to their parent nodes to form the hierarchical tree
	const rootNodes: SwarmProfileNode[] = [];
	const allNodes = [...nodesById.values(), ...standaloneNodes];

	for (const node of allNodes) {
		if (node.parentId) {
			const parent = nodesById.get(node.parentId);
			if (parent) {
				parent.children.push(node);
			} else {
				// Parent ID references a node not present in this trace segment
				rootNodes.push(node);
			}
		} else {
			// No parent ID, so it's a root node
			rootNodes.push(node);
		}
	}

	// Third pass: Sort children chronologically by start timestamp (ts)
	const sortNodes = (nodes: SwarmProfileNode[]) => {
		nodes.sort((a, b) => a.ts - b.ts);
		for (const node of nodes) {
			if (node.children.length > 0) {
				sortNodes(node.children);
			}
		}
	};

	sortNodes(rootNodes);

	return rootNodes;
}
