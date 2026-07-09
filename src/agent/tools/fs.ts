import { exec } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";
import { fileTypeFromBuffer } from "file-type";
import fs from "fs-extra";
import sharp from "sharp";
import { z } from "zod";
import { formatDiffStats, showDiffPreview } from "../../utils/diff-preview.js";

const execAsync = promisify(exec);

export async function runAciLinter(
	filePath: string,
	content: string,
): Promise<{ success: boolean; error?: string }> {
	if (
		!filePath.endsWith(".ts") &&
		!filePath.endsWith(".tsx") &&
		!filePath.endsWith(".js") &&
		!filePath.endsWith(".jsx")
	) {
		return { success: true };
	}
	const tempFilePath = path.join(
		path.dirname(filePath),
		`.tmp.aci.${path.basename(filePath)}`,
	);
	try {
		await fs.writeFile(tempFilePath, content, "utf-8");
		await execAsync(
			`npx tsc --noEmit --esModuleInterop --skipLibCheck --target es2022 --moduleResolution node16 --module node16 "${tempFilePath}"`,
		);
		return { success: true };
	} catch (error: any) {
		return { success: false, error: error.stdout || error.message };
	} finally {
		await fs.unlink(tempFilePath).catch(() => {});
	}
}

export async function createBackup(
	filePath: string,
	content: string,
): Promise<void> {
	try {
		const timestamp = Date.now();
		const bakPath = `${filePath}.${timestamp}.bak`;
		await fs.writeFile(bakPath, content, "utf-8");

		await fs.unlink(`${filePath}.bak`).catch(() => {});

		const dir = path.dirname(filePath);
		const basename = path.basename(filePath);
		const files = await fs.readdir(dir);

		const escapedBasename = basename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const bakPattern = new RegExp(`^${escapedBasename}\\.\\d+\\.bak$`);
		const bakFiles = files.filter((f) => bakPattern.test(f));

		const MAX_BACKUPS = 5;
		const TTL = 24 * 60 * 60 * 1000;
		const now = Date.now();

		const stats = await Promise.all(
			bakFiles.map(async (f) => {
				const p = path.join(dir, f);
				const stat = await fs.stat(p).catch(() => null);
				return stat ? { path: p, mtimeMs: stat.mtimeMs } : null;
			}),
		);

		const validStats = stats.filter(
			(s): s is { path: string; mtimeMs: number } => s !== null,
		);
		validStats.sort((a, b) => b.mtimeMs - a.mtimeMs);

		for (let i = 0; i < validStats.length; i++) {
			const stat = validStats[i];
			if (i >= MAX_BACKUPS || now - stat.mtimeMs > TTL) {
				await fs.unlink(stat.path).catch(() => {});
			}
		}
	} catch (e) {
		// Ignore backup creation/cleanup errors to avoid failing the main operation
	}
}

import type {
	AnyToolExecutor,
	ToolContext,
	ToolDefinition,
	ToolResult,
} from "./registry.js";

const PROTECTED_FILES = [
	".env",
	".env.local",
	".env.production",
	".env.development",
	".envrc",
	"credentials.json",
	"secrets.json",
	".pem",
	".key",
	".ssh",
	".netrc",
	".pgpass",
	".npmrc",
	".gitconfig",
	".git-credentials",
	"config.json",
];

const PROTECTED_PATTERNS = [
	/\/\.ssh\//i,
	/\/\.gnupg\//i,
	/\/\.pgp\//i,
	/\/\.aws\//i,
	/\/\.docker\//i,
	/\.pem$/i,
	/\.key$/i,
	/\.ssh$/i,
	/\.pfx$/i,
	/\.p12$/i,
	/\.p7b$/i,
	/\.keystore$/i,
	/\.jks$/i,
	/id_rsa/i,
	/id_ed25519/i,
	/id_ecdsa/i,
	/id_dsa/i,
	/_history$/i,
	/\.env\./i,
];

function isSensitiveFile(filePath: string): boolean {
	const basename = path.basename(filePath).toLowerCase();
	const _dirPath = path.dirname(filePath).toLowerCase();

	if (PROTECTED_FILES.some((p) => basename === p.toLowerCase())) {
		return true;
	}

	if (PROTECTED_PATTERNS.some((p) => p.test(filePath))) {
		return true;
	}

	return false;
}

export function hasFileBeenRead(filePath: string, ctx: ToolContext): boolean {
	if (!ctx.readFilesThisSession) ctx.readFilesThisSession = new Set();
	return ctx.readFilesThisSession.has(filePath);
}

export function markFileAsRead(filePath: string, ctx: ToolContext): void {
	if (!ctx.readFilesThisSession) ctx.readFilesThisSession = new Set();
	ctx.readFilesThisSession.add(filePath);
}

const READ_FILE_SCHEMA = z.object({
	file_path: z.string().describe("The absolute path to the file to read"),
	offset: z
		.number()
		.int()
		.positive()
		.optional()
		.describe("The line number to start reading from (1-indexed)"),
	limit: z
		.number()
		.int()
		.positive()
		.optional()
		.describe("The maximum number of lines to read"),
});

const WRITE_FILE_SCHEMA = z.object({
	file_path: z.string().describe("The absolute path to the file to write"),
	content: z.string().describe("The content to write to the file"),
});

const EDIT_FILE_SCHEMA = z.object({
	file_path: z.string().describe("The absolute path to the file to edit"),
	old_string: z.string().describe("The text to find and replace"),
	new_string: z.string().describe("The text to replace with"),
	expected_hash: z
		.string()
		.describe(
			"The short MD5 hash of the live file to prevent drift corruption",
		),
	replace_all: z
		.boolean()
		.optional()
		.describe("Replace all occurrences (default: false)"),
});

const CREATE_DIR_SCHEMA = z.object({
	dir_path: z.string().describe("The absolute path of the directory to create"),
	recursive: z
		.boolean()
		.optional()
		.describe("Create parent directories if needed (default: true)"),
});

const DELETE_FILE_SCHEMA = z.object({
	file_path: z.string().describe("The absolute path to the file to delete"),
});

const DELETE_DIR_SCHEMA = z.object({
	dir_path: z.string().describe("The absolute path to the directory to delete"),
	recursive: z
		.boolean()
		.optional()
		.describe("Delete recursively (default: false)"),
});

const COPY_FILE_SCHEMA = z.object({
	source: z.string().describe("The absolute path of the source file"),
	destination: z.string().describe("The absolute path of the destination"),
});

const MOVE_FILE_SCHEMA = z.object({
	source: z.string().describe("The absolute path of the source file"),
	destination: z.string().describe("The absolute path of the destination"),
});

const LIST_DIR_SCHEMA = z.object({
	dir_path: z.string().describe("The absolute path to the directory to list"),
	json: z.boolean().optional().describe("Return output in JSON format"),
});

const GET_FILE_INFO_SCHEMA = z.object({
	file_path: z.string().describe("The absolute path to get info for"),
});

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_WRITE_SIZE = 1 * 1024 * 1024;
const _MAX_BACKGROUND_PROCESSES = 50;

async function _safeWriteFile(
	filePath: string,
	content: string,
): Promise<void> {
	const fd = await fs.promises.open(filePath, "wx");
	try {
		await fd.writeFile(content, "utf8");
	} finally {
		await fd.close();
	}
}

async function _safeOverwriteFile(
	filePath: string,
	content: string,
): Promise<void> {
	await fs.promises.writeFile(filePath, content, "utf8");
}

export function resolvePath(filePath: string, cwd: string): string {
	if (path.isAbsolute(filePath)) {
		return filePath;
	}
	return path.resolve(cwd, filePath);
}

export function validatePathSecurity(
	resolvedPath: string,
	cwd: string,
): { safe: boolean; reason?: string } {
	const normalizedPath = path.normalize(resolvedPath);
	const normalizedCwd = path.normalize(cwd);

	const relativePath = path.relative(normalizedCwd, normalizedPath);
	if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
		return {
			safe: false,
			reason: "Path traversal outside working directory is not allowed",
		};
	}

	if (isSensitiveFile(normalizedPath)) {
		return { safe: false, reason: "Access to sensitive files is restricted" };
	}

	return { safe: true };
}

export async function checkSymlinkSafety(
	resolvedPath: string,
	cwd: string,
): Promise<{ safe: boolean; reason?: string; realPath?: string }> {
	try {
		const stats = await fs.lstat(resolvedPath);

		if (stats.isSymbolicLink()) {
			const realPath = await fs.realpath(resolvedPath);
			const normalizedReal = path.normalize(realPath);
			const normalizedCwd = path.normalize(cwd);
			const relativePath = path.relative(normalizedCwd, normalizedReal);

			if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
				return {
					safe: false,
					reason: `Symlink points outside working directory: ${realPath}`,
					realPath,
				};
			}

			if (isSensitiveFile(normalizedReal)) {
				return {
					safe: false,
					reason: `Symlink points to sensitive file: ${realPath}`,
					realPath,
				};
			}

			return {
				safe: true,
				realPath,
			};
		}

		return { safe: true };
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		if (errorMsg.includes("ENOENT") || errorMsg.includes("no such file")) {
			return { safe: true };
		}
		return { safe: false, reason: `Cannot verify path safety: ${errorMsg}` };
	}
}

async function isBinaryFile(filePath: string): Promise<boolean> {
	const buffer = Buffer.alloc(8192);
	const fileHandle = await fs.promises.open(filePath, "r");
	try {
		const { bytesRead } = await fileHandle.read(buffer, 0, 8192, 0);
		for (let i = 0; i < bytesRead; i++) {
			if (buffer[i] === 0) return true;
		}
		return false;
	} finally {
		await fileHandle.close();
	}
}

async function readFile(
	args: z.infer<typeof READ_FILE_SCHEMA>,
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

	try {
		const symlinkCheck = await checkSymlinkSafety(resolvedPath, ctx.cwd);
		if (!symlinkCheck.safe) {
			return {
				success: false,
				output: "",
				error: `Security error: ${symlinkCheck.reason}`,
			};
		}

		const stats = await fs.lstat(resolvedPath);

		if (!stats.isFile()) {
			return {
				success: false,
				output: "",
				error: `Not a file: ${resolvedPath}`,
			};
		}

		if (stats.size > MAX_FILE_SIZE) {
			return {
				success: false,
				output: "",
				error: `File too large (${(stats.size / 1024 / 1024).toFixed(2)}MB). Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB.`,
			};
		}

		if (await isBinaryFile(resolvedPath)) {
			return {
				success: false,
				output: "",
				error: `Binary file detected. Use the bash tool with 'file' command to inspect.`,
			};
		}

		const content = await fs.readFile(resolvedPath, "utf-8");
		const fileHash = crypto
			.createHash("md5")
			.update(content)
			.digest("hex")
			.slice(0, 8);
		const lines = content.split("\n");

		const offset = Math.max(0, args.offset ? args.offset - 1 : 0);
		const limit = args.limit ?? lines.length;

		const selectedLines = lines.slice(offset, offset + limit);

		const numberedLines = selectedLines
			.map((line, i) => `${offset + i + 1}: ${line}`)
			.join("\n");

		const truncated = selectedLines.length < lines.length;
		const summary = truncated
			? `\n\n(Showing lines ${offset + 1}-${offset + selectedLines.length} of ${lines.length})`
			: "";

		markFileAsRead(resolvedPath, ctx);

		return {
			success: true,
			output: `${numberedLines + summary}\n\nFile Hash: ${fileHash}`,
			metadata: {
				path: resolvedPath,
				totalLines: lines.length,
				shownLines: selectedLines.length,
				offset: offset + 1,
				fileHash,
			},
		};
	} catch (error) {
		return {
			success: false,
			output: "",
			error: `Failed to read file: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

async function writeFile(
	args: z.infer<typeof WRITE_FILE_SCHEMA>,
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

	const symlinkCheck = await checkSymlinkSafety(
		path.dirname(resolvedPath),
		ctx.cwd,
	);
	if (!symlinkCheck.safe) {
		return {
			success: false,
			output: "",
			error: `Security error: Parent directory is a symlink: ${symlinkCheck.reason}`,
		};
	}

	const contentBytes = Buffer.byteLength(args.content, "utf8");
	if (contentBytes > MAX_WRITE_SIZE) {
		return {
			success: false,
			output: "",
			error: `Content too large (${(contentBytes / 1024).toFixed(2)}KB). Maximum write size is ${MAX_WRITE_SIZE / 1024}KB. Consider splitting into smaller files.`,
		};
	}

	const linterResult = await runAciLinter(resolvedPath, args.content);
	if (!linterResult.success) {
		return {
			success: false,
			output: "",
			error: `ACI Linter failed (Syntax Error):\n${linterResult.error}\n\nWrite was NOT applied. Please self-correct.`,
		};
	}

	try {
		const fileExists = await fs.pathExists(resolvedPath);

		if (fileExists) {
			const existingSymlinkCheck = await checkSymlinkSafety(
				resolvedPath,
				ctx.cwd,
			);
			if (!existingSymlinkCheck.safe) {
				return {
					success: false,
					output: "",
					error: `Security error: ${existingSymlinkCheck.reason}`,
				};
			}

			if (!hasFileBeenRead(resolvedPath, ctx)) {
				return {
					success: false,
					output: "",
					error: `You MUST use the Read tool at least once in the conversation before you can write to an existing file. This tool will fail if you did not read the file. Read the file first: ${resolvedPath}`,
				};
			}
		}

		if (ctx.diffPreview?.showPreview) {
			const existingContent = fileExists
				? await fs.readFile(resolvedPath, "utf-8")
				: null;
			const _operation = fileExists ? "overwrite" : "create";

			const previewResult = await showDiffPreview(
				existingContent,
				args.content,
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

		await fs.ensureDir(path.dirname(resolvedPath));

		const finalSymlinkCheck = await checkSymlinkSafety(resolvedPath, ctx.cwd);
		if (!finalSymlinkCheck.safe && !fileExists) {
			return {
				success: false,
				output: "",
				error: `Security error: ${finalSymlinkCheck.reason}`,
			};
		}

		if (fileExists) {
			try {
				const existingContent = await fs.readFile(resolvedPath, "utf-8");
				await createBackup(resolvedPath, existingContent);

				const fd = await fs.promises.open(resolvedPath, "w");
				try {
					await fd.writeFile(args.content, "utf8");
				} finally {
					await fd.close();
				}
			} catch (writeError: unknown) {
				const errorMsg =
					writeError instanceof Error ? writeError.message : String(writeError);
				if (
					errorMsg.includes("ELOOP") ||
					errorMsg.includes("not a regular file")
				) {
					return {
						success: false,
						output: "",
						error: `Security error: File appears to be a symlink. Write blocked.`,
					};
				}
				throw writeError;
			}
		} else {
			try {
				const fd = await fs.promises.open(resolvedPath, "wx");
				try {
					await fd.writeFile(args.content, "utf8");
				} finally {
					await fd.close();
				}
			} catch (writeError: unknown) {
				const errorMsg =
					writeError instanceof Error ? writeError.message : String(writeError);
				if (errorMsg.includes("EEXIST")) {
					return {
						success: false,
						output: "",
						error: `File was created by another process. Read the file first before writing.`,
					};
				}
				throw writeError;
			}
		}

		markFileAsRead(resolvedPath, ctx);

		const statsNote = ctx.diffPreview?.showPreview
			? ` (${formatDiffStats(fileExists ? await fs.readFile(resolvedPath, "utf-8") : args.content)})`
			: "";

		return {
			success: true,
			output: `Successfully wrote ${contentBytes} bytes to ${resolvedPath}${statsNote}`,
			metadata: { path: resolvedPath, bytes: contentBytes },
		};
	} catch (error) {
		return {
			success: false,
			output: "",
			error: `Failed to write file: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

async function editFile(
	args: z.infer<typeof EDIT_FILE_SCHEMA>,
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
				error: `File not found: ${resolvedPath}`,
			};
		}

		if (!hasFileBeenRead(resolvedPath, ctx)) {
			return {
				success: false,
				output: "",
				error: `You MUST use the Read tool at least once in the conversation before you can edit a file. This tool will fail if you did not read the file. Read the file first: ${resolvedPath}`,
			};
		}

		const content = await fs.readFile(resolvedPath, "utf-8");
		const currentHash = crypto
			.createHash("md5")
			.update(content)
			.digest("hex")
			.slice(0, 8);

		if (args.expected_hash !== currentHash) {
			return {
				success: false,
				output: "",
				error: `Drift detected: Live file hash (${currentHash}) does not match expected hash (${args.expected_hash}). Please read the file again to get the latest content and hash.`,
			};
		}

		if (!content.includes(args.old_string)) {
			const lines = content.split("\n");
			const contextLines: string[] = [];

			for (let i = 0; i < Math.min(5, lines.length); i++) {
				contextLines.push(`${i + 1}: ${lines[i]}`);
			}

			return {
				success: false,
				output: "",
				error: `oldString not found in content. The file starts with:\n${contextLines.join("\n")}\n\nPlease ensure oldString matches EXACTLY, including whitespace and line breaks.`,
			};
		}

		const occurrences = content.split(args.old_string).length - 1;

		if (occurrences > 1 && !args.replace_all) {
			const firstIdx = content.indexOf(args.old_string);
			const lineNum = content.substring(0, firstIdx).split("\n").length;
			const startLine = Math.max(0, lineNum - 3);
			const endLine = Math.min(content.split("\n").length, lineNum + 5);
			const contextLines = content
				.split("\n")
				.slice(startLine, endLine)
				.map((l, i) => `${startLine + i + 1}: ${l}`)
				.join("\n");

			return {
				success: false,
				output: "",
				error: `Found ${occurrences} occurrences of oldString. Provide more surrounding lines for a unique match, or use replace_all: true.\n\nContext around first match:\n${contextLines}`,
				metadata: { occurrences, firstMatchLine: lineNum },
			};
		}

		await createBackup(resolvedPath, content);

		const newContent = args.replace_all
			? content.split(args.old_string).join(args.new_string)
			: content.replace(args.old_string, args.new_string);

		const linterResult = await runAciLinter(resolvedPath, newContent);
		if (!linterResult.success) {
			return {
				success: false,
				output: "",
				error: `ACI Linter failed (Syntax Error):\n${linterResult.error}\n\nEdit was NOT applied. Please self-correct.`,
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

		const replacedCount = args.replace_all ? occurrences : 1;
		const statsNote = ctx.diffPreview?.showPreview
			? ` (${formatDiffStats(newContent)})`
			: "";

		return {
			success: true,
			output: `Successfully replaced ${replacedCount} occurrence(s) in ${resolvedPath}${statsNote}`,
			metadata: { path: resolvedPath, replacements: replacedCount },
		};
	} catch (error) {
		return {
			success: false,
			output: "",
			error: `Failed to edit file: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

async function createDir(
	args: z.infer<typeof CREATE_DIR_SCHEMA>,
	ctx: ToolContext,
): Promise<ToolResult> {
	const resolvedPath = resolvePath(args.dir_path, ctx.cwd);

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
		await fs.ensureDir(resolvedPath);

		return {
			success: true,
			output: `Created directory: ${resolvedPath}`,
			metadata: { path: resolvedPath },
		};
	} catch (error) {
		return {
			success: false,
			output: "",
			error: `Failed to create directory: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

async function deleteFile(
	args: z.infer<typeof DELETE_FILE_SCHEMA>,
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
				error: `File not found: ${resolvedPath}`,
			};
		}

		await fs.unlink(resolvedPath);

		return {
			success: true,
			output: `Deleted file: ${resolvedPath}`,
			metadata: { path: resolvedPath },
		};
	} catch (error) {
		return {
			success: false,
			output: "",
			error: `Failed to delete file: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

async function deleteDir(
	args: z.infer<typeof DELETE_DIR_SCHEMA>,
	ctx: ToolContext,
): Promise<ToolResult> {
	const resolvedPath = resolvePath(args.dir_path, ctx.cwd);

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
				error: `Directory not found: ${resolvedPath}`,
			};
		}

		await fs.rm(resolvedPath, { recursive: args.recursive ?? false });

		return {
			success: true,
			output: `Deleted directory: ${resolvedPath}`,
			metadata: { path: resolvedPath },
		};
	} catch (error) {
		return {
			success: false,
			output: "",
			error: `Failed to delete directory: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

async function copyFile(
	args: z.infer<typeof COPY_FILE_SCHEMA>,
	ctx: ToolContext,
): Promise<ToolResult> {
	const sourcePath = resolvePath(args.source, ctx.cwd);
	const destPath = resolvePath(args.destination, ctx.cwd);

	const sourceSecurity = validatePathSecurity(sourcePath, ctx.cwd);
	if (!sourceSecurity.safe) {
		return {
			success: false,
			output: "",
			error: `Security error (source): ${sourceSecurity.reason}`,
		};
	}

	const destSecurity = validatePathSecurity(destPath, ctx.cwd);
	if (!destSecurity.safe) {
		return {
			success: false,
			output: "",
			error: `Security error (destination): ${destSecurity.reason}`,
		};
	}

	const sourceSymlinkCheck = await checkSymlinkSafety(sourcePath, ctx.cwd);
	if (!sourceSymlinkCheck.safe) {
		return {
			success: false,
			output: "",
			error: `Security error (source): ${sourceSymlinkCheck.reason}`,
		};
	}

	const destSymlinkCheck = await checkSymlinkSafety(destPath, ctx.cwd);
	if (!destSymlinkCheck.safe) {
		return {
			success: false,
			output: "",
			error: `Security error (destination): ${destSymlinkCheck.reason}`,
		};
	}

	try {
		await fs.ensureDir(path.dirname(destPath));
		await fs.copy(sourcePath, destPath);

		return {
			success: true,
			output: `Copied ${sourcePath} to ${destPath}`,
			metadata: { source: sourcePath, destination: destPath },
		};
	} catch (error) {
		return {
			success: false,
			output: "",
			error: `Failed to copy: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

async function moveFile(
	args: z.infer<typeof MOVE_FILE_SCHEMA>,
	ctx: ToolContext,
): Promise<ToolResult> {
	const sourcePath = resolvePath(args.source, ctx.cwd);
	const destPath = resolvePath(args.destination, ctx.cwd);

	const sourceSecurity = validatePathSecurity(sourcePath, ctx.cwd);
	if (!sourceSecurity.safe) {
		return {
			success: false,
			output: "",
			error: `Security error (source): ${sourceSecurity.reason}`,
		};
	}

	const destSecurity = validatePathSecurity(destPath, ctx.cwd);
	if (!destSecurity.safe) {
		return {
			success: false,
			output: "",
			error: `Security error (destination): ${destSecurity.reason}`,
		};
	}

	const sourceSymlinkCheck = await checkSymlinkSafety(sourcePath, ctx.cwd);
	if (!sourceSymlinkCheck.safe) {
		return {
			success: false,
			output: "",
			error: `Security error (source): ${sourceSymlinkCheck.reason}`,
		};
	}

	const destSymlinkCheck = await checkSymlinkSafety(destPath, ctx.cwd);
	if (!destSymlinkCheck.safe) {
		return {
			success: false,
			output: "",
			error: `Security error (destination): ${destSymlinkCheck.reason}`,
		};
	}

	try {
		await fs.ensureDir(path.dirname(destPath));
		await fs.move(sourcePath, destPath);

		return {
			success: true,
			output: `Moved ${sourcePath} to ${destPath}`,
			metadata: { source: sourcePath, destination: destPath },
		};
	} catch (error) {
		return {
			success: false,
			output: "",
			error: `Failed to move: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

async function listDir(
	args: z.infer<typeof LIST_DIR_SCHEMA> & Record<string, unknown>,
	ctx: ToolContext,
): Promise<ToolResult> {
	// Handle cases where model uses 'directory' instead of 'dir_path'
	let dirPath = args.dir_path;
	if (!dirPath && "directory" in args) {
		dirPath = args.directory as string;
	}
	if (!dirPath) {
		return {
			success: false,
			output: "",
			error: "Missing required parameter: dir_path (or directory)",
		};
	}

	const resolvedPath = resolvePath(dirPath, ctx.cwd);

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
				error: `Directory not found: ${resolvedPath}`,
			};
		}

		const stats = await fs.stat(resolvedPath);
		if (!stats.isDirectory()) {
			return {
				success: false,
				output: "",
				error: `Not a directory: ${resolvedPath}`,
			};
		}

		const entries = await fs.readdir(resolvedPath, { withFileTypes: true });

		if (args.json) {
			const jsonEntries = entries
				.sort((a, b) => {
					if (a.isDirectory() && !b.isDirectory()) return -1;
					if (!a.isDirectory() && b.isDirectory()) return 1;
					return a.name.localeCompare(b.name);
				})
				.map((entry) => ({
					name: entry.name,
					type: entry.isDirectory() ? "directory" : "file",
					path: path.join(resolvedPath, entry.name),
				}));

			return {
				success: true,
				output: JSON.stringify(jsonEntries, null, 2),
				metadata: { path: resolvedPath, count: entries.length },
			};
		} else {
			const lines = entries
				.sort((a, b) => {
					if (a.isDirectory() && !b.isDirectory()) return -1;
					if (!a.isDirectory() && b.isDirectory()) return 1;
					return a.name.localeCompare(b.name);
				})
				.map((entry) => {
					const suffix = entry.isDirectory() ? "/" : "";
					return `${entry.name}${suffix}`;
				});

			return {
				success: true,
				output: lines.join("\n") || "(empty directory)",
				metadata: { path: resolvedPath, count: entries.length },
			};
		}
	} catch (error) {
		return {
			success: false,
			output: "",
			error: `Failed to list directory: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

async function getFileInfo(
	args: z.infer<typeof GET_FILE_INFO_SCHEMA>,
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
		const stats = await fs.stat(resolvedPath);

		const now = Date.now();
		const msAgo = Math.max(0, now - stats.mtimeMs);
		const seconds = Math.floor(msAgo / 1000);
		const minutes = Math.floor(seconds / 60);
		const hours = Math.floor(minutes / 60);
		const days = Math.floor(hours / 24);

		let relativeModified = "";
		if (seconds < 60) relativeModified = `${seconds} seconds ago`;
		else if (minutes < 60) relativeModified = `${minutes} minutes ago`;
		else if (hours < 24) relativeModified = `${hours} hours ago`;
		else relativeModified = `${days} days ago`;

		const info = {
			path: resolvedPath,
			type: stats.isDirectory() ? "directory" : "file",
			size: stats.size,
			created: stats.birthtime,
			modified: stats.mtime,
			modified_ms: stats.mtimeMs,
			modified_relative: relativeModified,
			accessed: stats.atime,
		};

		return {
			success: true,
			output: JSON.stringify(info, null, 2),
			metadata: info,
		};
	} catch (error) {
		return {
			success: false,
			output: "",
			error: `Failed to get file info: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

export const fsTools: ToolDefinition[] = [
	{
		name: "read",
		description: `Read a file or directory from the local filesystem. If the path does not exist, an error is returned.

Usage:
- The filePath parameter should be an absolute path.
- By default, this tool returns up to 2000 lines from the start of the file.
- The offset parameter is the line number to start from (1-indexed).
- To read later sections, call this tool again with a larger offset.
- Use the grep tool to find specific content in large files or files with long lines.
- If you are unsure of the correct file path, use the glob tool to look up filenames by glob pattern.
- Contents are returned with each line prefixed by its line number as "<line>: <content>". For example, if a file has contents "foo\\n", you will receive "1: foo\\n". For directories, entries are returned one per line (without line numbers) with a trailing "/" for subdirectories.
- Any line longer than 2000 characters is truncated.
- Call this tool in parallel when you know there are multiple files you want to read.
- Avoid tiny repeated slices (30 line chunks). If you need more context, read a larger window.
- This tool can read image files and PDFs and return them as file attachments.`,
		parameters: READ_FILE_SCHEMA,
		execute: readFile as AnyToolExecutor,
		category: "fs",
		requiresPermission: false,
		isReadonly: true,
		prefetchRules: [
			{
				tool: "file_info",
				argMapper: (args: unknown) => {
					if (!args || typeof args !== "object") return null;
					const record = args as Record<string, unknown>;
					return { file_path: record.file_path };
				},
				priority: "medium",
			},
			{
				tool: "list_dir",
				argMapper: (args: unknown, _ctx: ToolContext) => {
					if (!args || typeof args !== "object") return null;
					const record = args as Record<string, unknown>;
					const filePath = record.file_path;
					if (typeof filePath !== "string") return null;
					return { dir_path: path.dirname(filePath) };
				},
				priority: "low",
			},
			{
				tool: "grep",
				argMapper: (args: unknown, _ctx: ToolContext) => {
					if (!args || typeof args !== "object") return null;
					const record = args as Record<string, unknown>;
					const filePath = record.file_path;
					if (typeof filePath !== "string") return null;
					const ext = path.extname(filePath).slice(1);
					if (!ext) return null;
					return {
						pattern: "import|require|from",
						path: path.dirname(filePath),
						include: `*.${ext}`,
					};
				},
				condition: (args: unknown) => {
					if (!args || typeof args !== "object") return false;
					const record = args as Record<string, unknown>;
					const filePath = record.file_path;
					if (typeof filePath !== "string") return false;
					const ext = path.extname(filePath).slice(1);
					return ["ts", "tsx", "js", "jsx", "py", "go", "rs"].includes(ext);
				},
				priority: "low",
			},
		],
	},
	{
		name: "write",
		description: `Writes a file to the local filesystem.

Usage:
- This tool will overwrite the existing file if there is one at the provided path.
- If this is an existing file, you MUST use the Read tool first to read the file. This tool will fail if you did not read the file.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.
- NEVER use emojis unless the user explicitly requests it. Avoid writing emojis to files unless asked.`,
		parameters: WRITE_FILE_SCHEMA,
		execute: writeFile as AnyToolExecutor,
		category: "fs",
		requiresPermission: true,
		isReadonly: false,
	},
	{
		name: "edit",
		description: `Performs exact string replacements in files. 

Usage:
- You must use your Read tool at least once in the conversation before editing. This tool will error if you attempt an edit without reading the file. 
- You MUST pass the expected_hash of the file which you received from the Read tool output.
- When editing text from Read tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: line number + colon + space (e.g., "1: "). Everything after that space is the actual file content to match. Never include any part of the line number prefix in the oldString or newString.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.
- The edit will FAIL if expected_hash does not match the live file's hash (drift corruption).
- The edit will FAIL if oldString is not found in the file with an error "oldString not found in content".
- The edit will FAIL if oldString is found multiple times in the file. Provide more surrounding lines in oldString to identify the correct match. 
- Use replaceAll for replacing all occurrences of oldString across the file.`,

		parameters: EDIT_FILE_SCHEMA,
		execute: editFile as AnyToolExecutor,
		category: "fs",
		requiresPermission: true,
		isReadonly: false,
	},
	{
		name: "create_dir",
		description: "Create a directory. Creates parent directories by default.",
		parameters: CREATE_DIR_SCHEMA,
		execute: createDir as AnyToolExecutor,
		category: "fs",
		requiresPermission: true,
		isReadonly: false,
	},
	{
		name: "delete_file",
		description: "Delete a file from the filesystem.",
		parameters: DELETE_FILE_SCHEMA,
		execute: deleteFile as AnyToolExecutor,
		category: "fs",
		requiresPermission: true,
		isReadonly: false,
	},
	{
		name: "delete_dir",
		description:
			"Delete a directory. Use recursive: true to delete non-empty directories.",
		parameters: DELETE_DIR_SCHEMA,
		execute: deleteDir as AnyToolExecutor,
		category: "fs",
		requiresPermission: true,
		isReadonly: false,
	},
	{
		name: "copy",
		description: "Copy a file from source to destination.",
		parameters: COPY_FILE_SCHEMA,
		execute: copyFile as AnyToolExecutor,
		category: "fs",
		requiresPermission: true,
		isReadonly: false,
	},
	{
		name: "move",
		description: "Move a file from source to destination.",
		parameters: MOVE_FILE_SCHEMA,
		execute: moveFile as AnyToolExecutor,
		category: "fs",
		requiresPermission: true,
		isReadonly: false,
	},
	{
		name: "list_dir",
		description:
			"List contents of a directory. Directories are shown with trailing /.",
		parameters: LIST_DIR_SCHEMA,
		execute: listDir as AnyToolExecutor,
		category: "fs",
		requiresPermission: false,
		isReadonly: true,
	},
	{
		name: "file_info",
		description:
			"Get information about a file or directory (size, dates, type).",
		parameters: GET_FILE_INFO_SCHEMA,
		execute: getFileInfo as AnyToolExecutor,
		category: "fs",
		requiresPermission: false,
		isReadonly: true,
	},
];

const IMAGE_READ_SCHEMA = z.object({
	file_path: z.string().describe("The absolute path to the image file"),
	max_width: z
		.number()
		.int()
		.positive()
		.optional()
		.describe("Maximum width for resizing (default: 1024)"),
	max_height: z
		.number()
		.int()
		.positive()
		.optional()
		.describe("Maximum height for resizing (default: 1024)"),
});

async function readImage(
	args: z.infer<typeof IMAGE_READ_SCHEMA>,
	ctx: ToolContext,
): Promise<ToolResult> {
	const resolvedPath = resolvePath(args.file_path, ctx.cwd);
	const maxWidth = args.max_width ?? 1024;
	const maxHeight = args.max_height ?? 1024;

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
		const stats = await fs.lstat(resolvedPath);

		if (stats.isSymbolicLink()) {
			const realPath = await fs.realpath(resolvedPath);
			return {
				success: false,
				output: "",
				error: `File is a symlink pointing to: ${realPath}. Direct access to symlinks is restricted for security.`,
			};
		}

		if (!stats.isFile()) {
			return {
				success: false,
				output: "",
				error: `Not a file: ${resolvedPath}`,
			};
		}

		if (stats.size > 10 * 1024 * 1024) {
			return {
				success: false,
				output: "",
				error: `Image too large (${(stats.size / 1024 / 1024).toFixed(2)}MB). Maximum size is 10MB.`,
			};
		}

		const buffer = await fs.readFile(resolvedPath);
		const fileType = await fileTypeFromBuffer(buffer);

		if (!fileType || !fileType.mime.startsWith("image/")) {
			return {
				success: false,
				output: "",
				error: `Not a valid image file. Detected type: ${fileType?.mime ?? "unknown"}`,
			};
		}

		const image = sharp(buffer);
		const metadata = await image.metadata();

		const resizedBuffer = await image
			.resize(maxWidth, maxHeight, {
				fit: "inside",
				withoutEnlargement: true,
			})
			.png({ quality: 80 })
			.toBuffer();

		const base64 = resizedBuffer.toString("base64");

		return {
			success: true,
			output: `[Image: ${path.basename(resolvedPath)}]\nFormat: ${metadata.format?.toUpperCase() ?? "unknown"}\nOriginal size: ${metadata.width}x${metadata.height}\nMIME: ${fileType.mime}\nBase64 data available for vision models.`,
			metadata: {
				path: resolvedPath,
				originalWidth: metadata.width,
				originalHeight: metadata.height,
				mimeType: fileType.mime,
				base64: base64,
			},
		};
	} catch (error) {
		return {
			success: false,
			output: "",
			error: `Failed to read image: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

export const imageTool: ToolDefinition = {
	name: "read_image",
	description:
		"Read an image file and return base64-encoded data for vision models. Supports PNG, JPEG, GIF, WebP, and other formats. Automatically resizes large images.",
	parameters: IMAGE_READ_SCHEMA,
	execute: readImage as AnyToolExecutor,
	category: "fs",
	requiresPermission: false,
	isReadonly: true,
};

const PDF_READ_SCHEMA = z.object({
	file_path: z.string().describe("The absolute path to the PDF file"),
	max_pages: z
		.number()
		.int()
		.positive()
		.optional()
		.describe("Maximum number of pages to read (default: 50)"),
});

async function readPDF(
	args: z.infer<typeof PDF_READ_SCHEMA>,
	ctx: ToolContext,
): Promise<ToolResult> {
	const resolvedPath = resolvePath(args.file_path, ctx.cwd);
	const maxPages = args.max_pages ?? 50;

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
		const stats = await fs.lstat(resolvedPath);

		if (stats.isSymbolicLink()) {
			const realPath = await fs.realpath(resolvedPath);
			return {
				success: false,
				output: "",
				error: `File is a symlink pointing to: ${realPath}. Direct access to symlinks is restricted for security.`,
			};
		}

		if (!stats.isFile()) {
			return {
				success: false,
				output: "",
				error: `Not a file: ${resolvedPath}`,
			};
		}

		if (stats.size > 50 * 1024 * 1024) {
			return {
				success: false,
				output: "",
				error: `PDF too large (${(stats.size / 1024 / 1024).toFixed(2)}MB). Maximum size is 50MB.`,
			};
		}

		const buffer = await fs.readFile(resolvedPath);

		const { PDFParse } = await import("pdf-parse");
		const pdfParser = new PDFParse({ data: buffer });
		const textResult = await pdfParser.getText({ first: maxPages });

		const totalPages = textResult.total;
		const text = textResult.text;

		const truncated = text.length > 100000;
		const outputText = truncated
			? `${text.slice(0, 100000)}\n\n... (truncated)`
			: text;

		return {
			success: true,
			output: `[PDF: ${path.basename(resolvedPath)}]\nPages: ${totalPages} (showing first ${Math.min(totalPages, maxPages)})\n\n${outputText}`,
			metadata: {
				path: resolvedPath,
				totalPages,
				characters: text.length,
				truncated,
			},
		};
	} catch (error) {
		return {
			success: false,
			output: "",
			error: `Failed to read PDF: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

export const pdfTool: ToolDefinition = {
	name: "read_pdf",
	description:
		"Read and extract text content from a PDF file. Returns text content with page information.",
	parameters: PDF_READ_SCHEMA,
	execute: readPDF as AnyToolExecutor,
	category: "fs",
	requiresPermission: false,
	isReadonly: true,
};

export const allFsTools: ToolDefinition[] = [...fsTools, imageTool, pdfTool];
