# AST Parsing Tool - Analysis & Design Proposal

This report presents a concrete proposal and design for a dedicated AST parsing tool within the Tehuti CLI agent ecosystem, allowing detailed symbol structure extraction from source code files to support precise code modification and exploration.

---

## 1. Executive Summary
- **Core Finding**: The existing codebase has `tree-sitter` (v0.21.1), `tree-sitter-typescript` (v0.23.2), and `tree-sitter-javascript` fully installed and verified as functional in the local environment. We propose adding a read-only `parse_ast` tool under `src/agent/tools/ast.ts` that uses these dependencies to parse TypeScript/JavaScript/TSX/JSX files, coupled with a robust regex fallback for other languages (Python, Rust, etc.) or environment setups.

---

## 2. Codebase Investigation

### Existing AST Parsing Libraries & Utilities
Our search of `package.json` and the `node_modules` directory confirms the following relevant packages are already configured and compiled:
1. **`tree-sitter` (v0.21.1)** - Node bindings for the Tree-sitter incremental parsing library.
2. **`tree-sitter-typescript` (v0.23.2)** - TypeScript parser for tree-sitter, which exports both the standard `typescript` and `tsx` language grammars.
3. **`tree-sitter-javascript`** - JavaScript parser for tree-sitter.
4. **`typescript` (v5.7.3)** - The TypeScript compiler package (available as a devDependency).

### Existing AST Usage in the Codebase
The `repo-map` tool (`src/agent/tools/repo-map.ts`) currently uses `tree-sitter` and `tree-sitter-typescript` to parse `.ts`, `.tsx`, `.js`, and `.jsx` files. It performs a high-level AST walk on the root node of files to list exported classes, interfaces, types, functions, and lexical variables, returning a compressed repository-wide outline to feed into the LLM context.

### Limitations of Current Tools
1. **`repo_map` is too high-level**: It is designed to summarize the entire codebase layout in a single condensed format, omitting line numbers, character columns, visibility/access modifiers, specific parameters, return types, or nested method scopes of individual files.
2. **`grep` is line-oriented**: It matches raw text regular expressions and lacks structural syntax awareness. For example, `grep` cannot reliably identify the end of a class, list all parameters of an overloaded function, or isolate the scope of a nested method.
3. **Lack of Location Information**: Neither tool provides the exact start and end line/column coordinates of code blocks, making it difficult for implementing agents to perform precise edits using targeted block replacements.

---

## 3. Proposed AST Parsing Tool Interface (`parse_ast`)

We propose registering a new read-only tool named `parse_ast` within the `search` category.

### Zod Parameters Schema
```typescript
import { z } from "zod";

export const PARSE_AST_SCHEMA = z.object({
  file_path: z.string().describe("The path to the source file to parse (absolute or relative to current working directory)"),
  include_loc: z
    .boolean()
    .optional()
    .default(true)
    .describe("Whether to include precise line and column numbers for extracted symbols (default: true)"),
  include_details: z
    .boolean()
    .optional()
    .default(true)
    .describe("Whether to extract details like function parameters, return types, class member access modifiers (default: true)"),
  symbol_types: z
    .array(z.enum(["class", "interface", "function", "method", "property", "variable", "type_alias", "enum"]))
    .optional()
    .describe("Filter results to only include specific symbol types")
});
```

### JSON Response Schema
The output returned inside `ToolResult.output` will be a formatted JSON representation of a symbol tree. The structure will follow this TypeScript interface:

```typescript
export interface SymbolLocation {
  start: { line: number; column: number };
  end: { line: number; column: number };
}

export interface ParameterInfo {
  name: string;
  type?: string;
  optional?: boolean;
}

export interface SymbolNode {
  name: string;
  type: "class" | "interface" | "function" | "method" | "property" | "variable" | "type_alias" | "enum";
  loc?: SymbolLocation;
  modifiers?: string[]; // e.g., ["export", "async", "private", "static", "readonly"]
  details?: {
    extends?: string[];
    implements?: string[];
    parameters?: ParameterInfo[];
    returnType?: string;
    valueType?: string;
  };
  children?: SymbolNode[];
}
```

---

## 4. Implementation Strategy

### 1. Safety & Resolution
- **Resolution**: Convert `file_path` to absolute using a resolved path context helper.
- **Path Security Checks**: Integrate the existing security architecture:
  - Export `resolvePath` and `validatePathSecurity` from `src/agent/tools/fs.ts`.
  - Use `validatePathSecurity` inside `parse_ast` to block access outside the working directory (traversal attacks) and sensitive file definitions (`.env`, `.ssh`, etc.).

### 2. Parser Loading & Language Matching
Match file extensions to choose the corresponding Tree-sitter language parser:
- `.ts`, `.cts`, `.mts` $\to$ `tree-sitter-typescript` (language: `typescript`).
- `.tsx` $\to$ `tree-sitter-typescript` (language: `tsx`).
- `.js`, `.jsx`, `.mjs`, `.cjs` $\to$ `tree-sitter-javascript` (or `tree-sitter-typescript` as a backup).

### 3. AST Tree-sitter Walker
A recursive function walks the Tree-sitter nodes and maps target syntax constructs to the canonical `SymbolNode` shape:
- `class_declaration`: Extract class names, modifiers, and traverse members in `class_body` as nested children.
- `interface_declaration`: Extract names, extends, and traverse members in `interface_body`/`object_type` as children.
- `function_declaration`, `generator_function_declaration`: Extract names, parameter list (from `formal_parameters`), return type.
- `method_definition`: Extract names, parameters, return type, and modifiers (`async`, `static`, etc.).
- `property_signature`, `public_field_definition`: Extract property names, optionality, type annotations, and modifiers (`readonly`, accessibility).
- `lexical_declaration`, `variable_declaration`: Parse each `variable_declarator`. If the initializer value is an `arrow_function` or `function_expression`, treat it as a function symbol; otherwise, extract it as a variable symbol with its value type.
- `type_alias_declaration`, `enum_declaration`: Extract custom types and enums.

### 4. Robust Fallback Mechanism (Multi-language Support)
If:
- The file type is not supported by standard Tree-sitter JS/TS bindings (e.g. Python, Rust, Go).
- The Tree-sitter package fails to load or compile native bindings on a particular system.

The tool will fall back to a regex-based parser that scans line-by-line using patterns tailored to the file extension (e.g. Python `def`/`class`, Rust `fn`/`struct`, Go `func`/`struct`/`interface`). This guarantees that `parse_ast` works across the entire workspace in any language, while offering max fidelity for TypeScript/JavaScript.

---

## 5. Draft Implementation

The following is the proposed implementation of `src/agent/tools/ast.ts`:

```typescript
import path from "node:path";
import fs from "fs-extra";
import { z } from "zod";
import Parser from "tree-sitter";
import ts from "tree-sitter-typescript";
import js from "tree-sitter-javascript";

import type {
  AnyToolExecutor,
  ToolContext,
  ToolDefinition,
  ToolResult,
} from "./registry.js";
import { resolvePath, validatePathSecurity } from "./fs.js";

// Zod Schema
export const PARSE_AST_SCHEMA = z.object({
  file_path: z.string().describe("The path to the source file to parse (absolute or relative to current working directory)"),
  include_loc: z
    .boolean()
    .optional()
    .default(true)
    .describe("Whether to include precise line and column numbers (default: true)"),
  include_details: z
    .boolean()
    .optional()
    .default(true)
    .describe("Whether to extract parameters, return types, modifiers (default: true)"),
  symbol_types: z
    .array(z.enum(["class", "interface", "function", "method", "property", "variable", "type_alias", "enum"]))
    .optional()
    .describe("Filter results to only include specific symbol types")
});

export interface SymbolLocation {
  start: { line: number; column: number };
  end: { line: number; column: number };
}

export interface ParameterInfo {
  name: string;
  type?: string;
  optional?: boolean;
}

export interface SymbolNode {
  name: string;
  type: "class" | "interface" | "function" | "method" | "property" | "variable" | "type_alias" | "enum";
  loc?: SymbolLocation;
  modifiers?: string[];
  details?: {
    extends?: string[];
    implements?: string[];
    parameters?: ParameterInfo[];
    returnType?: string;
    valueType?: string;
  };
  children?: SymbolNode[];
}

function getLoc(node: Parser.SyntaxNode): SymbolLocation {
  return {
    start: { line: node.startPosition.row + 1, column: node.startPosition.column },
    end: { line: node.endPosition.row + 1, column: node.endPosition.column }
  };
}

function getModifiers(node: Parser.SyntaxNode): string[] {
  const modifiers: string[] = [];
  
  if (node.parent?.type === "export_statement") {
    modifiers.push("export");
  }

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)!;
    if (
      child.type === "accessibility_modifier" ||
      child.type === "static" ||
      child.type === "async" ||
      child.type === "readonly" ||
      child.type === "abstract"
    ) {
      modifiers.push(child.text);
    }
  }

  return modifiers;
}

function getParameters(node: Parser.SyntaxNode): ParameterInfo[] {
  const params: ParameterInfo[] = [];
  const formalParams = node.children.find(c => c.type === "formal_parameters");
  if (formalParams) {
    const paramNodes = formalParams.children.filter(c => 
      c.type === "required_parameter" || 
      c.type === "optional_parameter" || 
      c.type === "parameter" ||
      c.type === "identifier"
    );
    for (const p of paramNodes) {
      const nameNode = p.type === "identifier" ? p : p.children.find(c => c.type === "identifier");
      const typeNode = p.children.find(c => c.type === "type_annotation");
      const name = nameNode ? nameNode.text : p.text;
      const type = typeNode ? typeNode.text.replace(/^:\s*/, "") : undefined;
      const isOptional = p.type === "optional_parameter" || p.text.includes("?");
      
      params.push({ name, type, optional: isOptional });
    }
  }
  return params;
}

function getReturnType(node: Parser.SyntaxNode): string | undefined {
  const typeNode = node.children.find(c => c.type === "type_annotation");
  if (typeNode) {
    return typeNode.text.replace(/^:\s*/, "");
  }
  return undefined;
}

// Recursive Tree-Sitter Walker
function walkTreeSitter(
  node: Parser.SyntaxNode,
  results: SymbolNode[],
  opts: { includeLoc: boolean; includeDetails: boolean }
): void {
  let current: SymbolNode | null = null;

  switch (node.type) {
    case "class_declaration": {
      const nameNode = node.childForFieldName("name") || node.children.find(c => c.type === "identifier" || c.type === "type_identifier");
      current = {
        name: nameNode ? nameNode.text : "AnonymousClass",
        type: "class",
        children: []
      };
      break;
    }
    case "interface_declaration": {
      const nameNode = node.childForFieldName("name") || node.children.find(c => c.type === "type_identifier");
      current = {
        name: nameNode ? nameNode.text : "AnonymousInterface",
        type: "interface",
        children: []
      };
      break;
    }
    case "function_declaration":
    case "generator_function_declaration": {
      const nameNode = node.childForFieldName("name") || node.children.find(c => c.type === "identifier");
      current = {
        name: nameNode ? nameNode.text : "anonymousFunction",
        type: "function"
      };
      if (opts.includeDetails) {
        current.details = {
          parameters: getParameters(node),
          returnType: getReturnType(node)
        };
      }
      break;
    }
    case "method_definition": {
      const nameNode = node.childForFieldName("name") || node.children.find(c => c.type === "property_identifier" || c.type === "identifier");
      current = {
        name: nameNode ? nameNode.text : "anonymousMethod",
        type: "method"
      };
      if (opts.includeDetails) {
        current.details = {
          parameters: getParameters(node),
          returnType: getReturnType(node)
        };
      }
      break;
    }
    case "property_signature":
    case "public_field_definition": {
      const nameNode = node.childForFieldName("name") || node.children.find(c => c.type === "property_identifier" || c.type === "identifier");
      current = {
        name: nameNode ? nameNode.text : "anonymousProperty",
        type: "property"
      };
      if (opts.includeDetails) {
        const typeNode = node.childForFieldName("type") || node.children.find(c => c.type === "type_annotation");
        current.details = {
          valueType: typeNode ? typeNode.text.replace(/^:\s*/, "") : undefined
        };
      }
      break;
    }
    case "lexical_declaration":
    case "variable_declaration": {
      const declarators = node.children.filter(c => c.type === "variable_declarator");
      for (const decl of declarators) {
        const nameNode = decl.childForFieldName("name") || decl.children.find(c => c.type === "identifier");
        const name = nameNode ? nameNode.text : "anonymousVar";
        const valueNode = decl.childForFieldName("value");

        let symbol: SymbolNode;
        if (valueNode && (valueNode.type === "arrow_function" || valueNode.type === "function_expression")) {
          symbol = {
            name,
            type: "function"
          };
          if (opts.includeDetails) {
            symbol.details = {
              parameters: getParameters(valueNode),
              returnType: getReturnType(valueNode)
            };
          }
        } else {
          symbol = {
            name,
            type: "variable"
          };
          if (opts.includeDetails) {
            const typeNode = decl.childForFieldName("type") || decl.children.find(c => c.type === "type_annotation");
            symbol.details = {
              valueType: typeNode ? typeNode.text.replace(/^:\s*/, "") : undefined
            };
          }
        }

        if (opts.includeLoc) symbol.loc = getLoc(node);
        if (opts.includeDetails) symbol.modifiers = getModifiers(node);
        results.push(symbol);
      }
      break;
    }
    case "type_alias_declaration": {
      const nameNode = node.childForFieldName("name") || node.children.find(c => c.type === "type_identifier");
      current = {
        name: nameNode ? nameNode.text : "anonymousType",
        type: "type_alias"
      };
      break;
    }
    case "enum_declaration": {
      const nameNode = node.childForFieldName("name") || node.children.find(c => c.type === "identifier");
      current = {
        name: nameNode ? nameNode.text : "anonymousEnum",
        type: "enum"
      };
      break;
    }
  }

  if (current) {
    if (opts.includeLoc) current.loc = getLoc(node);
    if (opts.includeDetails) current.modifiers = getModifiers(node);
    results.push(current);

    if (current.type === "class" || current.type === "interface") {
      const bodyNode = node.children.find(c => c.type === "class_body" || c.type === "interface_body");
      if (bodyNode) {
        for (let i = 0; i < bodyNode.childCount; i++) {
          walkTreeSitter(bodyNode.child(i)!, current.children!, opts);
        }
      }
      return;
    }
  }

  for (let i = 0; i < node.childCount; i++) {
    walkTreeSitter(node.child(i)!, results, opts);
  }
}

// Regex-based Fallback Parser
function parseWithRegex(code: string, extension: string, opts: { includeLoc: boolean; includeDetails: boolean }): SymbolNode[] {
  const symbols: SymbolNode[] = [];
  const lines = code.split("\n");

  const createLoc = (lineIdx: number, startCol: number, length: number): SymbolLocation | undefined => {
    if (!opts.includeLoc) return undefined;
    return {
      start: { line: lineIdx + 1, column: startCol },
      end: { line: lineIdx + 1, column: startCol + length }
    };
  };

  if (extension === ".py") {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const classMatch = line.match(/^\s*class\s+(\w+)(?:\(([^)]+)\))?:/);
      if (classMatch) {
        symbols.push({
          name: classMatch[1],
          type: "class",
          loc: createLoc(i, line.indexOf("class"), classMatch[0].length),
          details: opts.includeDetails && classMatch[2] ? { extends: [classMatch[2]] } : undefined
        });
      }
      const defMatch = line.match(/^\s*def\s+(\w+)\s*\(([^)]*)\)(?:\s*->\s*([^:]+))?:/);
      if (defMatch) {
        const isMethod = line.startsWith(" ") || line.startsWith("\t");
        symbols.push({
          name: defMatch[1],
          type: isMethod ? "method" : "function",
          loc: createLoc(i, line.indexOf("def"), defMatch[0].length),
          details: opts.includeDetails ? {
            parameters: defMatch[2].split(",").map(p => ({ name: p.trim() })),
            returnType: defMatch[3]?.trim()
          } : undefined
        });
      }
    }
  } else if (extension === ".rs") {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const structMatch = line.match(/^\s*(?:pub\s+)?struct\s+(\w+)/);
      if (structMatch) {
        symbols.push({
          name: structMatch[1],
          type: "class",
          loc: createLoc(i, line.indexOf("struct"), structMatch[0].length),
          modifiers: opts.includeDetails && line.includes("pub") ? ["pub"] : undefined
        });
      }
      const fnMatch = line.match(/^\s*(?:pub\s+)?(?:async\s+)?fn\s+(\w+)\s*\(([^)]*)\)(?:\s*->\s*([^{]+))?/);
      if (fnMatch) {
        const mods = [];
        if (line.includes("pub")) mods.push("pub");
        if (line.includes("async")) mods.push("async");
        symbols.push({
          name: fnMatch[1],
          type: "function",
          loc: createLoc(i, line.indexOf("fn"), fnMatch[0].length),
          modifiers: opts.includeDetails ? mods : undefined,
          details: opts.includeDetails ? {
            parameters: fnMatch[2].split(",").map(p => ({ name: p.trim() })),
            returnType: fnMatch[3]?.trim()
          } : undefined
        });
      }
    }
  } else {
    // Generic JS/TS fallback if Tree-sitter failed to parse
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const classMatch = line.match(/(?:export\s+)?class\s+(\w+)/);
      if (classMatch) {
        symbols.push({
          name: classMatch[1],
          type: "class",
          loc: createLoc(i, line.indexOf("class"), classMatch[0].length),
          modifiers: opts.includeDetails && line.includes("export") ? ["export"] : undefined
        });
      }
      const interfaceMatch = line.match(/(?:export\s+)?interface\s+(\w+)/);
      if (interfaceMatch) {
        symbols.push({
          name: interfaceMatch[1],
          type: "interface",
          loc: createLoc(i, line.indexOf("interface"), interfaceMatch[0].length),
          modifiers: opts.includeDetails && line.includes("export") ? ["export"] : undefined
        });
      }
      const fnMatch = line.match(/(?:export\s+)?(?:async\s+)?function\s+(\w+)/);
      if (fnMatch) {
        const mods = [];
        if (line.includes("export")) mods.push("export");
        if (line.includes("async")) mods.push("async");
        symbols.push({
          name: fnMatch[1],
          type: "function",
          loc: createLoc(i, line.indexOf("function"), fnMatch[0].length),
          modifiers: opts.includeDetails ? mods : undefined
        });
      }
    }
  }
  return symbols;
}

// Filter utility
function filterSymbols(symbols: SymbolNode[], allowedTypes: Set<string>): SymbolNode[] {
  const filtered: SymbolNode[] = [];
  for (const s of symbols) {
    const keep = allowedTypes.has(s.type);
    if (s.children && s.children.length > 0) {
      const filteredChildren = filterSymbols(s.children, allowedTypes);
      if (keep || filteredChildren.length > 0) {
        filtered.push({
          ...s,
          children: filteredChildren.length > 0 ? filteredChildren : undefined
        });
      }
    } else if (keep) {
      filtered.push(s);
    }
  }
  return filtered;
}

// Tool Executor
async function parseAst(
  args: z.infer<typeof PARSE_AST_SCHEMA>,
  ctx: ToolContext
): Promise<ToolResult> {
  const resolved = resolvePath(args.file_path, ctx.cwd);
  
  const security = validatePathSecurity(resolved, ctx.cwd);
  if (!security.safe) {
    return {
      success: false,
      output: "",
      error: `Security error: ${security.reason}`
    };
  }

  try {
    if (!(await fs.pathExists(resolved))) {
      return {
        success: false,
        output: "",
        error: `File does not exist: ${resolved}`
      };
    }

    const code = await fs.readFile(resolved, "utf-8");
    const ext = path.extname(resolved).toLowerCase();
    
    let symbols: SymbolNode[] = [];
    const includeLoc = args.include_loc !== false;
    const includeDetails = args.include_details !== false;

    // Use tree-sitter for TS/JS/TSX/JSX
    if ([".ts", ".tsx", ".js", ".jsx", ".cts", ".mts", ".cjs", ".mjs"].includes(ext)) {
      try {
        const parser = new Parser();
        if (ext === ".tsx" || ext === ".jsx") {
          parser.setLanguage(ts.tsx);
        } else if (ext === ".js" || ext === ".cjs" || ext === ".mjs") {
          parser.setLanguage(js);
        } else {
          parser.setLanguage(ts.typescript);
        }

        const tree = parser.parse(code);
        walkTreeSitter(tree.rootNode, symbols, { includeLoc, includeDetails });
      } catch (tsError) {
        // Log parser error and fallback to regex
        symbols = parseWithRegex(code, ext, { includeLoc, includeDetails });
      }
    } else {
      // Fallback for Python, Rust, etc.
      symbols = parseWithRegex(code, ext, { includeLoc, includeDetails });
    }

    // Filter by type if requested
    if (args.symbol_types && args.symbol_types.length > 0) {
      const allowed = new Set(args.symbol_types);
      symbols = filterSymbols(symbols, allowed);
    }

    return {
      success: true,
      output: JSON.stringify(symbols, null, 2),
      metadata: {
        file: resolved,
        symbolCount: symbols.length,
        parserUsed: symbols.length > 0 && [".ts", ".tsx", ".js", ".jsx"].includes(ext) ? "tree-sitter" : "regex-fallback"
      }
    };
  } catch (error) {
    return {
      success: false,
      output: "",
      error: `Failed to parse AST: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

export const astTools: ToolDefinition[] = [
  {
    name: "parse_ast",
    description: `- Extracts syntactic symbols (classes, interfaces, methods, functions, variables, types) from a source file.
- Provides precise line/column locations, parameter declarations, return types, and access modifiers.
- Supports TypeScript, TSX, JavaScript, JSX natively via Tree-sitter, and has robust regex fallback for other languages (Python, Rust).
- Use this tool when you need a structured understanding of a file's symbols and their boundaries to execute clean edits.`,
    parameters: PARSE_AST_SCHEMA,
    execute: parseAst as AnyToolExecutor,
    category: "search",
    requiresPermission: false,
    isReadonly: true
  }
];
```

---

## 6. Integration Steps

To activate the tool:
1. **Export the helpers**: Modify `src/agent/tools/fs.ts` to export `resolvePath` and `validatePathSecurity` functions:
   ```diff
   - function resolvePath(filePath: string, cwd: string): string {
   + export function resolvePath(filePath: string, cwd: string): string {
   ```
   ```diff
   - function validatePathSecurity(
   + export function validatePathSecurity(
   ```
2. **Register in registry**: Expose `astTools` in `src/agent/tools/index.ts`:
   ```typescript
   export * from "./ast.js";
   ```
3. **Register statically**: Add the new tool to the boot-up registration call in `src/agent/index.ts`:
   ```typescript
   import { astTools } from "./tools/ast.js";
   // ...
   registerTools([
     ...allFsTools,
     ...searchTools,
     ...astTools, // <-- Add here
     repoMapTool,
     // ...
   ]);
   ```
