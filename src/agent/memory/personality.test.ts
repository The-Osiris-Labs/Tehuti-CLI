import { describe, expect, it } from "vitest";
import db from "./db.js";
import { getProjectProfile, updateProjectProfile } from "./personality.js";

describe("personality updateProjectProfile", () => {
	it("merges new formatting habits with existing project profile without destructive overwriting", async () => {
		const projectPath = "/test/project/merge";

		// First update sets indentation and quotes
		const diff1 = ["+	const x = 'hello';", "+	const y = 'world';"].join("\n");
		updateProjectProfile(projectPath, diff1, ["git status"]);

		const profile1 = await getProjectProfile(projectPath);
		expect(profile1).not.toBeNull();
		expect(profile1?.formattingHabits.indentation).toBe("tabs");
		expect(profile1?.formattingHabits.quotes).toBe("single");

		// Second update sets double quotes and semicolons, but has no tabs or spaces
		const diff2 = ['+"hello";', '+"world";'].join("\n");
		updateProjectProfile(projectPath, diff2, ["npm test"]);

		const profile2 = await getProjectProfile(projectPath);
		expect(profile2).not.toBeNull();
		// Should preserve indentation from profile1 even though diff2 had no indentation
		expect(profile2?.formattingHabits.indentation).toBe("tabs");
		expect(profile2?.formattingHabits.quotes).toBe("double");
		expect(profile2?.formattingHabits.semicolons).toBe(true);

		// Clean up
		db.prepare("DELETE FROM project_profiles WHERE project_path = ?").run(
			projectPath,
		);
	});
});
