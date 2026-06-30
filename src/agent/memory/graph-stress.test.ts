import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "fs-extra";
import {
	loadGraph,
	saveGraph,
	addNode,
	addEdge,
	searchGraph,
	getSystemPromptMemory,
	GraphData
} from "./graph.js";

// Mock filesystem storage
const mockFiles: Record<string, string> = {};
const MEMORY_FILE = path.join(os.homedir(), ".tehuti", "memory-graph.json");

let ioDelayMs = 0;
let failNextWrite = false;

// Mock active reader/writer tracking
let activeMockWriters = 0;
let activeMockReaders = 0;
let mockViolations = 0;
let maxConcurrentMockReaders = 0;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

vi.mock("fs-extra", () => {
	return {
		default: {
			pathExists: async (p: string) => {
				activeMockReaders++;
				if (activeMockWriters > 0) {
					mockViolations++;
				}
				maxConcurrentMockReaders = Math.max(maxConcurrentMockReaders, activeMockReaders);
				if (ioDelayMs > 0) await delay(ioDelayMs);
				const exists = p in mockFiles;
				activeMockReaders--;
				return exists;
			},
			readJson: async (p: string) => {
				activeMockReaders++;
				if (activeMockWriters > 0) {
					mockViolations++;
				}
				maxConcurrentMockReaders = Math.max(maxConcurrentMockReaders, activeMockReaders);
				if (ioDelayMs > 0) await delay(ioDelayMs);
				if (!(p in mockFiles)) {
					activeMockReaders--;
					throw new Error("File not found");
				}
				const data = JSON.parse(mockFiles[p]);
				activeMockReaders--;
				return data;
			},
			writeJson: async (p: string, data: any) => {
				activeMockWriters++;
				if (activeMockWriters > 1 || activeMockReaders > 0) {
					mockViolations++;
				}
				if (ioDelayMs > 0) await delay(ioDelayMs);
				if (failNextWrite) {
					failNextWrite = false;
					activeMockWriters--;
					throw new Error("Simulated I/O Write Failure");
				}
				mockFiles[p] = JSON.stringify(data, null, 2);
				activeMockWriters--;
			},
			move: async (src: string, dest: string, options?: { overwrite?: boolean }) => {
				activeMockWriters++;
				if (activeMockWriters > 1 || activeMockReaders > 0) {
					mockViolations++;
				}
				if (ioDelayMs > 0) await delay(ioDelayMs);
				if (!(src in mockFiles)) {
					activeMockWriters--;
					throw new Error("Source not found");
				}
				mockFiles[dest] = mockFiles[src];
				delete mockFiles[src];
				activeMockWriters--;
			},
			copy: async (src: string, dest: string) => {
				activeMockWriters++;
				if (activeMockWriters > 1 || activeMockReaders > 0) {
					mockViolations++;
				}
				if (ioDelayMs > 0) await delay(ioDelayMs);
				if (!(src in mockFiles)) {
					activeMockWriters--;
					throw new Error("Source not found");
				}
				mockFiles[dest] = mockFiles[src];
				activeMockWriters--;
			},
			ensureDir: async (p: string) => {
				if (ioDelayMs > 0) await delay(ioDelayMs);
			}
		}
	};
});

describe("Memory Graph ReadWriteLock Stress Tests", () => {
	beforeEach(() => {
		// Clear mock files
		for (const key in mockFiles) {
			delete mockFiles[key];
		}
		ioDelayMs = 0;
		failNextWrite = false;
		activeMockWriters = 0;
		activeMockReaders = 0;
		mockViolations = 0;
		maxConcurrentMockReaders = 0;
		vi.clearAllMocks();
	});

	it("should prevent lost updates under high write concurrency (100 concurrent writes)", async () => {
		ioDelayMs = 5; // Introduce delay to force interleaving

		// Trigger 100 concurrent addNode writes
		const promises = Array.from({ length: 100 }, (_, i) =>
			addNode(`node-${i}`, "critical_fact", `content-${i}`)
		);

		await Promise.all(promises);

		// Read the final graph and check that all 100 nodes exist
		const graph = await loadGraph();
		expect(graph.nodes).toHaveLength(100);

		const ids = graph.nodes.map(n => n.id);
		for (let i = 0; i < 100; i++) {
			expect(ids).toContain(`node-${i}`);
		}
	});

	it("should ensure readers and writers exclude each other correctly", async () => {
		ioDelayMs = 10;

		// Launch 30 writes and 30 reads concurrently
		const operations: Promise<any>[] = [];
		for (let i = 0; i < 30; i++) {
			operations.push(addNode(`w-node-${i}`, "critical_fact", "content"));
			operations.push(searchGraph("content"));
		}

		await Promise.all(operations);

		expect(mockViolations).toBe(0);
		expect(maxConcurrentMockReaders).toBeGreaterThan(1); // Ensure readers actually ran concurrently
	});

	it("should recover and not deadlock if a write operation throws an error", async () => {
		// Initialize the graph with one node
		await addNode("init", "critical_fact", "initial");

		// Make the next write fail
		failNextWrite = true;
		ioDelayMs = 5;

		// This addNode call should reject
		await expect(addNode("failed-node", "critical_fact", "failed")).rejects.toThrow("Simulated I/O Write Failure");

		// The lock should have been released, allowing subsequent operations to succeed
		await addNode("success-node", "critical_fact", "success");

		const graph = await loadGraph();
		expect(graph.nodes.map(n => n.id)).toContain("init");
		expect(graph.nodes.map(n => n.id)).toContain("success-node");
		expect(graph.nodes.map(n => n.id)).not.toContain("failed-node");
	});

	it("should prioritize writers over readers under the lock queue logic", async () => {
		ioDelayMs = 15;
		const order: string[] = [];

		// Start a write lock that holds the lock for a while
		const p1 = addNode("w1", "critical_fact", "write 1").then(() => {
			order.push("write-1-done");
		});

		// Defer requests slightly using setTimeout to control request queue order
		await delay(2);
		
		const p2 = searchGraph("w1").then(() => {
			order.push("read-1-done");
		});

		await delay(2);

		const p3 = addNode("w2", "critical_fact", "write 2").then(() => {
			order.push("write-2-done");
		});

		await delay(2);

		const p4 = searchGraph("w1").then(() => {
			order.push("read-2-done");
		});

		await Promise.all([p1, p2, p3, p4]);

		// Under writer priority logic:
		// 1. write-1 completes.
		// 2. Since write-2 is a writer in writeQueue, it is prioritized and runs before readers (read-1 and read-2).
		// 3. Thus write-2 completes.
		// 4. Finally, when writeQueue is empty, the readQueue is drained, so read-1 and read-2 run and complete.
		// Order: write-1 -> write-2 -> read-1 and read-2
		expect(order.indexOf("write-1-done")).toBeLessThan(order.indexOf("write-2-done"));
		expect(order.indexOf("write-2-done")).toBeLessThan(order.indexOf("read-1-done"));
		expect(order.indexOf("write-2-done")).toBeLessThan(order.indexOf("read-2-done"));
	});
});
