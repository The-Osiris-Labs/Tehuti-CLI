import { beforeEach, describe, expect, it } from "vitest";
import {
	isPlanMode,
	isToolAllowedInPlanMode,
	planTools,
	setPlanMode,
} from "./plan-mode.js";

describe("Plan Mode", () => {
	beforeEach(() => {
		setPlanMode(false);
	});

	describe("setPlanMode and isPlanMode", () => {
		it("should enable plan mode", () => {
			setPlanMode(true);
			expect(isPlanMode()).toBe(true);
		});

		it("should disable plan mode", () => {
			setPlanMode(true);
			setPlanMode(false);
			expect(isPlanMode()).toBe(false);
		});

		it("should toggle plan mode", () => {
			expect(isPlanMode()).toBe(false);
			setPlanMode(true);
			expect(isPlanMode()).toBe(true);
			setPlanMode(false);
			expect(isPlanMode()).toBe(false);
		});
	});

	describe("isToolAllowedInPlanMode", () => {
		it("should allow read-only tools in plan mode", () => {
			setPlanMode(true);

			const allowedTools = [
				"read",
				"glob",
				"grep",
				"list_dir",
				"file_info",
				"web_fetch",
				"web_search",
				"code_search",
				"read_image",
				"read_pdf",
				"mcp_list_prompts",
				"mcp_get_prompt",
			];

			for (const tool of allowedTools) {
				expect(isToolAllowedInPlanMode(tool)).toBe(true);
			}
		});

		it("should block destructive tools in plan mode", () => {
			setPlanMode(true);

			const blockedTools = [
				"write",
				"edit",
				"delete_file",
				"delete_dir",
				"bash",
				"create_dir",
				"copy",
				"move",
			];

			for (const tool of blockedTools) {
				expect(isToolAllowedInPlanMode(tool)).toBe(false);
			}
		});

		it("should allow all tools when plan mode is off", () => {
			setPlanMode(false);

			expect(isToolAllowedInPlanMode("write")).toBe(true);
			expect(isToolAllowedInPlanMode("bash")).toBe(true);
			expect(isToolAllowedInPlanMode("edit")).toBe(true);
		});
	});

	describe("planTools", () => {
		it("should have write_plan tool", () => {
			expect(planTools).toBeDefined();
			expect(planTools.some((t) => t.name === "write_plan")).toBe(true);
		});
	});
});
