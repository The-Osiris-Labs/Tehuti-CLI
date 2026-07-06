import db from "./db.js";
import { vectorStore } from "./vector-store.js";

let isInitialized = false;

export async function initMemory(): Promise<void> {
	if (isInitialized) return;
	isInitialized = true;

	const stmt = db.prepare(`SELECT * FROM nodes`);
	const rows = stmt.all() as any[];

	for (const row of rows) {
		const meta = row.metadata ? JSON.parse(row.metadata) : {};
		await vectorStore.addEmbedding(row.id, row.content, {
			type: row.type,
			cwd: meta.cwd,
			priority: meta.priority ?? 0,
			importance: meta.importance ?? 0,
			timestamp: row.created_at,
		});
	}
}

export * from "./db.js";
export * from "./env-bootstrap.js";
export * from "./graph.js";
export * from "./vector-store.js";
export * from "./consolidation.js";
