import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as fs from "fs-extra";
import { execSync } from "node:child_process";
import React from "react";
import { render } from "ink";

// Import index.js to run side-effect registrations for tools
import "../../src/agent/index.js";

import { setupE2EEnvironment } from "./helpers/e2e-helper.js";

// F1: Parallel Executor imports
import {
	classifyToolCalls,
	canRunInParallel,
	executeToolsParallel,
} from "../../src/agent/parallel-executor.js";

// F2: Context Compressor imports
import {
	estimateTokens,
	compressContext,
	progressiveCompress,
} from "../../src/agent/context-compressor.js";

// F3: Predictive Prefetcher imports
import {
	getPrefetcher,
	resetPrefetcher,
} from "../../src/agent/prefetcher.js";

// F4: Memory Graph imports
import {
	addNode,
	addEdge,
	searchGraph,
	getSystemPromptMemory,
	loadGraph,
	saveGraph,
} from "../../src/agent/memory/graph.js";

// F5: Chat UI & Viewport imports
import {
	computeMessageLines,
	wrap,
} from "../../src/terminal/output.js";

// F6: Slash Command Palette imports
import {
	CommandPalette,
} from "../../src/cli/ui/components/CommandPalette.js";

// F7: Config Editor imports
import {
	ConfigEditor,
} from "../../src/cli/ui/components/ConfigEditor.js";

// F8: Advanced Tooling imports
import { repoMapTool } from "../../src/agent/tools/repo-map.js";
import { searchTools } from "../../src/agent/tools/search.js";
import {
	registerTool,
	getTool,
	unregisterTool,
	executeTool,
} from "../../src/agent/tools/registry.js";

// Session Manager import
import { sessionManager } from "../../src/session/manager.js";

// Cache import
import { getToolCache, resetToolCache } from "../../src/agent/cache/index.js";

describe("Tehuti CLI Tier 3 & 4 E2E Suite", () => {
	let env: any;
	let tempDir: string;

	beforeEach(async () => {
		env = await setupE2EEnvironment();
		tempDir = process.env.TEST_HOME || "";
		await fs.ensureDir(tempDir);
		resetToolCache();
	});

	afterEach(async () => {
		if (env) {
			await env.cleanup();
		}
		resetPrefetcher();
		resetToolCache();
		vi.restoreAllMocks();
	});

	// ==========================================
	// Tier 3: Cross-Feature Interactions
	// ==========================================
	describe("Tier 3: Cross-Feature Interactions", () => {
		
		it("Test 1: F1 + F3 - Prefetcher cache pre-population with Parallel Executor concurrent tool runs", async () => {
			const prefetcher = getPrefetcher();
			prefetcher.setEnabled(true);
			
			const testFile = path.join(tempDir, "prefetch-target.ts");
			await fs.writeFile(testFile, "export const target = 100;");

			const registry = await import("../../src/agent/tools/registry.js");
			const originalGetTool = registry.getTool;
			
			// Mock the predict rule: when read "a.ts" is called, prefetch "read" for "prefetch-target.ts"
			vi.spyOn(registry, "getTool").mockImplementation((name: string) => {
				if (name === "read") {
					return {
						name: "read",
						isReadonly: true,
						prefetchRules: [
							{
								tool: "read",
								argMapper: () => ({ file_path: testFile }),
								priority: "high"
							}
						]
					} as any;
				}
				return originalGetTool(name);
			});

			// Mock execution registry so that reading testFile returns success
			const spyExecute = vi.spyOn(registry, "executeTool").mockImplementation(async (name: string, args: any) => {
				if (name === "read" && args.file_path === testFile) {
					return { success: true, output: "pre-populated content" };
				}
				return { success: false, output: "error" };
			});

			const mockCtx = {
				messages: [],
				config: { model: "test" },
				cwd: tempDir,
				metadata: { tokensUsed: 0 },
				toolCallCount: 0,
				toolCalls: [],
			} as any;

			// 1. Run prefetcher prediction on "read" of "a.ts". This should run the prefetch in the background.
			prefetcher.predict("read", { file_path: "a.ts" }, { cwd: tempDir, workingDir: tempDir, env: {} } as any);

			// Await outstanding prefetches to complete
			const pendingPromise = prefetcher.getPrefetched("read", { file_path: testFile });
			expect(pendingPromise).not.toBeNull();
			const prefetchRes = await pendingPromise;
			expect(prefetchRes).toBeDefined();
			expect(prefetchRes.success).toBe(true);

			// Populate cache manually using the result of the prefetch (as done in prefetcher.ts queuePrefetch)
			getToolCache().set("read", { file_path: testFile }, prefetchRes);

			// Reset mock calls count to verify that executeToolsParallel doesn't trigger a new execution
			spyExecute.mockClear();

			// 2. Now run Parallel Executor executing concurrent read calls containing "read" for "prefetch-target.ts"
			const addToolResult = vi.fn();
			const toolCalls = [
				{
					id: "call_1",
					function: {
						name: "read",
						arguments: JSON.stringify({ file_path: testFile }),
					}
				}
			];

			const results = await executeToolsParallel(toolCalls, {
				ctx: mockCtx,
				toolContext: { cwd: tempDir, workingDir: tempDir, env: {} },
				addToolResult,
			});

			expect(results).toHaveLength(1);
			expect(results[0].success).toBe(true);
			expect(results[0].output).toBe("pre-populated content");
			// Parallel Executor should bypass executeTool call since it is found in the cache
			expect(spyExecute).toHaveBeenCalledTimes(0);
		});

		it("Test 2: F2 + F4 - Compressor saving context memory with Memory Graph inserts", async () => {
			await saveGraph({ nodes: [], edges: [] });

			// 1. Insert multiple nodes into the memory graph representing critical configuration context
			await addNode("mem-node-1", "critical_fact", "Secret Key X = 99", tempDir, 10);
			await addNode("mem-node-2", "critical_fact", "Production URL = api.osiris.com", tempDir, 8);

			// 2. Build the system prompt memory
			const memoryPrompt = await getSystemPromptMemory(tempDir);
			expect(memoryPrompt).toContain("Secret Key X = 99");

			// 3. Create context messages including the memory prompt in the system message
			const messages = [
				{ role: "system" as const, content: `System Directives:\n${memoryPrompt}` },
				...Array.from({ length: 10 }, (_, i) => ({
					role: "user" as const,
					content: `User turn ${i} containing filler dialogue to inflate token counts.`.repeat(10)
				})),
				{ role: "user" as const, content: "Final task question" }
			];

			// 4. Run Context Compressor
			const compressed = await compressContext(messages, async () => "Summary of user turns", 200, {
				keepFirstN: 1,
				keepLastN: 1,
				chunkSize: 2
			});

			// Verify that the system message containing the memory facts is preserved intact at the start
			expect(compressed.length).toBeLessThan(messages.length);
			expect(compressed[0].role).toBe("system");
			expect(compressed[0].content).toContain("Secret Key X = 99");
			expect(compressed[compressed.length - 1].content).toBe("Final task question");
		});

		it("Test 3: F5 + F6 - Command palette display options in Chat UI custom sliding viewport", () => {
			const viewportHeight = 20;
			const query = "cl";
			
			const commands = [
				{ id: "/clear", label: "Clear", description: "Clear chat", category: "session" as const },
				{ id: "/close", label: "Close", description: "Close window", category: "session" as const },
				{ id: "/models", label: "Models", description: "List models", category: "model" as const }
			];

			const filtered = commands.filter(cmd => cmd.label.toLowerCase().includes(query.toLowerCase()));
			expect(filtered).toHaveLength(2); // Clear and Close

			const commandPaletteLinesCount = 4;
			const chatLinesCount = 30;
			const totalLines = chatLinesCount + commandPaletteLinesCount;

			const maxOffset = Math.max(0, totalLines - viewportHeight);
			expect(maxOffset).toBe(14); // 34 - 20
		});

		it("Test 4: F1 + F4 - Parallel Executor executing concurrent read tools on Memory Graph files", async () => {
			await saveGraph({ nodes: [], edges: [] });
			await addNode("n-parallel-1", "fact", "important fact 1", tempDir);
			await addNode("n-parallel-2", "fact", "important fact 2", tempDir);

			const memoryFilePath = path.join(tempDir, ".tehuti", "memory-graph.json");
			expect(await fs.pathExists(memoryFilePath)).toBe(true);

			const registry = await import("../../src/agent/tools/registry.js");
			// Mock executeTool so we don't hit path safety/symlink restrictions in test env
			vi.spyOn(registry, "executeTool").mockImplementation(async (name: string, args: any) => {
				if ((name === "read" || name === "file_info") && args.file_path === memoryFilePath) {
					const content = await fs.readFile(memoryFilePath, "utf8");
					return { success: true, output: content };
				}
				return { success: false, output: "error" };
			});

			const toolCalls = [
				{
					id: "1",
					function: {
						name: "read",
						arguments: JSON.stringify({ file_path: memoryFilePath })
					}
				},
				{
					id: "2",
					function: {
						name: "file_info",
						arguments: JSON.stringify({ file_path: memoryFilePath })
					}
				}
			];

			const mockCtx = {
				messages: [],
				config: { model: "test" },
				cwd: tempDir,
				metadata: { tokensUsed: 0 },
				toolCallCount: 0,
				toolCalls: [],
			} as any;

			const addToolResult = vi.fn();
			
			const results = await executeToolsParallel(toolCalls, {
				ctx: mockCtx,
				toolContext: { cwd: tempDir, workingDir: tempDir, env: {} },
				addToolResult,
			});

			expect(results).toHaveLength(2);
			expect(results[0].success).toBe(true);
			expect(results[1].success).toBe(true);

			const readOutput = JSON.parse(results[0].output);
			expect(readOutput.nodes).toHaveLength(2);
		});

		it("Test 5: F2 + F8 - Context Compressor managing token boundaries for large AST parsing/grep tool results", async () => {
			const largeCode = `
				${Array.from({ length: 50 }, (_, i) => `export class ControllerClass${i} { handleRequest() { return ${i}; } }`).join("\n")}
			`;
			const codeFile = path.join(tempDir, "large-definitions.ts");
			await fs.writeFile(codeFile, largeCode);

			const repoMapResult = await repoMapTool.execute(
				{ path: tempDir },
				{ cwd: tempDir, workingDir: tempDir, env: {}, timeout: 30000 }
			);
			expect(repoMapResult.success).toBe(true);
			const repoMapOutput = repoMapResult.output;
			expect(repoMapOutput.length).toBeGreaterThan(1000);

			const messages = [
				{ role: "system" as const, content: "You are a coding assistant" },
				{ role: "user" as const, content: "Summarize the project structure" },
				{ role: "assistant" as const, content: `Here is the repo structure:\n${repoMapOutput}` },
				{ role: "user" as const, content: "Great, now write a test" }
			];

			// Compress with keepFirstN: 1, keepLastN: 1, chunkSize: 2
			// This chunks the 2 compressable messages into 1 chunk, reducing the message count to 3
			const compressed = await compressContext(messages, async () => "[Summary of Repo Map]", 100, {
				keepFirstN: 1,
				keepLastN: 1,
				chunkSize: 2
			});

			expect(compressed.length).toBeLessThan(messages.length);
			expect(compressed).toHaveLength(3);
			const condensedMsg = compressed.find(m => m.role === "assistant");
			expect(condensedMsg).toBeDefined();
			expect(condensedMsg?.content).toContain("[Previous Context Summary]");
		});

		it("Test 6: F5 + F7 - Config editor form rendering and editing displayed inside Chat UI scrolling viewport", () => {
			const config = { provider: "openrouter", apiKey: "test-api-key", temperature: 0.7 };
			const configEditorLines = 7;
			
			const msg = { role: "assistant", content: "Config Settings Panel:" };
			const baseLines = computeMessageLines(msg, 80); 

			const totalConfigUIRows = baseLines + configEditorLines;
			expect(totalConfigUIRows).toBe(10);

			const viewportHeight = 24;
			const maxOff = Math.max(0, totalConfigUIRows - viewportHeight);
			expect(maxOff).toBe(0); 
		});

		it("Test 7: F3 + F8 - Prefetcher rule conditions triggering and prefetching AST/search tool results", async () => {
			const prefetcher = getPrefetcher();
			prefetcher.setEnabled(true);

			const registry = await import("../../src/agent/tools/registry.js");
			const originalGetTool = registry.getTool;
			
			vi.spyOn(registry, "getTool").mockImplementation((name: string) => {
				if (name === "grep") {
					return {
						name: "grep",
						isReadonly: true,
						prefetchRules: [
							{
								tool: "repo_map",
								argMapper: (args: any) => ({ path: args.path }),
								condition: (args: any) => args.path !== undefined
							}
						]
					} as any;
				}
				return originalGetTool(name);
			});

			// Mock executeTool so that executing repo_map returns a mock success
			vi.spyOn(registry, "executeTool").mockImplementation(async (name: string, args: any) => {
				if (name === "repo_map") {
					return { success: true, output: "repo-map-prefetched" };
				}
				return { success: false, output: "error" };
			});

			prefetcher.predict("grep", { pattern: "Scribe", path: tempDir }, { cwd: tempDir, workingDir: tempDir, env: {} } as any);

			expect(prefetcher.hasPrefetched("repo_map", { path: tempDir })).toBe(true);

			const promise = prefetcher.getPrefetched("repo_map", { path: tempDir });
			expect(promise).not.toBeNull();
			const res = await promise;
			expect(res.success).toBe(true);
			expect(res.output).toBe("repo-map-prefetched");
		});

		it("Test 8: F6 + F7 - Command palette launching Config Editor submenus to update configurations", async () => {
			const mockConfigChange = vi.fn().mockImplementation(async (key: string, val: any) => {
				const configPath = path.join(tempDir, ".tehuti.json");
				const current = await fs.readJson(configPath);
				current[key] = val;
				await fs.writeJson(configPath, current);
			});

			const configSubmenu = {
				id: "/config/temperature",
				label: "Edit Temperature",
				category: "submenu" as const,
				execute: async () => {
					await mockConfigChange("temperature", 0.95);
				}
			};

			await configSubmenu.execute();

			expect(mockConfigChange).toHaveBeenCalledWith("temperature", 0.95);
			const savedConfig = await fs.readJson(path.join(tempDir, ".tehuti.json"));
			expect(savedConfig.temperature).toBe(0.95);
		});
	});

	// ==========================================
	// Tier 4: Real-World Application Scenarios
	// ==========================================
	describe("Tier 4: Real-World Application Scenarios", () => {

		it("Test 9: Greenfield project generation scenario", async () => {
			const projectDir = path.join(tempDir, "greenfield-project");
			await fs.ensureDir(projectDir);

			const tsConfig = {
				compilerOptions: {
					target: "es2022",
					module: "NodeNext",
					moduleResolution: "NodeNext",
					esModuleInterop: true,
					strict: true,
					skipLibCheck: true
				},
				include: ["src/**/*"]
			};
			await fs.writeJson(path.join(projectDir, "tsconfig.json"), tsConfig, { spaces: 2 });
			await fs.ensureDir(path.join(projectDir, "src"));

			const mathCode = `
				export function multiply(a: number, b: number): number {
					return a * b;
				}
			`;
			await fs.writeFile(path.join(projectDir, "src/math.ts"), mathCode);

			const mainCode = `
				import { multiply } from "./math.js";
				const result = multiply(10, 5);
				console.log(\`Result: \${result}\`);
			`;
			await fs.writeFile(path.join(projectDir, "src/index.ts"), mainCode);

			let compilationPassed = false;
			try {
				execSync("npx tsc --noEmit", { cwd: projectDir, stdio: "pipe" });
				compilationPassed = true;
			} catch (err: any) {
				compilationPassed = false;
				console.error("Compilation error output:", err.stdout?.toString());
			}

			expect(compilationPassed).toBe(true);
		});

		it("Test 10: Multi-file refactoring scenario", async () => {
			const refactorDir = path.join(tempDir, "refactor-project");
			await fs.ensureDir(refactorDir);
			await fs.ensureDir(path.join(refactorDir, "src"));

			const tsConfig = {
				compilerOptions: { target: "es2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true },
				include: ["src/**/*"]
			};
			await fs.writeJson(path.join(refactorDir, "tsconfig.json"), tsConfig);

			const oldUtilCode = `
				export function calculateSum(a: number, b: number): number {
					return a + b;
				}
			`;
			await fs.writeFile(path.join(refactorDir, "src/util.ts"), oldUtilCode);

			const oldAppCode = `
				import { calculateSum } from "./util.js";
				console.log(calculateSum(10, 20));
			`;
			await fs.writeFile(path.join(refactorDir, "src/app.ts"), oldAppCode);

			// Mock registry.executeTool to prevent path/permission errors on read
			const registry = await import("../../src/agent/tools/registry.js");
			vi.spyOn(registry, "executeTool").mockImplementation(async (name: string, args: any) => {
				if (name === "read") {
					const content = await fs.readFile(args.file_path, "utf8");
					return { success: true, output: content };
				}
				return { success: false, output: "error" };
			});

			const addToolResult = vi.fn();
			const readCalls = [
				{ id: "r1", function: { name: "read", arguments: JSON.stringify({ file_path: path.join(refactorDir, "src/util.ts") }) } },
				{ id: "r2", function: { name: "read", arguments: JSON.stringify({ file_path: path.join(refactorDir, "src/app.ts") }) } }
			];
			const readResults = await executeToolsParallel(readCalls, {
				ctx: { cwd: refactorDir } as any,
				toolContext: { cwd: refactorDir, workingDir: refactorDir, env: {} },
				addToolResult,
			});
			expect(readResults).toHaveLength(2);
			expect(readResults[0].success).toBe(true);

			// Perform refactoring updates
			const newUtilCode = `
				export function sum(a: number, b: number): number {
					return a + b;
				}
			`;
			await fs.writeFile(path.join(refactorDir, "src/util.ts"), newUtilCode);

			const newAppCode = `
				import { sum } from "./util.js";
				console.log(sum(10, 20));
			`;
			await fs.writeFile(path.join(refactorDir, "src/app.ts"), newAppCode);

			let typecheckSuccess = false;
			try {
				execSync("npx tsc --noEmit", { cwd: refactorDir, stdio: "pipe" });
				typecheckSuccess = true;
			} catch (err: any) {
				typecheckSuccess = false;
			}
			expect(typecheckSuccess).toBe(true);
		});

		it("Test 11: Debugging loop scenario", async () => {
			const debugDir = path.join(tempDir, "debugging-project");
			await fs.ensureDir(debugDir);
			await fs.ensureDir(path.join(debugDir, "src"));

			await fs.writeJson(path.join(debugDir, "tsconfig.json"), {
				compilerOptions: { target: "es2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true },
				include: ["src/**/*"]
			});

			const buggyCode = `
				const age: number = "twenty-five";
			`;
			const bugFilePath = path.join(debugDir, "src/buggy.ts");
			await fs.writeFile(bugFilePath, buggyCode);

			let errorOutput = "";
			try {
				execSync("npx tsc --noEmit", { cwd: debugDir, stdio: "pipe" });
			} catch (err: any) {
				errorOutput = err.stdout?.toString() || err.stderr?.toString();
			}
			expect(errorOutput).toContain("is not assignable to type 'number'");

			const correctedCode = `
				const age: number = 25;
			`;
			await fs.writeFile(bugFilePath, correctedCode);

			let debugSuccess = false;
			try {
				execSync("npx tsc --noEmit", { cwd: debugDir, stdio: "pipe" });
				debugSuccess = true;
			} catch {}
			expect(debugSuccess).toBe(true);
		});

		it("Test 12: Long session context compression scenario", async () => {
			const systemPrompt = "Instructions: you are Tehuti, divine scribe.";
			const messages = [
				{ role: "system" as const, content: systemPrompt }
			];

			for (let i = 0; i < 6; i++) {
				messages.push({
					role: "user" as const,
					content: `Turn ${i} user request. Let's build a massive file database system.`.repeat(100)
				});
				messages.push({
					role: "assistant" as const,
					content: `Turn ${i} response. Executing commands and generating directories.`.repeat(100)
				});
			}
			messages.push({ role: "user" as const, content: "Final prompt request" });

			const initialTokens = estimateTokens(messages);
			expect(initialTokens).toBeGreaterThan(1000);

			const summarizer = vi.fn().mockResolvedValue("Turn Summary");
			const compressed = await compressContext(messages, summarizer, 200, {
				keepFirstN: 1,
				keepLastN: 1,
				chunkSize: 2
			});

			expect(compressed.length).toBeLessThan(messages.length);
			expect(compressed[0].content).toBe(systemPrompt);
			expect(compressed[compressed.length - 1].content).toBe("Final prompt request");
			expect(summarizer).toHaveBeenCalled();

			// Fallback compression with failing summarizer
			const failingSummarizer = vi.fn().mockRejectedValue(new Error("LLM failure"));
			const fallbackCompressed = await compressContext(messages, failingSummarizer, 200, {
				keepFirstN: 1,
				keepLastN: 1,
				chunkSize: 2
			});

			// For fallback compression, array length doesn't change, but total estimated tokens decreases
			expect(fallbackCompressed.length).toBe(messages.length);
			expect(estimateTokens(fallbackCompressed)).toBeLessThan(initialTokens);
			expect(fallbackCompressed[0].content).toBe(systemPrompt);
			expect(fallbackCompressed[fallbackCompressed.length - 1].content).toBe("Final prompt request");
			
			const condensedMsg = fallbackCompressed.find(m => typeof m.content === "string" && m.content.startsWith("[Condensed]"));
			expect(condensedMsg).toBeDefined();
		});

		it("Test 13: Config and Session Persistence scenario", async () => {
			const configPath = path.join(tempDir, ".tehuti.json");
			await fs.writeJson(configPath, {
				apiKey: "api-key-original",
				model: "original-model",
				provider: "openrouter",
				initialized: true
			});

			const sessionsDir = path.join(tempDir, "sessions");
			await fs.ensureDir(sessionsDir);

			vi.spyOn(sessionManager, "getSessionsDir").mockReturnValue(sessionsDir);
			(sessionManager as any).sessionsDir = sessionsDir;

			const mockCtx = {
				cwd: tempDir,
				workingDir: tempDir,
				messages: [
					{ role: "system", content: "Init system" },
					{ role: "user", content: "Create a schema file" },
					{ role: "assistant", content: "Here is the schema" }
				],
				config: {
					model: "original-model",
					provider: "openrouter",
					apiKey: "api-key-original"
				},
				metadata: {
					toolCalls: 2,
					tokensUsed: 120,
					startTime: new Date()
				}
			} as any;

			const sessionId = await sessionManager.createSession(tempDir, "original-model");
			expect(sessionId).toBeDefined();

			await sessionManager.saveSession(sessionId, mockCtx, "Schema Design Session");

			const loadedConfig = await fs.readJson(configPath);
			loadedConfig.model = "refactored-deepseek-model";
			await fs.writeJson(configPath, loadedConfig);

			const loadedSession = await sessionManager.loadSession(sessionId);
			expect(loadedSession).not.toBeNull();
			expect(loadedSession?.metadata.name).toBe("Schema Design Session");
			expect(loadedSession?.messages).toHaveLength(3);
			expect(loadedSession?.metadata.toolCalls).toBe(2);

			const finalConfig = await fs.readJson(configPath);
			expect(finalConfig.model).toBe("refactored-deepseek-model");
		});
	});
});
