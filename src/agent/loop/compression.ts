import { compressContext, estimateTokens, createContextSummarizer } from "../context-compressor.js";
import type { AgentContext } from "../context.js";
import type { OpenRouterClient, KiloCodeClient, CustomProviderClient } from "../../api/index.js";
import { debug } from "../../utils/debug.js";

export async function manageContextWindow(
	ctx: AgentContext,
	client: OpenRouterClient | KiloCodeClient | CustomProviderClient
): Promise<void> {
	const currentTokens = estimateTokens(ctx.messages);
	const maxContext = 100000;
	// Trigger compression at 85% of max context
	const triggerThreshold = Math.floor(maxContext * 0.85);
	const targetTokens = Math.floor(maxContext * 0.80);

	if (currentTokens > triggerThreshold) {
		debug.log(
			"agent",
			`Context compression triggered (\${currentTokens} > \${triggerThreshold} tokens)`,
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
		
		ctx.messages = await compressContext(ctx.messages, summarizer, {
			targetTokens,
		});
	}
}
