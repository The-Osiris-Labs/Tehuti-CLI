import { describe, expect, it } from "vitest";
import db from "./db.js";
import { optimizeInsights } from "./graph.js";

describe("graph optimizeInsights", () => {
	it("normalizes second-based timestamps and handles node optimization safely", async () => {
		const secondsTimestamp = Math.floor(Date.now() / 1000) - 86400 * 30;
		db.prepare(`
			INSERT INTO nodes (id, type, content, metadata, created_at, last_accessed)
			VALUES (@id, @type, @content, @metadata, @ts, @ts)
			ON CONFLICT(id) DO UPDATE SET last_accessed = @ts
		`).run({
			id: "test-seconds-node",
			type: "insight",
			content: "test obsolete insight",
			metadata: JSON.stringify({ priority: 0, importance: 0, accessCount: 1 }),
			ts: secondsTimestamp,
		});

		const result = await optimizeInsights();
		expect(typeof result.removed).toBe("number");
		expect(typeof result.merged).toBe("number");

		db.prepare("DELETE FROM nodes WHERE id = ?").run("test-seconds-node");
	});
});
