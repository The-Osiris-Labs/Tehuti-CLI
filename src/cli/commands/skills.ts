import chalk from "chalk";
import { Command } from "commander";
import { getSkillsManager } from "../../agent/skills/manager.js";

export function skillsCommand(): Command {
	return new Command("skills")
		.description("List installed Tehuti skills")
		.argument("[action]", "Action: list", "list")
		.option("--json", "Print machine-readable JSON")
		.action((action: string, options: { json?: boolean }, command: Command) => {
			if (action !== "list") {
				console.error(`Unknown skills action: ${action}`);
				process.exitCode = 1;
				return;
			}

			const skills = getSkillsManager()
				.listSkills()
				.map((skill) => ({
					id: skill.id,
					name: skill.name,
					description: skill.description,
					category: skill.category,
					active: skill.active,
					author: skill.author,
				}));

			if (options.json || Boolean(command.optsWithGlobals().json)) {
				console.log(JSON.stringify(skills, null, 2));
				return;
			}

			console.log();
			console.log(chalk.hex("#F5C518")("  𓆣 Tehuti skills"));
			console.log();
			if (skills.length === 0) {
				console.log(chalk.gray("  No skills installed."));
			} else {
				for (const skill of skills) {
					const state = skill.active
						? chalk.green("active")
						: chalk.gray("inactive");
					console.log(`  ${chalk.cyan(skill.id)}  ${state}`);
					console.log(chalk.gray(`    ${skill.description}`));
				}
			}
			console.log();
		});
}
