# Agent Core Hardening Analysis Report — Milestone 2: Agent Loop and Parallel Executor

## Overview
This report evaluates the durability, security, and execution correctness of the agent loop and parallel tool execution system in the Tehuti CLI codebase, focusing on `src/agent/loop/runner.ts` and `src/agent/parallel-executor.ts` (and its vitest suite `src/agent/parallel-executor.test.ts`). 

Multiple critical issues have been identified, including a severe logical bug that shuffles the execution order of parallel/sequential tool calls, a failure to propagate `AbortSignal` to executing tools, loop termination status corruption on cancel, fragile parallel error handling, cache consistency gaps for bash operations, and prefetcher resource leaks.

---

## Part 1: Exploration & Detailed Observations

### 1. Correctness Bug: Tool Execution Order Shuffling
* **File Location**: `src/agent/parallel-executor.ts` (Lines 178–303)
* **Observation**:
  When multiple tool calls are sent to `executeToolsParallel`, they are classified into categories (`parallel`, `sequential`, `interactive`):
  ```typescript
  const classified = classifyToolCalls(toolCalls);
  ```
  The function then runs all `classified.parallel` tools first (grouped in parallel chunks of size `maxConcurrency`), then all `classified.sequential` tools sequentially, and finally `classified.interactive` tools:
  ```typescript
  // 1. Execute parallel tools first
  for (const chunk of parallelChunks) {
      const chunkResults = await Promise.all(...)
  }
  // 2. Execute sequential tools second
  for (const tc of classified.sequential) {
      const result = await executeToolCall(...)
  }
  ```
* **Analysis**:
  This classification and execution structure completely ignores the original array index of the tool calls returned by the model. 
  If the model emits a list of tool calls containing dependencies, such as:
  1. `edit_file` (applies a code change; sequential tool)
  2. `read_file` (reads the code to verify; parallel/readonly tool)
  
  The parallel executor shuffles the execution order. It will execute the `read_file` tool *before* the `edit_file` tool.
  Consequently, the read tool returns the stale contents of the file, leading to incorrect agent observations. The edit tool executes afterwards, but the mismatch has already occurred, and the LLM receives out-of-order tool outputs.
* **Lack of Usage**: 
  The utility `canRunInParallel(toolCalls)`—which safely determines if a sequence of tool calls can be run in parallel without writes or interactions—is defined and tested but **never called** in `runner.ts` or `tool-processing.ts`.

---

### 2. Missing `AbortSignal` Propagation to Tool Context
* **File Location**: `src/agent/context.ts` (Lines 419–428), `src/agent/loop/tool-processing.ts`, `src/agent/parallel-executor.ts`
* **Observation**:
  `runAgentLoop` accepts an `AbortSignal` (`options.signal`) to cancel long-running operations. However, the `ToolContext` returned by `getToolContext(ctx)` completely ignores this signal:
  ```typescript
  export function getToolContext(ctx: AgentContext) {
      return {
          cwd: ctx.cwd,
          workingDir: ctx.workingDir,
          env: process.env as Record<string, string>,
          timeout: 120000,
          diffPreview: ctx.diffPreview,
          readFilesThisSession: ctx.readFilesThisSession,
      };
  }
  ```
* **Analysis**:
  Because `signal` is missing from the tool context:
  - The `question` tool in `src/agent/tools/system.ts` checks `ctx.signal?.aborted`, but since it is always `undefined`, the check is dead code and the tool cannot be cancelled.
  - The `bash` tool (which spawns shell commands) never receives the signal and cannot kill child processes on abort.
  - The parallel and sequential execution loops in `executeToolsParallel` have no checks for `signal?.aborted` between calls. If the agent executes a long list of tool calls and the user aborts, the execution will continue running to completion.

---

### 3. Loop Termination/Abort Status Mismatch
* **File Location**: `src/agent/loop/runner.ts` (Lines 141–165, 206–217)
* **Observation**:
  In `runner.ts`, when the stream chat is aborted, the code breaks from the async stream loop but does not throw:
  ```typescript
  for await (const chunk of stream) {
      if (signal?.aborted) {
          client.abort();
          break; 
      }
  }
  ```
  The logic then flows down. Since the stream was aborted, `toolCalls.length` will typically be 0, triggering the following exit condition:
  ```typescript
  if (toolCalls.length === 0) {
      return {
          content: totalContent,
          toolCalls: totalToolCalls,
          success: true, // <--- Returns true!
          finishReason: state.finishReason, // <--- Usually null or last reason
          ...
      };
  }
  ```
* **Analysis**:
  The outer check `if (signal?.aborted)` at the start of the next iteration is bypassed because the iteration exits prematurely from the bottom of the loop.
  This causes aborted runs to return `success: true` and missing/empty finish reasons, showing "Task completed" to the calling CLI instead of aborting properly.

---

### 4. Fragile Concurrency in Parallel Tool Execution
* **File Location**: `src/agent/parallel-executor.ts` (Lines 205–227)
* **Observation**:
  Parallel execution uses a standard `Promise.all` inside chunks:
  ```typescript
  const chunkResults = await Promise.all(
      chunk.map(async (tc) => {
          const result = await executeToolCall(...);
          ...
          return result;
      })
  );
  ```
* **Analysis**:
  If a single tool call in the parallel chunk throws an unhandled rejection, the entire `Promise.all` rejects immediately. Since there is no try-catch around `executeToolsParallel` in `processToolCalls`, this rejection crashes the entire agent loop. The outputs of other successfully executed tools are lost, and the run fails hard.

---

### 5. Cache Invalidation Gaps on Bash Execution
* **File Location**: `src/agent/cache/invalidation.ts` (Lines 22–30, 49–76)
* **Observation**:
  `invalidateOnWrite` explicitly skips the `bash` and `start_background` tools. 
  A dedicated helper `invalidateOnBash` exists to scan bash command strings and invalidate caches for edited files, but **it is never called** in production code.
* **Analysis**:
  If the LLM edits a file via a bash script (e.g. using `sed`, `git checkout`, or compilation scripts), the cached results of `read_file`, `glob`, or `grep` on those files are not invalidated. Subsequent reads will hit the stale cache and return old file content.

---

### 6. Speculative Prefetcher Resource Leaks
* **File Location**: `src/agent/prefetcher.ts` (Lines 237–244, 258–272)
* **Observation**:
  `Prefetcher` is a global singleton that schedules speculative executions of read-only tools.
  The `clear()` and `resetPrefetcher()` methods exist to cancel pending runs and flush memory, but **they are never called** in production code.
* **Analysis**:
  If the agent loop finishes or is aborted, speculative prefetch tasks continue executing in the background, wasting CPU and filesystem resources. Additionally, history patterns grow unbounded, causing memory accumulation over long sessions.

---

## Part 2: Concrete Hardening Strategies

### 1. Dependency-Aware Adjacent Tool Grouping
To maintain sequential correctness while retaining parallel performance, we must only parallelize **consecutive read-only tools** within the tool call array, and run any write or interactive tools sequentially in the exact order requested:
* **Algorithm**:
  1. Iterate through the array of tool calls.
  2. Group adjacent parallel-safe tools (as defined in `SAFE_PARALLEL_TOOLS`) into batches.
  3. Keep write/interactive tools as single-element sequential batches.
  4. Run each batch in sequence. For parallel-safe batches, execute them concurrently up to `maxConcurrency`. For sequential batches, run them in isolation.
  5. This ensures that a `read` following an `edit` will always run after the `edit` has completed.

### 2. End-to-End AbortSignal Propagation
1. Update `getToolContext` in `src/agent/context.ts` to accept an optional `signal?: AbortSignal` and forward it:
   ```typescript
   export function getToolContext(ctx: AgentContext, signal?: AbortSignal) {
       return {
           cwd: ctx.cwd,
           workingDir: ctx.workingDir,
           env: process.env as Record<string, string>,
           timeout: 120000,
           diffPreview: ctx.diffPreview,
           readFilesThisSession: ctx.readFilesThisSession,
           signal, // Propagate the signal
       };
   }
   ```
2. Update the signatures of `processToolCalls` and `executeToolsParallel` to accept `signal?: AbortSignal` and pass it down.
3. In `executeToolsParallel`, check `if (signal?.aborted)` before starting any parallel chunk or sequential execution, returning a failure results list early.
4. Update the `bash` tool to listen for `signal` abort events and terminate the spawned process group:
   ```typescript
   if (ctx.signal) {
       ctx.signal.addEventListener("abort", () => {
           try {
               process.kill(-proc.pid!, "SIGTERM");
           } catch {}
       });
   }
   ```

### 3. Hardened Loop Lifecycle Abort Checks
Ensure that whenever `signal?.aborted` is detected in `runner.ts`, the loop exits cleanly with `success: false` and `finishReason: "aborted"`:
* Modify the stream chunk loop in `runner.ts`:
  ```typescript
  for await (const chunk of stream) {
      if (signal?.aborted) {
          client.abort();
          throw new AgentError("Execution aborted by user", "execution");
      }
      ...
  }
  ```
* Throwing an error ensures that the catch block handles the cleanup and returns a proper failure result, rather than falling through to a pseudo-successful completion.

### 4. Rejection-Resistant Promise.all in Parallel Executor
Wrap each mapped tool call execution in `executeToolsParallel` in a try-catch block to prevent a single tool failure from rejecting the entire batch:
```typescript
const chunkResults = await Promise.all(
    chunk.map(async (tc) => {
        try {
            return await executeToolCall(tc, ctx, toolContext, cache, telemetry);
        } catch (error) {
            return {
                success: false,
                output: "",
                error: `Parallel execution failed: ${error instanceof Error ? error.message : String(error)}`,
            };
        }
    })
);
```

### 5. Activating Bash Cache Invalidation
Modify `processToolCalls` or `executeToolsParallel` to invoke `invalidateOnBash` whenever a bash tool finishes execution:
```typescript
if (tc.function.name === "bash") {
    let args: any;
    try { args = JSON.parse(tc.function.arguments); } catch { args = {}; }
    if (args.command) {
        invalidateOnBash(args.command);
    }
}
```

### 6. Prefetcher Lifecycle Hook integration
Ensure that the global prefetcher is cleared and reset at the end of the agent loop (or on abort/exit) by calling `resetPrefetcher()` inside `runAgentLoop`'s final block:
```typescript
try {
    // core agent loop logic
} finally {
    resetPrefetcher();
}
```

---

## Part 3: Peer Synthesis & Unified Assessment

This section synthesizes findings from our analysis of the loop and executor with peer reports covering Context Compression (Explorer 2) and the Prefetcher & Memory Graph (Explorer 3).

### 1. Consensus
* **Concurrency Vulnerabilities**: Strong consensus that the agent core does not properly serialize state accesses. Explorer 3 confirmed that long-term memory operations (`addNode`/`addEdge`) perform read-modify-write sequences without locking, causing race conditions in parallel execution.
* **Error Propagation Failure**: Both context compression (Explorer 2) and the prefetcher (Explorer 3) suffer from caught/swallowed errors that break fallback logic. In compression, the summarizer swallows API errors, replacing chunks with useless static prompts. In the prefetcher, speculative rule evaluation runs without any try-catch, which will crash the entire CLI.
* **Resource Leakage**: Clear consensus on resource lifecycle issues. Both our analysis and Explorer 3 identified the Speculative Prefetcher as a source of memory and process leakage because its `clear()` / `resetPrefetcher()` methods are completely unused in production.
* **Cache Integrity**: Strong consensus that the cache is vulnerable to stale data. Our analysis found that bash writes do not trigger invalidation, and Explorer 3 found that prefetch aborts do not normalize paths or match file tools like `file_info` or `list_dir`.

### 2. Resolved Conflicts
No structural conflicts were identified across the three reports. The findings are highly complementary, each exposing a different aspect of Milestone 2's core hardening objectives:
* **Explorer 1 (Us)**: Loop Runner, Parallel Executor ordering/dependencies, and AbortSignal propagation.
* **Explorer 2**: Context Compression (index shifts, token estimation, system prompt preservation).
* **Explorer 3**: Prefetcher (uncaught rule exceptions, queue clogging) and Memory Graph (global rules bleeding, silent corruption data loss).

### 3. Dissenting Views
There are no dissenting views. All findings have been verified directly against file paths and line numbers.

### 4. Gaps
* **Multi-Process Memory Locks**: While in-memory transactional locks will protect the Memory Graph from concurrent tool calls within a single agent instance, they will not protect it from separate CLI instances running concurrently. A file-level locking system (e.g. `proper-lockfile`) is required for complete robustness.
* **Prefetch Cache Coordination**: Currently, prefetch aborts are handled separately from main cache writes. A unified invalidation manager that handles both prefetch cancellation and cache purging for all file operations is needed.
