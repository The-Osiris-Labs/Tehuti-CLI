import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { logger } from "../../utils/logger.js";
import { agentEventBus } from "../events.js";
import { debug } from "../../utils/debug.js";
import db from "./db.js";

// Type definitions
export interface FormattingHabits {
	indentation?: string;
	quotes?: string;
	semicolons?: boolean;
	[key: string]: unknown;
}

export interface CommandPatterns {
	frequentCommands: string[];
	[key: string]: unknown;
}

export interface ProjectProfile {
	projectPath: string;
	formattingHabits: FormattingHabits;
	commandPatterns: CommandPatterns;
}

export interface UserPreference {
	key: string;
	value: string;
}

/**
 * Executes a git diff command to capture actual changes made.
 */
export function getActualGitDiff(cwd: string): string {
	try {
		return execSync("git diff HEAD", {
			cwd,
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "ignore"],
			maxBuffer: 5 * 1024 * 1024,
		});
	} catch {
		try {
			return execSync("git diff", {
				cwd,
				encoding: "utf-8",
				stdio: ["ignore", "pipe", "ignore"],
				maxBuffer: 5 * 1024 * 1024,
			});
		} catch {
			return "";
		}
	}
}

/**
 * Extracts code formatting habits from a given git diff.
 * This is a basic implementation that can be expanded.
 */
export function extractFormattingHabitsFromDiff(
	diff: string,
): FormattingHabits {
	const habits: FormattingHabits = {};

	// Very basic heuristics
	const addedLines = diff
		.split("\n")
		.filter((line) => line.startsWith("+") && !line.startsWith("+++"));

	let tabCount = 0;
	let spaceCount = 0;
	let singleQuoteCount = 0;
	let doubleQuoteCount = 0;
	let semicolonCount = 0;

	for (const line of addedLines) {
		const content = line.slice(1);
		if (content.startsWith("\t")) tabCount++;
		else if (content.startsWith("  ")) spaceCount++;

		if (content.includes("'")) singleQuoteCount++;
		if (content.includes('"')) doubleQuoteCount++;
		if (content.trim().endsWith(";")) semicolonCount++;
	}

	if (tabCount > 0 || spaceCount > 0) {
		habits.indentation = tabCount > spaceCount ? "tabs" : "spaces";
	}

	if (singleQuoteCount > 0 || doubleQuoteCount > 0) {
		habits.quotes = singleQuoteCount > doubleQuoteCount ? "single" : "double";
	}

	habits.semicolons = semicolonCount > 0;

	return habits;
}

/**
 * Extracts command patterns from a sequence of terminal commands.
 */
export function extractCommandPatterns(commands: string[]): CommandPatterns {
	const frequency: Record<string, number> = {};
	for (const cmd of commands) {
		const baseCmd = cmd.split(" ")[0];
		if (baseCmd) {
			frequency[baseCmd] = (frequency[baseCmd] || 0) + 1;
		}
	}

	const frequentCommands = Object.entries(frequency)
		.sort((a, b) => b[1] - a[1])
		.slice(0, 5)
		.map(([cmd]) => cmd);

	return { frequentCommands };
}

/**
 * Stores formatting habits and command patterns in project_profiles table.
 */
export function updateProjectProfile(
	projectPath: string,
	diff: string,
	commands: string[],
): void {
	const newFormattingHabits = extractFormattingHabitsFromDiff(diff);
	const commandPatterns = extractCommandPatterns(commands);

	try {
		const selectStmt = db.prepare(
			"SELECT formatting_habits, command_patterns FROM project_profiles WHERE project_path = ?",
		);
		const existingRow = selectStmt.get(projectPath) as
			| { formatting_habits: string; command_patterns: string }
			| undefined;

		let formattingHabits: FormattingHabits = newFormattingHabits;
		if (existingRow?.formatting_habits) {
			try {
				const existingHabits = JSON.parse(
					existingRow.formatting_habits,
				) as FormattingHabits;
				formattingHabits = {
					...existingHabits,
					...newFormattingHabits,
				};
				} catch (_err) {
				debug.log("memory", `Failed to parse existing formatting habits: ${_err}`);
				}
		}

		let finalCommandPatterns = commandPatterns;
		if (existingRow?.command_patterns) {
			try {
				const existingPatterns = JSON.parse(
					existingRow.command_patterns,
				) as CommandPatterns;
				finalCommandPatterns = {
					...existingPatterns,
					frequentCommands: Array.from(
						new Set([
							...(existingPatterns.frequentCommands || []),
							...commandPatterns.frequentCommands,
						]),
					),
				};
				} catch (_err) {
				debug.log("memory", `Failed to parse existing command patterns: ${_err}`);
				}
		}

		const stmt = db.prepare(`
			INSERT INTO project_profiles (project_path, formatting_habits, command_patterns, updated_at)
			VALUES (?, ?, ?, cast(unixepoch() * 1000 as integer))
			ON CONFLICT(project_path) DO UPDATE SET
				formatting_habits = excluded.formatting_habits,
				command_patterns = excluded.command_patterns,
				updated_at = excluded.updated_at
		`);

		stmt.run(
			projectPath,
			JSON.stringify(formattingHabits),
			JSON.stringify(finalCommandPatterns),
		);
		agentEventBus.emit("memoryEvent", {
			type: "learning",
			message: "Learned new styling habits",
		});
	} catch (error) {
		logger.error(`Failed to update project profile: ${error}`);
	}
}

/**
 * Updates a user preference in the user_preferences table.
 */
export function setUserPreference(key: string, value: string): void {
	try {
		const stmt = db.prepare(`
			INSERT INTO user_preferences (id, key, value, updated_at)
			VALUES (?, ?, ?, cast(unixepoch() * 1000 as integer))
			ON CONFLICT(key) DO UPDATE SET
				value = excluded.value,
				updated_at = excluded.updated_at
		`);

		// id can just be the key for simplicity in this schema
		stmt.run(key, key, value);
	} catch (error) {
		logger.error(`Failed to set user preference ${key}: ${error}`);
	}
}

/**
 * Auto-detects whether personality learning should be enabled.
 * Returns true when the project has a git repo or the user has run more than 5 sessions.
 */
export function autoDetectLearning(cwd: string): boolean {
	try {
		// Check for git repo
		const gitDir = path.join(cwd, ".git");
		if (fs.existsSync(gitDir)) return true;

		// Check session count in messaging_sessions
		try {
			const stmt = db.prepare("SELECT COUNT(*) as cnt FROM messaging_sessions");
			const row = stmt.get() as { cnt: number } | undefined;
			if (row && row.cnt > 5) return true;
		} catch {
			// Table may not exist yet
		}

		// Also check user_profiles for additional session tracking
		try {
			const stmt = db.prepare("SELECT COUNT(*) as cnt FROM user_profiles");
			const row = stmt.get() as { cnt: number } | undefined;
			if (row && row.cnt > 5) return true;
		} catch {
			// Table may not exist yet
		}
	} catch {
		// If anything fails, default to disabled
	}
	return false;
}

/**
 * Retrieves the project profile from the database.
 */
export async function getProjectProfile(
	projectPath: string,
): Promise<ProjectProfile | null> {
	try {
		const stmt = db.prepare(
			"SELECT * FROM project_profiles WHERE project_path = ?",
		);
		const row = stmt.get(projectPath) as
			| { formatting_habits: string; command_patterns: string }
			| undefined;

		if (!row) return null;

		return {
			projectPath,
			formattingHabits: JSON.parse(row.formatting_habits),
			commandPatterns: JSON.parse(row.command_patterns),
		};
	} catch (error) {
		logger.error(`Failed to get project profile: ${error}`);
		return null;
	}
}

/**
 * Retrieves a user preference from the database.
 */
export async function getUserPreference(key: string): Promise<string | null> {
	try {
		const stmt = db.prepare("SELECT value FROM user_preferences WHERE key = ?");
		const row = stmt.get(key) as { value: string } | undefined;
		return row ? row.value : null;
	} catch (error) {
		logger.error(`Failed to get user preference ${key}: ${error}`);
		return null;
	}
}

/**
 * Generates a prompt block to inject into the system prompt based on learned personality/preferences.
 */
export async function getPersonalityPromptBlock(
	projectPath: string,
): Promise<string> {
	const profile = await getProjectProfile(projectPath);
	const globalGuidelines = await getUserPreference("global_guidelines");

	let block = "## User Personality & Project Preferences\n\n";

	if (globalGuidelines) {
		block += `### Global Guidelines\n${globalGuidelines}\n\n`;
	}

	if (profile) {
		block += `### Project Formatting Habits\n`;
		if (profile.formattingHabits.indentation) {
			block += `- Indentation: ${profile.formattingHabits.indentation}\n`;
		}
		if (profile.formattingHabits.quotes) {
			block += `- Quotes: ${profile.formattingHabits.quotes}\n`;
		}
		if (profile.formattingHabits.semicolons !== undefined) {
			block += `- Semicolons: ${profile.formattingHabits.semicolons ? "Required" : "Omitted"}\n`;
		}

		if (
			profile.commandPatterns.frequentCommands &&
			profile.commandPatterns.frequentCommands.length > 0
		) {
			block += `\n### Frequent Project Commands\n`;
			block += `- ${profile.commandPatterns.frequentCommands.join(", ")}\n`;
		}
	} else {
		block +=
			"No specific project profile available yet. Adapt to the existing code style.\n";
	}

	return block;
}
