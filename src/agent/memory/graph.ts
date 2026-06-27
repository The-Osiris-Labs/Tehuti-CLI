import path from "node:path";
import os from "node:os";
import fs from "fs-extra";

export interface Node {
	id: string;
	type: string;
	content: string;
}

export interface Edge {
	source: string;
	target: string;
	relation: string;
}

export interface GraphData {
	nodes: Node[];
	edges: Edge[];
}

const MEMORY_FILE = path.join(os.homedir(), ".tehuti", "memory-graph.json");

export async function loadGraph(): Promise<GraphData> {
	try {
		if (await fs.pathExists(MEMORY_FILE)) {
			return await fs.readJson(MEMORY_FILE);
		}
	} catch (error) {
		// Ignore parse errors, just return empty
	}
	return { nodes: [], edges: [] };
}

export async function saveGraph(graph: GraphData): Promise<void> {
	await fs.ensureDir(path.dirname(MEMORY_FILE));
	await fs.writeJson(MEMORY_FILE, graph, { spaces: 2 });
}

export async function addNode(id: string, type: string, content: string): Promise<void> {
	const graph = await loadGraph();
	const existingIndex = graph.nodes.findIndex((n) => n.id === id);
	if (existingIndex >= 0) {
		graph.nodes[existingIndex] = { id, type, content };
	} else {
		graph.nodes.push({ id, type, content });
	}
	await saveGraph(graph);
}

export async function addEdge(source: string, target: string, relation: string): Promise<void> {
	const graph = await loadGraph();
	graph.edges.push({ source, target, relation });
	await saveGraph(graph);
}

export async function searchGraph(query: string): Promise<Node[]> {
	const graph = await loadGraph();
	const lowerQuery = query.toLowerCase();
	return graph.nodes.filter(
		(n) => n.id.toLowerCase().includes(lowerQuery) || n.content.toLowerCase().includes(lowerQuery)
	);
}

export async function getSystemPromptMemory(): Promise<string> {
	const graph = await loadGraph();
	if (graph.nodes.length === 0) return "";

	const criticalNodes = graph.nodes
		.filter((n) => n.type === "project_rule" || n.type === "critical_fact")
		.slice(0, 10);

	if (criticalNodes.length === 0) return "";

	let memoryStr = "\n## Long-Term Memory (Critical Insights)\n";
	for (const node of criticalNodes) {
		memoryStr += `- [${node.id}] ${node.content}\n`;
	}
	return memoryStr;
}
