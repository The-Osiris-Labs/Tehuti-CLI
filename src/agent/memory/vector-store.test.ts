import { beforeEach, describe, expect, it } from "vitest";
import { BM25VectorStore } from "./vector-store.js";

describe("BM25VectorStore (BM25)", () => {
	let store: BM25VectorStore;

	beforeEach(async () => {
		store = new BM25VectorStore();
		await store.init();
	});

	it("ranks exact matches higher", async () => {
		await store.addEmbedding("doc1", "the quick brown fox", { doc: 1 });
		await store.addEmbedding("doc2", "the fast brown fox", { doc: 2 });

		const results = await store.search("quick");
		expect(results).toHaveLength(1);
		expect(results[0].id).toBe("doc1");
	});

	it("favors shorter documents (BM25 length normalization)", async () => {
		await store.addEmbedding("short", "artificial intelligence", { doc: 1 });
		await store.addEmbedding(
			"long",
			"artificial intelligence is a fascinating field that is constantly evolving and changing our world",
			{ doc: 2 },
		);

		const results = await store.search("artificial intelligence");
		expect(results).toHaveLength(2);
		// The short doc should rank higher because of length normalization
		expect(results[0].id).toBe("short");
		expect(results[1].id).toBe("long");
	});

	it("favors higher term frequency", async () => {
		await store.addEmbedding("tf-low", "this document mentions AI once", {
			doc: 1,
		});
		await store.addEmbedding(
			"tf-high",
			"this document mentions AI, and it talks about AI, and AI is great",
			{ doc: 2 },
		);

		const results = await store.search("AI");
		expect(results).toHaveLength(2);
		expect(results[0].id).toBe("tf-high");
		expect(results[1].id).toBe("tf-low");
	});

	it("caches IDF and recalculates on new documents", async () => {
		await store.addEmbedding("doc1", "unique word", { doc: 1 });

		let results = await store.search("unique word");
		expect(results).toHaveLength(1);
		const score1 = results[0].score;

		await store.addEmbedding("doc2", "some other text", { doc: 2 });
		// The IDF for "unique" should increase because document count increased but df stayed the same
		results = await store.search("unique word");
		expect(results).toHaveLength(1);
		const score2 = results[0].score;

		expect(score2).toBeGreaterThan(score1);
	});

	it("handles document updates correctly", async () => {
		await store.addEmbedding("doc1", "first version text", {});
		await store.search("version");

		// Update doc1
		await store.addEmbedding("doc1", "second iteration text", {});

		const resultsOld = await store.search("version");
		expect(resultsOld).toHaveLength(0); // Old terms should be removed

		const resultsNew = await store.search("iteration");
		expect(resultsNew).toHaveLength(1);
		expect(resultsNew[0].id).toBe("doc1");
	});
});
