# Analysis: Agent Core Hardening (Milestone 2)

## Summary of Core Findings
This report details critical architectural vulnerabilities, bugs, and hardening opportunities identified in the predictive prefetcher (`src/agent/prefetcher.ts`) and the long-term memory graph (`src/agent/memory/graph.ts`). Key issues include uncaught crashes in prefetch mapping rules, silent data loss upon memory file corruption, concurrency race conditions, and lack of scoping/eviction causing global memory pollution.

---

## 1. Observations

### Prefetcher (`src/agent/prefetcher.ts` & `src/agent/prefetcher.test.ts`)

#### Observation 1.1: Uncaught Exceptions in Prefetch Rule Evaluation
In `src/agent/prefetcher.ts` (lines 183-187), rule condition checks and argument mapping are evaluated without `try/catch` blocks:
```typescript
183: 			if (nextTool.condition && !nextTool.condition(args)) {
184: 				continue;
185: 			}
186: 
187: 			const predictedArgs = nextTool.argMapper(args, ctx);
```
Since `predict` is called directly inside the main agent runner loop (`src/agent/loop/runner.ts:227`) without a try-catch wrapper, any exception thrown by a tool's prefetch rule will crash the entire agent loop and terminate the CLI.

#### Observation 1.2: Incomplete File-Based Aborting & Legacy Name Typo
In `src/agent/prefetcher.ts` (lines 88 and 104), `abortPrefetchIfMatches` only filters keys matching `read:` or `read_file:`:
```typescript
87: 			for (const [key, controller] of this.abortControllers.entries()) {
88: 				if (key.startsWith("read:") || key.startsWith("read_file:")) {
```
* However, `read_file` is not a registered tool name (the correct tools are `read`, `read_image`, `read_pdf`, `file_info`, `list_dir`, etc.).
* Other file-based prefetch tasks (`file_info`, `list_dir`, `read_image`, `read_pdf`) are never aborted when a file write occurs, risking caching and returning stale data.

#### Observation 1.3: Weak and Delimiter-Sensitive Path Equality
In `src/agent/prefetcher.ts` (line 93), aborted paths are compared using strict string equality:
```typescript
93: 						if (readFilePath === filePath) {
```
If a read tool uses a relative path (e.g. `./src/index.ts`) and the write tool uses an absolute path (e.g. `/Users/.../src/index.ts`), or if path casing or delimiters differ (e.g. double slashes), the strict string equality check fails. Consequently, stale read prefetches are not aborted and their outdated results get cached.

#### Observation 1.4: Hanging Speculative Tasks & Queue Saturation
In `src/agent/prefetcher.ts` (lines 53-61), the prefetch promise execution is not bounded by a timeout:
```typescript
53: 		const prefetchPromise = executeTool(toolName, args, { ...ctx, signal: controller.signal })
```
If a tool execution hangs (e.g., executing a slow bash command or a blocked network request), the prefetch task occupies a slot in `pending` indefinitely. This will eventually saturate the `MAX_PREFETCH_QUEUE = 10` cap (checked in lines 169, 181, 206), permanently disabling all prefetching for the session.

#### Observation 1.5: Unused Priority Field
The `priority` field (`"high" | "medium" | "low"`) is defined in `PrefetchRule` (line 12) but is ignored in `predict` (lines 180-202). No sorting or queue eviction based on priority is performed.

---

### Memory Graph (`src/agent/memory/graph.ts`)

#### Observation 1.6: Silent Data Loss upon File Corruption
In `src/agent/memory/graph.ts` (lines 24-33), `loadGraph()` swallows JSON parse errors and returns an empty graph structure:
```typescript
24: export async function loadGraph(): Promise<GraphData> {
25: 	try {
26: 		if (await fs.pathExists(MEMORY_FILE)) {
27: 			return await fs.readJson(MEMORY_FILE);
28: 		}
29: 	} catch (error) {
30: 		// Ignore parse errors, just return empty
31: 	}
32: 	return { nodes: [], edges: [] };
33: }
```
If the memory graph file (`~/.tehuti/memory-graph.json`) gets corrupted (e.g., due to an interrupted write or manual edit), it is read as empty `{ nodes: [], edges: [] }`. If a subsequent write operation is performed, the empty graph is saved, permanently wiping out the user's entire historical memory.

#### Observation 1.7: Concurrency Race Conditions
In `src/agent/memory/graph.ts` (lines 40-55), `addNode` and `addEdge` perform asynchronous read-modify-write sequences:
```typescript
41: 	const graph = await loadGraph();
...
48: 	await saveGraph(graph);
```
No file locks or mutexes are used. Concurrent calls in parallel execution loops can result in race conditions where one save operation silently overwrites another.

#### Observation 1.8: Global Scope Pollution & Insertion-Order Hard Limit
In `src/agent/memory/graph.ts` (lines 65-80), `getSystemPromptMemory` loads the first 10 critical nodes/project rules:
```typescript
69: 	const criticalNodes = graph.nodes
70: 		.filter((n) => n.type === "project_rule" || n.type === "critical_fact")
71: 		.slice(0, 10);
```
* **No Project Isolation**: Since memory is global (`~/.tehuti/memory-graph.json`), project rules stored from Project A will bleed into Project B's prompt, causing conflicts.
* **Insertion-Order Cap**: Slicing the first 10 elements on insertion order means rules beyond the first 10 are permanently ignored in future prompts.

#### Observation 1.9: Redundant Edges and Missing Referential Integrity
In `src/agent/memory/graph.ts` (lines 51-55), `addEdge` appends edges without verifying if source/target nodes exist, or if the edge relation already exists. This causes duplicate edges and JSON storage bloat.

#### Observation 1.10: Lack of Deletion APIs (CRUD)
The module lacks deletion or eviction APIs for nodes/edges, meaning outdated or incorrect memories cannot be removed.

---

## 2. Logic Chain

1. **Uncaught Crashes**: Since prefetch rule execution is speculative, it should never affect core agent behavior. However, because `nextTool.condition(...)` and `nextTool.argMapper(...)` run synchronously within `predict` without `try/catch` and `predict` is not caught by the runner, rule errors cause the CLI to crash.
2. **Stale Data Risks**: Since `abortPrefetchIfMatches` ignores file tools like `file_info` and `list_dir` and fails to normalize paths, modifying a file (e.g. updating a script) leaves stale file metadata or list prefetch results in `pending`. If the agent subsequently calls those tools, it gets stale values.
3. **Queue Blockage**: Since there is no execution timeout for prefetches, slow speculative commands can clog the queue. Since the queue limit of 10 is hard-capped, a clogged queue permanently halts all future prefetching.
4. **Data Loss**: Swallowing read errors means a corrupted JSON file defaults to `{ nodes: [], edges: [] }`. Since `addNode` unconditionally overwrites the file, corruption leads to immediate and permanent loss of all long-term memories.
5. **Context Clashing**: Because long-term memory lacks a directory or scope boundary, instructions meant for one codebase will bleed into others, misinforming the LLM.

---

## 3. Caveats
* **Single-Process Context**: Node.js is single-threaded, but async operations interleave. The proposed concurrency fixes focus on serializing operations within the single process, but multi-process locking (e.g. if the user runs two separate CLI instances) may still require file-level locks if both write simultaneously.
* **Semantic Graph Traversal**: Currently, search query matching is purely string-based. A true graph lookup would traverse edges to find connected nodes.

---

## 4. Conclusion & Hardening Strategies

### Strategies to Harden the Prefetcher

1. **Rule Exception Isolation**: Wrap the rule iteration inside `predict` in a `try/catch` block. Log the error to debug logs and proceed with the remaining rules to prevent CLI crashes.
2. **Normalized Path Matching**: Use `path.resolve` and `path.normalize` on both the read and write paths in `abortPrefetchIfMatches` to ensure relative/absolute and casing differences match properly.
3. **Expand Abort Scope**: Update `abortPrefetchIfMatches` to target all file-based tools (`read`, `file_info`, `list_dir`, `read_image`, `read_pdf`). If a file is modified, also abort any parent directory prefetch tools (e.g., `list_dir` on `/test` when `/test/file.ts` is written).
4. **Execution Timeout**: Enforce a maximum timeout (e.g., 5000ms) on prefetch promises using `Promise.race`. If a prefetch times out, abort it to free up the queue slot.
5. **Priority Queue Sorting**: Sort prefetch rules by `priority` before execution so high-priority prefetches are queued first.

### Strategies to Harden the Memory Graph

1. **Transactional Locking**: Import `ReadWriteLock` from `src/utils/mutex.ts`. Wrap read operations (`loadGraph`, `searchGraph`) in a read lock, and write operations (`saveGraph`, `addNode`, `addEdge`) in a write lock.
2. **In-Memory Cache (Write-Through)**: Maintain an in-memory `cachedGraph` object to reduce disk I/O.
3. **Safe Atomic Writes & Backup Restoration**:
   * Implement atomic file writing (write to `.tmp` first, then rename).
   * Do not silently default to empty graph on parse failure; backup the corrupted file and report/throw an error.
4. **Scoped Nodes**: Add a `cwd` or `project` field to `Node` metadata to isolate project rules to their respective workspace folders.
5. **Least Recently Used (LRU) / Priority Eviction**:
   * Add `lastAccessedAt` and `importance` fields to memory nodes.
   * Sort system prompt memories by relevance/date rather than slicing by insertion order.

---

## 5. Verification Method

### 1. Verification Commands
To verify the hardening strategies once implemented, run the vitest suites:
```bash
npm test
```
Additionally, write regression tests in `src/agent/prefetcher.test.ts` and `src/agent/memory/graph.test.ts` (to be created) for path normalization, rule crashes, transactional concurrency, and atomic writes.

### 2. Manual Inspection
Inspect the memory graph file directly at `~/.tehuti/memory-graph.json` to verify structure and content separation.
