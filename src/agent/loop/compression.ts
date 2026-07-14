import type {
	CustomProviderClient,
	KiloCodeClient,
	StandardAPIClient,
} from "../../api/index.js";
import { debug } from "../../utils/debug.js";
import { type AgentContext, compactContext } from "../context.js";
import { estimateTokens } from "../context-compressor.js";

export async function manageContextWindow(
	ctx: AgentContext,
	_client: StandardAPIClient | KiloCodeClient | CustomProviderClient,
	maxContext?: number,
): Promise<boolean> {
	let currentTokens = estimateTokens(ctx.messages);
	const initialTokens = currentTokens;
	const effectiveMaxContext =
		maxContext ??
		ctx.modelContextLength ??
		ctx.config.kilocode?.contextManagement?.maxContextLength ??
		1000000;
	// Trigger compression at 85% of max context
	const triggerThreshold = Math.floor(effectiveMaxContext * 0.85);
	const targetTokens = Math.floor(effectiveMaxContext * 0.8);

	if (currentTokens > triggerThreshold) {
		debug.log(
			"agent",
			`Context compression triggered (${currentTokens} > ${triggerThreshold} tokens). Building a structured digest and retaining the append-only archive.`,
		);

		const compacted = compactContext(ctx, targetTokens, effectiveMaxContext);
		currentTokens = estimateTokens(ctx.messages);

		// Fallback 1: Truncate massive individual strings in the model-facing
		// copy. The original content remains in appendOnlyLog.
		if (currentTokens > targetTokens) {
			debug.log(
				"agent",
				"Context still exceeded after structural truncation. Truncating large individual messages.",
			);
			const MAX_CHARS = 40000 * 3; // ~40k tokens
			for (const msg of ctx.messages) {
				if (typeof msg.content === "string" && msg.content.length > MAX_CHARS) {
					msg.content =
						msg.content.substring(0, MAX_CHARS) +
						"\n\n...[TRUNCATED BY COMPRESSOR]...";
				}
			}
			currentTokens = estimateTokens(ctx.messages);
		}

		// Fallback 2: Override keep window if still exceeded. This is only a
		// last-resort provider-safety measure; the append-only archive is intact.
		while (currentTokens > targetTokens && ctx.messages.length > 2) {
			let removed = false;
			for (let i = 0; i < ctx.messages.length - 1; i++) {
				if (ctx.messages[i].role !== "system") {
					ctx.messages.splice(i, 1);
					removed = true;
					break;
				}
			}
			if (!removed) break;
			currentTokens = estimateTokens(ctx.messages);
		}

		return compacted || currentTokens < initialTokens;
	}

	return false;
}
