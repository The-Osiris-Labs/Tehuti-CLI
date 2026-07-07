import type {
	CustomProviderClient,
	KiloCodeClient,
	StandardAPIClient,
} from "../../api/index.js";
import { debug } from "../../utils/debug.js";
import type { AgentContext } from "../context.js";
import { estimateTokens } from "../context-compressor.js";

export async function manageContextWindow(
	ctx: AgentContext,
	_client: StandardAPIClient | KiloCodeClient | CustomProviderClient,
): Promise<void> {
	let currentTokens = estimateTokens(ctx.messages);
	const maxContext =
		ctx.config.kilocode?.contextManagement?.maxContextLength || 32000;
	// Trigger compression at 85% of max context
	const triggerThreshold = Math.floor(maxContext * 0.85);
	const targetTokens = Math.floor(maxContext * 0.8);

	if (currentTokens > triggerThreshold) {
		debug.log(
			"agent",
			`Context compression triggered (${currentTokens} > ${triggerThreshold} tokens). Relying on deterministic head/tail truncation.`,
		);

		// Deterministic truncation: keep head (system prompts) and tail (recent messages)
		// We remove the oldest non-system messages until under target
		const keepLastN = 10;
		while (currentTokens > targetTokens && ctx.messages.length > keepLastN + 1) {
			const endIndex = ctx.messages.length - keepLastN;
			let removed = false;
			for (let i = 0; i < endIndex; i++) {
				if (ctx.messages[i].role !== "system") {
					ctx.messages.splice(i, 1);
					removed = true;
					break;
				}
			}
			if (!removed) break; // Only system messages remain before the keep window
			currentTokens = estimateTokens(ctx.messages);
		}
	}
}
