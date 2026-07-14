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
	maxAgeDays: number = 30,
): Promise<Node[]> {
	if (!query || query.trim().length === 0) {
		return [];
	}
	const lowerQuery = query.toLowerCase();
	const resolvedCwd = cwd ? path.resolve(cwd) : undefined;

	// RAG retrieval
	const vectorResults = await vectorStore.search(query, 20);
	const vectorNodeIds = new Set(vectorResults.map((r: { id: string }) => r.id));

	const allNodesStmt = db.prepare(`SELECT * FROM nodes WHERE type != 'env_snapshot' ORDER BY last_accessed DESC LIMIT 1000`);
	const allNodesRows = allNodesStmt.all() as any[];
	const nodes = allNodesRows.map(mapRowToNode);

	const now = Date.now();

	// Filter by scope and age
	const scopedNodes = nodes.filter(
		(n) => {
			// Only keep nodes in scope
			if (n.cwd && n.cwd !== "global" && (!resolvedCwd || path.resolve(n.cwd) !== resolvedCwd)) {
				return false;
			}

			// Skip old nodes unless they are important types
			if (maxAgeDays > 0 && n.type !== "project_rule" && n.type !== "critical_fact") {
				const accessTime = n.lastAccessed || n.timestamp || now;
				const ageDays = (now - accessTime) / (1000 * 60 * 60 * 24);
				if (ageDays > maxAgeDays) return false;
			}

			return true;
		},
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
		let baseRelevance =
			((n.priority ?? 0) + (n.importance ?? 0)) * 1e13 + (n.timestamp ?? 0);

		// Apply time-decay factor: relevance *= exp(-daysSinceAccess / 30)
		const accessTime = n.lastAccessed || n.timestamp || now;
		const daysSinceAccess = Math.max(0, (now - accessTime) / (1000 * 60 * 60 * 24));
		const timeDecay = Math.exp(-daysSinceAccess / 30);
		baseRelevance = baseRelevance * timeDecay;

		// Boost recent nodes (last 7 days) by 2x
		if (daysSinceAccess <= 7) {
			baseRelevance *= 2;
		}

		// Boost nodes that have been accessed more than once
		const accessCount = n.accessCount ?? 1;
		if (accessCount > 1) {
			baseRelevance *= 1 + Math.log10(accessCount);
		}

		results.set(n.id, { node: n, relevance: baseRelevance });
	});

	// Graph Traversal with depth decay (Decay Factor: 0.5 per hop)
	for (let depth = 1; depth <= maxDepth; depth++) {
		if (currentSet.size === 0) break;
		const nextSet = new Set<string>();

		const currentArray = Array.from(currentSet);
		if (currentArray.length === 0) break;

		const CHUNK_SIZE = 400; // Safe limit for SQLite limits (max 999 vars, 400*2 = 800)
		let edges: any[] = [];

		for (let i = 0; i < currentArray.length; i += CHUNK_SIZE) {
			const chunk = currentArray.slice(i, i + CHUNK_SIZE);
			const placeholders = chunk.map(() => "?").join(",");
			const edgesStmt = db.prepare(
				`SELECT * FROM edges WHERE source_id IN (${placeholders}) OR target_id IN (${placeholders})`,
			);
			edges = edges.concat(edgesStmt.all(...chunk, ...chunk) as any[]);
		}

		for (const edge of edges) {
			const neighborId = currentSet.has(edge.source_id)
				? edge.target_id
				: edge.source_id;
			if (!visited.has(neighborId)) {
				visited.add(neighborId);
				nextSet.add(neighborId);

				const neighborRow = db
					.prepare(`SELECT * FROM nodes WHERE id = ?`)
					.get(neighborId) as Record<string, unknown> | undefined;
				if (neighborRow) {
					const n = mapRowToNode(neighborRow);

					// Apply scoped and age filter for neighbor
					const inScope = !n.cwd ||
						n.cwd === "global" ||
						(resolvedCwd && path.resolve(n.cwd) === resolvedCwd);
					if (!inScope) continue;

					if (maxAgeDays > 0 && n.type !== "project_rule" && n.type !== "critical_fact") {
						const accessTime = n.lastAccessed || n.timestamp || now;
						const ageDays = (now - accessTime) / (1000 * 60 * 60 * 24);
						if (ageDays > maxAgeDays) continue;
					}

					let baseRelevance =
						((n.priority ?? 0) + (n.importance ?? 0)) * 1e13 +
						(n.timestamp ?? 0);
					const decayedRelevance = baseRelevance * 0.5 ** depth;

					// Apply time-decay, recency boost, access boost for neighbors too
					const accessTime = n.lastAccessed || n.timestamp || now;
					const daysSinceAccess = Math.max(0, (now - accessTime) / (1000 * 60 * 60 * 24));
					const timeDecay = Math.exp(-daysSinceAccess / 30);
					let finalRelevance = decayedRelevance * timeDecay;

					if (daysSinceAccess <= 7) {
						finalRelevance *= 2;
					}

					const accessCount = n.accessCount ?? 1;
					if (accessCount > 1) {
						finalRelevance *= 1 + Math.log10(accessCount);
					}

					results.set(n.id, { node: n, relevance: finalRelevance });
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
			(a.priority ?? 0) * 10 + (a.importance ?? 0) * 10 + (a.accessCount ?? 1);
		const relB =
			(b.priority ?? 0) * 10 + (b.importance ?? 0) * 10 + (b.accessCount ?? 1);
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
 * Iterates through stored nodes and removes or merges insights that are lexically identical (BM25 token matching) or exact duplicates.
 */
export async function optimizeInsights(
  cwd: string = process.cwd(),
): Promise<{ removed: number; merged: number }> {
  const resolvedCwd = cwd && cwd !== "global" ? path.resolve(cwd) : cwd;

  // Optimized: use JSON extraction to filter at database level
  // This avoids loading all nodes and filtering in JavaScript
  const stmt = db.prepare(`
    SELECT * FROM nodes 
    WHERE (
      JSON_EXTRACT(metadata, '$.priority') > 0 
      OR JSON_EXTRACT(metadata, '$.importance') > 0 
      OR JSON_EXTRACT(metadata, '$.accessCount') > 1
    )
    ORDER BY created_at DESC
    LIMIT 1000
  `);
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
	const DECAY_RATE = 0.005; // 0.5% decay per day (extends to 60+ days)
	const OBSOLETE_THRESHOLD = 0.1;
	const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

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

	const updateStmt = db.prepare(`
		UPDATE nodes 
		SET metadata = @metadata
		WHERE id = @id
	`);

	const edgesStmt = db.prepare(
		`SELECT * FROM edges WHERE source_id = ? OR target_id = ?`,
	);

	const insertEdgeStmt = db.prepare(`
		INSERT INTO edges (id, source_id, target_id, relation_type, weight, created_at)
		VALUES (@id, @source, @target, @relation, @weight, @now)
		ON CONFLICT(id) DO UPDATE SET weight = @weight
	`);

	const delEdgeStmt = db.prepare(`DELETE FROM edges WHERE id = ?`);

	// Group nodes by type to skip cross-type comparisons entirely (O(n²) → O(Σ nₖ²))
	const nodesByType = new Map<string, typeof nodes>();
	for (const node of nodes) {
		const type = node.type;
		if (!nodesByType.has(type)) nodesByType.set(type, []);
		nodesByType.get(type)!.push(node);
	}

	let compareCount = 0;
	for (const [, typeNodes] of nodesByType) {
		for (let i = 0; i < typeNodes.length; i++) {
			if (compareCount++ % 50 === 0) {
				const { promise, resolve } = Promise.withResolvers<void>();
				setImmediate(resolve);
				await promise;
			}
			if (toRemove.has(typeNodes[i].id)) continue;

			for (let j = i + 1; j < typeNodes.length; j++) {
				if (toRemove.has(typeNodes[j].id)) continue;

				const nodeA = typeNodes[i];
				const nodeB = typeNodes[j];

				// Skip nodes created more than 30 days apart
				const tsA = nodeA.timestamp ?? 0;
				const tsB = nodeB.timestamp ?? 0;
				if (Math.abs(tsA - tsB) > THIRTY_DAYS_MS) continue;

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

				const isLexicalMatch = similarity > 0.85;

				if (isExactMatch || isLexicalMatch) {
					toRemove.add(nodeB.id);

					const newPriority = Math.max(nodeA.priority ?? 0, nodeB.priority ?? 0);
					const newImportance = Math.max(
						nodeA.importance ?? 0,
						nodeB.importance ?? 0,
					);
					const newAccessCount =
						(nodeA.accessCount ?? 1) + (nodeB.accessCount ?? 1);

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
						const oldEdges = edgesStmt.all(nodeB.id, nodeB.id) as any[];

						for (const edge of oldEdges) {
							const newSource =
								edge.source_id === nodeB.id ? nodeA.id : edge.source_id;
							const newTarget =
								edge.target_id === nodeB.id ? nodeA.id : edge.target_id;

							// Avoid self-loops if the edge was between A and B
							if (newSource !== newTarget) {
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

							delEdgeStmt.run(edge.id);
						}
					});

					executeMerge();

					mergedCount++;
				}
			}
		}
	}

	// Compute and store relevanceScore for surviving nodes
	const relevanceStmt = db.prepare(`
		UPDATE nodes
		SET metadata = @metadata
		WHERE id = @id
	`);

	const executeRelevanceUpdate = db.transaction(() => {
		for (const node of nodes) {
			if (toRemove.has(node.id)) continue;
			const p = node.priority ?? 0;
			const i = node.importance ?? 0;
			const ac = node.accessCount ?? 1;
			const relevanceScore = p * 10 + i * 10 + ac;

			const meta = {
				cwd: node.cwd,
				priority: p,
				importance: i,
				accessCount: ac,
				relevance: relevanceScore,
			};

			relevanceStmt.run({
				metadata: JSON.stringify(meta),
				id: node.id,
			});
		}
	});

	try {
		executeRelevanceUpdate();
	} catch {
		// Best-effort: relevance scoring should not block consolidation
	}


	if (toRemove.size > 0) {
		const idsToRemove = Array.from(toRemove);

		await Promise.allSettled(
			idsToRemove.map(async (id) => {
				try {
					await vectorStore.removeEmbedding(id);
				} catch (err) {
					console.error(`Failed to remove vector embedding for ${id}`);
				}
			}),
		);

		const deleteNodeStmt = db.prepare(`DELETE FROM nodes WHERE id = ?`);
		const executeDeletions = db.transaction((ids: string[]) => {
			for (const id of ids) {
				deleteNodeStmt.run(id);
			}
		});
		executeDeletions(idsToRemove);

		removedCount = toRemove.size;
	}

	return { removed: removedCount, merged: mergedCount };
}
