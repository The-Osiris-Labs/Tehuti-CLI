import chalk from "chalk";
import { BRANDING } from "../../../branding/index.js";

/**
 * Returns a human readable relative time.
 */
export function formatDate(timestamp: number): string {
	const now = Date.now();
	// Handle cases where timestamp might be in seconds instead of milliseconds
	const tsMs = timestamp < 1e12 ? timestamp * 1000 : timestamp;
	const diffInSeconds = Math.floor((now - tsMs) / 1000);

	if (diffInSeconds < 60) return "just now";

	const diffInMinutes = Math.floor(diffInSeconds / 60);
	if (diffInMinutes < 60) {
		return `${diffInMinutes} minute${diffInMinutes === 1 ? "" : "s"} ago`;
	}

	const diffInHours = Math.floor(diffInMinutes / 60);
	if (diffInHours < 24) {
		return `${diffInHours} hour${diffInHours === 1 ? "" : "s"} ago`;
	}

	const diffInDays = Math.floor(diffInHours / 24);
	if (diffInDays === 1) return "yesterday";
	if (diffInDays < 30) {
		return `${diffInDays} day${diffInDays === 1 ? "" : "s"} ago`;
	}

	const diffInMonths = Math.floor(diffInDays / 30);
	if (diffInMonths < 12) {
		return `${diffInMonths} month${diffInMonths === 1 ? "" : "s"} ago`;
	}

	const diffInYears = Math.floor(diffInDays / 365);
	return `${diffInYears} year${diffInYears === 1 ? "" : "s"} ago`;
}

/**
 * Colorizes the model name using the branding palette.
 */
export function formatModelBadge(model: string): string {
	const lower = model.toLowerCase();
	if (lower.includes("deepseek")) {
		return chalk.hex(BRANDING.colors.nile)(model);
	}
	if (lower.includes("gpt") || lower.includes("claude")) {
		return chalk.hex(BRANDING.colors.gold)(model);
	}
	return chalk.hex(BRANDING.colors.coral)(model);
}

/**
 * Truncates a string to a maximum length, appending an ellipsis if truncated.
 */
export function truncateName(name: string, maxLen: number): string {
	if (name.length <= maxLen) return name;
	if (maxLen <= 3) return name.slice(0, maxLen);
	return name.slice(0, Math.max(0, maxLen - 3)) + "...";
}
