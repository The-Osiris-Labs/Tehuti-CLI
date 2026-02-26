import { describe, it, expect } from "vitest";
import {
	listSkillsTool,
	activateSkillTool,
	deactivateSkillTool,
	findSkillsTool,
	getSkillTool,
} from "./tools.js";
import { getSkillsManager } from "./manager.js";

describe("Skills Tools", () => {
	describe("list_skills", () => {
		it("should list all skills with proper fields", async () => {
			const result = await listSkillsTool.execute({}, {} as any);
			expect(result).toBeDefined();
			expect(result.success).toBe(true);
			expect(typeof result.output).toBe("string");

			const data = JSON.parse(result.output);
			expect(Array.isArray(data.skills)).toBe(true);
			expect(data.skills.length).toBeGreaterThan(0);

			data.skills.forEach((skill: any) => {
				expect(typeof skill.id).toBe("string");
				expect(typeof skill.name).toBe("string");
				expect(typeof skill.description).toBe("string");
				expect(typeof skill.category).toBe("string");
				expect(typeof skill.active).toBe("boolean");
			});
		});
	});

	describe("get_skill", () => {
		it("should retrieve existing skill", async () => {
			const result = await getSkillTool.execute({ skillId: "javascript-expert" }, {} as any);
			expect(result).toBeDefined();
			expect(result.success).toBe(true);
			expect(typeof result.output).toBe("string");

			const data = JSON.parse(result.output);
			expect(data.id).toBe("javascript-expert");
		});

		it("should handle non-existent skill", async () => {
			const result = await getSkillTool.execute({ skillId: "non-existent-skill" }, {} as any);
			expect(result).toBeDefined();
			expect(result.success).toBe(false);
			expect(result.error).toBeDefined();
		});
	});

	describe("activate_skill", () => {
		it("should activate existing skill", async () => {
			const manager = getSkillsManager();
			manager.deactivateSkill("javascript-expert");

			const result = await activateSkillTool.execute({ skillId: "javascript-expert" }, {} as any);
			expect(result).toBeDefined();
			expect(result.success).toBe(true);

			const skill = manager.getSkill("javascript-expert");
			expect(skill?.active).toBe(true);
		});

		it("should handle activating non-existent skill", async () => {
			const result = await activateSkillTool.execute({ skillId: "non-existent-skill" }, {} as any);
			expect(result).toBeDefined();
			expect(result.success).toBe(false);
			expect(result.error).toBeDefined();
		});
	});

	describe("deactivate_skill", () => {
		it("should deactivate existing skill", async () => {
			const manager = getSkillsManager();
			manager.activateSkill("javascript-expert");

			const result = await deactivateSkillTool.execute({ skillId: "javascript-expert" }, {} as any);
			expect(result).toBeDefined();
			expect(result.success).toBe(true);

			const skill = manager.getSkill("javascript-expert");
			expect(skill?.active).toBe(false);
		});

		it("should handle deactivating non-existent skill", async () => {
			const result = await deactivateSkillTool.execute({ skillId: "non-existent-skill" }, {} as any);
			expect(result).toBeDefined();
			expect(result.success).toBe(false);
			expect(result.error).toBeDefined();
		});
	});

	describe("find_skills", () => {
		it("should find skills by query", async () => {
			const manager = getSkillsManager();
			manager.activateSkill("javascript-expert");

			const result = await findSkillsTool.execute({ query: "javascript" }, {} as any);
			expect(result).toBeDefined();
			expect(result.success).toBe(true);
			expect(typeof result.output).toBe("string");

			const data = JSON.parse(result.output);
			expect(Array.isArray(data.skills)).toBe(true);
			expect(data.skills.length).toBeGreaterThan(0);

			const hasJavaScriptSkill = data.skills.some((skill: any) => skill.id === "javascript-expert");
			expect(hasJavaScriptSkill).toBe(true);
		});

		it("should return empty array for no matches", async () => {
			const result = await findSkillsTool.execute({
				query: "non-existent-query-that-wont-match-any-skill",
			}, {} as any);
			expect(result).toBeDefined();
			expect(result.success).toBe(true);

			const data = JSON.parse(result.output);
			expect(data.skills).toEqual([]);
		});
	});
});