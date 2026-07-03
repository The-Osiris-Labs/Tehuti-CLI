import { watch } from "node:fs";
import { access, readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { debug } from "../../utils/debug.js";
import { createTool } from "../tools/registry.js";

export interface Skill {
	id: string;
	name: string;
	description: string;
	keywords: string[];
	category: string;
	expertise: string;
	examples?: string[];
	author?: string;
	version?: string;
	active: boolean;
}

const SKILL_SCHEMA = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string(),
	keywords: z.array(z.string()),
	category: z.string(),
	expertise: z.string(),
	examples: z.array(z.string()).optional(),
	author: z.string().optional(),
	version: z.string().optional(),
	active: z.boolean().optional().default(true),
});

export class SkillsManager {
	private skills: Map<string, Skill> = new Map();
	private skillsDirectory: string;

	constructor() {
		this.skillsDirectory = join(homedir(), ".tehuti", "skills");
		this.loadSkills();
	}

	private loadSkills(): void {
		// Load built-in skills (from the project)
		this.loadBuiltInSkills();

		// Load user-defined skills (from ~/.tehuti/skills) asynchronously
		this.loadUserSkills().catch((err) =>
			debug.log("agent", "Failed to load user skills:", err),
		);
	}

	private loadBuiltInSkills(): void {
		// TODO: Implement built-in skills
		const builtInSkills: Skill[] = [
			{
				id: "javascript-expert",
				name: "JavaScript/TypeScript Expert",
				description:
					"Deep knowledge of JavaScript and TypeScript programming languages",
				keywords: [
					"javascript",
					"typescript",
					"js",
					"ts",
					"nodejs",
					"react",
					"angular",
					"vue",
				],
				category: "programming",
				expertise: `I am an expert in JavaScript and TypeScript with deep knowledge of:
- Modern JavaScript (ES6+) and TypeScript syntax
- Node.js and browser environments
- Frontend frameworks (React, Vue, Angular)
- Asynchronous programming (Promises, async/await)
- Common design patterns and best practices
- Debugging techniques
- Performance optimization

When working on JavaScript/TypeScript projects:
1. Follow the existing code style
2. Use type-safe code with TypeScript
3. Implement proper error handling
4. Write testable and maintainable code
5. Optimize for performance when necessary`,
				examples: [
					"Refactor JavaScript code to TypeScript",
					"Fix performance issues in Node.js application",
					"Debug React component rendering problems",
				],
				author: "Tehuti",
				version: "1.0.0",
				active: true,
			},
			{
				id: "python-expert",
				name: "Python Expert",
				description:
					"Expert knowledge of Python programming language and its ecosystems",
				keywords: [
					"python",
					"py",
					"django",
					"flask",
					"numpy",
					"pandas",
					"tensorflow",
					"pytorch",
				],
				category: "programming",
				expertise: `I am a Python expert with comprehensive knowledge of:
- Python syntax and standard library
- Web frameworks (Django, Flask, FastAPI)
- Data analysis (Pandas, NumPy)
- Machine learning (TensorFlow, PyTorch)
- Scientific computing
- Database integration
- Best practices for Python development

When working on Python projects:
1. Follow PEP 8 guidelines for code style
2. Write clear and readable code
3. Implement proper error handling
4. Use appropriate data structures
5. Optimize for readability and maintainability`,
				examples: [
					"Debug Python script errors",
					"Optimize pandas dataframe operations",
					"Build REST API with FastAPI",
				],
				author: "Tehuti",
				version: "1.0.0",
				active: true,
			},
			{
				id: "git-expert",
				name: "Git Expert",
				description: "Advanced knowledge of Git version control system",
				keywords: [
					"git",
					"version-control",
					"branching",
					"merging",
					"rebase",
					"conflict-resolution",
				],
				category: "devops",
				expertise: `I am a Git expert with advanced knowledge of:
- Git fundamentals and workflows
- Branching strategies (Git Flow, Trunk Based Development)
- Merging and rebasing
- Conflict resolution
- Git hooks and automation
- Performance optimization
- Advanced features (bisect, blame, reflog)

When working with Git:
1. Write clear and meaningful commit messages
2. Use atomic commits
3. Follow the project's branching strategy
4. Handle conflicts carefully
5. Optimize repository performance when needed`,
				examples: [
					"Resolve Git merge conflicts",
					"Optimize large Git repository",
					"Recover lost commits using reflog",
				],
				author: "Tehuti",
				version: "1.0.0",
				active: true,
			},
		];

		builtInSkills.forEach((skill) => {
			this.skills.set(skill.id, skill);
		});
	}

	private async loadUserSkills(): Promise<void> {
		try {
			await access(this.skillsDirectory);
		} catch {
			return; // directory doesn't exist
		}

		await this.readUserSkillsDirectory();

		// Setup dynamic loading via fs.watch
		try {
			watch(this.skillsDirectory, (eventType, filename) => {
				if (filename && filename.endsWith(".json")) {
					this.readUserSkillsDirectory().catch((err) =>
						debug.log("agent", "Error reloading user skills:", err),
					);
				}
			});
		} catch (error) {
			debug.log("agent", "Failed to watch skills directory:", error);
		}
	}

	private async readUserSkillsDirectory(): Promise<void> {
		try {
			const files = await readdir(this.skillsDirectory);

			// Track user skills to remove ones that were deleted
			const currentUserSkills = new Set<string>();

			for (const file of files) {
				if (file.endsWith(".json")) {
					try {
						const filePath = join(this.skillsDirectory, file);
						const content = await readFile(filePath, "utf-8");
						const data = JSON.parse(content);
						const skill = SKILL_SCHEMA.parse(data) as Skill;
						this.addSkill(skill);
						currentUserSkills.add(skill.id);
					} catch (err) {
						debug.log("agent", `Failed to load skill from ${file}:`, err);
					}
				}
			}

			// Clean up deleted user skills (assuming built-in skills have author "Tehuti")
			for (const [id, skill] of this.skills.entries()) {
				if (skill.author !== "Tehuti" && !currentUserSkills.has(id)) {
					this.removeSkill(id);
				}
			}
		} catch (error) {
			debug.log("agent", "Error reading user skills directory:", error);
		}
	}

	public listSkills(): Skill[] {
		return Array.from(this.skills.values());
	}

	public getActiveSkills(): Skill[] {
		return Array.from(this.skills.values()).filter((skill) => skill.active);
	}

	public getSkill(id: string): Skill | undefined {
		return this.skills.get(id);
	}

	public activateSkill(id: string): boolean {
		const skill = this.skills.get(id);
		if (skill) {
			skill.active = true;
			return true;
		}
		return false;
	}

	public deactivateSkill(id: string): boolean {
		const skill = this.skills.get(id);
		if (skill) {
			skill.active = false;
			return true;
		}
		return false;
	}

	public findRelevantSkills(query: string): Skill[] {
		const lowerQuery = query.toLowerCase();
		const activeSkills = this.getActiveSkills();

		return activeSkills.filter((skill) => {
			// Check if query matches skill name, description, or keywords
			const matchesName = skill.name.toLowerCase().includes(lowerQuery);
			const matchesDescription = skill.description
				.toLowerCase()
				.includes(lowerQuery);
			const matchesKeywords = skill.keywords.some((keyword) =>
				lowerQuery.includes(keyword.toLowerCase()),
			);
			const matchesCategory = skill.category.toLowerCase().includes(lowerQuery);

			return (
				matchesName || matchesDescription || matchesKeywords || matchesCategory
			);
		});
	}

	public getExpertiseForSkills(skills: Skill[]): string {
		if (skills.length === 0) {
			return "";
		}

		return skills
			.map((skill) => `\n## ${skill.name}\n${skill.expertise}`)
			.join("\n");
	}

	public addSkill(skill: Skill): void {
		this.skills.set(skill.id, skill);
	}

	public removeSkill(id: string): boolean {
		return this.skills.delete(id);
	}

	public async createReusableSkill(name: string, description: string, instructions: string): Promise<Skill> {
		const skillId = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
		const skillDir = join(this.skillsDirectory, skillId);
		await mkdir(skillDir, { recursive: true });
		
		const skillContent = `---
name: ${name}
description: ${description}
---

${instructions}`;

		await writeFile(join(skillDir, "SKILL.md"), skillContent, "utf-8");

		const skill: Skill = {
			id: skillId,
			name,
			description,
			keywords: [],
			category: "custom",
			expertise: instructions,
			author: "Agent",
			version: "1.0.0",
			active: true,
		};
		
		// Save metadata so it can be picked up by the existing JSON loader
		await writeFile(join(this.skillsDirectory, `${skillId}.json`), JSON.stringify(skill, null, 2), "utf-8");

		this.addSkill(skill);
		return skill;
	}
}

// Create a singleton instance
let skillsManager: SkillsManager | null = null;

export function getSkillsManager(): SkillsManager {
	if (!skillsManager) {
		skillsManager = new SkillsManager();
	}
	return skillsManager;
}

export const createReusableSkillTool = createTool({
	name: "create_reusable_skill",
	description: "Create a reusable skill by writing instructions to a SKILL.md file autonomously.",
	parameters: z.object({
		name: z.string().describe("The name of the skill"),
		description: z.string().describe("A short description of what the skill does"),
		instructions: z.string().describe("The detailed instructions for the skill in markdown format"),
	}),
	category: "system",
	execute: async (args, _ctx) => {
		const { name, description, instructions } = args as { name: string; description: string; instructions: string };
		try {
			const skill = await getSkillsManager().createReusableSkill(name, description, instructions);
			return {
				success: true,
				output: JSON.stringify({ message: `Skill ${skill.name} created successfully`, skillId: skill.id }),
			};
		} catch (error) {
			return {
				success: false,
				output: "",
				error: String(error),
			};
		}
	},
});
