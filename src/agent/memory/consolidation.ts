import { logger } from "../../utils/logger.js";
import { agentEventBus } from "../events.js";
import { optimizeInsights } from "./graph.js";
let consolidationTimer: NodeJS.Timeout | null = null;
let isConsolidating = false;
let shuttingDown = false;
let currentConsolidation: Promise<void> | null = null;

/**
 * Signals the consolidation system to shut down gracefully.
 * Prevents new runs from starting and awaits any in-flight consolidation.
 */
export async function shutdownConsolidation(): Promise<void> {
	shuttingDown = true;
	if (consolidationTimer) {
		clearInterval(consolidationTimer);
		consolidationTimer = null;
	}
	if (currentConsolidation) {
		await currentConsolidation;
	}
}

/**
 * Starts a background consolidation job that periodically merges insights
 * (using lexical BM25 token matching) and prevents unhandled promise rejections.
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
		if (isConsolidating || shuttingDown) return;

		isConsolidating = true;
		currentConsolidation = (async () => {
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
				currentConsolidation = null;
			}
		})();

		try {
			await currentConsolidation;
		} finally {
			currentConsolidation = null;
		}
	}, intervalMs);

	// Ensure it doesn't block process exit
	if (consolidationTimer.unref) {
		consolidationTimer.unref();
	}
}
