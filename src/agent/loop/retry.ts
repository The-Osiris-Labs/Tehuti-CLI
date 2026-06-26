import { APIError } from "../../utils/errors.js";
import { debug } from "../../utils/debug.js";

export async function withRetry<T>(
	operation: () => Promise<T>,
	options: { maxRetries?: number; initialDelayMs?: number; signal?: AbortSignal } = {}
): Promise<T> {
	const maxRetries = options.maxRetries ?? 3;
	let delay = options.initialDelayMs ?? 2000;

	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			if (options.signal?.aborted) {
				throw new Error("Aborted");
			}
			return await operation();
		} catch (error: any) {
			if (options.signal?.aborted) {
				throw error;
			}
			
			const isTimeout = error.message?.toLowerCase().includes("timeout") || error.name === "TimeoutError";
			const isRateLimit = error.message?.includes("429") || error.message?.toLowerCase().includes("rate limit") || (error instanceof APIError && error.status === 429);
			const isServerErr = error.message?.includes("500") || error.message?.includes("502") || error.message?.includes("503") || error.message?.includes("504");
			
			if ((isTimeout || isRateLimit || isServerErr) && attempt < maxRetries) {
				debug.log("agent", `Attempt \${attempt} failed with \${isRateLimit ? "rate limit" : isTimeout ? "timeout" : "server error"}. Retrying in \${delay}ms...`);
				await new Promise(resolve => setTimeout(resolve, delay));
				delay *= 2; // Exponential backoff
				continue;
			}
			
			throw error; // Not retryable or max retries reached
		}
	}
	throw new Error("Unreachable");
}
