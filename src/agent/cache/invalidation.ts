import type { ToolResult } from "../tools/registry.js";
import { getToolCache } from "./tool-cache.js";

const WRITE_TOOLS = new Set([
	"write",
	"write_file",
	"edit",
	"edit_file",
	"delete_file",
	"delete_dir",
	"create_dir",
	"move",
	"copy",
]);

const PATH_KEYS = ["file_path", "path", "source", "destination", "dir_path"];

function extractPaths(args: unknown): string[] {
	const paths: string[] = [];

	if (!args || typeof args !== "object") return paths;

	const record = args as Record<string, unknown>;

	for (const key of PATH_KEYS) {
		if (typeof record[key] === "string") {
			paths.push(record[key]);
		}
	}

	return paths;
}

export function invalidateOnWrite(toolName: string, args: unknown): void {
	if (!WRITE_TOOLS.has(toolName)) return;

	const cache = getToolCache();
	const paths = extractPaths(args);

	for (const filePath of paths) {
		cache.invalidateFile(filePath);
	}

	if (toolName === "move" || toolName === "copy") {
		const record = args as Record<string, unknown>;
		const destPath = record.destination || record.dest;
		if (typeof destPath === "string") {
			cache.invalidateFile(destPath);
		}
	}

	if (toolName === "delete_dir") {
		const record = args as Record<string, unknown>;
		const dirPath = record.dir_path || record.path;
		if (typeof dirPath === "string") {
			cache.invalidateDirectory(dirPath);
		}
	}
}

export function invalidateOnBash(command: string, affectedPaths: string[] = []): void {
	const cache = getToolCache();

	for (const p of affectedPaths) {
		cache.invalidateFile(p);
	}

	const writePatterns = [
		/\b(write|create|save)\b/i,
		/\b(delete|remove|rm)\b/i,
		/\b(move|rename|mv)\b/i,
		/\b(copy|cp)\b/i,
		/\b(edit|modify)\b/i,
	];

	const isWriteCommand = writePatterns.some((p) => p.test(command));

	if (isWriteCommand && affectedPaths.length === 0) {
		const pathPattern = /['"]([\/.][^'"]+)['"]/g;
		let match;
		while ((match = pathPattern.exec(command)) !== null) {
			cache.invalidateFile(match[1]);
		}
	}
}

export function shouldCacheTool(toolName: string, args: unknown): boolean {
	const cacheableTools = new Set([
		"read",
		"read_file",
		"read_image",
		"read_pdf",
		"glob",
		"grep",
		"grep_search",
		"file_info",
		"list_dir",
		"list_directory",
		"web_fetch",
		"webfetch",
		"web_search",
		"code_search",
		"git_status",
		"git_log",
		"git_diff",
	]);

	if (!cacheableTools.has(toolName)) return false;

	if (args && typeof args === "object") {
		const record = args as Record<string, unknown>;
		if (record.no_cache === true) return false;
	}

	return true;
}

export type { ToolResult };
