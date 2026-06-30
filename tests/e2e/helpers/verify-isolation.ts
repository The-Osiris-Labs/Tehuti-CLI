import fs from "fs-extra";
import path from "path";
import os from "os";
import { execSync } from "child_process";

const HOME = os.homedir();
const TARGET_PATHS = [
	path.join(HOME, ".tehuti.json"),
	path.join(HOME, ".tehuti"),
	path.join(HOME, "Library/Preferences/tehuti-nodejs/config.json"),
	path.join(HOME, "Library/Preferences/tehuti-nodejs"),
];

interface PathState {
	exists: boolean;
	mtimeMs?: number;
	size?: number;
}

function getStates(): Record<string, PathState> {
	const states: Record<string, PathState> = {};
	for (const p of TARGET_PATHS) {
		if (fs.existsSync(p)) {
			const stat = fs.statSync(p);
			states[p] = {
				exists: true,
				mtimeMs: stat.mtimeMs,
				size: stat.size,
			};
		} else {
			states[p] = { exists: false };
		}
	}
	return states;
}

export async function verifyConfigIsolation(): Promise<{
	success: boolean;
	details: string;
}> {
	const before = getStates();

	console.log("Running E2E tests to verify config isolation...");
	try {
		execSync("npm run test:e2e", { stdio: "inherit", cwd: process.cwd() });
	} catch (error) {
		return {
			success: false,
			details: `E2E tests failed to run: ${error instanceof Error ? error.message : String(error)}`,
		};
	}

	const after = getStates();
	const issues: string[] = [];

	for (const p of TARGET_PATHS) {
		const b = before[p];
		const a = after[p];

		if (b.exists !== a.exists) {
			issues.push(
				`Path ${p} existence changed: before=${b.exists}, after=${a.exists}`,
			);
		} else if (b.exists && a.exists) {
			if (b.mtimeMs !== a.mtimeMs) {
				issues.push(
					`Path ${p} was modified: before mtime=${new Date(
						b.mtimeMs!,
					).toISOString()}, after mtime=${new Date(
						a.mtimeMs!,
					).toISOString()}`,
				);
			}
			if (b.size !== a.size) {
				issues.push(
					`Path ${p} size changed: before size=${b.size}, after size=${a.size}`,
				);
			}
		}
	}

	if (issues.length > 0) {
		return {
			success: false,
			details: `Config isolation violated:\n${issues.join("\n")}`,
		};
	}

	return {
		success: true,
		details: "Verification successful. All global config files are untouched.",
	};
}

// Run if called directly
if (import.meta.url.endsWith(process.argv[1]) || process.argv[1]?.endsWith("verify-isolation.ts")) {
	verifyConfigIsolation().then((res) => {
		console.log(res.details);
		process.exit(res.success ? 0 : 1);
	});
}
