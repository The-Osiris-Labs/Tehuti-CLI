import { debug } from "../../utils/debug.js";
import { registerCleanupHandler } from "../../utils/errors.js";
import {
	startBackgroundConsolidation,
	stopBackgroundConsolidation,
} from "./consolidation.js";
import db from "./db.js";
import { vectorStore } from "./vector-store.js";

let isInitialized = false;
let cleanupRegistered = false;

export async function initMemory(
	consolidationIntervalMs?: number,
): Promise<void> {
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

	// Start background memory consolidation timer
	const interval = consolidationIntervalMs ?? 15 * 60 * 1000;
	debug.log(
		"memory",
		`Starting memory consolidation timer (every ${interval}ms)`,
	);
	startBackgroundConsolidation(interval);

	// Register cleanup handler to stop consolidation on shutdown
	if (!cleanupRegistered) {
		cleanupRegistered = true;
		registerCleanupHandler(async () => {
			debug.log("memory", "Stopping memory consolidation timer");
			stopBackgroundConsolidation();
		});
	}
}

export * from "./consolidation.js";
export * from "./db.js";
export * from "./env-bootstrap.js";
export * from "./graph.js";
export * from "./vector-store.js";
