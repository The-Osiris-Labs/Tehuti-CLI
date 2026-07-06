import path from "node:path";
import { applyPatch } from "diff";
import fs from "fs-extra";
import { z } from "zod";
import { formatDiffStats, showDiffPreview } from "../../utils/diff-preview.js";
import {
	checkSymlinkSafety,
	hasFileBeenRead,
	markFileAsRead,
	resolvePath,
	runAciLinter,
	validatePathSecurity,
} from "./fs.js";
import type {
	AnyToolExecutor,
	ToolContext,
	ToolDefinition,
	ToolResult,
} from "./registry.js";

const APPLY_DIFF_SCHEMA = z.object({
	file_path: z.string().describe("The absolute path to the file to patch"),
	patch: z
		.string()
		.describe("The unified diff patch string to apply to the file"),
});

async function applyDiff(
	args: z.infer<typeof APPLY_DIFF_SCHEMA>,
	ctx: ToolContext,
): Promise<ToolResult> {
	const resolvedPath = resolvePath(args.file_path, ctx.cwd);

	const securityCheck = validatePathSecurity(resolvedPath, ctx.cwd);
	if (!securityCheck.safe) {
		return {
			success: false,
			output: "",
			error: `Security error: ${securityCheck.reason}`,
		};
	}

	const symlinkCheck = await checkSymlinkSafety(resolvedPath, ctx.cwd);
	if (!symlinkCheck.safe) {
		return {
			success: false,
			output: "",
			error: `Security error: ${symlinkCheck.reason}`,
		};
	}

	try {
		if (!(await fs.pathExists(resolvedPath))) {
			return {
				success: false,
				output: "",
				error: `File not found: ${resolvedPath}. You cannot patch a non-existent file.`,
			};
		}

		if (!hasFileBeenRead(resolvedPath, ctx)) {
			return {
				success: false,
				output: "",
				error: `You MUST use the Read tool at least once in the conversation before you can patch a file. This tool will fail if you did not read the file. Read the file first: ${resolvedPath}`,
			};
		}

		const content = await fs.readFile(resolvedPath, "utf-8");

		const bakPath = `${resolvedPath}.bak`;
		await fs.writeFile(bakPath, content, "utf-8");

		let newContent = applyPatch(content, args.patch);
		if (newContent === false) {
			return {
				success: false,
				output: "",
				error:
					"Failed to apply patch. The patch might be malformed or out of sync with the file's current content. Ensure your patch exactly matches the existing file context.",
			};
		}

		// applyPatch returns a string on success
		newContent = newContent as string;

		const linterResult = await runAciLinter(resolvedPath, newContent);
		if (!linterResult.success) {
			return {
				success: false,
				output: "",
				error: `ACI Linter failed (Syntax Error):\
${linterResult.error}\
\
Patch was NOT applied. Please self-correct.`,
			};
		}

		if (ctx.diffPreview?.showPreview) {
			const previewResult = await showDiffPreview(
				content,
				newContent,
				path.basename(resolvedPath),
				ctx.diffPreview,
			);

			if (!previewResult.confirmed) {
				return {
					success: false,
					output: "",
					error:
						previewResult.diffOutput === "No changes detected."
							? "No changes to apply."
							: "Diff preview rejected by user.",
				};
			}
		}

		await fs.writeFile(resolvedPath, newContent, "utf-8");
		markFileAsRead(resolvedPath, ctx);

		const statsNote = ctx.diffPreview?.showPreview
			? ` (${formatDiffStats(newContent)})`
			: "";

		return {
			success: true,
			output: `Successfully applied patch to ${resolvedPath}${statsNote}`,
			metadata: { path: resolvedPath },
		};
	} catch (error) {
		return {
			success: false,
			output: "",
			error: `Failed to apply patch: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

export const applyDiffTool: ToolDefinition = {
	name: "apply_diff",
	description: `- Applies a unified diff patch to a file.
- Safely replaces string-replacement edits by checking context.
- The patch must be in standard unified diff format.
- Ensure the context lines exactly match the live file to prevent failures.`,
	parameters: APPLY_DIFF_SCHEMA,
	execute: applyDiff as AnyToolExecutor,
	category: "fs",
	requiresPermission: true,
};
