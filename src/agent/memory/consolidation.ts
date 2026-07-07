import { logger } from "../../utils/logger.js";
import { agentEventBus } from "../events.js";
import { optimizeInsights } from "./graph.js";

let consolidationTimer: NodeJS.Timeout | null = null;
let isConsolidating = false;

/**
 * Starts a background consolidation job that periodically merges semantic insights
 * and prevents unhandled promise rejections.
 *
 * @param intervalMs The interval in milliseconds to run the consolidation job
 */
export function startBackgroundConsolidation(
	intervalMs: number = 60 * 60 * 1000,
): void {
	if (consolidationTimer) {
		clearInterval(consolidationTimer);
	}

	consolidationTimer = setInterval(async () => {
		if (isConsolidating) return;

		isConsolidating = true;
		try {
			// Wrapping async background work in a try-catch to avoid unhandled promise rejections
			const result = await optimizeInsights();
			if (result.removed > 0 || result.merged > 0) {
				logger.debug(
					`Consolidated memory graph: removed ${result.removed}, merged ${result.merged} nodes.`,
				);
				agentEventBus.emit("memoryEvent", {
					type: "consolidated",
					message: "Memory consolidated",
				});
			}
		} catch (error) {
			logger.error(
				`Error during background consolidation: ${error instanceof Error ? error.message : String(error)}`,
			);
		} finally {
			isConsolidating = false;
		}
	}, intervalMs);

	// Ensure it doesn't block process exit
	if (consolidationTimer.unref) {
		consolidationTimer.unref();
	}
}

/**
 * Stops the background consolidation job.
 */
export function stopBackgroundConsolidation(): void {
	if (consolidationTimer) {
		clearInterval(consolidationTimer);
		consolidationTimer = null;
	}
}
