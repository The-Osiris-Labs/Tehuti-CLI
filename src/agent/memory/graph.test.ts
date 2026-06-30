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
	Node
} from "./graph.js";

// Mock filesystem storage
const mockFiles: Record<string, string> = {};
const MEMORY_FILE = path.join(os.homedir(), ".tehuti", "memory-graph.json");

// Control variable to simulate I/O delays in concurrency tests
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
				// Simulate JSON parsing (will throw SyntaxError on bad JSON)
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

describe("Memory Graph Hardening", () => {
	beforeEach(() => {
		// Clear mock files
		for (const key in mockFiles) {
			delete mockFiles[key];
		}
		ioDelayMs = 0;
		vi.clearAllMocks();
	});

	describe("Atomicity of Writes", () => {
		it("should write to a temp file first then rename it", async () => {
			const testGraph = {
				nodes: [{ id: "n1", type: "critical_fact", content: "atomic test" }],
				edges: []
			};

			await saveGraph(testGraph);

			// The temp file path is MEMORY_FILE + ".tmp"
			const tempPath = `${MEMORY_FILE}.tmp`;
			
			// Verify final file exists with content, and temp file does not remain
			expect(mockFiles[MEMORY_FILE]).toBeDefined();
			expect(mockFiles[tempPath]).toBeUndefined();
			expect(JSON.parse(mockFiles[MEMORY_FILE])).toEqual(testGraph);
		});
	});

	describe("Concurrency Lock", () => {
		it("should execute concurrent writes sequentially using ReadWriteLock", async () => {
			ioDelayMs = 20; // Add simulated disk latency to trigger races if locking fails

			// Start two concurrent addNode operations without awaiting
			const p1 = addNode("c1", "critical_fact", "fact 1");
			const p2 = addNode("c2", "critical_fact", "fact 2");

			await Promise.all([p1, p2]);

			const graph = await loadGraph();
			expect(graph.nodes).toHaveLength(2);
			expect(graph.nodes.some(n => n.id === "c1")).toBe(true);
			expect(graph.nodes.some(n => n.id === "c2")).toBe(true);
		});
	});

	describe("Load Failure & Fallback Backup", () => {
		it("should backup the corrupted file and propagate parse error", async () => {
			// Write invalid JSON to target file
			mockFiles[MEMORY_FILE] = "invalid json { not parseable }";

			// Attempting to load should throw a JSON syntax/parse error
			await expect(loadGraph()).rejects.toThrow();

			// Look for any corrupted backup file keys
			const backupKeys = Object.keys(mockFiles).filter(
				(k) => k.includes("memory-graph.corrupted-")
			);

			expect(backupKeys.length).toBe(1);
			expect(mockFiles[backupKeys[0]!]).toBe("invalid json { not parseable }");
		});
	});

	describe("Node Scoping", () => {
		it("should isolate nodes to workspace cwd and include global nodes", async () => {
			const projectCwd = "/projects/my-app";
			const otherCwd = "/projects/other-app";

			// Add scoped and unscoped (global) nodes
			await addNode("global-fact", "critical_fact", "visible everywhere", "global");
			await addNode("app-fact", "critical_fact", "my app secret fact", projectCwd);
			await addNode("other-fact", "critical_fact", "other app fact", otherCwd);

			// Search when context is projectCwd
			const resultsProject = await searchGraph("fact", projectCwd);
			const idsProject = resultsProject.map((n) => n.id);

			expect(idsProject).toContain("global-fact");
			expect(idsProject).toContain("app-fact");
			expect(idsProject).not.toContain("other-fact");

			// Get system prompt memory for projectCwd
			const promptProject = await getSystemPromptMemory(projectCwd);
			expect(promptProject).toContain("global-fact");
			expect(promptProject).toContain("app-fact");
			expect(promptProject).not.toContain("other-fact");
		});
	});

	describe("LRU/Priority Eviction & Sorting", () => {
		it("should sort memories by relevance/date (priority/importance first, then timestamp)", async () => {
			const cwd = "/projects/evict-test";

			// Add nodes with different priorities
			await addNode("node-low", "critical_fact", "low priority", cwd, 1);
			await delay(5);
			await addNode("node-high", "critical_fact", "high priority", cwd, 10);
			await delay(5);
			await addNode("node-med", "critical_fact", "medium priority", cwd, 5);

			const systemMemory = await getSystemPromptMemory(cwd);
			// Extract lines containing nodes
			const lines = systemMemory.split("\n").filter((l) => l.startsWith("- "));
			
			// Order should be: high (10) -> med (5) -> low (1)
			expect(lines[0]).toContain("node-high");
			expect(lines[1]).toContain("node-med");
			expect(lines[2]).toContain("node-low");
		});

		it("should evict least relevant nodes when limit is exceeded", async () => {
			const cwd = "/projects/limit-test";

			// Add 1005 nodes
			// The first 5 are low priority (1), the next 1000 are high priority (10)
			for (let i = 0; i < 5; i++) {
				await addNode(`low-${i}`, "critical_fact", "low priority", cwd, 1);
			}
			for (let i = 0; i < 1000; i++) {
				await addNode(`high-${i}`, "critical_fact", "high priority", cwd, 10);
			}

			const graph = await loadGraph();
			expect(graph.nodes.length).toBe(1000);

			// The low priority nodes should have been evicted
			const remainingIds = graph.nodes.map(n => n.id);
			for (let i = 0; i < 5; i++) {
				expect(remainingIds).not.toContain(`low-${i}`);
			}
		});
	});
});
