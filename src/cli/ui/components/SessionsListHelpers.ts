import chalk from "chalk";
import { BRANDING } from "../../../branding/index.js";

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/**
 * Returns a human readable relative time.
 */
export function formatDate(timestamp: number): string {
	const now = Date.now();
	// Handle cases where timestamp might be in seconds instead of milliseconds
	const tsMs = timestamp < 1e12 ? timestamp * 1000 : timestamp;
	
	if (tsMs >= now) return "just now";

	const diffInSeconds = Math.floor((now - tsMs) / 1000);
	if (diffInSeconds < 60) return "just now";

	const diffInMinutes = Math.floor(diffInSeconds / 60);
	if (diffInMinutes < 60) {
		return rtf.format(-diffInMinutes, "minute");
	}

	const diffInHours = Math.floor(diffInMinutes / 60);
	if (diffInHours < 24) {
		return rtf.format(-diffInHours, "hour");
	}

	const nowDate = new Date(now);
	const targetDate = new Date(tsMs);
	
	const nowDay = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate());
	const targetDay = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
	const diffInDays = Math.round((nowDay.getTime() - targetDay.getTime()) / (1000 * 60 * 60 * 24));
	
	if (diffInDays < 30) {
		return rtf.format(-diffInDays, "day");
	}

	const diffInMonths = (nowDate.getFullYear() - targetDate.getFullYear()) * 12 + (nowDate.getMonth() - targetDate.getMonth());
	if (diffInMonths < 12) {
		return rtf.format(-diffInMonths, "month");
	}

	const diffInYears = nowDate.getFullYear() - targetDate.getFullYear();
	return rtf.format(-diffInYears, "year");
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
