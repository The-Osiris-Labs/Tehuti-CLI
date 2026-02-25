import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import chalk from "chalk";

const PACKAGE_NAME = "tehuti-cli";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

interface UpdateCheckResult {
	currentVersion: string;
	latestVersion: string;
	hasUpdate: boolean;
	lastChecked: number;
}

function getVersionFromPackage(): string {
	try {
		const packageJson = JSON.parse(
			readFileSync(
				join(import.meta.dirname ?? ".", "..", "package.json"),
				"utf-8",
			),
		);
		return packageJson.version ?? "0.0.0";
	} catch {
		return "0.0.0";
	}
}

function getCacheDir(): string {
	const cacheDir = join(homedir(), ".config", "tehuti-cli");
	if (!existsSync(cacheDir)) {
		mkdirSync(cacheDir, { recursive: true });
	}
	return cacheDir;
}

function getLastCheckFile(): string {
	return join(getCacheDir(), "update-check.json");
}

function getLastCheck(): UpdateCheckResult | null {
	try {
		const file = getLastCheckFile();
		if (existsSync(file)) {
			return JSON.parse(readFileSync(file, "utf-8")) as UpdateCheckResult;
		}
	} catch {}
	return null;
}

function saveLastCheck(result: UpdateCheckResult): void {
	try {
		writeFileSync(getLastCheckFile(), JSON.stringify(result, null, 2));
	} catch {}
}

function getLatestNpmVersion(): string | null {
	try {
		const output = execSync(`npm view ${PACKAGE_NAME} version`, {
			encoding: "utf-8",
			timeout: 5000,
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
		return output || null;
	} catch {
		return null;
	}
}

function compareVersions(a: string, b: string): number {
	const partsA = a.split(".").map(Number);
	const partsB = b.split(".").map(Number);

	for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
		const numA = partsA[i] ?? 0;
		const numB = partsB[i] ?? 0;
		if (numA > numB) return 1;
		if (numA < numB) return -1;
	}
	return 0;
}

export function checkForUpdates(
	force: boolean = false,
): UpdateCheckResult | null {
	const currentVersion = getVersionFromPackage();
	const lastCheck = getLastCheck();
	const now = Date.now();

	if (!force && lastCheck && now - lastCheck.lastChecked < CHECK_INTERVAL_MS) {
		return lastCheck.hasUpdate ? lastCheck : null;
	}

	const latestVersion = getLatestNpmVersion();
	if (!latestVersion) {
		return null;
	}

	const hasUpdate = compareVersions(currentVersion, latestVersion) < 0;

	const result: UpdateCheckResult = {
		currentVersion,
		latestVersion,
		hasUpdate,
		lastChecked: now,
	};

	saveLastCheck(result);

	return hasUpdate ? result : null;
}

export function formatUpdateMessage(result: UpdateCheckResult): string {
	return `
${chalk.yellow("Update available!")} ${chalk.dim(result.currentVersion)} → ${chalk.green(result.latestVersion)}
${chalk.dim("Run:")} ${chalk.cyan("npm update -g tehuti-cli")}
`;
}

export function showUpdateNotification(force: boolean = false): void {
	const result = checkForUpdates(force);
	if (result) {
		console.log(formatUpdateMessage(result));
	}
}

export default {
	checkForUpdates,
	formatUpdateMessage,
	showUpdateNotification,
};
