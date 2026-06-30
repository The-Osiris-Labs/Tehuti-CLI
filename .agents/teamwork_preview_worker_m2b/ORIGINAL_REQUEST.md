# Original Request - 2026-06-29T02:23:36+03:00

You are a teamwork_preview_worker. Your working directory is `/Users/youssefsala7/Projects/Tehuti-CLI-Revival/.agents/teamwork_preview_worker_m2b`.
Your task is to implement the hardening and fixes for Subtask 2B (Context Compressor, Prefetcher, and Memory Graph) of Milestone 2: Agent Core Hardening.

Please read the analysis reports from Explorer 2 and Explorer 3:
- Explorer 2: `/Users/youssefsala7/Projects/Tehuti-CLI-Revival/.agents/teamwork_preview_explorer_m2_2/analysis.md`
- Explorer 3: `/Users/youssefsala7/Projects/Tehuti-CLI-Revival/.agents/teamwork_preview_explorer_m2_3/analysis.md`

Specifically, you need to implement the following changes:
1. **Context Compressor (`src/agent/context-compressor.ts` and `src/agent/context.ts`)**:
   - Fix Index-Shift Bug in `progressiveCompress`: Pre-map message metadata to avoid index shifts during filtering (see Strategy 1 in Explorer 2 report).
   - Let `createContextSummarizer` (and `createSmartSummarizer`) throw errors instead of catching internally, so that `compressContext`'s `try-catch` can trigger the local `summarizeWithoutLLM` fallback (Strategy 2).
   - Token Estimation: Update `estimateTokens` to include `tool_calls` and handle `undefined` or `null` content safely without crashing (Strategy 3).
   - System Prompt Role Preservation: Preserve all `system` role messages in the `toCompress` window as actual `system` messages in the final compressed array instead of compiling them into summaries (Strategy 4).
   - Unify token estimation to use the tiktoken-based `estimateTokens` in `context.ts` as well, and update `warnOnContextLimit` to dynamically use the configured `maxContextLength` from the active agent configuration rather than the hardcoded `100000` limit (Strategy 5).
2. **Prefetcher (`src/agent/prefetcher.ts`)**:
   - Rule Exception Isolation: Wrap rule condition/argument mapper evaluations in `predict` in a `try/catch` block to prevent rule errors from crashing the agent loop.
   - Expand Abort Scope & Path Normalization: Use path normalization/resolution on read and write paths in `abortPrefetchIfMatches` and cover all file-related tools (`read`, `file_info`, `list_dir`, `read_image`, `read_pdf`).
   - Execution Timeout: Enforce a maximum timeout (e.g., 5000ms) on prefetch promises using `Promise.race` to prevent speculative command hangs from clogging the queue.
   - Priority Queue Sorting: Sort prefetch rules by priority.
3. **Memory Graph (`src/agent/memory/graph.ts`)**:
   - Transactional Locking: Import `ReadWriteLock` from `src/utils/mutex.ts`. Wrap read operations (`loadGraph`, `searchGraph`) in a read lock, and write operations (`saveGraph`, `addNode`, `addEdge`) in a write lock.
   - Safe Atomic Writes & Backup Restoration: Write to a `.tmp` file and rename. Do not silently default to an empty graph on parse failure; save a backup of the corrupted file and throw/report an error.
   - Scoped Nodes: Add `cwd` or `project` context to isolate nodes to their respective workspace folders, preventing rule bleeding.
   - Prompt Memory sorting: Sort prompt memories by date/relevance/importance rather than slicing by insertion order.

MANDATORY INTEGRITY WARNING:
> DO NOT CHEAT. All implementations must be genuine. DO NOT
> hardcode test results, create dummy/facade implementations, or
> circumvent the intended task. A Forensic Auditor will independently
> verify your work. Integrity violations WILL be detected and your
> work WILL be rejected.

Please compile the project and run all tests (`npm run build && npm test`) to verify your implementation before reporting back with a detailed handoff.
