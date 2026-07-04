import { estimateTokens } from "../context-compressor.js";
import type { AgentContext } from "../context.js";
import type { OpenRouterClient, KiloCodeClient, CustomProviderClient } from "../../api/index.js";
import { debug } from "../../utils/debug.js";
import { supportsPromptCaching } from "../../api/model-capabilities.js";

export async function manageContextWindow(
	ctx: AgentContext,
	client: OpenRouterClient | KiloCodeClient | CustomProviderClient
): Promise<void> {
	let currentTokens = estimateTokens(ctx.messages);
	const maxContext = ctx.config.kilocode?.contextManagement?.maxContextLength || 32000;
	// Trigger compression at 85% of max context
	const triggerThreshold = Math.floor(maxContext * 0.85);
	const targetTokens = Math.floor(maxContext * 0.80);

	if (currentTokens > triggerThreshold) {
		debug.log(
			"agent",
			`Context compression triggered (${currentTokens} > ${triggerThreshold} tokens). Relying on deterministic head/tail truncation.`,
		);
		
		// Deterministic truncation: keep head (system prompts) and tail (recent messages)
		// We remove the oldest non-system messages until under target
		while (currentTokens > targetTokens && ctx.messages.length > 2) {
			const nonSystemIndex = ctx.messages.findIndex(m => m.role !== "system");
			if (nonSystemIndex !== -1) {
				ctx.messages.splice(nonSystemIndex, 1);
			} else {
				// Fallback if all are system messages (unlikely)
				ctx.messages.splice(1, 1);
			}
			currentTokens = estimateTokens(ctx.messages);
		}
	}
}
