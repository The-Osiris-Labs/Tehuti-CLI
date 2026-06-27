import fs from "fs-extra";
import path from "node:path";
import { glob } from "tinyglobby";
import { z } from "zod";
import Parser from "tree-sitter";
import ts from "tree-sitter-typescript";
import type { ToolDefinition, ToolContext, ToolResult, AnyToolExecutor } from "./registry.js";

const REPO_MAP_SCHEMA = z.object({
	path: z.string().optional().describe("The directory to generate a map for (default: cwd)"),
	ignore: z.array(z.string()).optional().describe("Patterns to ignore"),
});

async function generateRepoMap(
	args: z.infer<typeof REPO_MAP_SCHEMA>,
	ctx: ToolContext,
): Promise<ToolResult> {
	const searchPath = args.path ? path.resolve(ctx.cwd, args.path) : ctx.cwd;
	
	try {
		const files = await glob(["**/*.{ts,tsx,js,jsx}"], {
			cwd: searchPath,
			ignore: args.ignore ?? ["node_modules/**", "dist/**", "build/**", ".git/**", "**/*.test.ts", "**/tests/**"],
			absolute: true,
		});

		const parser = new Parser();
		parser.setLanguage(ts.typescript);

		const map: Record<string, string[]> = {};
		
		for (const file of files) {
			const relPath = path.relative(ctx.cwd, file);
			try {
				const code = await fs.readFile(file, "utf-8");
				const tree = parser.parse(code);
				const definitions: string[] = [];

				const walk = (node: Parser.SyntaxNode) => {
					if (node.type === "export_statement") {
						const decl = node.child(1) || node.child(0);
						if (decl) {
							if (decl.type === "class_declaration" || decl.type === "interface_declaration" || decl.type === "function_declaration" || decl.type === "type_alias_declaration") {
								const nameNode = decl.children.find(c => c.type === "identifier" || c.type === "type_identifier");
								if (nameNode) {
									let typeStr = decl.type.replace("_declaration", "");
									if (typeStr === "type_alias") typeStr = "type";
									definitions.push(`export ${typeStr} ${nameNode.text}`);
								}
							} else if (decl.type === "lexical_declaration") {
								const varDecls = decl.children.filter(c => c.type === "variable_declarator");
								for (const vd of varDecls) {
									const nameNode = vd.children.find(c => c.type === "identifier");
									if (nameNode) {
										definitions.push(`export const ${nameNode.text}`);
									}
								}
							}
						}
					} else if (node.parent?.type !== "export_statement") {
						if (node.type === "class_declaration" || node.type === "interface_declaration") {
							const nameNode = node.children.find(c => c.type === "identifier" || c.type === "type_identifier");
							if (nameNode) {
								let typeStr = node.type.replace("_declaration", "");
								definitions.push(`${typeStr} ${nameNode.text}`);
							}
						} else if (node.type === "function_declaration") {
							const nameNode = node.children.find(c => c.type === "identifier");
							if (nameNode) {
								definitions.push(`function ${nameNode.text}`);
							}
						}
					}
					
					for (let i = 0; i < node.childCount; i++) {
						walk(node.child(i)!);
					}
				};

				walk(tree.rootNode);
				
				if (definitions.length > 0) {
					map[relPath] = definitions;
				}
			} catch (e) {
				// ignore parse errors
			}
		}

		let output = "";
		for (const [file, defs] of Object.entries(map)) {
			output += `\n${file}:\n`;
			for (const def of defs) {
				output += `  ${def}\n`;
			}
		}

		return {
			success: true,
			output: output.trim() || "No definitions found.",
		};
	} catch (error) {
		return {
			success: false,
			output: "",
			error: `Repo map generation failed: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

export const repoMapTool: ToolDefinition = {
	name: "repo_map",
	description: `- Generates a compressed repository map containing class definitions, exported functions, and interfaces using tree-sitter AST parsing.
- Use this tool to get a high-level overview of the codebase architecture.`,
	parameters: REPO_MAP_SCHEMA,
	execute: generateRepoMap as AnyToolExecutor,
	category: "search",
	requiresPermission: false,
	isReadonly: true,
};
