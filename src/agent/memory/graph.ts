import path from "node:path";
import os from "node:os";
import fs from "fs-extra";
import { ReadWriteLock } from "../../utils/mutex.js";

export interface Node {
	id: string;
	type: string;
	content: string;
	cwd?: string;
	project?: string;
	timestamp?: number;
	accessCount?: number;
	priority?: number;
	importance?: number;
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

function getMemoryFile(): string {
	const baseDir = process.env.TEST_HOME || os.homedir();
	return path.join(baseDir, ".tehuti", "memory-graph.json");
}
const rwLock = new ReadWriteLock();

// Load the graph without locking (internal use)
async function loadGraphInternal(): Promise<GraphData> {
	const memoryFile = getMemoryFile();
	try {
		if (await fs.pathExists(memoryFile)) {
			return await fs.readJson(memoryFile);
		}
	} catch (error) {
		if (await fs.pathExists(memoryFile)) {
			const timestamp = Date.now();
			const backupDir = path.dirname(memoryFile);
			const backupPath = path.join(backupDir, `memory-graph.corrupted-${timestamp}.json`);
			try {
				await fs.ensureDir(backupDir);
				await fs.copy(memoryFile, backupPath);
			} catch (backupError) {
				// Ignore backup copy error, still throw the main parse error
			}
			throw error;
		}
	}
	return { nodes: [], edges: [] };
}

// Save the graph atomically without locking (internal use)
async function saveGraphInternal(graph: GraphData): Promise<void> {
	const memoryFile = getMemoryFile();
	await fs.ensureDir(path.dirname(memoryFile));
	const tempFile = `${memoryFile}.tmp`;
	await fs.writeJson(tempFile, graph, { spaces: 2 });
	await fs.move(tempFile, memoryFile, { overwrite: true });
}

// Public API wrapper for loadGraph with a read lock
export async function loadGraph(): Promise<GraphData> {
	return await rwLock.withReadLock(() => loadGraphInternal());
}

// Public API wrapper for saveGraph with a write lock
export async function saveGraph(graph: GraphData): Promise<void> {
	await rwLock.withWriteLock(() => saveGraphInternal(graph));
}

// Helper to get relevance for sorting
function getNodeRelevance(node: Node): number {
	const priority = node.priority ?? node.importance ?? 0;
	const timestamp = node.timestamp ?? 0;
	return priority * 1e13 + timestamp;
}

export async function addNode(
	id: string,
	type: string,
	content: string,
	cwd: string = process.cwd(),
	priority = 0,
	importance = 0
): Promise<void> {
	await rwLock.withWriteLock(async () => {
		const graph = await loadGraphInternal();
		const existingIndex = graph.nodes.findIndex((n) => n.id === id);
		const now = Date.now();

		const node: Node = {
			id,
			type,
			content,
			cwd: cwd && cwd !== "global" ? path.resolve(cwd) : cwd,
			timestamp: now,
			accessCount: existingIndex >= 0 ? (graph.nodes[existingIndex].accessCount ?? 0) + 1 : 1,
			priority: priority || (existingIndex >= 0 ? graph.nodes[existingIndex].priority : 0),
			importance: importance || (existingIndex >= 0 ? graph.nodes[existingIndex].importance : 0),
		};

		if (existingIndex >= 0) {
			graph.nodes[existingIndex] = node;
		} else {
			graph.nodes.push(node);
		}

		// Sort and evict least relevant nodes if we exceed a threshold
		const MAX_NODES = 1000;
		if (graph.nodes.length > MAX_NODES) {
			graph.nodes.sort((a, b) => getNodeRelevance(b) - getNodeRelevance(a));
			graph.nodes = graph.nodes.slice(0, MAX_NODES);
		}

		await saveGraphInternal(graph);
	});
}

export async function addEdge(source: string, target: string, relation: string): Promise<void> {
	await rwLock.withWriteLock(async () => {
		const graph = await loadGraphInternal();
		graph.edges.push({ source, target, relation });
		await saveGraphInternal(graph);
	});
}

export async function searchGraph(query: string, cwd: string = process.cwd()): Promise<Node[]> {
	return await rwLock.withReadLock(async () => {
		const graph = await loadGraphInternal();
		const lowerQuery = query.toLowerCase();
		const resolvedCwd = cwd ? path.resolve(cwd) : undefined;
		
		// Node scoping filter: include match if n.cwd is undefined/empty, "global", or equals current workspace CWD
		const scopedNodes = graph.nodes.filter(
			(n) => !n.cwd || n.cwd === "global" || (resolvedCwd && path.resolve(n.cwd) === resolvedCwd)
		);

		const matched = scopedNodes.filter(
			(n) => n.id.toLowerCase().includes(lowerQuery) || n.content.toLowerCase().includes(lowerQuery)
		);

		// Sort matched nodes by relevance/date (highest relevance first)
		return matched.sort((a, b) => getNodeRelevance(b) - getNodeRelevance(a));
	});
}

export async function getSystemPromptMemory(cwd: string = process.cwd()): Promise<string> {
	return await rwLock.withReadLock(async () => {
		const graph = await loadGraphInternal();
		if (graph.nodes.length === 0) return "";

		const resolvedCwd = cwd ? path.resolve(cwd) : undefined;

		// Filter for scoped nodes matching current workspace cwd or global nodes
		const scopedNodes = graph.nodes.filter(
			(n) => !n.cwd || n.cwd === "global" || (resolvedCwd && path.resolve(n.cwd) === resolvedCwd)
		);

		// Filter for project_rule or critical_fact
		const criticalNodesFiltered = scopedNodes.filter(
			(n) => n.type === "project_rule" || n.type === "critical_fact"
		);

		// Sort by relevance/date (highest relevance first)
		const sortedNodes = criticalNodesFiltered.sort((a, b) => getNodeRelevance(b) - getNodeRelevance(a));

		// Slice to top 10
		const criticalNodes = sortedNodes.slice(0, 10);

		if (criticalNodes.length === 0) return "";

		let memoryStr = "\n## Long-Term Memory (Critical Insights)\n";
		for (const node of criticalNodes) {
			memoryStr += `- [${node.id}] ${node.content}\n`;
		}
		return memoryStr;
	});
}
