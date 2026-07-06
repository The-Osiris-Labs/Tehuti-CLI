import { vi } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "fs-extra";
import { PassThrough } from "node:stream";

// Define the temporary home directory path with a unique suffix for parallel test safety
const UNIQUE_ID = Math.random().toString(36).substring(2, 15);
const TEST_HOME = path.join(process.cwd(), `tests/e2e/.tmp-home-${UNIQUE_ID}`);

// Set environment variables before any other code imports this
process.env.TEST_HOME = TEST_HOME;
process.env.TEHUTI_CONFIG_DIR = path.join(TEST_HOME, ".config");

// Use vi.hoisted to ensure these mocks are configured at the very beginning of compilation
vi.mock("node:os", async (importOriginal) => {
	const original = await importOriginal<typeof import("node:os")>();
	return {
		...original,
		homedir: () => process.env.TEST_HOME || original.homedir(),
	};
});

vi.mock("os", async (importOriginal) => {
	const original = await importOriginal<typeof import("os")>();
	return {
		...original,
		homedir: () => process.env.TEST_HOME || original.homedir(),
	};
});

// Mock OpenRouterClient
interface MockResponse {
	content?: string;
	reasoning?: string;
	toolCalls?: { name: string; arguments: string }[];
	error?: Error;
}

const responseQueue: MockResponse[] = [];

export function enqueueMockResponse(response: MockResponse) {
	responseQueue.push(response);
}

export function clearMockResponses() {
	responseQueue.length = 0;
}

const mockStreamChat = async function* (messages: any[], tools: any[], options: any, signal: any) {
	const nextResponse = responseQueue.shift();
	if (!nextResponse) {
		yield {
			id: "mock-chunk",
			choices: [{
				index: 0,
				delta: { content: "Hello from mock Tehuti!" },
				finish_reason: "stop"
			}],
			usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
		};
		return;
	}

	if (nextResponse.error) {
		throw nextResponse.error;
	}

	if (nextResponse.reasoning) {
		yield {
			id: "mock-chunk",
			choices: [{
				index: 0,
				delta: { reasoning: nextResponse.reasoning },
				finish_reason: null
			}]
		};
	}

	if (nextResponse.content) {
		yield {
			id: "mock-chunk",
			choices: [{
				index: 0,
				delta: { content: nextResponse.content },
				finish_reason: nextResponse.toolCalls ? null : "stop"
			}],
			usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
		};
	}

	if (nextResponse.toolCalls) {
		yield {
			id: "mock-chunk",
			choices: [{
				index: 0,
				delta: {
					tool_calls: nextResponse.toolCalls.map((tc, idx) => ({
						index: idx,
						id: `call_${idx}`,
						type: "function",
						function: {
							name: tc.name,
							arguments: tc.arguments
						}
					}))
				},
				finish_reason: "tool_calls"
			}]
		};
	}
};

const mockCompleteChat = vi.fn().mockImplementation(async (messages: any[], options: any) => {
	return {
		choices: [{ message: { role: "assistant", content: "Mock summary response" } }],
		usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
	};
});

vi.mock("../../../src/api/standard-client.js", () => {
	return {
		StandardAPIClient: {
			getInstance: () => ({
				streamChat: mockStreamChat,
				completeChat: mockCompleteChat,
				abort: vi.fn(),
			}),
			resetInstance: vi.fn(),
		}
	};
});




let mockGraph: any = { nodes: [], edges: [] };
vi.mock("../../../src/agent/memory/graph.js", () => {
	return {
		loadGraph: vi.fn(async () => {
            const fs = require("fs-extra");
            const path = require("node:path");
            const tempDir = process.env.TEST_HOME || "";
            const memoryFilePath = path.join(tempDir, ".tehuti", "memory-graph.json");
            if (fs.existsSync(memoryFilePath)) {
                try {
                    const content = fs.readFileSync(memoryFilePath, "utf8");
                    JSON.parse(content);
                } catch (e) {
                    fs.copyFileSync(memoryFilePath, memoryFilePath.replace(".json", `.corrupted-${Date.now()}.json`));
                    throw new Error("Parse error");
                }
            }
			return mockGraph;
		}),
		saveGraph: vi.fn(async (graph) => {
			mockGraph = graph;
		}),
		addNode: vi.fn(async (id, type, content, cwd, priority) => {
            const path = require("node:path");
			mockGraph.nodes.push({ id, type, content, cwd: cwd === "global" ? cwd : path.resolve(cwd || ""), priority });
			if (mockGraph.nodes.length > 1000) {
				mockGraph.nodes.sort((a: any, b: any) => (b.priority || 0) - (a.priority || 0));
				mockGraph.nodes = mockGraph.nodes.slice(0, 1000);
			}
		}),
		addEdge: vi.fn(async (source, target, relation) => {
			mockGraph.edges.push({ source, target, relation });
		}),
		searchGraph: vi.fn(async (query, cwd) => {
            const path = require("node:path");
			return mockGraph.nodes.filter((n: any) => 
                (n.content.includes(query) || n.id.includes(query)) && 
                (n.cwd === "global" || n.cwd === cwd || n.cwd === path.resolve(cwd || ""))
            );
		}),
		getSystemPromptMemory: vi.fn(async (cwd) => {
            const path = require("node:path");
            const resolvedCwd = path.resolve(cwd || "");
            const nodes = mockGraph.nodes
                .filter((n: any) => n.cwd === "global" || n.cwd === resolvedCwd || n.cwd === cwd)
                .sort((a: any, b: any) => (b.priority || 0) - (a.priority || 0));
                
            let prompt = "\n## Long-Term Memory\n";
            for (const n of nodes) {
                prompt += `- [${n.id}] ${n.content}\n`;
            }
			return prompt;
		}),
	};
});

// Helper to configure E2E testing environment
export async function setupE2EEnvironment() {
	// Recreate a clean test home directory
	await fs.ensureDir(TEST_HOME);
	await fs.ensureDir(process.env.TEHUTI_CONFIG_DIR!);

	// Write a mock config file ~/.tehuti.json
	const configPath = path.join(TEST_HOME, ".tehuti.json");
	await fs.writeJson(configPath, {
		apiKey: "sk-or-test-e2e-api-key-12345",
		model: "test/model",
		provider: "openrouter",
		initialized: true
	});

	clearMockResponses();

	// Setup mock streams
	const stdin = new PassThrough() as any;
	stdin.isTTY = true;
	stdin.setRawMode = vi.fn();

	const stdout = new PassThrough() as any;
	stdout.isTTY = true;
	stdout.columns = 80;
	stdout.rows = 24;

	let output = "";
	stdout.on("data", (chunk: Buffer) => {
		output += chunk.toString();
	});

	const originalStdin = process.stdin;
	const originalStdout = process.stdout;

	Object.defineProperty(process, "stdin", {
		value: stdin,
		configurable: true,
		writable: true,
	});

	Object.defineProperty(process, "stdout", {
		value: stdout,
		configurable: true,
		writable: true,
	});

	// Overwrite console.log and console.error to capture their outputs
	const originalConsoleLog = console.log;
	const originalConsoleError = console.error;

	console.log = vi.fn().mockImplementation((...args: any[]) => {
		output += args.map(arg => typeof arg === "string" ? arg : JSON.stringify(arg)).join(" ") + "\n";
	});

	console.error = vi.fn().mockImplementation((...args: any[]) => {
		output += args.map(arg => typeof arg === "string" ? arg : JSON.stringify(arg)).join(" ") + "\n";
	});

	// Mock process.exit to prevent test runner from exiting
	const originalExit = process.exit;
	const mockExit = vi.fn() as any;
	process.exit = mockExit;

	return {
		stdin,
		stdout,
		getOutput: () => output,
		clearOutput: () => {
			output = "";
		},
		mockExit,
		cleanup: async () => {
			// Restore console methods
			console.log = originalConsoleLog;
			console.error = originalConsoleError;

			// Restore original properties
			Object.defineProperty(process, "stdin", {
				value: originalStdin,
				configurable: true,
				writable: true,
			});
			Object.defineProperty(process, "stdout", {
				value: originalStdout,
				configurable: true,
				writable: true,
			});
			process.exit = originalExit;

			// Clean up temp directories
			try {
				await fs.remove(TEST_HOME);
			} catch (err) {
				// Ignore errors during directory cleanup
			}
		}
	};
}
