# Semantic Search Ecosystem Investigation Report

## Executive Summary
This report analyzes the current semantic search implementation in Tehuti CLI, which is based on the `grepai` executable. It identifies several critical security, functional, and architectural issues in the current codebase (including an ESM runtime crash, command resolution bugs, path traversal vulnerabilities, and background daemon leaks). 

To resolve these issues and streamline the agent tooling, we propose:
1. **Adding a new unified `semantic` search tool** that acts as the single entry point for natural language search, with built-in caching, path validation, and clean formatting.
2. **Hardening the existing GrepAI integration** by resolving runtime bugs, enforcing path security, and ensuring background process lifecycle tracking.
3. **Refactoring the Tool Registry** to remove administrative and internal cache tools, reducing context pollution for the agent.

---

## 1. Current State Analysis
Tehuti CLI currently has a fragmented and partially non-functional integration for semantic search using a local/system binary named `grepai`. This is divided into four files in `src/agent/tools/`:

1. **`grepai.ts` (Core Search & Init Tools)**:
   - Registers `grepai_search`, `grepai_init`, `grepai_status`, and `grepai_trace`.
   - Locates the `grepai` binary locally (`tools/grepai`) or globally (`/usr/local/bin/grepai`).
   - Executes search commands using `spawn` with `--json` formatted outputs.

2. **`grepai-cache.ts` (Caching Wrapper)**:
   - Registers `grepai_search_with_cache`, `grepai_clear_cache`, and `grepai_cache_status`.
   - Uses SHA-256 hashing to generate cache keys, saving result payloads to `.tehuti/grepai-cache/` with a default 1-hour TTL.

3. **`grepai-mcp.ts` (MCP & Daemon Tools)**:
   - Registers `grepai_mcp_serve`, `grepai_list_workspaces`, `grepai_create_workspace`, `grepai_watch`, and `grepai_update`.
   - Manages spawning of long-running daemons like the MCP server and real-time directory watcher.

4. **`grepai-advanced.ts` (Index Management Tools)**:
   - Registers `configure_grepai_memory_bank`, `optimize_grepai_index`, `parallel_index`, `export_grepai_index`, and `import_grepai_index`.
   - Executes indexing tasks and optimizes/compresses vector indexes.

All of these tools are registered in bulk in `src/agent/index.ts`.

---

## 2. Identified Issues & Vulnerabilities

During our read-only investigation, we discovered six significant bugs, security flaws, and design gaps:

### A. ESM Compatibility Crash (Critical Bug)
In `src/agent/tools/grepai-cache.ts` (Line 21):
```typescript
const hash = require("crypto").createHash("sha256");
```
Because the project runs in TypeScript ESM (`"type": "module"` in `package.json`), CommonJS `require()` is not globally defined. Calling this tool causes an immediate runtime crash (`ReferenceError: require is not defined`).

### B. Command Resolution Failures in Advanced Tools (Bug)
In `src/agent/tools/grepai-advanced.ts` (Lines 106, 166, 210, 253), commands are executed via:
```typescript
const command = "grepai";
...
const { stdout, stderr } = await execFilePromise(command, argsList, { ... });
```
This assumes the `grepai` binary is installed globally on the system's `PATH`. However, `grepai` is bundled locally in the project under `tools/grepai`. Calling any of these tools on a system without a global `grepai` installation will crash with `ENOENT`. These files fail to use the `getGrepaiPath()` helper.

### C. Missing Path Traversal & Sensitive File Exposure (Security Vulnerability)
Unlike the standard `glob` and `grep` search tools in `src/agent/tools/search.ts` which use `validateSearchPath()` and `isSensitivePath()` to prevent directory traversal (`../`) and block access to credentials/keys (such as `.env`, `.pem`, and `secrets.json`), `grepai_search` accepts a `path` parameter and passes it directly to the subprocess without any security checks. This could allow the LLM to inspect files outside the project or expose sensitive variables.

### D. Daemon Process Accumulation & Resource Leak (Bug)
`grepai_mcp_serve` and `grepai_watch` spawn background processes using `spawn(..., { detached: true })`. However, unlike standard background tasks (which register their PIDs in a map and kill them on CLI shutdown via exit handlers), `grepai` background processes are completely untracked. They will leak and continue to run as orphan/zombie processes after Tehuti CLI exits.

### E. Hardcoded Synchronous Sleep Blocks (Performance)
In `grepai-mcp.ts`, tools wait for background processes to initialize using hardcoded timeouts:
```typescript
await new Promise((resolve) => setTimeout(resolve, 2000)); // mcp serve
...
await new Promise((resolve) => setTimeout(resolve, 1000)); // watch
```
These block the tool execution synchronously, slowing down the CLI experience.

### F. Tool Registry Pollution & Context Bloat (Architecture)
Exposing 15+ different semantic search and vector index management commands to the LLM agent is unnecessary. Commands like `grepai_cache_status`, `grepai_clear_cache`, `grepai_update`, and index exports/imports are administrative tasks that should be run by the developer via the CLI, not by the agent. Exposing them wastes context tokens and confuses the model.

---

## 3. Proposed Design: The Unified `semantic` Search Tool

We propose replacing the duplicate search tools with a single unified `semantic` search tool. This tool abstracts the underlying executable and caching details.

### A. Tool Definition and Interface
The unified tool should be located under a new file `src/agent/tools/semantic.ts` with the following definition:

```typescript
import { z } from "zod";
import { createTool, type ToolContext, type ToolResult } from "./registry.js";
import { getGrepaiPath } from "./grepai-helper.js";
import { validateSearchPath } from "./search.js"; // Needs to be exported
import { getCachedResults, setCachedResults } from "./semantic-cache.js";

export const semanticSearchTool = createTool({
  name: "semantic",
  description: 
    "Search the codebase semantically using natural language queries. " +
    "Calculates vector similarity to locate relevant code blocks, classes, functions, and logic. " +
    "Returns matched chunks with file paths, line numbers, and relevance scores.",
  parameters: z.object({
    query: z.string().describe("Natural language query to search for"),
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .default(10)
      .describe("Maximum number of results to return"),
    path: z
      .string()
      .optional()
      .describe("Path prefix to filter search results (must be within working directory)"),
    useCache: z
      .boolean()
      .optional()
      .default(true)
      .describe("Whether to return cached results if available"),
  }),
  category: "search",
  execute: async (args, ctx: ToolContext): Promise<ToolResult> => {
    const { query, limit = 10, path: searchPath, useCache = true } = args as {
      query: string;
      limit?: number;
      path?: string;
      useCache?: boolean;
    };

    // 1. Resolve binary path
    const grepaiPath = await getGrepaiPath();

    // 2. Validate path constraints
    if (searchPath) {
      const resolved = path.resolve(ctx.cwd, searchPath);
      const pathCheck = await validateSearchPath(resolved, ctx.cwd);
      if (!pathCheck.safe) {
        return {
          success: false,
          output: "",
          error: `Security error: ${pathCheck.reason}`,
        };
      }
    }

    // 3. Cache lookup
    if (useCache) {
      const cached = await getCachedResults(query, { limit, path: searchPath });
      if (cached) {
        return {
          success: true,
          output: JSON.stringify(cached),
          metadata: { cached: true },
        };
      }
    }

    // 4. Run command
    const results = await executeGrepaiSearch(grepaiPath, query, limit, searchPath, ctx.cwd);

    // 5. Post-filter sensitive files
    const filteredResults = results.filter(r => !isSensitivePath(r.file));

    // 6. Cache write
    if (useCache && filteredResults.length > 0) {
      await setCachedResults(query, { limit, path: searchPath }, filteredResults);
    }

    return {
      success: true,
      output: JSON.stringify(filteredResults, null, 2),
      metadata: { cached: false, count: filteredResults.length },
    };
  }
});
```

---

## 4. Implementation Strategy

To implement this design and harden the codebase, we outline a step-by-step refactoring plan:

### Step 1: Export Security Utilities
Modify `src/agent/tools/search.ts` to export `validateSearchPath` and `isSensitivePath`:
```typescript
export function isSensitivePath(filePath: string): boolean { ... }
export async function validateSearchPath(resolvedPath: string, cwd: string): Promise<{ safe: boolean; reason?: string }> { ... }
```

### Step 2: Create GrepAI Shared Helper
Create `src/agent/tools/grepai-helper.ts` to consolidate the execution path resolution and process tracking:
- Move `getGrepaiPath` here.
- Maintain a list of active background PIDs.
- Register a single `process.on("exit")` and signal listener to kill any active daemon process groups.

### Step 3: Implement `semantic` Tool and Cache
- Create `src/agent/tools/semantic.ts` containing the `semantic` search tool.
- Implement the cache utility using Node's native `import crypto from "node:crypto";` to generate cache keys.
- Write cache records to `.tehuti/grepai-cache/`.

### Step 4: Refactor and Harden Existing Tools
- Rename `grepai_status` to `semantic_status` and ensure it uses `getGrepaiPath()` from helper.
- Rename `grepai_trace` to `semantic_trace`, ensure it uses the helper and validates paths.
- Rename `grepai_init` to `semantic_init`.
- Deprecate `grepai_search` and `grepai_search_with_cache` entirely.
- Exclude all advanced tools and caching status/clear tools from agent registration in `src/agent/index.ts`.
- In `grepai-mcp.ts` and `grepai-advanced.ts`, replace `execFile` command string `"grepai"` with the resolved path.

### Step 5: Test Coverage
Write unit tests under `src/agent/tools/semantic.test.ts` verifying:
1. Retrieval of cached results vs. fresh results.
2. Traversal rejection (e.g., path starting with `../` or pointing to sensitive files).
3. Graceful fallback when the binary is missing or `.grepai` is uninitialized.
