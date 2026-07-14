import { z } from "zod";
import type {
	AnyToolExecutor,
	ToolContext,
	ToolDefinition,
	ToolResult,
} from "./registry.js";
import { findReferences, goToDefinition, grepFiles } from "./search.js";

const LSP_FIND_REFERENCES_SCHEMA = z.object({
	symbol: z.string().describe("Symbol name to find references for"),
	filePath: z
		.string()
		.describe("Path to the file containing the symbol"),
});

const LSP_GO_TO_DEFINITION_SCHEMA = z.object({
	symbol: z.string().describe("Symbol name to locate"),
	filePath: z
		.string()
		.describe("Path to the file containing the symbol"),
});

const LSP_RENAME_SYMBOL_SCHEMA = z.object({
	symbol: z.string().describe("Current symbol name"),
	newName: z.string().describe("New symbol name"),
	filePath: z
		.string()
		.describe("Path to the file containing the symbol"),
});

const LSP_HOVER_SCHEMA = z.object({
	symbol: z.string().describe("Symbol name to inspect"),
	filePath: z
		.string()
		.describe("Path to the file containing the symbol"),
});

async function lspFindReferences(
	args: z.infer<typeof LSP_FIND_REFERENCES_SCHEMA>,
	ctx: ToolContext,
): Promise<ToolResult> {
	const result = await findReferences(
		{ symbol: args.symbol, path: args.filePath },
		ctx,
	);
	return {
		...result,
		metadata: {
			...result.metadata,
			tool: "lsp_find_references",
			source: "tree-sitter+grep",
		},
	};
}

async function lspGoToDefinition(
	args: z.infer<typeof LSP_GO_TO_DEFINITION_SCHEMA>,
	ctx: ToolContext,
): Promise<ToolResult> {
	const result = await goToDefinition(
		{ symbol: args.symbol, path: args.filePath },
		ctx,
	);
	return {
		...result,
		metadata: {
			...result.metadata,
			tool: "lsp_go_to_definition",
			source: "tree-sitter+grep",
		},
	};
}

async function lspRenameSymbol(
	args: z.infer<typeof LSP_RENAME_SYMBOL_SCHEMA>,
	ctx: ToolContext,
): Promise<ToolResult> {
	const refsResult = await findReferences(
		{ symbol: args.symbol, path: args.filePath },
		ctx,
	);

	if (!refsResult.success) return refsResult;

	const lines = (refsResult.output || "")
		.split("\n")
		.filter((l) => l.trim());
	const changes: Array<{
		file: string;
		line: number;
		old: string;
		new: string;
	}> = [];

	for (const line of lines) {
		const match = line.match(/^([^:]+):(\d+):\d+:\s*(.*)/);
		if (match) {
			const [, file, lineNum, text] = match;
			if (text.includes(args.symbol)) {
				changes.push({
					file,
					line: parseInt(lineNum, 10),
					old: args.symbol,
					new: args.newName,
				});
			}
		}
	}

	return {
		success: true,
		output: JSON.stringify(
			{
				status: "rename_planned",
				symbol: args.symbol,
				newName: args.newName,
				totalReferences: changes.length,
				changes,
				message: `Found ${changes.length} references to rename. Use apply_diff to replace "${args.symbol}" with "${args.newName}" in the listed files.`,
			},
			null,
			2,
		),
		metadata: {
			tool: "lsp_rename_symbol",
			symbol: args.symbol,
			newName: args.newName,
			referenceCount: changes.length,
		},
	};
}

async function lspHover(
	args: z.infer<typeof LSP_HOVER_SCHEMA>,
	ctx: ToolContext,
): Promise<ToolResult> {
	// Search for type definitions: interface/type/class/enum/function declarations
	const defResult = await grepFiles(
		{
			pattern: `\\b(interface|type|class|enum|function|const|let|var)\\s+${args.symbol}\\b`,
			path: args.filePath,
			ignore_case: false,
			include: "*.{ts,tsx,js,jsx}",
			context: 3,
		},
		ctx,
	);

	if (
		defResult.success &&
		defResult.output &&
		!defResult.output.startsWith("No matches found")
	) {
		return {
			...defResult,
			metadata: {
				...defResult.metadata,
				tool: "lsp_hover",
				source: "tree-sitter+grep",
			},
		};
	}

	// Fallback: method-like patterns with surrounding context
	const fallbackResult = await grepFiles(
		{
			pattern: `\\b${args.symbol}\\s*[=(:]|${args.symbol}\\s*:\\s*\\w+`,
			path: args.filePath,
			include: "*.{ts,tsx,js,jsx}",
			context: 2,
		},
		ctx,
	);

	return {
		...fallbackResult,
		metadata: {
			...fallbackResult.metadata,
			tool: "lsp_hover",
			source: "tree-sitter+grep",
		},
	};
}

export const lspTools: ToolDefinition[] = [
	{
		name: "lsp_find_references",
		description:
			"Find all references to a symbol across the project using semantic grep (no LSP server required)",
		parameters: LSP_FIND_REFERENCES_SCHEMA,
		execute: lspFindReferences as AnyToolExecutor,
		category: "development",
		requiresPermission: true,
		isReadonly: true,
	},
	{
		name: "lsp_go_to_definition",
		description:
			"Navigate to the definition of a symbol using semantic grep (no LSP server required)",
		parameters: LSP_GO_TO_DEFINITION_SCHEMA,
		execute: lspGoToDefinition as AnyToolExecutor,
		category: "development",
		requiresPermission: true,
		isReadonly: true,
	},
	{
		name: "lsp_rename_symbol",
		description:
			"Plan a symbol rename across all references. Returns structured edit operations (no LSP server required)",
		parameters: LSP_RENAME_SYMBOL_SCHEMA,
		execute: lspRenameSymbol as AnyToolExecutor,
		category: "development",
		requiresPermission: true,
	},
	{
		name: "lsp_hover",
		description:
			"Get type information and documentation for a symbol using semantic grep (no LSP server required)",
		parameters: LSP_HOVER_SCHEMA,
		execute: lspHover as AnyToolExecutor,
		category: "development",
		requiresPermission: true,
		isReadonly: true,
	},
];
