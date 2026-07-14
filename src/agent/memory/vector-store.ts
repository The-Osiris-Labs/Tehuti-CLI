export interface VectorStore {
	init(): Promise<void>;
	addEmbedding(
		id: string,
		text: string,
		metadata: Record<string, any>,
	): Promise<void>;
	removeEmbedding(id: string): Promise<void>;
	search(
		query: string,
		limit?: number,
	): Promise<
		Array<{ id: string; score: number; metadata: Record<string, any> }>
	>;
}

/**
 * A production-grade local Okapi BM25 Vector Store.
 * Replaces fragile dense mocks with a robust sparse vector space model (classic NLP).
 * BM25 improves upon standard TF-IDF by adding term saturation and document length normalization.
 * Requires zero native bindings, no API keys, and no network dependencies.
 */
export class BM25VectorStore implements VectorStore {
	private documents: Map<
		string,
		{ tokens: string[]; metadata: Record<string, any> }
	> = new Map();
	private documentCount = 0;
	// document frequency per term
	private df: Map<string, number> = new Map();
	// average document length
	private avgdl = 0;
	private totalTokens = 0;

	// BM25 parameters
	private k1 = 1.5;
	private b = 0.75;
	// Cache for recent search results
	private searchCache = new Map<string, { results: Array<{ id: string; score: number; metadata: Record<string, any> }>; timestamp: number }>();
	private searchCacheTTL = 60_000; // 1 minute
	private searchCacheMaxSize = 500;

	async init(): Promise<void> {
		// Ready instantly
	}
	/** Configure cache parameters from performance config */
	configure(performanceConfig: { searchCacheTTL?: number; searchCacheMaxSize?: number } | undefined): void {
		if (performanceConfig?.searchCacheTTL !== undefined) {
			this.searchCacheTTL = performanceConfig.searchCacheTTL;
		}
		if (performanceConfig?.searchCacheMaxSize !== undefined) {
			this.searchCacheMaxSize = performanceConfig.searchCacheMaxSize;
		}
	}

	private tokenize(text: string): string[] {
		// Unicode-aware word tokenizer. The previous regex stripped all
		// non-ASCII characters, making memory items in non-Latin scripts
		// (Arabic, Chinese, Japanese, Korean, etc.) completely unsearchable
		// in BM25. The new regex keeps Unicode letters and digits, so any
		// script is tokenized correctly.
		return text
			.toLowerCase()
			.replace(/[^\p{L}\p{N}]+/gu, " ")
			.split(/\s+/)
			.filter((t) => t.length >= 2);
	}

	async addEmbedding(
		id: string,
		text: string,
		metadata: Record<string, any>,
	): Promise<void> {
		if (this.documents.has(id)) {
			await this.removeEmbedding(id);
		}
		this.searchCache.clear();

		const tokens = this.tokenize(text);
		if (tokens.length === 0) return;

		this.documents.set(id, { tokens, metadata });
		this.documentCount++;
		this.totalTokens += tokens.length;
		this.avgdl = this.totalTokens / this.documentCount;

		// Unique tokens in this document
		const uniqueTokens = new Set(tokens);
		for (const token of uniqueTokens) {
			this.df.set(token, (this.df.get(token) || 0) + 1);
		}
	}

	async removeEmbedding(id: string): Promise<void> {
		const doc = this.documents.get(id);
		if (!doc) return;
		this.searchCache.clear();

		this.documents.delete(id);
		this.documentCount--;
		this.totalTokens -= doc.tokens.length;
		this.avgdl =
			this.documentCount > 0 ? this.totalTokens / this.documentCount : 0;

		const uniqueTokens = new Set(doc.tokens);
		for (const token of uniqueTokens) {
			const currentDf = this.df.get(token);
			if (currentDf !== undefined) {
				if (currentDf <= 1) {
					this.df.delete(token);
				} else {
					this.df.set(token, currentDf - 1);
				}
			}
		}
	}

	async search(
		query: string,
		limit = 5,
	): Promise<
		Array<{ id: string; score: number; metadata: Record<string, any> }>
	> {
		const cacheKey = `${query}:${limit}`;
		const cached = this.searchCache.get(cacheKey);
		if (cached && Date.now() - cached.timestamp < this.searchCacheTTL) {
			return cached.results;
		}

		const queryTokens = this.tokenize(query);
		if (queryTokens.length === 0 || this.documentCount === 0) return [];

		const results: Array<{
			id: string;
			score: number;
			metadata: Record<string, any>;
		}> = [];

		for (const [id, doc] of this.documents.entries()) {
			let score = 0;
			const docLength = doc.tokens.length;

			// Count term frequencies in this document
			const tf = new Map<string, number>();
			for (const token of doc.tokens) {
				tf.set(token, (tf.get(token) || 0) + 1);
			}

			// Calculate BM25 score
			for (const token of queryTokens) {
				const termFreq = tf.get(token) || 0;
				if (termFreq === 0) continue;

				const docFreq = this.df.get(token) || 0;

				// IDF calculation with floor to prevent negative IDFs
				const idf = Math.max(
					0,
					Math.log((this.documentCount - docFreq + 0.5) / (docFreq + 0.5) + 1),
				);

				// Term frequency saturation & length normalization
				const numerator = termFreq * (this.k1 + 1);
				const denominator =
					termFreq + this.k1 * (1 - this.b + this.b * (docLength / this.avgdl));

				score += idf * (numerator / denominator);
			}

			if (score > 0) {
				results.push({ id, score, metadata: doc.metadata });
			}
		}

		const sorted = results.sort((a, b) => b.score - a.score).slice(0, limit);
		// Evict oldest cache entries when max size exceeded
		if (this.searchCache.size >= this.searchCacheMaxSize) {
			const oldestKeys = [...this.searchCache.entries()]
				.sort((a, b) => a[1].timestamp - b[1].timestamp)
				.slice(0, Math.max(1, Math.floor(this.searchCacheMaxSize * 0.1)))
				.map(([key]) => key);
			for (const key of oldestKeys) {
				this.searchCache.delete(key);
			}
		}
		this.searchCache.set(cacheKey, { results: sorted, timestamp: Date.now() });
		return sorted;
	}
}

export const vectorStore = new BM25VectorStore();
