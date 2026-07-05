import { describe, expect, it } from "vitest";
import { z } from "zod";
import { type ToolDefinition, ToolRegistryManager } from "./registry.js";

describe("ToolRegistryManager Concurrency and Scoping Stress Tests", () => {
	const mockCtx = {
		cwd: process.cwd(),
		workingDir: process.cwd(),
		env: {},
		timeout: 30000,
	};

	it("should handle 1000 concurrent registrations and unregistrations without corruption", async () => {
		const registry = new ToolRegistryManager();
		const promises: Promise<void>[] = [];

		for (let i = 0; i < 1000; i++) {
			const name = `tool_${i}`;
			promises.push(
				(async () => {
					// Register
					registry.registerTool({
						name,
						description: `Description ${i}`,
						parameters: z.object({}),
						execute: async () => ({ success: true, output: `Output ${i}` }),
						category: "test",
					});

					// Verify existence
					const tool = registry.getTool(name);
					expect(tool).toBeDefined();
					expect(tool?.name).toBe(name);

					// Execute
					const res = await registry.executeTool(name, {}, mockCtx);
					expect(res.success).toBe(true);
					expect(res.output).toBe(`Output ${i}`);

					// Unregister half of them
					if (i % 2 === 0) {
						const removed = registry.unregisterTool(name);
						expect(removed).toBe(true);
						expect(registry.getTool(name)).toBeUndefined();
					}
				})(),
			);
		}

		await Promise.all(promises);

		// Assert that exactly 500 tools remain in the registry
		const allTools = registry.getAllTools();
		expect(allTools.length).toBe(500);
	});

	it("should maintain parent-child scoping and isolation under concurrent access", async () => {
		const parent = new ToolRegistryManager();
		const child1 = new ToolRegistryManager(parent);
		const child2 = new ToolRegistryManager(parent);

		// Register tool in parent
		parent.registerTool({
			name: "shared_tool",
			description: "Shared",
			parameters: z.object({}),
			execute: async () => ({ success: true, output: "parent_val" }),
			category: "test",
		});

		const promises: Promise<void>[] = [];

		// Child 1 overrides shared_tool and registers child1_tool
		promises.push(
			(async () => {
				for (let i = 0; i < 100; i++) {
					child1.registerTool({
						name: "shared_tool",
						description: "Shared Child 1",
						parameters: z.object({}),
						execute: async () => ({ success: true, output: `child1_val_${i}` }),
						category: "test",
					});
					const res = await child1.executeTool("shared_tool", {}, mockCtx);
					expect(res.output).toBe(`child1_val_${i}`);
				}
			})(),
		);

		// Child 2 keeps parent's shared_tool as is, but registers child2_tool
		promises.push(
			(async () => {
				for (let i = 0; i < 100; i++) {
					const res = await child2.executeTool("shared_tool", {}, mockCtx);
					expect(res.output).toBe("parent_val");
				}
			})(),
		);

		// Parent registry concurrently registers and executes other tools
		promises.push(
			(async () => {
				for (let i = 0; i < 100; i++) {
					parent.registerTool({
						name: `parent_only_${i}`,
						description: "Parent Only",
						parameters: z.object({}),
						execute: async () => ({ success: true, output: `parent_${i}` }),
						category: "test",
					});
					const res = await parent.executeTool(`parent_only_${i}`, {}, mockCtx);
					expect(res.output).toBe(`parent_${i}`);
				}
			})(),
		);

		await Promise.all(promises);

		// Verify child 1 has overridden shared_tool, child 2 uses parent's version
		const res1 = await child1.executeTool("shared_tool", {}, mockCtx);
		expect(res1.output).toContain("child1_val_");
		const res2 = await child2.executeTool("shared_tool", {}, mockCtx);
		expect(res2.output).toBe("parent_val");
	});

	it("should handle re-entrant tool registration hooks gracefully", () => {
		const registry = new ToolRegistryManager();

		const secondaryTool: ToolDefinition = {
			name: "secondary",
			description: "Secondary",
			parameters: z.object({}),
			execute: async () => ({ success: true, output: "secondary" }),
			category: "test",
		};

		const primaryTool: ToolDefinition = {
			name: "primary",
			description: "Primary",
			parameters: z.object({}),
			execute: async () => ({ success: true, output: "primary" }),
			category: "test",
			onRegister: (mgr) => {
				// Register secondary tool during registration
				mgr.registerTool(secondaryTool);
			},
			onUnregister: (mgr) => {
				// Unregister secondary tool during unregistration
				mgr.unregisterTool("secondary");
			},
		};

		registry.registerTool(primaryTool);

		expect(registry.getTool("primary")).toBeDefined();
		expect(registry.getTool("secondary")).toBeDefined();

		registry.unregisterTool("primary");

		expect(registry.getTool("primary")).toBeUndefined();
		expect(registry.getTool("secondary")).toBeUndefined();
	});

	it("should handle circular or deeply nested re-entrant registrations", () => {
		const registry = new ToolRegistryManager();

		// A registers B, B registers A (circular check)
		// We use a counter to avoid infinite loops if it gets called indefinitely
		let registerCount = 0;

		const toolB: ToolDefinition = {
			name: "tool_b",
			description: "Tool B",
			parameters: z.object({}),
			execute: async () => ({ success: true, output: "B" }),
			category: "test",
			onRegister: (mgr) => {
				if (registerCount < 10) {
					registerCount++;
					mgr.registerTool(toolA);
				}
			},
		};

		const toolA: ToolDefinition = {
			name: "tool_a",
			description: "Tool A",
			parameters: z.object({}),
			execute: async () => ({ success: true, output: "A" }),
			category: "test",
			onRegister: (mgr) => {
				if (registerCount < 10) {
					registerCount++;
					mgr.registerTool(toolB);
				}
			},
		};

		registry.registerTool(toolA);
		expect(registry.getTool("tool_a")).toBeDefined();
		expect(registry.getTool("tool_b")).toBeDefined();
	});

	it("should handle unregisterToolsWhere with dynamic modifications inside predicates", () => {
		const registry = new ToolRegistryManager();

		for (let i = 0; i < 50; i++) {
			registry.registerTool({
				name: `dynamic_${i}`,
				description: `Dynamic ${i}`,
				parameters: z.object({}),
				execute: async () => ({ success: true, output: "" }),
				category: "test",
			});
		}

		// A predicate that tries to register new tools while iterating/unregistering
		let newCount = 0;
		registry.unregisterToolsWhere((tool) => {
			if (tool.name.startsWith("dynamic_") && newCount < 10) {
				registry.registerTool({
					name: `nested_dynamic_${newCount}`,
					description: `Nested ${newCount}`,
					parameters: z.object({}),
					execute: async () => ({ success: true, output: "" }),
					category: "test",
				});
				newCount++;
			}
			return true; // remove all checked tools
		});

		// Verify no crash occurs and mapping is clear
		expect(registry.getAllTools().length).toBeLessThan(50);
	});
});
