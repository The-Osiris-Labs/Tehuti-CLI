import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../memory/graph.js", () => ({
	addNode: vi.fn(),
	searchGraph: vi.fn(),
}));

import { addNode, searchGraph } from "../memory/graph.js";
import { memoryTools } from "./memory.js";
import type { ToolContext } from "./registry.js";

const mockedAddNode = vi.mocked(addNode);
const mockedSearchGraph = vi.mocked(searchGraph);

function mockCtx(): ToolContext {
	return {
		config: {} as ToolContext["config"],
		workingDir: "/tmp/test",
		agentContext: undefined,
	} satisfies ToolContext;
}

describe("memoryTools", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("tool definitions", () => {
		it("should export an array of two tools", () => {
			expect(memoryTools).toHaveLength(2);
		});

		it("should have store_insight as first tool", () => {
			expect(memoryTools[0].name).toBe("store_insight");
			expect(memoryTools[0].category).toBe("system");
		});

		it("should have query_memory as second tool", () => {
			expect(memoryTools[1].name).toBe("query_memory");
			expect(memoryTools[1].category).toBe("system");
		});
	});

	describe("store_insight", () => {
		it("should call addNode with correct arguments", async () => {
			mockedAddNode.mockResolvedValue(undefined);

			const result = await memoryTools[0].execute(
				{
					id: "auth-logic",
					type: "project_rule",
					content: "JWT tokens expire after 1h",
				},
				mockCtx(),
			);

			expect(mockedAddNode).toHaveBeenCalledWith(
				"auth-logic",
				"project_rule",
				"JWT tokens expire after 1h",
				expect.any(String),
				0,
				0,
				undefined,
				undefined,
			);
			expect(result.success).toBe(true);
		});

		it("should include epistemic status in output when provided", async () => {
			mockedAddNode.mockResolvedValue(undefined);

			const result = await memoryTools[0].execute(
				{
					id: "rule-1",
					type: "critical_fact",
					content: "Always use bcrypt",
					epistemicStatus: "verified_fact",
					confidenceScore: 0.95,
				},
				mockCtx(),
			);

			expect(result.success).toBe(true);
			expect(result.output).toContain("[verified_fact]");
			expect(mockedAddNode).toHaveBeenCalledWith(
				"rule-1",
				"critical_fact",
				"Always use bcrypt",
				expect.any(String),
				0,
				0,
				"verified_fact",
				0.95,
			);
		});

		it("should omit epistemic tag when not provided", async () => {
			mockedAddNode.mockResolvedValue(undefined);

			const result = await memoryTools[0].execute(
				{
					id: "simple",
					type: "concept",
					content: "React context",
				},
				mockCtx(),
			);

			expect(result.output).not.toContain("[");
		});
	});

	describe("query_memory", () => {
		it("should return no-results message when searchGraph returns empty", async () => {
			mockedSearchGraph.mockResolvedValue([]);

			const result = await memoryTools[1].execute(
				{ query: "nonexistent" },
				mockCtx(),
			);

			expect(result.success).toBe(true);
			expect(result.output).toContain("No memory found");
			expect(result.output).toContain("nonexistent");
		});

		it("should format results from searchGraph", async () => {
			mockedSearchGraph.mockResolvedValue([
				{ type: "project_rule", id: "auth-rule", content: "Use JWT" },
				{ type: "entity", id: "react", content: "React framework" },
			]);

			const result = await memoryTools[1].execute(
				{ query: "react" },
				mockCtx(),
			);

			expect(result.success).toBe(true);
			expect(result.output).toContain("[project_rule] auth-rule: Use JWT");
			expect(result.output).toContain("[entity] react: React framework");
		});

		it("should pass query string to searchGraph", async () => {
			mockedSearchGraph.mockResolvedValue([]);

			await memoryTools[1].execute({ query: "my-search-term" }, mockCtx());

			expect(mockedSearchGraph).toHaveBeenCalledWith("my-search-term");
		});
	});
});
