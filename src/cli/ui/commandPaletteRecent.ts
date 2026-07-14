import { globalConfig } from "../../config/index.js";
import { debug } from "../../utils/debug.js";

export const MAX_RECENT_COMMANDS = 10;

/**
 * Read persisted command IDs defensively: config data can outlive schema changes
 * or be manually edited, so only non-empty string IDs are accepted.
 */
export function getRecentCommands(): string[] {
	try {
		const stored: unknown = globalConfig.get("recentCommands");
		if (!Array.isArray(stored)) return [];

		const seen = new Set<string>();
		const recent: string[] = [];
		for (const value of stored) {
			if (typeof value !== "string") continue;
			const id = value.trim();
			if (!id || seen.has(id)) continue;
			seen.add(id);
			recent.push(id);
			if (recent.length === MAX_RECENT_COMMANDS) break;
		}
		return recent;
	} catch {
		return [];
	}
}

/** Persist a most-recently-used command list with a stable, bounded shape. */
export function addRecentCommand(commandId: string): void {
	const id = commandId.trim();
	if (!id) return;

	try {
		const recent = getRecentCommands().filter((existing) => existing !== id);
		globalConfig.set("recentCommands", [id, ...recent].slice(0, MAX_RECENT_COMMANDS));
	} catch (error) {
		debug.log("chat", `Failed to add recent command: ${error}`);
	}
}
