import { z } from "zod";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { consola } from "../../utils/logger.js";

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

		// Load user-defined skills (from ~/.tehuti/skills)
		this.loadUserSkills();
	}

	private loadBuiltInSkills(): void {
		// TODO: Implement built-in skills
		const builtInSkills: Skill[] = [
			{
				id: "javascript-expert",
				name: "JavaScript/TypeScript Expert",
				description: "Deep knowledge of JavaScript and TypeScript programming languages",
				keywords: ["javascript", "typescript", "js", "ts", "nodejs", "react", "angular", "vue"],
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
				description: "Expert knowledge of Python programming language and its ecosystems",
				keywords: ["python", "py", "django", "flask", "numpy", "pandas", "tensorflow", "pytorch"],
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
				keywords: ["git", "version-control", "branching", "merging", "rebase", "conflict-resolution"],
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

	private loadUserSkills(): void {
		// TODO: Implement user skills loading from ~/.tehuti/skills
		if (existsSync(this.skillsDirectory)) {
			// Read all JSON files in the skills directory
			// For now, we'll skip this and implement later
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
			const matchesDescription = skill.description.toLowerCase().includes(lowerQuery);
			const matchesKeywords = skill.keywords.some((keyword) =>
				lowerQuery.includes(keyword.toLowerCase())
			);
			const matchesCategory = skill.category.toLowerCase().includes(lowerQuery);

			return matchesName || matchesDescription || matchesKeywords || matchesCategory;
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
}

// Create a singleton instance
let skillsManager: SkillsManager | null = null;

export function getSkillsManager(): SkillsManager {
	if (!skillsManager) {
		skillsManager = new SkillsManager();
	}
	return skillsManager;
}