# Handoff Report: Semantic Search Tool Investigation

## 1. Observation
We observed the following files and code blocks in our investigation of the `grepai` semantic search tools:

* **ESM Crash**: In `src/agent/tools/grepai-cache.ts` (Line 21):
  ```typescript
  const hash = require("crypto").createHash("sha256");
  ```
  Since the project is configured as an ES module (`"type": "module"` in `package.json`), calling this tool will result in a runtime error: `ReferenceError: require is not defined`.

* **Bare Binary Execution Failures**: In `src/agent/tools/grepai-advanced.ts` (Lines 106, 166, 210, 253):
  ```typescript
  const command = "grepai";
  ...
  const { stdout, stderr } = await execFilePromise(command, argsList, { ... });
  ```
  This command execution fails if `grepai` is only available locally at `./tools/grepai` and is not in the system's `PATH`.

* **Duplicate Path Resolvers**: Identical `getGrepaiPath()` helper functions are duplicated in `src/agent/tools/grepai.ts` (Lines 8-21) and `src/agent/tools/grepai-mcp.ts` (Lines 14-27).

* **Lack of Path Validation**: In `src/agent/tools/grepai.ts` (Line 48), the `path` argument is passed directly to the subprocess:
  ```typescript
  if (searchPath) {
      commandArgs.push(`--path=${searchPath}`);
  }
  ```
  Unlike `glob` and `grep` in `src/agent/tools/search.ts` (Lines 63-105) which call `validateSearchPath(resolvedPath, cwd)` and `isSensitivePath(path)`, the `grepai` searches are unprotected.

* **Background Process Leaks**: In `src/agent/tools/grepai-mcp.ts` (Lines 54-60 and Lines 234-240), detached subprocesses are spawned:
  ```typescript
  const grepai = spawn(grepaiPath, commandArgs, {
      cwd: ctx.cwd,
      stdio: "pipe",
      detached: true,
      shell: false,
  });
  ```
  No event handlers track these background processes to kill them when the parent CLI exits, leaking zombie processes on the host.

* **Tool Registry Clutter**: In `src/agent/index.ts` (Lines 102-103), the project imports and registers 17 separate tools under `grepaiTools` and `grepaiAdvancedTools`, cluttering the agent's context and tool selection capabilities.

---

## 2. Logic Chain
1. From our observation of `require("crypto")` in `grepai-cache.ts`, the current caching tool is completely unusable and crashes immediately at runtime in the ESM environment.
2. From the bare `"grepai"` command string in `grepai-advanced.ts`, calling index optimizations or parallel indexing commands will throw an `ENOENT` error because the program fails to resolve the local `./tools/grepai` binary path.
3. From the duplicate `getGrepaiPath` declarations, refactoring code to export a single unified helper in `grepai-helper.ts` is required to adhere to DRY principles.
4. From the lack of path checks on the search inputs, directory traversal (`../`) and sensitive file reading (e.g. `.env`, ssh keys) are possible, presenting a security vulnerability.
5. From the absence of exit listeners for detached processes in `grepai-mcp.ts`, background daemons (MCP and Watcher) run indefinitely after Tehuti terminates, resulting in resource leaks.
6. From the 17 registered grepai/index tools, the agent is exposed to unnecessary administrative commands (e.g. `grepai_update`, `grepai_clear_cache`, `configure_grepai_memory_bank`). Condensing search into a single, secure `semantic` search tool and removing administrative commands streamlines agent invocation and reduces token usage.

---

## 3. Caveats
* We assume the local project-level `./tools/grepai` binary is the intended binary for execution on macOS arm64. On other architectures or environments, the system PATH fallback `/usr/local/bin/grepai` would be used.
* We have not analyzed the internal behavior of the compiled binary `grepai` itself (e.g. vector embedding generation quality, network interactions) as it is a closed/precompiled entity in this repository.

---

## 4. Conclusion
The current semantic search implementation is fragmented, insecure, and partially non-functional. 

We recommend implementing a new unified `semantic` search tool under `src/agent/tools/semantic.ts` that includes built-in caching (using `node:crypto`), directory traversal security checking (exporting utilities from `search.ts`), and path resolution.

The old caching and core search tools should be deprecated. We should refine the registry to expose only four hardened tools to the agent:
1. `semantic`: Secure, cached natural language search (combining old core search and cache tools).
2. `semantic_init`: Initialize semantic index.
3. `semantic_status`: Retrieve index health and files.
4. `semantic_trace`: Symbol call graph tracing.

All administrative/daemon tools (`grepai_update`, `grepai_clear_cache`, `grepai_mcp_serve`, `grepai_watch`, and index management tools) must be excluded from the agent's tool registry.

---

## 5. Verification Method
1. **Compilation**: Run typechecking and project builds to ensure no ESM import errors:
   ```bash
   npx tsc --noEmit && npm run build
   ```
2. **Test Suite**: Run standard unit and E2E tests to verify no regressions:
   ```bash
   npm test
   ```
3. **Semantic Tests**: Once implemented, run a new test suite under `src/agent/tools/semantic.test.ts` to verify:
   * That subsequent identical searches return the cached flag.
   * Path traversal inputs are rejected with a security error.
   * Graceful error reports are returned when the binary is missing or unitialized.
