import { z } from "zod";
import { ToolResult, createTool, type ToolContext } from "../tools/registry.js";
import { getSkillsManager, type Skill } from "./manager.js";

const skillsManager = getSkillsManager();

export const listSkillsTool = createTool({
	name: "list_skills",
	description: "List all available skills with their details",
	parameters: z.object({}),
	category: "system",
	execute: async (_args, _ctx) => {
		const skills = skillsManager.listSkills();

		const skillsList = skills.map((skill) => ({
			id: skill.id,
			name: skill.name,
			description: skill.description,
			category: skill.category,
			active: skill.active,
		}));

		return {
			success: true,
			output: JSON.stringify({ skills: skillsList }, null, 2),
		};
	},
});

export const activateSkillTool = createTool({
	name: "activate_skill",
	description: "Activate a specific skill by ID",
	parameters: z.object({
		skillId: z.string().describe("The ID of the skill to activate"),
	}),
	category: "system",
	execute: async (args, _ctx) => {
		const { skillId } = args as { skillId: string };
		const success = skillsManager.activateSkill(skillId);

		if (success) {
			return {
				success: true,
				output: JSON.stringify({ message: `Skill ${skillId} activated successfully` }),
			};
		} else {
			return {
				success: false,
				output: "",
				error: `Skill ${skillId} not found`,
			};
		}
	},
});

export const deactivateSkillTool = createTool({
	name: "deactivate_skill",
	description: "Deactivate a specific skill by ID",
	parameters: z.object({
		skillId: z.string().describe("The ID of the skill to deactivate"),
	}),
	category: "system",
	execute: async (args, _ctx) => {
		const { skillId } = args as { skillId: string };
		const success = skillsManager.deactivateSkill(skillId);

		if (success) {
			return {
				success: true,
				output: JSON.stringify({ message: `Skill ${skillId} deactivated successfully` }),
			};
		} else {
			return {
				success: false,
				output: "",
				error: `Skill ${skillId} not found`,
			};
		}
	},
});

export const findSkillsTool = createTool({
	name: "find_skills",
	description: "Find relevant skills for a specific query or task",
	parameters: z.object({
		query: z.string().describe("The search query or task description to find relevant skills"),
	}),
	category: "system",
	execute: async (args, _ctx) => {
		const { query } = args as { query: string };
		const relevantSkills = skillsManager.findRelevantSkills(query);

		const skillsList = relevantSkills.map((skill) => ({
			id: skill.id,
			name: skill.name,
			description: skill.description,
			category: skill.category,
		}));

		return {
			success: true,
			output: JSON.stringify({ skills: skillsList }, null, 2),
		};
	},
});

export const getSkillTool = createTool({
	name: "get_skill",
	description: "Get detailed information about a specific skill by ID",
	parameters: z.object({
		skillId: z.string().describe("The ID of the skill to retrieve information about"),
	}),
	category: "system",
	execute: async (args, _ctx) => {
		const { skillId } = args as { skillId: string };
		const skill = skillsManager.getSkill(skillId);

		if (skill) {
			return {
				success: true,
				output: JSON.stringify(skill, null, 2),
			};
		} else {
			return {
				success: false,
				output: "",
				error: `Skill ${skillId} not found`,
			};
		}
	},
});

export const skillsTools = [
	listSkillsTool,
	activateSkillTool,
	deactivateSkillTool,
	findSkillsTool,
	getSkillTool,
];