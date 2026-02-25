import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
	clearTools,
	executeTool,
	getTool,
	getToolDefinitions,
	registerTools,
} from "./registry.js";

describe("Tool Registry", () => {
	beforeEach(() => {
		clearTools();
	});

	describe("registerTools", () => {
		it("should register a tool", () => {
			const testTool = {
				name: "test_tool",
				description: "A test tool",
				parameters: z.object({ input: z.string() }),
				execute: async (args: { input: string }) => ({
					success: true,
					output: args.input,
				}),
				category: "test",
				requiresPermission: false,
			};

			registerTools([testTool]);

			const definitions = getToolDefinitions();
			expect(definitions).toHaveLength(1);
			expect(definitions[0].function.name).toBe("test_tool");
		});

		it("should register multiple tools", () => {
			const tools = [
				{
					name: "tool1",
					description: "Tool 1",
					parameters: z.object({}),
					execute: async () => ({ success: true, output: "" }),
					category: "test",
					requiresPermission: false,
				},
				{
					name: "tool2",
					description: "Tool 2",
					parameters: z.object({}),
					execute: async () => ({ success: true, output: "" }),
					category: "test",
					requiresPermission: false,
				},
			];

			registerTools(tools);

			const definitions = getToolDefinitions();
			expect(definitions).toHaveLength(2);
		});
	});

	describe("getTool", () => {
		it("should return a tool by name", () => {
			const testTool = {
				name: "get_test",
				description: "A test tool",
				parameters: z.object({}),
				execute: async () => ({ success: true, output: "test" }),
				category: "test",
				requiresPermission: false,
			};

			registerTools([testTool]);

			const found = getTool("get_test");
			expect(found).toBeDefined();
			expect(found?.name).toBe("get_test");
		});

		it("should return undefined for non-existent tool", () => {
			const found = getTool("nonexistent");
			expect(found).toBeUndefined();
		});
	});

	describe("executeTool", () => {
		it("should execute a tool and return result", async () => {
			const testTool = {
				name: "exec_test",
				description: "A test tool",
				parameters: z.object({ value: z.string() }),
				execute: async (args: { value: string }) => ({
					success: true,
					output: `Received: ${args.value}`,
				}),
				category: "test",
				requiresPermission: false,
			};

			registerTools([testTool]);

			const ctx = { cwd: "/tmp", workingDir: "/tmp", env: {}, timeout: 30000 };
			const result = await executeTool("exec_test", { value: "hello" }, ctx);

			expect(result.success).toBe(true);
			expect(result.output).toBe("Received: hello");
		});

		it("should return error for non-existent tool", async () => {
			const ctx = { cwd: "/tmp", workingDir: "/tmp", env: {}, timeout: 30000 };
			const result = await executeTool("nonexistent", {}, ctx);

			expect(result.success).toBe(false);
			expect(result.error).toContain("Unknown tool");
		});

		it("should validate parameters with Zod schema", async () => {
			const testTool = {
				name: "validated_tool",
				description: "A validated tool",
				parameters: z.object({
					count: z.number().int().positive(),
				}),
				execute: async (args: { count: number }) => ({
					success: true,
					output: `Count: ${args.count}`,
				}),
				category: "test",
				requiresPermission: false,
			};

			registerTools([testTool]);

			const ctx = { cwd: "/tmp", workingDir: "/tmp", env: {}, timeout: 30000 };
			const result = await executeTool("validated_tool", { count: -5 }, ctx);

			expect(result.success).toBe(false);
		});
	});

	describe("getToolDefinitions", () => {
		it("should return OpenRouter-compatible tool definitions", () => {
			const testTool = {
				name: "definition_test",
				description: "Test description",
				parameters: z.object({
					path: z.string().describe("File path"),
					recursive: z.boolean().optional(),
				}),
				execute: async () => ({ success: true, output: "" }),
				category: "test",
				requiresPermission: false,
			};

			registerTools([testTool]);

			const definitions = getToolDefinitions();
			expect(definitions).toHaveLength(1);
			expect(definitions[0]).toHaveProperty("type", "function");
			expect(definitions[0].function.name).toBe("definition_test");
			expect(definitions[0].function.parameters).toHaveProperty("properties");
		});
	});
});
