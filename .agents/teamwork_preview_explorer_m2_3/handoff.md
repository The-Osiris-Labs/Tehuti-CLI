# Handoff Report: Agent Core Hardening (Milestone 2)

This handoff contains the read-only investigation findings and hardening proposals for the Predictive Prefetcher and the Memory Graph system in Tehuti CLI.

---

## 1. Observation

Direct observations from source code:

* **File Path**: `src/agent/prefetcher.ts`
  * **Line 183-187**: Prefetch rule condition checking and argument mapping:
    ```typescript
    if (nextTool.condition && !nextTool.condition(args)) {
        continue;
    }
    const predictedArgs = nextTool.argMapper(args, ctx);
    ```
    There are no try-catch blocks here.
  * **Line 227 in `src/agent/loop/runner.ts`**: The call `prefetcher.predict(tc.function.name, args, getToolContext(ctx));` is unhandled by any surrounding try-catch block inside the main runner loop.
  * **Line 88 and 104**: Eviction checks filter by:
    ```typescript
    if (key.startsWith("read:") || key.startsWith("read_file:")) {
    ```
    This misses other read tools like `file_info` and `list_dir`.
  * **Line 93**: Eviction checks use strict path comparisons:
    ```typescript
    if (readFilePath === filePath) {
    ```
    No path normalization is applied.
  * **Line 53**: speculative tool executions are launched with:
    ```typescript
    const prefetchPromise = executeTool(toolName, args, { ...ctx, signal: controller.signal })
    ```
    No execution timeout is defined.

* **File Path**: `src/agent/memory/graph.ts`
  * **Line 24-33**: The `loadGraph()` function catching error:
    ```typescript
    try {
        if (await fs.pathExists(MEMORY_FILE)) {
            return await fs.readJson(MEMORY_FILE);
        }
    } catch (error) {
        // Ignore parse errors, just return empty
    }
    return { nodes: [], edges: [] };
    ```
  * **Line 40-55**: `addNode` and `addEdge` perform asynchronous loading, modification, and saving:
    ```typescript
    const graph = await loadGraph();
    // in-memory changes...
    await saveGraph(graph);
    ```
    No locks are acquired.
  * **Line 69-71**: Critical node retrieval in `getSystemPromptMemory()`:
    ```typescript
    const criticalNodes = graph.nodes
        .filter((n) => n.type === "project_rule" || n.type === "critical_fact")
        .slice(0, 10);
    ```
    Hard-coded limit of 10 nodes matching the filter, based on insertion order.

---

## 2. Logic Chain

1. **Uncaught Crashes**: Because `nextTool.condition` and `nextTool.argMapper` (Observation 1) can throw arbitrary runtime exceptions and `predict` is not wrapped in `try/catch` (Observation 2), a bug in any tool's prefetch rule will crash the entire CLI application.
2. **Stale Cache**: Because the prefetch abort check ignores tool prefixes such as `file_info` or `list_dir` (Observation 3) and does not normalize paths (Observation 4), directory listing caches or metadata caches remain stale on writes.
3. **Queue Blockage**: Because speculative prefetch tools run without a timeout (Observation 5), hanging/slow operations block queue slots indefinitely, saturating the cap of 10.
4. **Data Loss**: If the memory file gets corrupted, `loadGraph` ignores the JSON error and returns `{ nodes: [], edges: [] }` (Observation 6). Writing any node then completely overwrites the file, destroying all historical memories.
5. **Race Conditions**: Parallel tool executions modify the graph asynchronously (Observation 7) without locking, causing overlapping writes to overwrite each other.
6. **Project Rule Bleeding**: Since `MEMORY_FILE` is global and lacks directory scoping (Observation 8), project rules from different directories pollute the context of unrelated sessions. Slicing at 10 items limits rule retention.

---

## 3. Caveats

* **Multi-Instance Locking**: Using `ReadWriteLock` ensures process-level thread safety but does not serialize concurrent instances of the CLI run by the user. If they open multiple terminal tabs and run Tehuti simultaneously, file-level locks (`fs-ext` or `proper-lockfile`) would be needed.
* **Semantic Vector Storage**: String keyword matching is the current search baseline; semantic vector embedding is not investigated.

---

## 4. Conclusion

The prefetcher and long-term memory graph modules present several hardening opportunities:
1. Wrap speculative rule mapping inside `try/catch` blocks to protect the agent loop from crashing.
2. Enforce execution timeouts on prefetch tasks.
3. Normalize file paths and broaden abort targets to keep the cache accurate.
4. Use process locks (`ReadWriteLock`) and atomic file renames to guarantee data integrity.
5. Implement node scoping (using `cwd`) and relevance ranking to prevent global memory pollution.

Detailed strategies are documented in `analysis.md`.

---

## 5. Verification Method

To verify the current baseline works:
1. Run `npm test` to ensure all existing tests pass.
2. Verify that `src/agent/prefetcher.test.ts` executes successfully.
3. Inspect `analysis.md` for the concrete roadmap of recommended changes.
