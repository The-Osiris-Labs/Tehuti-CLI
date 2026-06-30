import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import {
	loadGraph,
	saveGraph,
	addNode,
	searchGraph,
	getSystemPromptMemory,
} from "./graph.js";

const mockFiles: Record<string, string> = {};
const MEMORY_FILE = path.join(os.homedir(), ".tehuti", "memory-graph.json");

let ioDelayMs = 0;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

vi.mock("fs-extra", () => {
	return {
		default: {
			pathExists: async (p: string) => {
				if (ioDelayMs > 0) await delay(ioDelayMs);
				return p in mockFiles;
			},
			readJson: async (p: string) => {
				if (ioDelayMs > 0) await delay(ioDelayMs);
				if (!(p in mockFiles)) {
					throw new Error("File not found");
				}
				return JSON.parse(mockFiles[p]);
			},
			writeJson: async (p: string, data: any) => {
				if (ioDelayMs > 0) await delay(ioDelayMs);
				mockFiles[p] = JSON.stringify(data, null, 2);
			},
			move: async (src: string, dest: string, options?: { overwrite?: boolean }) => {
				if (ioDelayMs > 0) await delay(ioDelayMs);
				if (!(src in mockFiles)) {
					throw new Error("Source not found");
				}
				mockFiles[dest] = mockFiles[src];
				delete mockFiles[src];
			},
			copy: async (src: string, dest: string) => {
				if (ioDelayMs > 0) await delay(ioDelayMs);
				if (!(src in mockFiles)) {
					throw new Error("Source not found");
				}
				mockFiles[dest] = mockFiles[src];
			},
			ensureDir: async (p: string) => {
				if (ioDelayMs > 0) await delay(ioDelayMs);
			}
		}
	};
});

describe("Memory Graph Concurrency Stress", () => {
	beforeEach(() => {
		for (const key in mockFiles) {
			delete mockFiles[key];
		}
		ioDelayMs = 0;
		vi.clearAllMocks();
	});

	it("should handle 100 concurrent reads and writes without losing data or causing corruption", async () => {
		ioDelayMs = 5; // Introduce simulated delay to stress-test locks

		const promises: Promise<any>[] = [];
		const totalWrites = 50;
		const totalReads = 50;

		// Spawn 50 concurrent writes
		for (let i = 0; i < totalWrites; i++) {
			promises.push(addNode(`node-${i}`, "critical_fact", `content ${i}`, "global"));
		}

		// Spawn 50 concurrent reads
		for (let i = 0; i < totalReads; i++) {
			promises.push(searchGraph("content", "global"));
		}

		await Promise.all(promises);

		// Verify that all 50 nodes were successfully written and are in the final graph
		const graph = await loadGraph();
		expect(graph.nodes).toHaveLength(totalWrites);

		const nodeIds = graph.nodes.map((n) => n.id);
		for (let i = 0; i < totalWrites; i++) {
			expect(nodeIds).toContain(`node-${i}`);
		}
	});

	it("should remain consistent if reads and writes are heavily interleaved", async () => {
		ioDelayMs = 2;

		const runInterleaved = async () => {
			for (let i = 0; i < 10; i++) {
				await addNode(`interleaved-${i}`, "project_rule", `rule ${i}`, "global");
				const results = await searchGraph(`rule ${i}`, "global");
				expect(results.length).toBeGreaterThan(0);
			}
		};

		// Run 5 concurrent interleaved sequences
		await Promise.all([
			runInterleaved(),
			runInterleaved(),
			runInterleaved(),
			runInterleaved(),
			runInterleaved(),
		]);

		const graph = await loadGraph();
		// Since keys are overlapping (each run does `interleaved-0` to `interleaved-9`),
		// the final graph should have exactly 10 nodes (0 to 9) with access counts updated.
		expect(graph.nodes).toHaveLength(10);
	});
});
