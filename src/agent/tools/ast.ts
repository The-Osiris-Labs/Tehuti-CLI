import path from "node:path";
import fs from "fs-extra";
import { z } from "zod";
import { resolvePath, validatePathSecurity } from "./fs.js";
import type { ToolContext, ToolDefinition, ToolResult } from "./registry.js";

// Lazy-loaded debug logger to match project style
const debug = {
	log: (ns: string, ...args: any[]) => {
		// Console/file debug logs if enabled in the harness
	},
};

export interface ASTNodeInfo {
	type: "class" | "interface" | "function" | "method" | "variable";
	name: string;
	start: { line: number; column: number };
	end: { line: number; column: number };
	modifiers: string[];
	parameters?: string[];
	returnType?: string;
	children?: ASTNodeInfo[];
}

let Parser: any;
let tsGrammar: any;
let jsGrammar: any;
let treeSitterInitialized = false;
let treeSitterInitFailed = false;

async function initTreeSitter() {
	if (treeSitterInitialized || treeSitterInitFailed) return;
	try {
		const parserMod = await import("tree-sitter");
		Parser = parserMod.default;

		const tsMod = await import("tree-sitter-typescript");
		tsGrammar = tsMod.default;

		const jsMod = await import("tree-sitter-javascript");
		jsGrammar = jsMod.default;

		treeSitterInitialized = true;
	} catch (err) {
		treeSitterInitFailed = true;
		debug.log(
			"ast",
			"Native tree-sitter bindings not available, using regex fallback:",
			err,
		);
	}
}

function getModifiers(node: any): string[] {
	if (!node) return [];
	const modifiers: string[] = [];

	for (let i = 0; i < node.childCount; i++) {
		const child = node.child(i);
		const t = child.type;
		if (
			t === "public" ||
			t === "private" ||
			t === "protected" ||
			t === "readonly" ||
			t === "static" ||
			t === "async" ||
			t === "abstract" ||
			t === "export" ||
			t === "declare"
		) {
			modifiers.push(child.text);
		} else if (t === "accessibility_modifier") {
			modifiers.push(child.text);
		}
	}

	if (
		node.parent &&
		(node.parent.type === "export_statement" ||
			node.parent.type === "export_declaration")
	) {
		modifiers.push("export");
		if (node.parent.text.includes("default")) {
			modifiers.push("default");
		}
	}

	return Array.from(new Set(modifiers));
}

function getParameters(node: any): string[] {
	const paramsNode =
		node.childForFieldName("parameters") ||
		node.children.find(
			(c: any) => c.type === "formal_parameters" || c.type === "parameter_list",
		);
	if (!paramsNode) {
		const nameNode = node.childForFieldName("parameter");
		if (nameNode) {
			return [nameNode.text];
		}
		return [];
	}
	const params: string[] = [];
	for (let i = 0; i < paramsNode.childCount; i++) {
		const child = paramsNode.child(i);
		if (child.type !== "(" && child.type !== ")" && child.type !== ",") {
			params.push(child.text.trim());
		}
	}
	return params;
}

function getReturnType(node: any): string | undefined {
	const typeNode =
		node.childForFieldName("return_type") ||
		node.children.find((c: any) => c.type === "type_annotation");
	if (typeNode) {
		return typeNode.text.replace(/^:\s*/, "").trim();
	}
	return undefined;
}

function walk(node: any): ASTNodeInfo[] {
	const results: ASTNodeInfo[] = [];
	let item: ASTNodeInfo | null = null;

	if (
		node.type === "class_declaration" ||
		(node.type === "class" && node.text !== "class")
	) {
		const nameNode =
			node.childForFieldName("name") ||
			node.children.find((c: any) => c.type === "identifier");
		const name = nameNode ? nameNode.text : "AnonymousClass";
		const modifiers = getModifiers(node);

		item = {
			type: "class",
			name,
			start: {
				line: node.startPosition.row + 1,
				column: node.startPosition.column,
			},
			end: { line: node.endPosition.row + 1, column: node.endPosition.column },
			modifiers,
			children: [],
		};
	} else if (node.type === "interface_declaration") {
		const nameNode =
			node.childForFieldName("name") ||
			node.children.find(
				(c: any) => c.type === "type_identifier" || c.type === "identifier",
			);
		const name = nameNode ? nameNode.text : "AnonymousInterface";
		const modifiers = getModifiers(node);

		item = {
			type: "interface",
			name,
			start: {
				line: node.startPosition.row + 1,
				column: node.startPosition.column,
			},
			end: { line: node.endPosition.row + 1, column: node.endPosition.column },
			modifiers,
			children: [],
		};
	} else if (
		node.type === "function_declaration" ||
		node.type === "generator_function_declaration" ||
		(node.type === "function" && node.text !== "function")
	) {
		const nameNode =
			node.childForFieldName("name") ||
			node.children.find((c: any) => c.type === "identifier");
		const name = nameNode ? nameNode.text : "AnonymousFunction";
		const modifiers = getModifiers(node);
		const params = getParameters(node);
		const returnType = getReturnType(node);

		item = {
			type: "function",
			name,
			start: {
				line: node.startPosition.row + 1,
				column: node.startPosition.column,
			},
			end: { line: node.endPosition.row + 1, column: node.endPosition.column },
			modifiers,
			parameters: params,
			returnType,
			children: [],
		};
	} else if (node.type === "method_definition") {
		const nameNode =
			node.childForFieldName("name") ||
			node.children.find(
				(c: any) =>
					c.type === "property_identifier" ||
					c.type === "identifier" ||
					c.type === "private_property_identifier",
			);
		const name = nameNode ? nameNode.text : "AnonymousMethod";
		const modifiers = getModifiers(node);
		const params = getParameters(node);
		const returnType = getReturnType(node);

		item = {
			type: "method",
			name,
			start: {
				line: node.startPosition.row + 1,
				column: node.startPosition.column,
			},
			end: { line: node.endPosition.row + 1, column: node.endPosition.column },
			modifiers,
			parameters: params,
			returnType,
			children: [],
		};
	} else if (
		node.type === "public_field_definition" ||
		node.type === "property_definition" ||
		node.type === "field_definition"
	) {
		const nameNode =
			node.childForFieldName("name") ||
			node.children.find(
				(c: any) => c.type === "property_identifier" || c.type === "identifier",
			);
		const name = nameNode ? nameNode.text : "AnonymousProperty";
		const modifiers = getModifiers(node);

		item = {
			type: "variable",
			name,
			start: {
				line: node.startPosition.row + 1,
				column: node.startPosition.column,
			},
			end: { line: node.endPosition.row + 1, column: node.endPosition.column },
			modifiers,
			children: [],
		};
	} else if (node.type === "variable_declarator") {
		const nameNode =
			node.childForFieldName("name") ||
			node.children.find(
				(c: any) =>
					c.type === "identifier" ||
					c.type === "object_pattern" ||
					c.type === "array_pattern",
			);
		const name = nameNode ? nameNode.text : "AnonymousVariable";
		const valueNode = node.childForFieldName("value");
		const isFunc =
			valueNode &&
			(valueNode.type === "arrow_function" ||
				valueNode.type === "function_expression");
		const parentModifiers = getModifiers(node.parent);

		if (isFunc) {
			const modifiers = [...parentModifiers];
			if (
				valueNode.type === "arrow_function" &&
				valueNode.text.includes("async")
			) {
				modifiers.push("async");
			}
			const params = getParameters(valueNode);
			const returnType = getReturnType(valueNode);

			item = {
				type: "function",
				name,
				start: {
					line: node.startPosition.row + 1,
					column: node.startPosition.column,
				},
				end: {
					line: node.endPosition.row + 1,
					column: node.endPosition.column,
				},
				modifiers,
				parameters: params,
				returnType,
				children: [],
			};
		} else {
			item = {
				type: "variable",
				name,
				start: {
					line: node.startPosition.row + 1,
					column: node.startPosition.column,
				},
				end: {
					line: node.endPosition.row + 1,
					column: node.endPosition.column,
				},
				modifiers: parentModifiers,
				children: [],
			};
		}
	}

	if (item) {
		for (let i = 0; i < node.childCount; i++) {
			const child = node.child(i);
			const childResults = walk(child);
			if (item.children) {
				item.children.push(...childResults);
			}
		}
		results.push(item);
	} else {
		for (let i = 0; i < node.childCount; i++) {
			const child = node.child(i);
			results.push(...walk(child));
		}
	}

	return results;
}

export function parseRegexFallback(
	content: string,
	filePath: string,
): ASTNodeInfo[] {
	const ext = path.extname(filePath).toLowerCase();
	const lines = content.split(/\r?\n/);
	const results: ASTNodeInfo[] = [];

	if (ext === ".py") {
		interface StackItem {
			indent: number;
			node: ASTNodeInfo;
		}
		const stack: StackItem[] = [];

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (!line.trim() || line.trim().startsWith("#")) {
				continue;
			}

			const indent = line.search(/\S/);
			if (indent === -1) continue;

			while (stack.length > 0 && indent <= stack[stack.length - 1].indent) {
				const popped = stack.pop();
				if (popped) {
					popped.node.end = { line: i, column: lines[i - 1]?.length || 0 };
				}
			}

			const classMatch = line.match(/^\s*class\s+([a-zA-Z_][a-zA-Z0-9_]*)/);
			const defMatch = line.match(
				/^\s*(async\s+)?def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([^)]*)\)\s*(->\s*([^:]+))?:/,
			);
			const varMatch = line.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*=[^=]/);

			if (classMatch) {
				const name = classMatch[1];
				const node: ASTNodeInfo = {
					type: "class",
					name,
					start: { line: i + 1, column: indent },
					end: { line: i + 1, column: line.length },
					modifiers: [],
					children: [],
				};
				if (stack.length > 0) {
					stack[stack.length - 1].node.children?.push(node);
				} else {
					results.push(node);
				}
				stack.push({ indent, node });
			} else if (defMatch) {
				const isAsync = !!defMatch[1];
				const name = defMatch[2];
				const paramsStr = defMatch[3];
				const retType = defMatch[5]?.trim();
				const isMethod =
					stack.length > 0 && stack[stack.length - 1].node.type === "class";

				const node: ASTNodeInfo = {
					type: isMethod ? "method" : "function",
					name,
					start: { line: i + 1, column: indent },
					end: { line: i + 1, column: line.length },
					modifiers: isAsync ? ["async"] : [],
					parameters: paramsStr
						? paramsStr
								.split(",")
								.map((p) => p.trim())
								.filter(Boolean)
						: [],
					returnType: retType,
					children: [],
				};
				if (stack.length > 0) {
					stack[stack.length - 1].node.children?.push(node);
				} else {
					results.push(node);
				}
				stack.push({ indent, node });
			} else if (varMatch) {
				const name = varMatch[1];
				const node: ASTNodeInfo = {
					type: "variable",
					name,
					start: { line: i + 1, column: indent },
					end: { line: i + 1, column: line.length },
					modifiers: [],
					children: [],
				};
				if (stack.length > 0) {
					stack[stack.length - 1].node.children?.push(node);
				} else {
					results.push(node);
				}
			}
		}

		while (stack.length > 0) {
			const popped = stack.pop();
			if (popped) {
				popped.node.end = {
					line: lines.length,
					column: lines[lines.length - 1]?.length || 0,
				};
			}
		}
	} else {
		interface StackItem {
			braceLevel: number;
			node: ASTNodeInfo;
		}
		const stack: StackItem[] = [];
		let currentBraceLevel = 0;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const trimmed = line.trim();
			if (
				!trimmed ||
				trimmed.startsWith("//") ||
				trimmed.startsWith("/*") ||
				trimmed.startsWith("*")
			) {
				continue;
			}

			const classMatch = line.match(
				/(?:export\s+)?(?:default\s+)?(?:class|interface|struct|impl|trait|enum|union)\s+([a-zA-Z_][a-zA-Z0-9_]*)/,
			);
			const funcMatch = line.match(
				/(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|fn)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([^)]*)\)\s*(->\s*([^{]+)|:\s*([^{]+))?/,
			);
			const arrowMatch = line.match(
				/(?:export\s+)?(?:const|let|var)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(async\s*)?\(([^)]*)\)\s*(:\s*([^{=]+))?\s*=>/,
			);
			const varMatch = line.match(
				/(?:export\s+)?(?:const|let|var|pub\s+mut|pub)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=/,
			);

			const opens = (line.match(/\{/g) || []).length;
			const closes = (line.match(/\}/g) || []).length;

			const startIndent = line.search(/\S/);

			if (classMatch) {
				const name = classMatch[1];
				const modifiers: string[] = [];
				if (line.includes("export")) modifiers.push("export");
				if (line.includes("default")) modifiers.push("default");
				if (line.includes("abstract")) modifiers.push("abstract");

				const node: ASTNodeInfo = {
					type:
						line.includes("interface") || line.includes("trait")
							? "interface"
							: "class",
					name,
					start: { line: i + 1, column: startIndent },
					end: { line: i + 1, column: line.length },
					modifiers,
					children: [],
				};

				if (stack.length > 0) {
					stack[stack.length - 1].node.children?.push(node);
				} else {
					results.push(node);
				}
				stack.push({ braceLevel: currentBraceLevel, node });
			} else if (funcMatch) {
				const name = funcMatch[1];
				const paramsStr = funcMatch[2];
				const retType = (funcMatch[4] || funcMatch[5])?.trim();
				const isAsync = line.includes("async");
				const modifiers: string[] = [];
				if (line.includes("export")) modifiers.push("export");
				if (line.includes("default")) modifiers.push("default");
				if (isAsync) modifiers.push("async");

				const isMethod =
					stack.length > 0 && stack[stack.length - 1].node.type === "class";

				const node: ASTNodeInfo = {
					type: isMethod ? "method" : "function",
					name,
					start: { line: i + 1, column: startIndent },
					end: { line: i + 1, column: line.length },
					modifiers,
					parameters: paramsStr
						? paramsStr
								.split(",")
								.map((p) => p.trim())
								.filter(Boolean)
						: [],
					returnType: retType,
					children: [],
				};

				if (stack.length > 0) {
					stack[stack.length - 1].node.children?.push(node);
				} else {
					results.push(node);
				}
				if (line.includes("{")) {
					stack.push({ braceLevel: currentBraceLevel, node });
				}
			} else if (arrowMatch) {
				const name = arrowMatch[1];
				const isAsync = !!arrowMatch[2];
				const paramsStr = arrowMatch[3];
				const retType = arrowMatch[5]?.trim();
				const modifiers: string[] = [];
				if (line.includes("export")) modifiers.push("export");
				if (isAsync) modifiers.push("async");

				const node: ASTNodeInfo = {
					type: "function",
					name,
					start: { line: i + 1, column: startIndent },
					end: { line: i + 1, column: line.length },
					modifiers,
					parameters: paramsStr
						? paramsStr
								.split(",")
								.map((p) => p.trim())
								.filter(Boolean)
						: [],
					returnType: retType,
					children: [],
				};

				if (stack.length > 0) {
					stack[stack.length - 1].node.children?.push(node);
				} else {
					results.push(node);
				}
				if (line.includes("{")) {
					stack.push({ braceLevel: currentBraceLevel, node });
				}
			} else if (varMatch) {
				if (!line.includes("=>")) {
					const name = varMatch[1];
					const modifiers: string[] = [];
					if (line.includes("export")) modifiers.push("export");
					const node: ASTNodeInfo = {
						type: "variable",
						name,
						start: { line: i + 1, column: startIndent },
						end: { line: i + 1, column: line.length },
						modifiers,
						children: [],
					};

					if (stack.length > 0) {
						stack[stack.length - 1].node.children?.push(node);
					} else {
						results.push(node);
					}
				}
			}

			currentBraceLevel += opens;
			currentBraceLevel -= closes;

			while (
				stack.length > 0 &&
				currentBraceLevel <= stack[stack.length - 1].braceLevel
			) {
				const popped = stack.pop();
				if (popped) {
					popped.node.end = { line: i + 1, column: line.length };
				}
			}
		}

		while (stack.length > 0) {
			const popped = stack.pop();
			if (popped) {
				popped.node.end = {
					line: lines.length,
					column: lines[lines.length - 1]?.length || 0,
				};
			}
		}
	}

	return results;
}

function countNodes(nodes: ASTNodeInfo[]): number {
	let count = nodes.length;
	for (const node of nodes) {
		if (node.children) {
			count += countNodes(node.children);
		}
	}
	return count;
}

const AST_PARSER_SCHEMA = z.object({
	file_path: z.string().describe("Path to the file to parse"),
});

export async function parseAST(
	args: { file_path: string },
	ctx: ToolContext,
): Promise<ToolResult> {
	try {
		const resolvedPath = resolvePath(args.file_path, ctx.cwd);
		const security = validatePathSecurity(resolvedPath, ctx.cwd);
		if (!security.safe) {
			return {
				success: false,
				output: "",
				error: security.reason || "Security restriction: path is invalid.",
			};
		}

		if (!(await fs.pathExists(resolvedPath))) {
			return {
				success: false,
				output: "",
				error: `File not found: ${args.file_path}`,
			};
		}

		const stat = await fs.stat(resolvedPath);
		if (!stat.isFile()) {
			return {
				success: false,
				output: "",
				error: `Path is not a file: ${args.file_path}`,
			};
		}

		const content = await fs.readFile(resolvedPath, "utf8");
		const ext = path.extname(resolvedPath).toLowerCase();

		await initTreeSitter();

		let astData: ASTNodeInfo[] = [];
		let parsedWithTreeSitter = false;

		if (
			treeSitterInitialized &&
			(ext === ".ts" || ext === ".tsx" || ext === ".js" || ext === ".jsx")
		) {
			try {
				const parser = new Parser();
				if (ext === ".ts") {
					parser.setLanguage(tsGrammar.typescript);
				} else if (ext === ".tsx") {
					parser.setLanguage(tsGrammar.tsx);
				} else {
					parser.setLanguage(jsGrammar);
				}

				const tree = parser.parse(content);
				astData = walk(tree.rootNode);
				parsedWithTreeSitter = true;
			} catch (err) {
				// Fallback to regex silently/log
			}
		}

		if (!parsedWithTreeSitter) {
			astData = parseRegexFallback(content, resolvedPath);
		}

		return {
			success: true,
			output: JSON.stringify(astData, null, 2),
			metadata: {
				parsedWithTreeSitter,
				nodeCount: countNodes(astData),
			},
		};
	} catch (error) {
		return {
			success: false,
			output: "",
			error: `AST parse failed: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

export const astTool: ToolDefinition = {
	name: "parse_ast",
	description:
		"Parse TypeScript, JavaScript, Python, or Rust source files and extract nested structures (classes, interfaces, functions, methods, variables).",
	parameters: AST_PARSER_SCHEMA,
	execute: parseAST as any,
	category: "development",
	requiresPermission: false,
	isReadonly: true,
};
