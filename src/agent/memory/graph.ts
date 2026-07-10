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
	lastAccessed?: number;
	epistemicStatus?: "verified_fact" | "speculative" | "user_preference";
	confidenceScore?: number;
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
	importance = 0,
	epistemicStatus?: "verified_fact" | "speculative" | "user_preference",
	confidenceScore?: number,
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
		metadata: JSON.stringify({
			cwd: resolvedCwd,
			priority,
			importance,
			accessCount: 1,
			epistemicStatus,
			confidenceScore,
		}),
		now,
	});

	await vectorStore.addEmbedding(id, content, {
		type,
		cwd: resolvedCwd,
		priority,
		importance,
		timestamp: now,
	});
}

export async function addEdge(
	source: string,
	target: string,
	relation: string,
	weight: number = 1.0,
): Promise<void> {
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
		now: Date.now(),
	});
}

// Map db row to Node
function mapRowToNode(row: any): Node {
	let meta: any = {};
	try {
		meta = row.metadata ? JSON.parse(row.metadata) : {};
	} catch (err) {
		meta = {};
	}
	return {
		id: row.id,
		type: row.type,
		content: row.content,
		cwd: meta.cwd,
		priority: meta.priority,
		importance: meta.importance,
		accessCount: meta.accessCount,
		epistemicStatus: meta.epistemicStatus,
		confidenceScore: meta.confidenceScore,
		timestamp: row.created_at,
		lastAccessed: row.last_accessed || row.created_at,
	};
}

export async function searchGraph(
	query: string,
	cwd: string = process.cwd(),
	maxDepth: number = 2,
): Promise<Node[]> {
	const lowerQuery = query.toLowerCase();
	const resolvedCwd = cwd ? path.resolve(cwd) : undefined;

	// RAG retrieval
	const vectorResults = await vectorStore.search(query, 20);
	const vectorNodeIds = new Set(vectorResults.map((r: { id: string }) => r.id));

	const allNodesStmt = db.prepare(`SELECT * FROM nodes`);
	const allNodesRows = allNodesStmt.all() as any[];
	const nodes = allNodesRows.map(mapRowToNode);

	const scopedNodes = nodes.filter(
		(n) =>
			!n.cwd ||
			n.cwd === "global" ||
			(resolvedCwd && path.resolve(n.cwd) === resolvedCwd),
	);

	const matchedNodes = scopedNodes.filter(
		(n) =>
			vectorNodeIds.has(n.id) ||
			n.id.toLowerCase().includes(lowerQuery) ||
			n.content.toLowerCase().includes(lowerQuery),
	);

	// Map matched nodes by depth mapping
	let currentSet = new Set(matchedNodes.map((n) => n.id));
	const visited = new Set(currentSet);
	const results: Map<string, { node: Node; relevance: number }> = new Map();

	matchedNodes.forEach((n) => {
		const baseRelevance =
			((n.priority ?? 0) + (n.importance ?? 0)) * 1e13 + (n.timestamp ?? 0);
		results.set(n.id, { node: n, relevance: baseRelevance });
	});

	// Graph Traversal with depth decay (Decay Factor: 0.5 per hop)
	for (let depth = 1; depth <= maxDepth; depth++) {
		if (currentSet.size === 0) break;
		const nextSet = new Set<string>();

		const placeholders = Array.from(currentSet)
			.map(() => "?")
			.join(",");
		if (placeholders.length === 0) break;

		const edgesStmt = db.prepare(
			`SELECT * FROM edges WHERE source_id IN (${placeholders}) OR target_id IN (${placeholders})`,
		);
		const params = Array.from(currentSet);
		const edges = edgesStmt.all(...params, ...params) as any[];

		for (const edge of edges) {
			const neighborId = currentSet.has(edge.source_id)
				? edge.target_id
				: edge.source_id;
			if (!visited.has(neighborId)) {
				visited.add(neighborId);
				nextSet.add(neighborId);

				const neighborRow = db
					.prepare(`SELECT * FROM nodes WHERE id = ?`)
					.get(neighborId) as any;
				if (neighborRow) {
					const n = mapRowToNode(neighborRow);
					const baseRelevance =
						((n.priority ?? 0) + (n.importance ?? 0)) * 1e13 +
						(n.timestamp ?? 0);
					const decayedRelevance = baseRelevance * 0.5 ** depth;

					// Apply scoped filter for neighbor
					if (
						!n.cwd ||
						n.cwd === "global" ||
						(resolvedCwd && path.resolve(n.cwd) === resolvedCwd)
					) {
						results.set(n.id, { node: n, relevance: decayedRelevance });
					}
				}
			}
		}
		currentSet = nextSet;
	}

	const finalResults = Array.from(results.values())
		.sort((a, b) => b.relevance - a.relevance)
		.map((r) => r.node);
	return finalResults;
}

function formatRelativeTime(timestamp: number): string {
	const diffSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
	if (diffSeconds < 60) return `${diffSeconds} seconds ago`;
	const diffMinutes = Math.floor(diffSeconds / 60);
	if (diffMinutes < 60)
		return `${diffMinutes} minute${diffMinutes > 1 ? "s" : ""} ago`;
	const diffHours = Math.floor(diffMinutes / 60);
	if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
	const diffDays = Math.floor(diffHours / 24);
	if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
	const diffWeeks = Math.floor(diffDays / 7);
	if (diffWeeks < 4) return `${diffWeeks} week${diffWeeks > 1 ? "s" : ""} ago`;
	const diffMonths = Math.floor(diffDays / 30);
	if (diffMonths < 12)
		return `${diffMonths} month${diffMonths > 1 ? "s" : ""} ago`;
	const diffYears = Math.floor(diffDays / 365);
	return `${diffYears} year${diffYears > 1 ? "s" : ""} ago`;
}

export async function getSystemPromptMemory(
	cwd: string = process.cwd(),
): Promise<string> {
	const resolvedCwd = cwd ? path.resolve(cwd) : undefined;

	const stmt = db.prepare(
		`SELECT * FROM nodes WHERE type IN ('project_rule', 'critical_fact')`,
	);
	const rows = stmt.all() as any[];
	const nodes = rows.map(mapRowToNode);

	const scopedNodes = nodes.filter(
		(n) =>
			!n.cwd ||
			n.cwd === "global" ||
			(resolvedCwd && path.resolve(n.cwd) === resolvedCwd),
	);

	const sortedNodes = scopedNodes.sort((a, b) => {
		const relA =
			((a.priority ?? 0) + (a.importance ?? 0)) * 1e13 + (a.timestamp ?? 0);
		const relB =
			((b.priority ?? 0) + (b.importance ?? 0)) * 1e13 + (b.timestamp ?? 0);
		return relB - relA;
	});

	const criticalNodes = sortedNodes.slice(0, 10);
	if (criticalNodes.length === 0) return "";

	let memoryStr = "\n## Long-Term Memory (Critical Insights)\n";
	for (const node of criticalNodes) {
		const ageTime = node.lastAccessed || node.timestamp || Date.now();
		const ageStr = formatRelativeTime(ageTime);
		memoryStr += `- [${node.id}] (Learned ${ageStr}) ${node.content}\n`;
	}
	return memoryStr;
}

/**
 * Iterates through stored nodes and removes or merges insights that are semantically identical or exact duplicates.
 */
export async function optimizeInsights(
	cwd: string = process.cwd(),
): Promise<{ removed: number; merged: number }> {
	const resolvedCwd = cwd && cwd !== "global" ? path.resolve(cwd) : cwd;

	const stmt = db.prepare(`SELECT * FROM nodes`);
	const allNodesRows = stmt.all() as any[];
	let nodes = allNodesRows.map(mapRowToNode);

	if (resolvedCwd && resolvedCwd !== "global") {
		nodes = nodes.filter(
			(n) =>
				!n.cwd || n.cwd === "global" || path.resolve(n.cwd) === resolvedCwd,
		);
	}

	let removedCount = 0;
	let mergedCount = 0;

	const toRemove = new Set<string>();

	const now = Date.now();
	const DECAY_RATE = 0.05; // 5% decay per day
	const OBSOLETE_THRESHOLD = 0.5;

	for (const node of nodes) {
		if (node.type === "project_rule" || node.type === "critical_fact") {
			continue;
		}

		let lastAccess = node.lastAccessed || node.timestamp || now;
		if (lastAccess < 1e11) lastAccess *= 1000;
		const daysOld = Math.max(0, (now - lastAccess) / (1000 * 60 * 60 * 24));

		const p = node.priority ?? 0;
		const i = node.importance ?? 0;
		const accessCount = node.accessCount ?? 1;

		const baseScore = p * 10 + i * 10 + accessCount;
		const decayedScore = baseScore * Math.exp(-DECAY_RATE * daysOld);

		if (decayedScore < OBSOLETE_THRESHOLD) {
			toRemove.add(node.id);
		}
	}

	const getTokens = (t: string) =>
		new Set(
			t
				.toLowerCase()
				.replace(/[^a-z0-9]/g, " ")
				.split(/\s+/)
				.filter((x) => x.length >= 2),
		);

	for (let i = 0; i < nodes.length; i++) {
		if (i > 0 && i % 50 === 0) {
			await new Promise((resolve) => setImmediate(resolve));
		}
		if (toRemove.has(nodes[i].id)) continue;

		for (let j = i + 1; j < nodes.length; j++) {
			if (toRemove.has(nodes[j].id)) continue;

			const nodeA = nodes[i];
			const nodeB = nodes[j];

			if (nodeA.type !== nodeB.type) continue;

			const contentA = nodeA.content.trim().toLowerCase();
			const contentB = nodeB.content.trim().toLowerCase();

			const isExactMatch = contentA === contentB;

			const tokensA = getTokens(contentA);
			const tokensB = getTokens(contentB);

			let intersectionSize = 0;
			for (const t of tokensA) {
				if (tokensB.has(t)) intersectionSize++;
			}

			const unionSize = tokensA.size + tokensB.size - intersectionSize;
			const similarity = unionSize === 0 ? 0 : intersectionSize / unionSize;

			const isSemanticMatch = similarity > 0.85;

			if (isExactMatch || isSemanticMatch) {
				toRemove.add(nodeB.id);

				const newPriority = Math.max(nodeA.priority ?? 0, nodeB.priority ?? 0);
				const newImportance = Math.max(
					nodeA.importance ?? 0,
					nodeB.importance ?? 0,
				);
				const newAccessCount =
					(nodeA.accessCount ?? 1) + (nodeB.accessCount ?? 1);

				const updateStmt = db.prepare(`
					UPDATE nodes 
					SET metadata = @metadata
					WHERE id = @id
				`);

				const newMeta = {
					cwd: nodeA.cwd,
					priority: newPriority,
					importance: newImportance,
					accessCount: newAccessCount,
				};

				const executeMerge = db.transaction(() => {
					updateStmt.run({
						metadata: JSON.stringify(newMeta),
						id: nodeA.id,
					});

					// Re-route edges from B to A
					const edgesStmt = db.prepare(
						`SELECT * FROM edges WHERE source_id = ? OR target_id = ?`,
					);
					const oldEdges = edgesStmt.all(nodeB.id, nodeB.id) as any[];

					for (const edge of oldEdges) {
						const newSource =
							edge.source_id === nodeB.id ? nodeA.id : edge.source_id;
						const newTarget =
							edge.target_id === nodeB.id ? nodeA.id : edge.target_id;

						// Avoid self-loops if the edge was between A and B
						if (newSource !== newTarget) {
							const insertEdgeStmt = db.prepare(`
								INSERT INTO edges (id, source_id, target_id, relation_type, weight, created_at)
								VALUES (@id, @source, @target, @relation, @weight, @now)
								ON CONFLICT(id) DO UPDATE SET weight = @weight
							`);
							const edgeId = `${newSource}->${newTarget}:${edge.relation_type}`;
							insertEdgeStmt.run({
								id: edgeId,
								source: newSource,
								target: newTarget,
								relation: edge.relation_type,
								weight: edge.weight,
								now: Date.now(),
							});
						}

						const delEdgeStmt = db.prepare(`DELETE FROM edges WHERE id = ?`);
						delEdgeStmt.run(edge.id);
					}
				});

				executeMerge();

				mergedCount++;
			}
		}
	}

	if (toRemove.size > 0) {
		for (const id of toRemove) {
			try {
				await vectorStore.removeEmbedding(id);
			} catch (err) {
				console.error(`Failed to remove vector embedding for ${id}`);
			}
		}

		const idsToRemove = Array.from(toRemove);
		const executeDeletions = db.transaction((ids: string[]) => {
			for (let i = 0; i < ids.length; i += 500) {
				const batch = ids.slice(i, i + 500);
				const placeholders = batch.map(() => "?").join(",");
				const deleteStmt = db.prepare(
					`DELETE FROM nodes WHERE id IN (${placeholders})`,
				);
				deleteStmt.run(...batch);
			}
		});
		executeDeletions(idsToRemove);

		removedCount = toRemove.size;
	}

	return { removed: removedCount, merged: mergedCount };
}

export async function saveGraph(graphData: GraphData): Promise<void> {
	const insertNodeStmt = db.prepare(`
		INSERT INTO nodes (id, type, content, metadata, created_at, last_accessed)
		VALUES (@id, @type, @content, @metadata, @now, @now)
		ON CONFLICT(id) DO UPDATE SET
			content = @content,
			metadata = @metadata,
			last_accessed = @now
	`);

	const insertEdgeStmt = db.prepare(`
		INSERT INTO edges (id, source_id, target_id, relation_type, weight, created_at)
		VALUES (@id, @source, @target, @relation, @weight, @now)
		ON CONFLICT(id) DO UPDATE SET weight = @weight
	`);

	const transaction = db.transaction((data: GraphData) => {
		const now = Date.now();
		for (const node of data.nodes) {
			const resolvedCwd =
				node.cwd && node.cwd !== "global" ? path.resolve(node.cwd) : node.cwd;
			insertNodeStmt.run({
				id: node.id,
				type: node.type,
				content: node.content,
				metadata: JSON.stringify({
					cwd: resolvedCwd,
					priority: node.priority ?? 0,
					importance: node.importance ?? 0,
					accessCount: node.accessCount ?? 1,
				}),
				now,
			});
		}
		for (const edge of data.edges) {
			const edgeId = `${edge.source}->${edge.target}:${edge.relation}`;
			insertEdgeStmt.run({
				id: edgeId,
				source: edge.source,
				target: edge.target,
				relation: edge.relation,
				weight: edge.weight ?? 1.0,
				now,
			});
		}
	});

	transaction(graphData);

	const now = Date.now();
	let processed = 0;
	for (const node of graphData.nodes) {
		const resolvedCwd =
			node.cwd && node.cwd !== "global" ? path.resolve(node.cwd) : node.cwd;
		await vectorStore.addEmbedding(node.id, node.content, {
			type: node.type,
			cwd: resolvedCwd,
			priority: node.priority ?? 0,
			importance: node.importance ?? 0,
			timestamp: node.timestamp ?? now,
		});
		processed++;
		if (processed % 50 === 0) {
			await new Promise((resolve) => setImmediate(resolve));
		}
	}
}

export async function loadGraph(): Promise<GraphData> {
	return { nodes: [], edges: [] };
}
