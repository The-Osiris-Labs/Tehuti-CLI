## 2026-06-29T07:42:09Z
You are Worker D.
Your task is to implement Milestone 3: Advanced Tooling Ecosystem.
Your working directory is /Users/youssefsala7/Projects/Tehuti-CLI-Revival/

Here is what you need to implement:

1. AST Parsing Tool:
   - Export `resolvePath` and `validatePathSecurity` in `src/agent/tools/fs.ts` to allow AST parser to reuse them.
   - Implement the `parse_ast` tool in `src/agent/tools/ast.ts`. It must use `tree-sitter`, `tree-sitter-typescript` (for typescript and tsx grammars), and `tree-sitter-javascript` to parse source files and extract nested structures (classes, interfaces, functions, methods, variables), returning their line/column positions, modifiers, parameters, and return types.
   - Add a robust Regex fallback parser inside `src/agent/tools/ast.ts` to parse other file types (Python, Rust, etc.) or serve as a fallback in environments where native tree-sitter binary bindings are missing or fail to build.
   - Export the new tool from `src/agent/tools/index.ts` and register it in the registry/main agent setup.
   - Add tests in `src/agent/tools/ast.test.ts` (or `tests/agent/tools/ast.test.ts`) verifying JS, TS, TSX, and regex fallbacks.

2. Semantic Search Tooling Refactoring:
   - Create a unified `semantic` search tool under `src/agent/tools/semantic.ts`.
   - Expose only 4 hardened tools to the agent: `semantic` (cached, secure search), `semantic_init` (initialize index), `semantic_status` (health), and `semantic_trace` (call graph). Remove all other administrative tools (`grepai_update`, `grepai_clear_cache`, etc.) from the agent-facing registry.
   - Fix the ESM caching crash by using ESM-compliant `node:crypto` imports instead of `require("crypto")`.
   - Fix binary path resolution: resolve `./tools/grepai` relative to the workspace, fallback to system PATH.
   - Add directory traversal security checks and sensitive path exclusions (using the functions from `fs.ts` or `search.ts`).
   - Track background daemons spawned (MCP server or Watcher) and attach process exit listeners to clean them up and prevent zombie leaks.
   - Add tests in `src/agent/tools/semantic.test.ts`.

3. Dynamic Tools Registry:
   - Refactor `src/agent/tools/registry.ts` to use a class-based `ToolRegistryManager` supporting scoped registries instead of a single global Map.
   - Support both Zod and raw JSON Schema parameter validation (to handle MCP tool schemas seamlessly).
   - Implement tool lifecycle hooks (`onRegister` / `onUnregister`) to manage resource initialization and teardown.

Ensure that all existing tests pass cleanly, and run vitest to verify.
