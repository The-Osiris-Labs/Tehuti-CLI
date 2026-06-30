# Handoff Report — Milestone 2: Agent Core Hardening (Loop and Parallel Executor)

## 1. Observation
* **Obs 1.1: Tool Execution Order Shuffle**
  In `src/agent/parallel-executor.ts` (lines 178–203), safe parallel tools are separated and executed first:
  ```typescript
  const classified = classifyToolCalls(toolCalls);
  ...
  for (const chunk of parallelChunks) {
      const chunkResults = await Promise.all(...)
  }
  ```
  `canRunInParallel(toolCalls)` is defined in `src/agent/parallel-executor.ts` but never referenced in `runner.ts` or `tool-processing.ts`.
* **Obs 1.2: Missing AbortSignal in Tool Context**
  In `src/agent/context.ts` (lines 419–428), `getToolContext` returns an object that does not copy or include the `signal` field from `AgentContext`.
  In `src/agent/tools/system.ts` (line 264), the `question` tool relies on `ctx.signal?.aborted` to cancel operations.
* **Obs 1.3: Loop Abort Fall-Through**
  In `src/agent/loop/runner.ts` (lines 141–146), `signal?.aborted` exits the async stream loop via `break` but does not prevent the loop from exiting with `success: true` at the bottom of the first iteration:
  ```typescript
  for await (const chunk of stream) {
      if (signal?.aborted) {
          client.abort();
          break;
      }
  }
  ```
* **Obs 1.4: Unchecked Parallel Execution Failures**
  In `src/agent/parallel-executor.ts` (lines 205–207), parallel tools are mapped to promises and processed directly by `Promise.all` without wrapping the inner mapping logic in a try-catch block.
* **Obs 1.5: Inactive Bash Cache Invalidation**
  In `src/agent/cache/invalidation.ts` (lines 23, 49–76), `invalidateOnWrite` skips the `bash` tool, and `invalidateOnBash` is defined but never invoked in `runner.ts`, `parallel-executor.ts`, or `tool-processing.ts`.
* **Obs 1.6: Unused Prefetcher Lifecycle Cleanup**
  In `src/agent/prefetcher.ts` (lines 237–244, 258–272), `Prefetcher` holds pending promises, but `resetPrefetcher` and `clear` are never called by production code.

---

## 2. Logic Chain
1. **From Obs 1.1 to Dependency Breakdown**: Because `executeToolsParallel` separates safe parallel tools (e.g. `read_file`) and runs them before sequential write tools (e.g. `edit_file`), dependencies in tool-call sequences like `[edit_file, read_file]` are shuffled. The read will execute first on stale disk contents, leading to incorrect observations.
2. **From Obs 1.2 to Cancellation Failures**: Because `getToolContext` does not pass `signal` into the `ToolContext` object, the `question` tool receives `ctx.signal = undefined`. The cancel check evaluates to `false` and the user-interactive question prompt remains uncancellable. Similarly, the `bash` tool cannot terminate active processes on abort.
3. **From Obs 1.3 to Status Corruption**: Breaking from the streaming loop on abort allows execution to flow down to the `toolCalls.length === 0` branch in `runner.ts`. Since the stream was interrupted early, `toolCalls.length` is 0, causing the runner to return `success: true`, masking the cancellation as a success.
4. **From Obs 1.4 to Agent Loop Crashing**: If a single tool execution in a parallel chunk throws an unhandled exception, `Promise.all` rejects immediately, bubbling up to crash the entire agent loop and discarding the results of other successful parallel tools.
5. **From Obs 1.5 to Cache Inconsistency**: Because `invalidateOnBash` is never called, any file modifications made via bash commands (e.g., `git`, custom build/format scripts) do not invalidate cached reads. Subsequent reads hit the stale cache.
6. **From Obs 1.6 to Resource Leakage**: Because `resetPrefetcher` is never called, speculative background processes started by prefetch rules are never cancelled upon runner termination, causing ongoing CPU/IO waste and memory accumulation.

---

## 3. Caveats
* **Single-Process Context**: All logic assumes the agent runs in a single process. Multi-process executions (e.g. running two CLI agents concurrently) may cause filesystem state drift that is not captured by in-memory locks.
* **Vitest Coverage**: The unit tests in `parallel-executor.test.ts` pass, but they mock the caching, prefetching, and tool registry interfaces. They do not catch the shuffle order correctness issue because they do not verify dependencies between mock tool calls.

---

## 4. Conclusion
The agent core loop and parallel executor contain critical logic errors, resource leaks, and liveness bugs. Hardening is required to guarantee:
1. Tool-call execution order is preserved via dependency-aware grouping.
2. `AbortSignal` is fully propagated to all executing tools.
3. Cache consistency is maintained across bash executions.
4. Speculative prefetch resources are cleaned up cleanly.

---

## 5. Verification Method
1. **Unit Testing**: Run `npm test -- src/agent/parallel-executor.test.ts --run` to verify current test coverage.
2. **Integration Verification**: 
   - Execute a multi-step task involving a write followed by a read (e.g. `node dist/index.js "Write Hello World to hello.txt and then read hello.txt"`). Check console logs to ensure `read` executes after `write`.
   - Start a slow bash command or question tool and trigger an abort to verify that execution cancels immediately and does not exit with `success: true`.
