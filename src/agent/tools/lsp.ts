import { z } from "zod";
import type {
	AnyToolExecutor,
	ToolContext,
	ToolDefinition,
	ToolResult,
} from "./registry.js";

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

const LSP_UNAVAILABLE_RESULT: ToolResult = {
	success: true,
	output: JSON.stringify({
		status: "lsp_not_available",
		message:
			"LSP server not running. Configure an LSP server in .tehuti.json (lsp.servers) or use semantic tools as a fallback.",
		fallback: "semantic",
	}),
};

async function lspFindReferences(
	_args: z.infer<typeof LSP_FIND_REFERENCES_SCHEMA>,
	_ctx: ToolContext,
): Promise<ToolResult> {
	return LSP_UNAVAILABLE_RESULT;
}

async function lspGoToDefinition(
	_args: z.infer<typeof LSP_GO_TO_DEFINITION_SCHEMA>,
	_ctx: ToolContext,
): Promise<ToolResult> {
	return LSP_UNAVAILABLE_RESULT;
}

async function lspRenameSymbol(
	_args: z.infer<typeof LSP_RENAME_SYMBOL_SCHEMA>,
	_ctx: ToolContext,
): Promise<ToolResult> {
	return LSP_UNAVAILABLE_RESULT;
}

async function lspHover(
	_args: z.infer<typeof LSP_HOVER_SCHEMA>,
	_ctx: ToolContext,
): Promise<ToolResult> {
	return LSP_UNAVAILABLE_RESULT;
}

export const lspTools: ToolDefinition[] = [
	{
		name: "lsp_find_references",
		description:
			"Find all references to a symbol across the project using LSP",
		parameters: LSP_FIND_REFERENCES_SCHEMA,
		execute: lspFindReferences as AnyToolExecutor,
		category: "development",
		requiresPermission: true,
		isReadonly: true,
	},
	{
		name: "lsp_go_to_definition",
		description:
			"Navigate to the definition of a symbol using LSP",
		parameters: LSP_GO_TO_DEFINITION_SCHEMA,
		execute: lspGoToDefinition as AnyToolExecutor,
		category: "development",
		requiresPermission: true,
		isReadonly: true,
	},
	{
		name: "lsp_rename_symbol",
		description:
			"Rename a symbol across all references using LSP",
		parameters: LSP_RENAME_SYMBOL_SCHEMA,
		execute: lspRenameSymbol as AnyToolExecutor,
		category: "development",
		requiresPermission: true,
	},
	{
		name: "lsp_hover",
		description:
			"Get type information and documentation for a symbol using LSP",
		parameters: LSP_HOVER_SCHEMA,
		execute: lspHover as AnyToolExecutor,
		category: "development",
		requiresPermission: true,
		isReadonly: true,
	},
];
