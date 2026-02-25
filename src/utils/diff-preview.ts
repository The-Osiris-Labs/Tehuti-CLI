import { confirm } from "@inquirer/prompts";
import * as diff from "diff";
import { formatDiff } from "../terminal/markdown.js";
import { colors, pc } from "../terminal/output.js";
import { consola } from "./logger.js";

export interface DiffPreviewOptions {
	showPreview: boolean;
	autoConfirm?: boolean;
	maxDiffLines?: number;
}

export interface DiffPreviewResult {
	confirmed: boolean;
	diffOutput?: string;
	skipped?: boolean;
}

const DEFAULT_MAX_DIFF_LINES = 100;

export function generateUnifiedDiff(
	oldContent: string,
	newContent: string,
	filename: string,
	contextLines = 3,
): string {
	const patch = diff.createPatch(filename, oldContent, newContent, "", "", {
		context: contextLines,
	});
	return patch;
}

export function generateCreateDiff(content: string, filename: string): string {
	const lines = content.split("\n");
	const header = `--- /dev/null\n+++ b/${filename}\n`;
	const hunks = lines.map((line, _i) => `+${line}`).join("\n");
	return `${header}@@ -0,0 +1,${lines.length} @@\n${hunks}`;
}

export function formatDiffPreview(
	diffOutput: string,
	filename: string,
	operation: "edit" | "create" | "overwrite",
): string {
	const operationLabel = {
		edit: "Editing",
		create: "Creating",
		overwrite: "Overwriting",
	}[operation];

	const header = colors.gold(`━━━ ${operationLabel}: ${filename} ━━━`);
	const formattedDiff = formatDiff(diffOutput, filename);

	return `\n${header}\n${formattedDiff}\n`;
}

export async function showDiffPreview(
	oldContent: string | null,
	newContent: string,
	filename: string,
	options: DiffPreviewOptions,
): Promise<DiffPreviewResult> {
	if (!options.showPreview) {
		return { confirmed: true, skipped: true };
	}

	const maxLines = options.maxDiffLines ?? DEFAULT_MAX_DIFF_LINES;

	let diffOutput: string;
	let operation: "edit" | "create" | "overwrite";

	if (oldContent === null) {
		operation = "create";
		diffOutput = generateCreateDiff(newContent, filename);
	} else if (oldContent === newContent) {
		return { confirmed: false, diffOutput: "No changes detected." };
	} else {
		operation = "edit";
		diffOutput = generateUnifiedDiff(oldContent, newContent, filename);
	}

	const lines = diffOutput.split("\n");
	const truncated = lines.length > maxLines;
	const displayDiff = truncated
		? lines.slice(0, maxLines).join("\n") +
			`\n\n... (${lines.length - maxLines} more lines truncated)`
		: diffOutput;

	const preview = formatDiffPreview(displayDiff, filename, operation);

	if (options.autoConfirm) {
		consola.info(preview);
		return { confirmed: true, diffOutput };
	}

	consola.info(preview);

	try {
		const confirmed = await confirm({
			message: `Apply this ${operation}?`,
			default: true,
		});

		return { confirmed, diffOutput };
	} catch {
		return { confirmed: false, diffOutput };
	}
}

export function countDiffChanges(diffOutput: string): {
	additions: number;
	deletions: number;
} {
	const lines = diffOutput.split("\n");
	let additions = 0;
	let deletions = 0;

	for (const line of lines) {
		if (
			line.startsWith("+") &&
			!line.startsWith("+++") &&
			!line.startsWith("+@@")
		) {
			additions++;
		} else if (
			line.startsWith("-") &&
			!line.startsWith("---") &&
			!line.startsWith("-@@")
		) {
			deletions++;
		}
	}

	return { additions, deletions };
}

export function formatDiffStats(diffOutput: string): string {
	const { additions, deletions } = countDiffChanges(diffOutput);
	const stats: string[] = [];

	if (additions > 0) {
		stats.push(pc.green(`+${additions}`));
	}
	if (deletions > 0) {
		stats.push(pc.red(`-${deletions}`));
	}

	return stats.length > 0 ? stats.join(" ") : "no changes";
}
