import { describe, expect, it } from "vitest";
import {
	getToolRenderStatus,
	normalizeBlocks,
	parseContentBlocks,
} from "./chat.js";

describe("Chat Parsing and Normalization", () => {
	describe("getToolRenderStatus", () => {
		it("treats error-only tool results as failed", () => {
			expect(getToolRenderStatus({ error: "wrapper failed" })).toBe("error");
		});

		it("treats explicit failed tool results as failed", () => {
			expect(getToolRenderStatus({ success: false, output: "" })).toBe("error");
		});
	});

	describe("parseContentBlocks", () => {
		it("should handle content without any think tags", () => {
			const content = "Hello world! This is a simple response.";
			const result = parseContentBlocks(content);
			expect(result).toEqual([
				{ type: "text", content: "Hello world! This is a simple response." },
			]);
		});

		it("should extract closed think tags into reasoning blocks", () => {
			const content = "Hello <think>analyzing some ideas</think> world!";
			const result = parseContentBlocks(content);
			expect(result).toEqual([
				{ type: "text", content: "Hello " },
				{ type: "reasoning", content: "analyzing some ideas" },
				{ type: "text", content: " world!" },
			]);
		});

		it("should handle open/unclosed think tags gracefully", () => {
			const content = "Starting <think>currently thinking...";
			const result = parseContentBlocks(content);
			expect(result).toEqual([
				{ type: "text", content: "Starting " },
				{ type: "reasoning", content: "currently thinking..." },
			]);
		});

		it("should handle multiple think blocks", () => {
			const content =
				"<think>first thought</think> intermediate text <think>second thought</think> final text";
			const result = parseContentBlocks(content);
			expect(result).toEqual([
				{ type: "reasoning", content: "first thought" },
				{ type: "text", content: " intermediate text " },
				{ type: "reasoning", content: "second thought" },
				{ type: "text", content: " final text" },
			]);
		});
	});

	describe("normalizeBlocks", () => {
		it("should normalize a mix of blocks, extracting think tags only from text blocks", () => {
			const blocks = [
				{
					type: "text" as const,
					content: "Initial <think>thought</think> text",
				},
				{
					type: "tool" as const,
					id: "tool-1",
					name: "list_dir",
					description: "Listing dir",
					result: { files: [] },
				},
				{
					type: "text" as const,
					content: "After tool <think>next thought</think> final",
				},
			];

			const result = normalizeBlocks(blocks);
			expect(result).toEqual([
				{ type: "text", content: "Initial " },
				{ type: "reasoning", content: "thought" },
				{ type: "text", content: " text" },
				{
					type: "tool",
					id: "tool-1",
					name: "list_dir",
					description: "Listing dir",
					result: { files: [] },
				},
				{ type: "text", content: "After tool " },
				{ type: "reasoning", content: "next thought" },
				{ type: "text", content: " final" },
			]);
		});
	});
});
