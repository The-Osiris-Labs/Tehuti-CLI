export interface VectorStore {
	init(): Promise<void>;
	addEmbedding(
		id: string,
		text: string,
		metadata: Record<string, any>,
	): Promise<void>;
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

	async init(): Promise<void> {
		// Ready instantly
	}

	private tokenize(text: string): string[] {
		// Simple word tokenizer
		return text
			.toLowerCase()
			.replace(/[^a-z0-9]/g, " ")
			.split(/\s+/)
			.filter((t) => t.length >= 2);
	}

	async addEmbedding(
		id: string,
		text: string,
		metadata: Record<string, any>,
	): Promise<void> {
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

	async search(
		query: string,
		limit = 5,
	): Promise<
		Array<{ id: string; score: number; metadata: Record<string, any> }>
	> {
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

		return results.sort((a, b) => b.score - a.score).slice(0, limit);
	}
}

export const vectorStore = new BM25VectorStore();
