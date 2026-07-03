import { compressContext, estimateTokens, createContextSummarizer } from "../context-compressor.js";
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
		const modelId = ctx.config.model;
		if (supportsPromptCaching(modelId)) {
			debug.log(
				"agent",
				`Context limit reached (${currentTokens} > ${triggerThreshold}). Model ${modelId} supports native prompt caching. Relying on sliding window instead of LLM compression.`
			);
			
			// Sliding window: keep system prompt, then remove oldest messages until under target
			// messages[0] is typically the system prompt
			while (currentTokens > targetTokens && ctx.messages.length > 2) {
				// Remove the second message (oldest after system prompt)
				ctx.messages.splice(1, 1);
				currentTokens = estimateTokens(ctx.messages);
			}
			return;
		}

		debug.log(
			"agent",
			`Context compression triggered (${currentTokens} > ${triggerThreshold} tokens)`,
		);
		
		const summarizer = createContextSummarizer(async (prompt: string) => {
			const result = await client.completeChat(
				[{ role: "user", content: prompt }],
				[],
			);
			return typeof result.choices[0].message.content === "string"
				? result.choices[0].message.content
				: "";
		});
		
		ctx.messages = await compressContext(ctx.messages, summarizer, targetTokens, {});
	}
}
