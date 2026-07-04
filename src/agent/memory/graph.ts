import path from "node:path";
import db from "./db.js";
import { vectorStore } from "./vector-store.js";

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
	weight?: number;
}

export interface GraphData {
	nodes: Node[];
	edges: Edge[];
}

export async function addNode(
	id: string,
	type: string,
	content: string,
	cwd: string = process.cwd(),
	priority = 0,
	importance = 0
): Promise<void> {
	const now = Date.now();
	const resolvedCwd = cwd && cwd !== "global" ? path.resolve(cwd) : cwd;
	
	const stmt = db.prepare(`
		INSERT INTO nodes (id, type, content, metadata, created_at, last_accessed)
		VALUES (@id, @type, @content, @metadata, @now, @now)
		ON CONFLICT(id) DO UPDATE SET
			content = @content,
			metadata = @metadata,
			last_accessed = @now
	`);
	
	stmt.run({
		id,
		type,
		content,
		metadata: JSON.stringify({ cwd: resolvedCwd, priority, importance, accessCount: 1 }),
		now
	});

	await vectorStore.addEmbedding(id, content, {
		type,
		cwd: resolvedCwd,
		priority,
		importance,
		timestamp: now,
	});
}

export async function addEdge(source: string, target: string, relation: string, weight: number = 1.0): Promise<void> {
	const stmt = db.prepare(`
		INSERT INTO edges (id, source_id, target_id, relation_type, weight, created_at)
		VALUES (@id, @source, @target, @relation, @weight, @now)
		ON CONFLICT(id) DO UPDATE SET weight = @weight
	`);
	const edgeId = `${source}->${target}:${relation}`;
	stmt.run({
		id: edgeId,
		source,
		target,
		relation,
		weight,
		now: Date.now()
	});
}

// Map db row to Node
function mapRowToNode(row: any): Node {
	const meta = row.metadata ? JSON.parse(row.metadata) : {};
	return {
		id: row.id,
		type: row.type,
		content: row.content,
		cwd: meta.cwd,
		priority: meta.priority,
		importance: meta.importance,
		accessCount: meta.accessCount,
		timestamp: row.created_at
	};
}

export async function searchGraph(query: string, cwd: string = process.cwd(), maxDepth: number = 2): Promise<Node[]> {
	const lowerQuery = query.toLowerCase();
	const resolvedCwd = cwd ? path.resolve(cwd) : undefined;
	
	// RAG retrieval
	const vectorResults = await vectorStore.search(query, 20);
	const vectorNodeIds = new Set(vectorResults.map((r: { id: string }) => r.id));
	
	const allNodesStmt = db.prepare(`SELECT * FROM nodes`);
	const allNodesRows = allNodesStmt.all() as any[];
	let nodes = allNodesRows.map(mapRowToNode);
	
	const scopedNodes = nodes.filter(
		(n) => !n.cwd || n.cwd === "global" || (resolvedCwd && path.resolve(n.cwd) === resolvedCwd)
	);

	let matchedNodes = scopedNodes.filter(
		(n) => vectorNodeIds.has(n.id) || n.id.toLowerCase().includes(lowerQuery) || n.content.toLowerCase().includes(lowerQuery)
	);
	
	// Map matched nodes by depth mapping
	let currentSet = new Set(matchedNodes.map(n => n.id));
	const visited = new Set(currentSet);
	const results: Map<string, {node: Node, relevance: number}> = new Map();
	
	matchedNodes.forEach(n => {
		const baseRelevance = ((n.priority ?? 0) + (n.importance ?? 0)) * 1e13 + (n.timestamp ?? 0);
		results.set(n.id, {node: n, relevance: baseRelevance});
	});
	
	// Graph Traversal with depth decay (Decay Factor: 0.5 per hop)
	for (let depth = 1; depth <= maxDepth; depth++) {
		if (currentSet.size === 0) break;
		const nextSet = new Set<string>();
		
		const placeholders = Array.from(currentSet).map(() => '?').join(',');
		if(placeholders.length === 0) break;
		
		const edgesStmt = db.prepare(`SELECT * FROM edges WHERE source_id IN (${placeholders}) OR target_id IN (${placeholders})`);
		const params = Array.from(currentSet);
		const edges = edgesStmt.all(...params, ...params) as any[];
		
		for (const edge of edges) {
			const neighborId = currentSet.has(edge.source_id) ? edge.target_id : edge.source_id;
			if (!visited.has(neighborId)) {
				visited.add(neighborId);
				nextSet.add(neighborId);
				
				const neighborRow = db.prepare(`SELECT * FROM nodes WHERE id = ?`).get(neighborId) as any;
				if (neighborRow) {
					const n = mapRowToNode(neighborRow);
					const baseRelevance = ((n.priority ?? 0) + (n.importance ?? 0)) * 1e13 + (n.timestamp ?? 0);
					const decayedRelevance = baseRelevance * Math.pow(0.5, depth);
					
					// Apply scoped filter for neighbor
					if (!n.cwd || n.cwd === "global" || (resolvedCwd && path.resolve(n.cwd) === resolvedCwd)) {
						results.set(n.id, {node: n, relevance: decayedRelevance});
					}
				}
			}
		}
		currentSet = nextSet;
	}
	
	const finalResults = Array.from(results.values()).sort((a, b) => b.relevance - a.relevance).map(r => r.node);
	return finalResults;
}

export async function getSystemPromptMemory(cwd: string = process.cwd()): Promise<string> {
	const resolvedCwd = cwd ? path.resolve(cwd) : undefined;
	
	const stmt = db.prepare(`SELECT * FROM nodes WHERE type IN ('project_rule', 'critical_fact')`);
	const rows = stmt.all() as any[];
	let nodes = rows.map(mapRowToNode);
	
	const scopedNodes = nodes.filter(
		(n) => !n.cwd || n.cwd === "global" || (resolvedCwd && path.resolve(n.cwd) === resolvedCwd)
	);

	const sortedNodes = scopedNodes.sort((a, b) => {
		const relA = ((a.priority ?? 0) + (a.importance ?? 0)) * 1e13 + (a.timestamp ?? 0);
		const relB = ((b.priority ?? 0) + (b.importance ?? 0)) * 1e13 + (b.timestamp ?? 0);
		return relB - relA;
	});

	const criticalNodes = sortedNodes.slice(0, 10);
	if (criticalNodes.length === 0) return "";

	let memoryStr = "\n## Long-Term Memory (Critical Insights)\n";
	for (const node of criticalNodes) {
		memoryStr += `- [${node.id}] ${node.content}\n`;
	}
	return memoryStr;
}
