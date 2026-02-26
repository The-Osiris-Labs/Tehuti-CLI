import { describe, it, expect, beforeEach } from "vitest";
import { SkillsManager, getSkillsManager, type Skill } from "./manager.js";

describe("Skills Manager", () => {
	let skillsManager: SkillsManager;

	beforeEach(() => {
		skillsManager = getSkillsManager();
	});

	describe("Initialization", () => {
		it("should create singleton instance", () => {
			const manager1 = getSkillsManager();
			const manager2 = getSkillsManager();
			expect(manager1).toBe(manager2);
		});

		it("should load built-in skills", () => {
			const skills = skillsManager.listSkills();
			expect(skills.length).toBeGreaterThan(0);
		});

		it("should have JavaScript/TypeScript expert skill", () => {
			const skills = skillsManager.listSkills();
			const jsSkill = skills.find((s) => s.id === "javascript-expert");
			expect(jsSkill).toBeDefined();
			expect(jsSkill?.name).toBe("JavaScript/TypeScript Expert");
		});

		it("should have Python expert skill", () => {
			const skills = skillsManager.listSkills();
			const pythonSkill = skills.find((s) => s.id === "python-expert");
			expect(pythonSkill).toBeDefined();
			expect(pythonSkill?.name).toBe("Python Expert");
		});

		it("should have Git expert skill", () => {
			const skills = skillsManager.listSkills();
			const gitSkill = skills.find((s) => s.id === "git-expert");
			expect(gitSkill).toBeDefined();
			expect(gitSkill?.name).toBe("Git Expert");
		});
	});

	describe("Skill Management", () => {
		it("should list all skills", () => {
			const skills = skillsManager.listSkills();
			expect(Array.isArray(skills)).toBe(true);
			expect(skills.length).toBeGreaterThan(0);
		});

		it("should get active skills", () => {
			const activeSkills = skillsManager.getActiveSkills();
			expect(Array.isArray(activeSkills)).toBe(true);
			activeSkills.forEach((skill) => {
				expect(skill.active).toBe(true);
			});
		});

		it("should get skill by id", () => {
			const skill = skillsManager.getSkill("javascript-expert");
			expect(skill).toBeDefined();
			expect(skill?.id).toBe("javascript-expert");
		});

		it("should return undefined for non-existent skill", () => {
			const skill = skillsManager.getSkill("non-existent-skill");
			expect(skill).toBeUndefined();
		});

		it("should activate and deactivate skills", () => {
			// Deactivate JavaScript expert
			const deactivated = skillsManager.deactivateSkill("javascript-expert");
			expect(deactivated).toBe(true);

			let skill = skillsManager.getSkill("javascript-expert");
			expect(skill?.active).toBe(false);

			// Activate it back
			const activated = skillsManager.activateSkill("javascript-expert");
			expect(activated).toBe(true);

			skill = skillsManager.getSkill("javascript-expert");
			expect(skill?.active).toBe(true);
		});

		it("should add and remove skills", () => {
			const newSkill: Skill = {
				id: "test-skill",
				name: "Test Skill",
				description: "A test skill for unit testing",
				keywords: ["test", "unit", "testing"],
				category: "testing",
				expertise: "Test expertise",
				active: true,
			};

			skillsManager.addSkill(newSkill);
			expect(skillsManager.getSkill("test-skill")).toEqual(newSkill);

			const removed = skillsManager.removeSkill("test-skill");
			expect(removed).toBe(true);
			expect(skillsManager.getSkill("test-skill")).toBeUndefined();
		});
	});

	describe("Skill Search", () => {
		it("should find relevant skills by query", () => {
			const results = skillsManager.findRelevantSkills("javascript");
			expect(results.length).toBeGreaterThan(0);
			expect(results.every((skill) => skill.active)).toBe(true);
			expect(results.some((skill) => skill.id === "javascript-expert")).toBe(true);
		});

		it("should find skills by keywords", () => {
			const results = skillsManager.findRelevantSkills("nodejs");
			expect(results.length).toBeGreaterThan(0);
			expect(results.some((skill) => skill.id === "javascript-expert")).toBe(true);
		});

		it("should find skills by category", () => {
			const results = skillsManager.findRelevantSkills("programming");
			expect(results.length).toBeGreaterThan(0);
			expect(
				results.some((skill) => skill.id === "javascript-expert" || skill.id === "python-expert"),
			).toBe(true);
		});

		it("should return empty array for irrelevant query", () => {
			const results = skillsManager.findRelevantSkills("irrelevant-query-that-wont-match-any-skill");
			expect(results.length).toBe(0);
		});
	});

	describe("Expertise Generation", () => {
		it("should get expertise for skills", () => {
			const jsSkill = skillsManager.getSkill("javascript-expert");
			const pythonSkill = skillsManager.getSkill("python-expert");
			expect(jsSkill).toBeDefined();
			expect(pythonSkill).toBeDefined();

			const expertise = skillsManager.getExpertiseForSkills([jsSkill!, pythonSkill!]);
			expect(expertise).toContain("JavaScript/TypeScript Expert");
			expect(expertise).toContain("Python Expert");
		});

		it("should return empty string for no skills", () => {
			const expertise = skillsManager.getExpertiseForSkills([]);
			expect(expertise).toBe("");
		});
	});
});