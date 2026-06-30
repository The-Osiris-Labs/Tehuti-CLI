## 2026-06-29T02:20:18Z

You are a teamwork_preview_worker. Your working directory is `/Users/youssefsala7/Projects/Tehuti-CLI-Revival/.agents/teamwork_preview_worker_m2a`.
Your task is to implement the hardening and fixes for Subtask 2A (Parallel Executor, Runner, AbortSignal, and Bash Invalidation) of Milestone 2: Agent Core Hardening.

Please read the analysis report by Explorer 1 here: `/Users/youssefsala7/Projects/Tehuti-CLI-Revival/.agents/teamwork_preview_explorer_m2_1/analysis.md`.

Specifically, you need to implement the following changes:
1. **Parallel Executor Hardening (`src/agent/parallel-executor.ts`)**:
   - Fix Tool Execution Order Shuffling: Only group adjacent parallel-safe tools (defined in `SAFE_PARALLEL_TOOLS`) into concurrent batches, maintaining sequential execution for write/interactive tools. Do NOT shuffle the order of tools when executing.
   - Rejection-Resistant Promise.all: Wrap each mapped tool call execution in a try-catch to prevent a single tool failure from rejecting the entire batch.
2. **AbortSignal Propagation (`src/agent/context.ts`, `src/agent/parallel-executor.ts`, etc.)**:
   - Update `getToolContext` in `src/agent/context.ts` to accept and forward `signal?: AbortSignal`.
   - Update `executeToolsParallel` and related processing functions to accept `signal?: AbortSignal` and propagate it.
   - In `executeToolsParallel`, check `if (signal?.aborted)` before starting any parallel chunk or sequential execution, returning failure tool results list early if aborted.
   - Update the `bash` tool (in `src/agent/tools/bash.ts` or wherever it is implemented) to listen for the `signal` abort event and terminate the spawned process group.
3. **Runner Abort Check (`src/agent/loop/runner.ts`)**:
   - Ensure that when the stream chunk loop detects `signal?.aborted`, it throws/exits cleanly with `success: false` and `finishReason: "aborted"`.
4. **Bash Invalidation & Prefetcher Reset Integration (`src/agent/loop/runner.ts`, invalidation logic)**:
   - Modify the tool execution path (in `runner.ts` or parallel executor) to invoke `invalidateOnBash` whenever a bash tool finishes execution with a command argument.
   - Call `resetPrefetcher()` in `runner.ts`'s `finally` block to prevent speculative prefetch resource leaks.

MANDATORY INTEGRITY WARNING:
> DO NOT CHEAT. All implementations must be genuine. DO NOT
> hardcode test results, create dummy/facade implementations, or
> circumvent the intended task. A Forensic Auditor will independently
> verify your work. Integrity violations WILL be detected and your
> work WILL be rejected.

Please compile the project and run all tests (`npm run build && npm test`) to verify your implementation before reporting back with a detailed handoff.
