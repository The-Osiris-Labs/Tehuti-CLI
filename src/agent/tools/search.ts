import { spawn } from "node:child_process";
import path from "node:path";
import fs from "fs-extra";
import { glob } from "tinyglobby";
import { z } from "zod";
import type {
	AnyToolExecutor,
	ToolContext,
	ToolDefinition,
	ToolResult,
} from "./registry.js";

const PROTECTED_PATTERNS = [
	/\.env$/i,
	/\.env\./i,
	/credentials/i,
	/secrets?\.json$/i,
	/\.pem$/i,
	/\.key$/i,
	/id_rsa/i,
	/id_ed25519/i,
	/\.ssh/i,
	/\.npmrc$/i,
	/\.netrc$/i,
	/\.pgpass$/i,
	/\.git-credentials$/i,
	/\.aws\//i,
	/\.docker\//i,
];

const SENSITIVE_DIR_PATTERNS = [
	/\/\.ssh\//i,
	/\/secrets?\//i,
	/\/credentials\//i,
	/\/\.aws\//i,
	/\/\.gnupg\//i,
];

function isSensitivePath(filePath: string): boolean {
	const lowerPath = filePath.toLowerCase();
	const basename = path.basename(lowerPath);

	if (SENSITIVE_DIR_PATTERNS.some((p) => p.test(lowerPath))) return true;

	return PROTECTED_PATTERNS.some((p) => p.test(basename));
}

function containsTraversal(pattern: string): boolean {
	let decoded = pattern;
	try {
		decoded = decodeURIComponent(pattern);
	} catch {
		decoded = pattern;
	}
	try {
		decoded = decodeURIComponent(decoded);
	} catch {}
	const normalized = path.normalize(decoded);
	return normalized.startsWith("..") || path.isAbsolute(normalized);
}

async function validateSearchPath(
	resolvedPath: string,
	cwd: string,
): Promise<{ safe: boolean; reason?: string }> {
	const normalizedPath = path.normalize(resolvedPath);
	const normalizedCwd = path.normalize(cwd);

	const relativePath = path.relative(normalizedCwd, normalizedPath);
	if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
		return {
			safe: false,
			reason: "Path traversal outside working directory is not allowed",
		};
	}

	if (isSensitivePath(normalizedPath)) {
		return { safe: false, reason: "Access to sensitive files is restricted" };
	}

	try {
		const stats = await fs.lstat(normalizedPath);
		if (stats.isSymbolicLink()) {
			const realPath = await fs.realpath(normalizedPath);
			const relativeReal = path.relative(normalizedCwd, realPath);
			if (relativeReal.startsWith("..") || path.isAbsolute(relativeReal)) {
				return {
					safe: false,
					reason: `Symlink points outside working directory: ${realPath}`,
				};
			}
			if (isSensitivePath(realPath)) {
				return {
					safe: false,
					reason: `Symlink points to sensitive file: ${realPath}`,
				};
			}
		}
	} catch {
		// Path doesn't exist yet, that's fine for search
	}

	return { safe: true };
}

const GLOB_SCHEMA = z.object({
	pattern: z
		.string()
		.describe("The glob pattern to match files against (e.g., '**/*.ts')"),
	path: z
		.string()
		.optional()
		.describe(
			"The directory to search in (default: current working directory)",
		),
	ignore: z.array(z.string()).optional().describe("Patterns to ignore"),
	absolute: z
		.boolean()
		.optional()
		.describe("Return absolute paths (default: true)"),
	only_files: z
		.boolean()
		.optional()
		.describe("Only return files, not directories (default: true)"),
	only_directories: z
		.boolean()
		.optional()
		.describe("Only return directories (default: false)"),
	deep: z.number().int().optional().describe("Maximum depth to search"),
	max_results: z
		.number()
		.int()
		.positive()
		.optional()
		.describe("Maximum number of results to return (default: 1000)"),
});

const GREP_SCHEMA = z.object({
	pattern: z.string().describe("The regex pattern to search for"),
	path: z
		.string()
		.optional()
		.describe(
			"The file or directory to search in (default: current working directory)",
		),
	include: z
		.string()
		.optional()
		.describe("File pattern to include (e.g., '*.ts')"),
	ignore_case: z
		.boolean()
		.optional()
		.describe("Case insensitive search (default: true)"),
	multiline: z.boolean().optional().describe("Enable multiline matching"),
	context: z
		.number()
		.int()
		.optional()
		.describe("Number of context lines to show"),
	max_results: z
		.number()
		.int()
		.positive()
		.optional()
		.describe("Maximum number of results to return"),
	timeout: z
		.number()
		.int()
		.positive()
		.optional()
		.describe("Timeout in milliseconds (default: 30000)"),
});

const GLOB_TIMEOUT_MS = 30000;

async function globFiles(
	args: z.infer<typeof GLOB_SCHEMA>,
	ctx: ToolContext,
): Promise<ToolResult> {
	const searchPath = args.path ? path.resolve(ctx.cwd, args.path) : ctx.cwd;
	const maxResults = args.max_results ?? 1000;

	if (containsTraversal(args.pattern)) {
		return {
			success: false,
			output: "",
			error: "Security error: Pattern contains path traversal",
		};
	}

	const pathCheck = await validateSearchPath(searchPath, ctx.cwd);
	if (!pathCheck.safe) {
		return {
			success: false,
			output: "",
			error: `Security error: ${pathCheck.reason}`,
		};
	}

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), GLOB_TIMEOUT_MS);

	try {
		const results = await glob([args.pattern], {
			cwd: searchPath,
			ignore: args.ignore ?? ["node_modules/**", ".git/**"],
			absolute: args.absolute ?? true,
			onlyFiles: args.only_directories ? false : (args.only_files ?? true),
			onlyDirectories: args.only_directories ?? false,
			deep: args.deep,
		});

		clearTimeout(timeoutId);

		const filteredResults = [];
		for (const r of results) {
			if (isSensitivePath(r)) continue;
			try {
				const stats = await fs.lstat(r);
				if (stats.isSymbolicLink()) {
					const realPath = await fs.realpath(r);
					const relReal = path.relative(ctx.cwd, realPath);
					if (relReal.startsWith("..") || path.isAbsolute(relReal)) continue;
					if (isSensitivePath(realPath)) continue;
				}
				filteredResults.push(r);
			} catch {
				filteredResults.push(r);
			}
		}

		const resultsWithMtime = await Promise.all(
			filteredResults.slice(0, maxResults * 2).map(async (filePath) => {
				try {
					const stats = await fs.stat(filePath);
					return { path: filePath, mtime: stats.mtime.getTime() };
				} catch {
					return { path: filePath, mtime: 0 };
				}
			}),
		);

		const sortedResults = resultsWithMtime
			.sort((a, b) => b.mtime - a.mtime)
			.slice(0, maxResults)
			.map((r) => r.path);

		const truncated = filteredResults.length > maxResults;

		if (sortedResults.length === 0) {
			return {
				success: true,
				output: `No files found matching pattern: ${args.pattern}`,
				metadata: { pattern: args.pattern, path: searchPath, count: 0 },
			};
		}

		return {
			success: true,
			output:
				sortedResults.join("\n") +
				(truncated
					? `\n\n... (truncated to ${maxResults} results, ${filteredResults.length} total found)`
					: ""),
			metadata: {
				pattern: args.pattern,
				path: searchPath,
				count: sortedResults.length,
				total: filteredResults.length,
				truncated,
			},
		};
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") {
			return {
				success: false,
				output: "",
				error: `Glob search timed out after ${GLOB_TIMEOUT_MS}ms. Try narrowing the search path.`,
			};
		}
		return {
			success: false,
			output: "",
			error: `Glob search failed: ${error instanceof Error ? error.message : String(error)}`,
		};
	} finally {
		clearTimeout(timeoutId);
	}
}

async function grepFiles(
	args: z.infer<typeof GREP_SCHEMA>,
	ctx: ToolContext,
): Promise<ToolResult> {
	const searchPath = args.path ? path.resolve(ctx.cwd, args.path) : ctx.cwd;
	const timeoutMs = args.timeout ?? 30000;

	if (args.include && containsTraversal(args.include)) {
		return {
			success: false,
			output: "",
			error: "Security error: Include pattern contains path traversal",
		};
	}

	const pathCheck = await validateSearchPath(searchPath, ctx.cwd);
	if (!pathCheck.safe) {
		return {
			success: false,
			output: "",
			error: `Security error: ${pathCheck.reason}`,
		};
	}

	try {
		const rgArgs = [
			"--json",
			"--line-number",
			"--column",
			"--heading",
			"--glob",
			"!.env*",
			"--glob",
			"!*credentials*",
			"--glob",
			"!*secret*",
			"--glob",
			"!*.pem",
			"--glob",
			"!*.key",
		];

		if (args.ignore_case !== false) {
			rgArgs.push("--ignore-case");
		}

		if (args.multiline) {
			rgArgs.push("--multiline");
		}

		if (args.context) {
			rgArgs.push("-C", String(args.context));
		}

		if (args.include) {
			rgArgs.push("--glob", args.include);
		}

		if (args.max_results) {
			rgArgs.push("--max-count", String(args.max_results));
		}

		rgArgs.push("--", args.pattern, searchPath);

		const result = await new Promise<{
			stdout: string;
			stderr: string;
			code: number;
		}>((resolve, reject) => {
			const proc = spawn("rg", rgArgs, {
				cwd: ctx.cwd,
				env: { ...process.env, ...ctx.env },
			});

			let stdout = "";
			let stderr = "";
			let timeoutId: NodeJS.Timeout | null = null;
			let resolved = false;

			const cleanup = () => {
				if (timeoutId) clearTimeout(timeoutId);
			};

			timeoutId = setTimeout(() => {
				if (resolved) return;
				cleanup();
				resolved = true;
				try {
					proc.kill("SIGKILL");
				} catch {}
				resolve({
					stdout: "",
					stderr: `Search timed out after ${timeoutMs}ms`,
					code: 124,
				});
			}, timeoutMs);

			proc.stdout.on("data", (data) => {
				stdout += data.toString();
			});

			proc.stderr.on("data", (data) => {
				stderr += data.toString();
			});

			proc.on("close", (code) => {
				if (resolved) return;
				cleanup();
				resolved = true;
				resolve({ stdout, stderr, code: code ?? 0 });
			});

			proc.on("error", (error) => {
				if (resolved) return;
				cleanup();
				resolved = true;
				reject(error);
			});
		});

		if (result.code === 124) {
			return {
				success: false,
				output: "",
				error: `Search timed out after ${timeoutMs}ms. Try narrowing the search path or pattern.`,
			};
		}

		if (result.code === 0 && !result.stdout) {
			return {
				success: true,
				output: `No matches found for pattern: ${args.pattern}`,
				metadata: { pattern: args.pattern, path: searchPath, count: 0 },
			};
		}

		const output: string[] = [];
		let matchCount = 0;

		for (const line of result.stdout.split("\n")) {
			if (!line.trim()) continue;

			try {
				const parsed = JSON.parse(line);

				if (parsed.type === "match") {
					const filePath = parsed.data?.path?.text ?? "";
					if (isSensitivePath(filePath)) continue;

					matchCount += parsed.data?.lines?.matches?.length ?? 1;

					const lineNum = parsed.data?.line_number ?? 0;
					const col = parsed.data?.absolute_offset ?? 0;
					const text = parsed.data?.lines?.text ?? "";

					output.push(`${filePath}:${lineNum}:${col}: ${text.trimEnd()}`);
				}
			} catch {
				output.push(line);
			}
		}

		return {
			success: true,
			output:
				output.slice(0, 100).join("\n") +
				(output.length > 100
					? `\n... (${output.length - 100} more results)`
					: ""),
			metadata: { pattern: args.pattern, path: searchPath, count: matchCount },
		};
	} catch (error) {
		if (error instanceof Error && error.message.includes("ENOENT")) {
			return {
				success: false,
				output: "",
				error:
					"ripgrep (rg) is not installed. Install it with: brew install ripgrep",
			};
		}
		return {
			success: false,
			output: "",
			error: `Grep search failed: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

export const searchTools: ToolDefinition[] = [
	{
		name: "glob",
		description: `- Fast file pattern matching tool that works with any codebase size
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time
- Use this tool when you need to find files by name patterns
- When doing an open-ended search that may require multiple rounds of globbing and grepping, use the Task tool instead
- You have the capability to call multiple tools in a single response. It is always better to speculatively perform multiple searches as a batch that are potentially useful.`,
		parameters: GLOB_SCHEMA,
		execute: globFiles as AnyToolExecutor,
		category: "fs",
		requiresPermission: false,
	},
	{
		name: "grep",
		description: `- Fast content search tool that works with any codebase size
- Searches file contents using regular expressions
- Supports full regex syntax (eg: "log.*Error", "function\\s+\\w+", etc.)
- Filter files by pattern with the include parameter (eg: "*.js", "*.{ts,tsx}")
- Returns file paths and line numbers with at least one match sorted by modification time
- Use this tool when you need to identify/count the number of matches within files, use the Bash tool with "rg" (ripgrep) directly.
- If you need to do an open-ended search that may require multiple rounds of globbing and grepping, use the Task tool instead
- You have the capability to call multiple tools in a single response. When making multiple independent pieces of information requested and all commands are likely to succeed, run multiple tool calls in parallel for optimal performance.`,
		parameters: GREP_SCHEMA,
		execute: grepFiles as AnyToolExecutor,
		category: "fs",
		requiresPermission: false,
	},
];
