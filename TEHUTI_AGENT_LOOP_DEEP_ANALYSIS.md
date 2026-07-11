# Tehuti CLI: Deep Architecture Analysis — Agent Loop, Self-Healing & Execution Subsystems

**Date:** 2026-07-09 | **Total files analyzed:** 12 source + 1 test + 1 util  
**Methodology:** Every source file read in full; line-level evidence cited.

---

## 1. runner.ts — The Exact Agent Loop (559 lines)

**File:** `src/agent/loop/runner.ts`

### 1.1 Entry Point: `runAgentLoop()` (L72–L558)

```
runAgentLoop(ctx, userMessage, client, syncMCPToolRegistry, options)
```

### 1.2 Step-by-step flow:

**Phase 0: Setup (L79–L98)**
- Destructures callbacks: `onToken`, `onToolCall`, `onToolResult`, `onThinking`, `onProgress`, `onCheckpoint`, `signal` (L79–L87)
- `totalTokensGenerated = 0`, `maxTokens = ctx.config.maxTokens ?? 4096` (L90–L91)
- `setParentContext(ctx)` — sets a global variable in `../tools/system.js` (L93)
- Acquires `telemetry` singleton and `prefetcher` singleton (L95–L96)
- Calls `buildSystemPrompt(ctx, userMessage)` (L98) — builds the full system prompt string (detective work from context.ts, see §10)

**Phase 1: System Prompt & User Message (L100–L112)**
- If messages array is empty (first iteration): pushes `{role:"system", content: systemPromptContent, timestamp, internalId}` (L100–L106)
- If first message is system: updates its content (recomputed every iteration) (L107–L109)
- Calls `addUserMessage(ctx, userMessage)` — appends a timestamp-prefixed user message, also logs to `appendOnlyLog` (context.ts L451–L463) (L111)
- Fires `onCheckpoint("user_message_added")` (L112)

**Phase 2: Model Routing (L114–L136)**
- For non-custom providers: calls `classifyTask(userMessage, ctx)` to get a `TaskClassification` (L116)
- Calls `selectModelForClassification(...)` to map tier → provider-specific model ID (L117–L128)
- If the routed model differs from config, updates `ctx.config.model` in-place (L129–L135)
- **BUG/GAP:** `classifyTask`'s 3rd param `pendingTools` is passed `pendingTools` (a `TaskClassification`), but the function signature expects `Array<{name, args}>`. This looks like a type mismatch — the `pendingTools` var on L116 shadows the 3rd parameter intent. In practice, the argument is the TaskClassification, which is truthy (has `tier`) but the `pendingTools.length` check on L97 inside classifyTask will be `undefined.length` → TypeError? Actually `TaskClassification` doesn't have `.length`, so `pendingTools.length` → `undefined`, and `undefined > 0` → `false`, so the pendingTools branch is never entered. This means the tool-intent-based routing path in classifyTask is **dead code** when called from runner.ts.

**Phase 3: Tool Preparation (L138–L145)**
- `syncMCPToolRegistry()` — syncs MCP tools (L138)
- `getToolDefinitions()` — gets all registered tool defs (L139)
- Initializes iteration counter, max iterations, self-healer (L141–L145)

### 1.3 Main Loop (L147–L524)

**Iteration start (L147–L148):**
```
while (iteration < maxIterations) { iteration++; }
```

**Check abort (L151–L158):** Returns early with `finishReason:"aborted"` if signal fired.

**Sleep/Wakeup mechanism (L162–L181):**
- If `ctx.isSleeping`: blocks on `wakeupQueue.consume()` — a promise-based consumer/producer queue (events.ts L48–L81)
- On wake: pushes a system message with the wakeup content, decrements `iteration` (so sleep doesn't count), `continue`s
- **This is how subagent completion notifications arrive** — subagents push wakeup messages

**Mid-flight injection (L183–L192):**
- `injectionQueue.consumeAll()` — drains all queued injection messages (e.g., `/btw` commands)
- Each injected message is pushed as a `{role:"user"}` into ctx.messages

**Context window management (L194):**
- `manageContextWindow(ctx, client)` — see §3

**Message normalization (L196):**
- `normalizeToolMessageHistory(ctx.messages)` — removes orphaned tool_calls with no matching tool results, strips empty assistant messages (context.ts L104–L177)

### 1.4 API Call with Retry (L204–L332)

**Pre-retry snapshots (L205–L210):** Saves `streamStartMessageCount`, `preRetryTotalContent`, `preRetryTokensGenerated` so retries can roll back.

**`withRetry()` wrapper (L212–L332):**
- Wraps the entire streaming API call
- On retry: awaits any in-flight mid-stream promises (`Promise.allSettled`), resets state vars, truncates `ctx.messages` to pre-call length (L215–L226)
- Calls `client.streamChat(messages, tools, undefined, signal)` (L228–L233)
- Checks if model is a reasoning model to enable thinking extraction (L234–L236)

**Stream processing loop (L239–L311):**
- Iterates `for await (const chunk of stream)`
- On abort: calls `client.abort()` then throws an `AgentError` (L240–L246)
- Calls `processStreamChunk(state, chunk, modelId)` — returns `{hasContent, newContent, hasThinking, newThinking}` (L248–L255)
- If content: triggers `onToken`, increments `totalTokensGenerated`, updates progress bar (max 90%), appends to `totalContent` (L257–L266)
- If thinking: triggers `onThinking` (L268–L270)

**Mid-stream tool dispatch (L272–L310):**
- `getToolCallsFromState(state)` — gets accumulated tool calls from streaming state (L272)
- For each tool call not yet dispatched (`dispatchedToolIds` set check at L274):
  - Parses JSON args; skips on parse error (L277–L281)
  - Checks `toolDef.intent === "read-only"` — **ONLY read-only tools are dispatched mid-stream** (L284)
  - If read-only: fires `processToolCalls(...)` as a fire-and-forget promise added to `midStreamPromises` (L299–L308)
  - **Non-read-only tools accumulate but are NOT dispatched until the stream completes** — the model can see all accumulated tool calls and cancel/revise them before they execute

**Stream error handling (L312–L329):**
- Catches stream errors, estimates token usage, tracks cost, re-throws for retry wrapper

**Retry config (L331):** `{signal, maxRetries: 3, initialDelayMs: 2000}`

### 1.5 Post-Stream Processing (L334–L411)

**Await mid-stream results (L334–L337):**
- `Promise.all(midStreamPromises)` — waits for all mid-stream dispatched tools

**Message splicing (L344–L358):**
- Calls `addAssistantMessageWithTools(ctx, state.content, toolCalls)` (L344–L348)
- Complex message reordering at L350–L357: if mid-stream tools added messages, they're spliced to maintain correct ordering (assistant message before tool results)
- Fires `onCheckpoint("assistant_message_added")` (L358)

**Token/cost tracking (L360–L386):**
- Updates `ctx.metadata.tokensUsed`, `cacheReadTokens`, `cacheWriteTokens`
- Tracks cost via `costTracker`
- Records telemetry

**Context limit warning (L388):**
- `warnOnContextLimit(ctx)` — triggers compaction if >90% capacity

**No tool calls → finish (L390–L401):**
- If `toolCalls.length === 0`: returns success with accumulated content

**Prefetch prediction (L403–L412):**
- On the **first tool call only** (`toolCalls[0]`): calls `prefetcher.predict(name, args, getToolContext(ctx))` (L411)
- **This triggers speculative prefetching of likely follow-up tools**

**Remaining tool dispatch (L414–L440):**
- Filters out already-dispatched (mid-stream read-only) tools via `dispatchedToolIds` (L422–L424)
- Dispatches remaining tools via `processToolCalls(ctx, remainingToolCalls, ...)` (L427–L437)
- Fires `onCheckpoint("tools_processed")` (L439)

### 1.6 Error Handling (L441–L523)

- Abort detection: `signal?.aborted || error.message.includes("aborted")` (L442–L445)
- `APIError` — passed through as-is (L457–L458)
- Generic `Error` → wrapped as `AgentError` with domain-specific suggestions (L459–L500):
  - API/key errors → suggest check API key
  - Timeout → suggest larger timeout / faster model
  - Rate limit (429) → suggest wait / different model
  - Context errors → suggest larger context window / compact
  - Others → generic suggestions
- Returns `{success:false, finishReason:"error", error: message}`

### 1.7 Final Exit (L526–L558)

- **Max iterations reached (L537–L543):** Returns `{success:false, finishReason:"max_iterations"}`
- **TRY block personality update (L527–L535):** Fire-and-forget `updateProjectProfile(cwd, "", [])`
- **FINALLY block (L544–L557):** Same personality update (yes, duplicated), then `resetPrefetcher()` (L556)
- **DUPLICATION:** The personality update is called in both the try-block post-loop (L527–L535) AND the finally block (L546–L554). The finally block always runs second, so this is effectively a double call but with fire-and-forget promises so benign.

### 1.8 Gaps / Issues in runner.ts

| Issue | Lines | Severity |
|-------|-------|----------|
| `classifyTask` 3rd arg type mismatch (passes TaskClassification vs pending tools array) | L116–L117 | Medium — dead code path in classifyTask |
| Mid-stream tool dispatch only for read-only; destructive tools cannot cancel mid-stream | L284 | Design choice, not a bug |
| Only first tool call triggers prefetcher | L403–L412 | Minor — could prefetch for all |
| Duplicate personality update in try+finally | L527–L554 | Minor — harmless fire-and-forget |
| No retry for tool execution failures (only API calls) | — | By design, but notable |

---

## 2. tool-processing.ts — Tool Dispatch Pipeline (488 lines)

**File:** `src/agent/loop/tool-processing.ts`

### 2.1 Core Function: `processToolCalls()` (L74–L488)

Signature: `processToolCalls(ctx, toolCallsTyped[], options, signal?) → Promise<number>`  
Returns: count of processed tool calls.

### 2.2 Two Code Paths: Parallel vs Sequential

**Path A: Multiple tool calls (L86–L245) — Parallel path**

1. Calls `getParallelizableCount(toolCalls)` — counts how many are `intent === "read-only"` (L84)
2. For each tool call (L92–L167), runs **gate checks in order**:
   - **JSON validation** (L93–L103): Parse `tc.function.arguments`; on failure → blocked
   - **Plan mode check** (L105–L111): `isPlanMode() && !isToolAllowedInPlanMode()` → blocked
   - **Firewall policy** (L113–L120): `checkFirewallPolicy()` regex checks for `rm -rf /` variants and `.git` access → blocked
   - **Pre-hook execution** (L127–L151): `hookExecutor.executeHook("PreToolUse", {...})` → blocked on error or `!proceed`
   - **Permission check** (L153–L164): `checkPermission(...)` → blocked
   - Passes all → added to `allowedCalls`
3. **Blocked calls** get error results immediately (L169–L176)
4. **Allowed calls** are dispatched via `executeToolsParallel()` (L193–L213) — see §6
5. After parallel execution: runs `PostToolUse` hook for each result (L232–L244)

**Path B: Single tool call (L246–L485) — Sequential path**

1. **Cache check** (L375–L384): `shouldCacheTool()` → `cache.get()` → if hit, use cached result
2. **Prefetch check** (L387–L400): `getPrefetcher().getPrefetched()` → await active prefetch promise
3. **Execute** (L403–L404): `executeTool(name, args, context)`
4. **Self-healing** (L405–L410): `applySelfHealingSafely(name, args, result, selfHealer)`
5. **Cache update** (L427–L431): If cacheable, set cache
6. **Cache invalidation** (L448–L458): `invalidateOnWrite()` and `invalidateOnBash()` for destructive tools
7. **Post-hook** (L436–L446)
8. Same gate checks as parallel path: JSON parse, plan mode, firewall, pre-hook, permission (L266–L369)

### 2.3 Firewall Policy: `checkFirewallPolicy()` (L51–L72)

```typescript
// L57: Blocks "rm -rf /" variants via regex
if (/(rm\s+-r.*f\s*\/[\s"']|rm\s+-r.*f\s*$)/.test(argsStr))
// L64: Blocks any .git access
if (/\.git\b/.test(argsStr))
```

**GAP:** The `_toolName` parameter is prefixed with underscore indicating it's intentionally unused. The firewall only checks argument content, not which tool is being invoked. A tool named "write" modifying `.gitignore` would be blocked by the `.git` regex — but this is arguably intentional.

### 2.4 Autonomous Tool Chaining: `executeMCPPipeline()`

**Feature Added:** A runtime for autonomous tool chaining bypassing the main LLM loop.
- Takes an array of `PipelineStep` (`{ tool, args, mapping }`).
- Executes a sequence of MCP tool calls as a single pipeline.
- Uses `TypeMapper.mapProperties(lastOutput, step.mapping)` to pipe output from one step to the next, mapping specific keys or auto-mapping identical keys.
- Fails early if any step fails.
- Allows chaining sequences of specific tools efficiently without round trips to the LLM.

### 2.5 Result Truncation (L27–L42)

`stringifyToolResult()` caps tool output at `MODEL_TOOL_RESULT_MAX_CHARS = 20000` characters. On success: returns `record.output`. On failure: returns `"Error: <error>\nOutput: <output>"` truncated.

### 2.6 Gaps in tool-processing.ts

| Issue | Lines | Severity |
|-------|-------|----------|
| Parallel path skips cache/prefetch/SH for individual tools — delegates entirely to `executeToolsParallel` | L193 | By design |
| `_toolName` unused in firewall — only argument content checked | L52 | Minor |
| Post-hook errors silently caught, only debug-logged | L242 | Low — intentional |
| No retry logic at tool-processing level — failures become immediate errors | — | By design |

---

## 3. compression.ts + context-compressor.ts — Two Separate Systems

### 3.1 `src/agent/loop/compression.ts` — Runtime Context Management (47 lines)

**Function: `manageContextWindow()` (L10–L47)**

This is a **deterministic truncation** system, NOT LLM-based:

1. Estimates current tokens via `estimateTokens(ctx.messages)` from context-compressor.ts (tiktoken-based) (L14)
2. Max context: `ctx.config.kilocode?.contextManagement?.maxContextLength || 128000` (L15–L16)
3. Trigger threshold: **85% of max** (L18)
4. Target: **80% of max** (L19)
5. If over threshold (L21–L46):
   - **Algorithm:** `keepLastN = 10` (L29)
   - While `currentTokens > targetTokens && messages.length > keepLastN + 1`:
     - Scans from index 0 to `(length - keepLastN)`, finds first non-system message (L36–L42)
     - Removes it via `splice(i, 1)` — **one at a time** (L38)
     - Re-estimates tokens (L44)
   - **Result: deterministic head/tail truncation** — preserves all system messages, keeps last 10 messages, removes oldest non-system messages first

**Key insight:** The debug log at L22–L25 explicitly states: `"Relying on deterministic head/tail truncation"`. This is NOT LLM-based summarization.

**GAP:** Removes messages one at a time with re-estimation each iteration — O(n²) complexity. For large contexts this could be slow. Also, `keepLastN` is hardcoded at 10 and not configurable.

### 3.2 `src/agent/context-compressor.ts` — Offline Compression Utility (191 lines)

**Function: `compressContext()` (L75–L162)**

This is also **deterministic truncation** (not LLM summarization), but with a structured summary format:

1. Uses `tiktoken` (`cl100k_base` encoding) for actual token counting via `encodeStringSafely()` (L39–L46)
2. Splits messages into system (preserved) and non-system (L82–L83)
3. Keeps `keepFirstN` (default 2) and `keepLastN` (default 10) non-system messages (L96–L97)
4. Middle messages (L98) are **compressed into a single summary message**:
   - Creates a `{role: "user", content: summaryContent}` message (L141–L144)
   - Summary is a bullet list: `"- <role>: <100-char preview> | Tool calls: <names>"` (L102–L139)
   - Reasoning blocks (`<think>...</think>`) replaced with `[Thought Process]` (L106–L109)
   - JSON payloads replaced with `[JSON Payload]` (L113–L114)
   - Tool calls listed by function name (L126–L132)
5. Returns `[systemMessages, ...firstN, compressedMessage, ...recentMessages]` (L146–L151)
6. Computes token savings (L152–L161)

**Key insight:** This is **syntactic/deterministic compression**, NOT LLM summarization. The "summary" is just a formatted bullet list of message roles and truncated content previews. No LLM call is ever made.

### 3.3 Stub Functions — Dead Code (L166–L191)

```typescript
// L166: identifyCriticalMessages — implemented but seems unused in current codebase
export function identifyCriticalMessages(messages: any): number[] { ... }

// L175–L181: compressContextWithMetrics — STUB, returns input unchanged
export async function compressContextWithMetrics(...) {
    return { messages, tokensSaved: 0, compressionRatio: 1 };
}

// L183–L185: progressiveCompress — STUB, returns input unchanged
export function progressiveCompress(messages: any, _target: number) { return messages; }

// L186–L188: createContextSummarizer — STUB, returns async () => ""
export function createContextSummarizer() { return async () => ""; }

// L189–L191: createSmartSummarizer — STUB, returns async () => ""
export function createSmartSummarizer() { return async () => ""; }
```

**These are clearly placeholder stubs for future LLM-based summarization features.** The parameter names (`_summarizer`, `_target`, `_opts`) with underscore prefixes confirm they're intentionally unimplemented. The `createContextSummarizer` and `createSmartSummarizer` functions literally return `async () => ""`.

### 3.4 How They Connect

- `context.ts::compactContext()` (L41–L80) calls `context-compressor.ts::compressContext()` — this is the "manual compact" path (e.g., `/compact` command)
- `runner.ts::manageContextWindow()` calls `compression.ts::manageContextWindow()` — this is the automatic runtime path
- Both use `estimateTokens()` from `context-compressor.ts` for tiktoken-based counting
- The runtime path uses simple splice-based truncation; the compact path uses the structured summary format

---

## 4. self-healing.ts — What It ACTUALLY Does (622 lines)

**File:** `src/agent/loop/self-healing.ts` | Class: `SelfHealingManager`

### 4.1 Core Claim vs Reality

**Claimed:** Speculative edits in a shadow workspace with validation and merge/discard.  
**Reality (Updated):** The core `wrapToolFailure` method still only acts as a validation/diagnostic tool. However, the newly added **`runMultiPathSpeculation`** method fully implements speculative multi-path execution: it spawns concurrent subagents in shadow workspaces, listens to chunked IPC streams, runs validations, and auto-merges the winner.

### 4.2 Detailed Flow

**Construction (L27–L33):**
- Stores `mainDir` (project root)
- Registers itself in a static `Set<SelfHealingManager>` for global cleanup
- Calls `cleanupOrphanedWorktrees()` on construction
- Registers process signal handlers (SIGINT, SIGTERM, exit)

**`wrapToolFailure()` (L35–L63):** The main entry point called from tool execution:

```
IF result.success !== false → return result (pass-through for successes)
IF config.selfHealing.enabled === false → return result
IF toolName not in ["write", "edit", "bash"] → return result
```

Then (L44–L62):
1. Calls `createShadowWorkspace()` — creates a git worktree (L46)
2. Gets validation command: `config.selfHealing.command || "npm test"` (L47)
3. Calls `runValidation(command, worktreePath)` (L48)
4. If validation **fails**: annotates original error with validation failure context (L50–L54)
5. If validation **passes**: returns original result unchanged (L62)
6. In `finally`: calls `cleanupShadowWorkspace()` (L58–L61)

**FINDING:** The `wrapToolFailure()` pipeline itself does NOT attempt to fix anything or apply changes. It purely acts as a validation/diagnostic tool for tool executions, telling you "your changes would break the build". However, the actual healing and merging logic is now fully implemented in `runMultiPathSpeculation()` via a separate multi-agent pipeline.

### 4.3 `createShadowWorkspace()` (L137–L234)

Detailed flow:
1. Creates `.tehuti/shadows/` directory (L141–L142)
2. Creates epoch-based worktree name: `tehuti-shadow-{timestamp}` (L144–L147)
3. `git branch tehuti-shadow-{ts}` (L150)
4. `git worktree add {path} {branch}` (L151–L153)
5. Syncs uncommitted changes to shadow workspace (L158–L231):
   - Gets deleted files: `git diff --name-only --diff-filter=D HEAD` (L159–L162)
   - Gets modified+staged files: `git diff --name-only --diff-filter=d HEAD` (L163–L166)
   - Gets untracked files: `git ls-files --others --exclude-standard` (L167–L170)
   - For deleted files: removes them from worktree via `fs.rm()` (L178–L185)
   - For modified/untracked: tries `rsync -a` first (L198–L203), falls back to manual `fs.cp()` with symlink preservation (L205–L224)
   - Uses a temp file list for rsync (L188–L195)

### 4.4 `runValidation()` (L255–L276)

- Runs command in worktree with `maxBuffer: 10MB`
- On success: returns `{success:true, output: stdout+stderr}`
- On failure: returns `{success:false, output: stdout+stderr+message, error: message}`

### 4.5 `parseFailureOutput()` (L301–L317) and `injectFailureContext()` (L323–L330)

- Extracts lines containing "error", "failed", or stack trace patterns (`/^\s+at\s/`)
- Formats as `<validation_failure>...</validation_failure>` XML block
- **These are never called anywhere in the runner/processing flow** — only `wrapToolFailure` is used, and it only appends raw output to the error message

### 4.6 Cleanup

- `cleanupShadowWorkspace()` (L283–L294): `git worktree remove --force`, `git branch -D`
- `cleanupActiveWorktrees()` (L89–L103): Iterates and force-removes all tracked worktrees
- `cleanupOrphanedWorktrees()` (L65–L87): Runs `git worktree prune`, then deletes everything in `.tehuti/shadows/` — **this is aggressive and could delete worktrees from other sessions**
- Signal handlers (L117–L131): SIGINT → exit(130), SIGTERM → exit(143)

### 4.7 Speculative Multi-Path Execution: `runMultiPathSpeculation()`

**Feature Added:** A multi-path speculative loop that spawns concurrent git worktrees to test fixes in parallel and auto-merges the winner.
- Creates `N` shadow workspaces via `createShadowWorkspace()`.
- Listens to chunked IPC streams via `swarmManager` update events to track subagent completion.
- Once a subagent completes, tests its workspace by running `runValidation()`.
- On the **first success** (`validation.success === true`):
  - Uses `git status` to ensure there are changes, then auto-merges the winner back into the primary branch using `fs.promises.cp` with filter.
  - Kills (prunes) all remaining slower or failing subagents via `swarmManager.pruneFailures()`.
- If no winner passes validation, it cleans up all shadow workspaces and branch references without modifying the primary branch.

### 4.8 Gaps in self-healing.ts

| Issue | Lines | Severity |
|-------|-------|----------|
| `applySpeculativeChanges()` exists but NEVER called | L242–L247 | Medium — legacy code now that `runMultiPathSpeculation` handles merging |
| `parseFailureOutput()` and `injectFailureContext()` exist but NEVER called | L301–L330 | Medium — dead code |
| Orphan cleanup deletes ALL shadows dirs, not just own | L74–L83 | Medium — could affect other sessions |
| `wrapToolFailure` only validates; never fixes | L35–L63 | Minor — functionality moved to multi-path speculation |
| Error during sync silently swallowed | L229–L231 | Low |

---

## 5. retry.ts — What It Wraps and How (57 lines)

**File:** `src/agent/loop/retry.ts` | Function: `withRetry()`

### 5.1 Signature

```typescript
withRetry<T>(operation: () => Promise<T>, options: {
    maxRetries?: number;      // default 3
    initialDelayMs?: number;  // default 2000
    signal?: AbortSignal;
}) → Promise<T>
```

### 5.2 Algorithm (L15–L55)

1. Loops `attempt = 1..maxRetries` (L15)
2. Checks abort signal before each attempt (L17–L19)
3. Executes operation (L20)
4. On error (L21–L54):
   - Checks abort signal again (L22–L24)
   - Classifies error as retryable:
     - **Timeout:** `message.includes("timeout") || name === "TimeoutError"` (L26–L28)
     - **Rate limit:** `message.includes("429") || message.includes("rate limit") || APIError.status === 429` (L29–L32)
     - **Server error:** `500/502/503/504` status codes, `fetch failed`, `ECONNRESET`, `ECONNREFUSED`, `socket hang up` (L33–L41)
   - If retryable AND attempts remain: waits `delay` ms, doubles delay (exponential backoff), continues (L43–L50)
   - Otherwise: throws (L53)
5. If loop exits without return or throw: throws `new Error("Unreachable")` (L56)

### 5.3 What It Wraps

In runner.ts (L212–L332): the entire streaming API call — `client.streamChat()` + stream processing + tool dispatch detection. The retry wrapper handles the full `async () => { ... }` block. On retry, pre-retry state is restored (messages trimmed, content/tokens reset).

### 5.4 What It Does NOT Wrap

- Individual tool executions (handled separately by tool-processing.ts error handling)
- Non-API errors (logic bugs, parse errors, etc.)
- The initial setup phases of the agent loop

### 5.5 Gaps

| Issue | Lines | Severity |
|-------|-------|----------|
| Error classification is string-based, could miss structured error types | L26–L41 | Low |
| Fixed exponential backoff, no jitter | L49 | Low |
| "Unreachable" throw at L56 — TypeScript should catch this | L56 | Negligible |

---

## 6. parallel-executor.ts — Tool Batching (387 lines)

**File:** `src/agent/parallel-executor.ts`

### 6.1 Core Functions

**`classifyToolCalls()` (L58–L77):**
- Reads `tool.intent` for each tool call
- `"read-only"` → parallel
- `"destructive"` (default) → sequential
- `"interactive"` → interactive (treated as sequential in practice)
- Returns `{parallel, sequential, interactive}`

**`canRunInParallel()` (L79–L84):**
- Returns `false` if any tool is destructive or interactive
- Returns `true` if all are read-only

**`getParallelizableCount()` (L376–L380):**
- Count of `intent === "read-only"` tools

### 6.2 `executeToolsParallel()` — The Core (L149–L374)

**Algorithm:**

1. **Defaults:** `maxConcurrency = 5` (L155)
2. **Batch construction (L187–L206):**
   - Iterates tool calls in order
   - Groups consecutive read-only tools into `"parallel"` batches
   - Each destructive/interactive tool becomes its own `"sequential"` batch
   - **Example:** `[read, read, write, read, read]` → `[parallel(read,read), sequential(write), parallel(read,read)]`

3. **Batch execution (L208–L371):**
   - For each batch:
     - If abort → fill remaining results with "aborted" errors
     - If `"parallel"`:
       - Chunked by `maxConcurrency` (5) into sub-groups (L226–L228)
       - Each chunk: `Promise.all(chunk.map(tc => executeToolCall(...)))` (L244–L299)
       - Uses `AsyncMutex` for thread-safe `addToolResult` calls (L270–L280)
       - Records parallel execution telemetry if beneficial (L320–L326)
     - If `"sequential"`: single tool execution (L327–L370)

4. **`executeToolCall()` (L86–L147):**
   - Parse JSON args
   - Check cache → if hit, return cached
   - Check prefetch → if active, await
   - Execute via `executeTool(name, args, toolContext)`
   - Apply self-healing via `applySelfHealingSafely()`
   - Record telemetry
   - Update cache (only on success)
   - Invalidate cache on destructive writes or bash commands

### 6.3 Read-only vs Write Classification

Classification is determined by `tool.intent` in the tool registry (not in this file). Tools declare their intent:
- `"read-only"` → safe to parallelize
- `"destructive"` → must be sequential
- `"interactive"` → special treatment

**Default:** If `tool.intent` is undefined, it defaults to `"destructive"` (L65) — safety-first.

### 6.4 MAX Concurrency

Hardcoded at **5** (L155). Not configurable via settings. Chunking means up to 5 read-only tools execute simultaneously per chunk.

### 6.5 Gaps

| Issue | Lines | Severity |
|-------|-------|----------|
| `maxConcurrency` not configurable | L155 | Medium |
| `classifyToolCalls()` result unused in `executeToolsParallel` — batching logic is inlined/duplicated | L58 vs L190 | Minor — code duplication |
| No deadlock prevention for sequential batches after parallel | — | Low — unlikely scenario |
| Result ordering preserved via original indices | L301–L306 | Good |

---

## 7. prefetcher.ts — Speculative Tool Prefetching (407 lines)

**File:** `src/agent/prefetcher.ts` | Class: `Prefetcher`

### 7.1 When It Triggers

Called from runner.ts (L411) after the LLM produces tool calls, BEFORE those tools are executed:
```typescript
prefetcher.predict(tc.function.name, args, getToolContext(ctx));
```
Note: Only for `toolCalls[0]` (the first tool call), not all of them.

### 7.2 What `predict()` Actually Does (L270–L349)

1. **Abort conflicting prefetches:** `abortPrefetchIfMatches(toolName, args)` (L273)
2. **Record pattern:** `recordPattern(toolName, args)` — stores in recent history (L275)
3. **Queue limit check:** If `pending.size >= 10`, skip (L277–L280)
4. **Prefetch rules:**
   - From tool definition: `currentToolDef.prefetchRules` (L283–L284)
   - From hardcoded map: `EXTRA_PREFETCH_RULES` (L285)
     - `git_status` → prefetch `git_diff` (high priority)
     - `git_log` → prefetch `git_status` (medium priority)
5. **Execute rules:** For each next-tool rule (L299–L329):
   - Check condition function
   - Call `argMapper(args, ctx)` to build predicted args
   - Skip if already cached or already pending
   - Only prefetch if `toolDef.isReadonly !== false && !toolDef.requiresPermission` (L318–L322)
   - `queuePrefetch(nextTool, predictedArgs, ctx, key)` (L323)
6. **History predictions:** `predictFromHistory()` (L331–L348):
   - Looks at recent patterns (last 5 minutes)
   - If same tool+args called ≥2 times in window → predict it
   - Scores by frequency × 10, returns top 5

### 7.3 `queuePrefetch()` (L62–L120)

- Creates an `AbortController` for the prefetch
- Sets a **5-second timeout** (L73–L78) — auto-aborts if tool not needed within 5s
- `Promise.race([executeTool(...), timeoutPromise])` (L80–L83)
- On success: if cacheable, stores in tool cache (L90–L97)
- Tracks promise in `this.pending` map; cleans up on `.finally()` (L110–L117)

### 7.4 `abortPrefetchIfMatches()` (L122–L219)

Called when a *destructive* tool is about to be executed. It aborts any pending prefetches that would be invalidated by the write:
- File-specific: if a `read/file_info/list_dir` prefetch targets a file that's about to be modified → abort (L143–L197)
- Broad: for bash/run_command → abort ALL read/list prefetches (L198–L218)

### 7.5 `getPrefetched()` (L351–L365)

Called during tool execution (tool-processing.ts L387–L400, parallel-executor.ts L112–L118). If a pending prefetch matches the tool being executed, it's returned and removed from pending.

### 7.6 `predictFromHistory()` (L233–L268)

- Filters to tools called in the last 5 minutes (L237–L241)
- Groups by `tool:args` key (L243–L247)
- Only returns tools called at least 2 times (L250)
- Score = count × 10, returns top 5 (L258–L267)

### 7.7 Gaps

| Issue | Lines | Severity |
|-------|-------|----------|
| Only first tool call triggers prefetch | runner.ts L411 | Medium — misses multi-tool predictions |
| `EXTRA_PREFETCH_RULES` only has 2 entries (git_status, git_log) | L21–L36 | Low — sparse rules |
| History-based prediction is basic frequency counting, no ML | L233–L268 | Low |
| 5-second timeout may be too short for slow tools | L73–L78 | Low |
| Abort on destructive tools is aggressive (aborts ALL reads for bash) | L198–L218 | Medium — may cancel useful prefetches |

---

## 8. model-router.ts — Task Classification (297 lines)

**File:** `src/agent/model-router.ts`

### 8.1 Three Model Tiers

Defined as hardcoded constants in `MODEL_TIERS` (L19–L50):

| Tier | Model | Max Tokens | Cost (prompt/completion per 1K) |
|------|-------|-----------|------|
| `fast` | `google/gemini-3.1-flash` | 8192 | $0 / $0 |
| `balanced` | `google/gemini-3.1-pro` | 16384 | $0 / $0 |
| `deep` | `anthropic/claude-4` | 32768 | $0.003 / $0.015 |

### 8.2 `classifyTask()` — Keyword Heuristic Engine (L90–L186)

**Algorithm priority (first match wins):**

1. **Pending tools check (L97–L129):** If `pendingTools` provided:
   - All read-only → `fast` (0.9 confidence)
   - Single destructive → `balanced` (0.8 confidence)
   - Multiple destructive → `deep` (0.7 confidence)
   - **NOTE:** Dead when called from runner.ts due to type mismatch

2. **Deep keyword matching (L131–L144):** If ≥2 deep keywords found → `deep` (0.85 confidence). Keywords:
   ```
   plan, architect, design, refactor, analyze, investigate,
   troubleshoot, debug, optimize, improve, explain, comprehensive,
   thorough, detailed, complex
   ```

3. **Fast keyword matching (L146–L152):** If ≥2 fast keywords AND 0 deep keywords → `fast` (0.8 confidence). Keywords:
   ```
   read, show, list, display, print, get, fetch, check, what, where, which
   ```

4. **Single deep keyword (L154–L160):** If exactly 1 deep keyword → `deep` (0.6 confidence)

5. **Message length heuristics (L162–L171):** If `messageLength > 500` or `sentenceCount > 5` → `deep` (0.7 confidence)

6. **Context length (L173–L179):** If `ctx.messages.length > 20` → `balanced` (0.6 confidence)

7. **Default (L181–L185):** `balanced` (0.5 confidence)

### 8.3 `selectModelForClassification()` (L205–L243)

Maps classification → actual model ID, respecting config overrides:

1. **Manual model** (L218–L228): If `config.manualModel` set:
   - But if `modelSelection === "cost-optimized"` → `tiers.fast`
   - But if `modelSelection === "speed-optimized"` → `tiers.fast`
   - Otherwise → `config.manualModel` as-is

2. **Cost-optimized mode** (L230–L232): Always `tiers.fast`

3. **Speed-optimized mode** (L234–L236): Always `tiers.fast`

4. **Preferred tier** (L238–L240): `tiers[config.preferredTier]`

5. **Default** (L242): `tiers[classification.tier]`

### 8.4 Tier Resolution: `getModelTiersForConfig()` (L188–L203)

Resolution order: `configTiers[tier]` → `providerInfo.modelTiers[tier]` → `MODEL_TIERS[tier].modelId`

### 8.5 Auxiliary Functions

- `getModelConfig()` (L245–L261): Lookup or return default config
- `getTierForModel()` (L263–L270): Reverse lookup model → tier
- `estimateCost()` (L272–L284): Simple cost calculator
- `getCheaperAlternative()` (L286–L297): deep→balanced, balanced→fast, fast→null

### 8.6 Gaps

| Issue | Lines | Severity |
|-------|-------|----------|
| `classifyTask` 3rd arg dead when called from runner (type mismatch) | L90 vs runner L116 | Medium |
| Uses regex `\b` word boundaries — "analyze" in "analyzer" wouldn't match | L132 | Low — design choice |
| No consideration of file count, project size, or git diff size | — | Medium |
| Hardcoded model IDs — won't work with providers that don't have these models | L19–L50 | Medium |
| `getCheaperAlternative` returns null for `fast` tier but `fast` is $0 cost | L293 | Minor |

---

## 9. events.ts — Event Infrastructure (115 lines)

**File:** `src/agent/events.ts`

### 9.1 `TypedEventEmitter<TEvents>` (L10–L40)

A thin wrapper around Node.js `EventEmitter` with TypeScript type safety. Exposes `emit`, `on`, `once`, `off` with typed event names and handler signatures.

### 9.2 `AgentEvents` Interface (L3–L8)

```typescript
{
    wakeup: (message: string) => void;
    error: (error: Error) => void;
    memoryEvent: (data: {type: string, message: string}) => void;
    streamEvent: (data: any) => void;
}
```

### 9.3 Global Instances

- `agentEventBus` (L42): Singleton typed event emitter — error handler logs to console (L44–L46)
- `wakeupQueue` (L83): `WakeupQueue` instance — used by runner.ts for agent sleep/wake
- `injectionQueue` (L104): `InjectionQueue` instance — used by runner.ts for `/btw` mid-flight injection
- `globalAbortController` (L107): Global `AbortController` for interrupting the agent loop
- `resetGlobalAbortController()` (L109–L111): Replaces the abort controller
- `interruptAgent()` (L113–L115): Calls `globalAbortController.abort()`

### 9.4 `WakeupQueue` (L48–L81)

A consumer/producer queue for wakeup messages:
- On construction: subscribes to `agentEventBus.on("wakeup", ...)`
- `consume()`: Returns buffered message immediately, or returns a Promise that resolves when a message arrives
- `isEmpty` getter, `clear()` method

### 9.5 `InjectionQueue` (L86–L102)

A simple FIFO queue for mid-flight context injection:
- `push(message)`: enqueues
- `consumeAll()`: drains all and returns array
- `clear()`: empties

### 9.6 Gaps

| Issue | Lines | Severity |
|-------|-------|----------|
| `streamEvent` type is `any` — no type safety | L7 | Low |
| `memoryEvent` appears defined but never used in the analyzed files | L6 | Minor — may be used elsewhere |
| No backpressure on injection queue | L89 | Low |
| Global mutable state (`globalAbortController`) | L107 | Low — typical for CLI |

---

## 10. context.ts — System Prompt Building & Context Management (608 lines)

**File:** `src/agent/context.ts`

### 10.1 `AgentContext` Interface (L179–L203)

```typescript
{
    cwd: string;
    workingDir: string;
    messages: StandardMessage[];      // Active working messages
    appendOnlyLog: StandardMessage[]; // Complete append-only log (never truncated)
    config: TehutiConfig;
    projectInstructions?: string;
    systemMemoryPromise?: Promise<string>;
    personalityBlockPromise?: Promise<string>;
    diffPreview?: DiffPreviewOptions;
    companionMode?: boolean;
    readFilesThisSession: Set<string>;
    isSleeping?: boolean;
    metadata: {
        startTime, sessionCost, toolCalls, tokensUsed,
        cacheReadTokens, cacheWriteTokens,
        filesRead[], filesWritten[], commandsRun[]
    };
}
```

### 10.2 `buildSystemPrompt()` (L260–L441)

Assembles the full system prompt from multiple sources:

1. **Project Instructions** (L264–L266): From `CLAUDE.md`, `TEHUTI.md`, `.claude.md`, `.tehuti.md`, or `AGENTS.md` (found via `loadProjectInstructions`, L205–L219)
2. **System Memory** (L268–L271): From memory graph (`getSystemPromptMemory()`)
3. **Personality Block** (L273–L278): From personality system (`getPersonalityPromptBlock()`)
4. **Skills Section** (L280–L288): If `userQuery` provided, finds relevant skills via `skillsManager.findRelevantSkills()` and builds expertise section
5. **Daemon Info** (L334–L362): Pings the Tehuti daemon for uptime/session info
6. **Temporal Context** (L290–L332): Computes current date/time/timezone
7. **Terminal Capabilities** (L387–L410): Detects terminal emulator, colors, Sixel/Kitty graphics support
8. **Static Template** (L364–L440): The main identity/rules/constraints template with sections for:
   - Identity (engineer persona)
   - Operational Rules (explain before doing, safety, conciseness)
   - Working Directory
   - Environment (platform, Node.js version, shell)
   - Harness & Subagent Capabilities
   - Tool Usage Guidelines
   - Output Format
   - Important Constraints (max iterations, tokens, model)

**Key detail:** The system prompt is rebuilt every iteration (runner.ts L98). The `${ctx.cwd}`, `${ctx.config.model}`, etc. are dynamically interpolated.

### 10.3 Message Helpers

- `addUserMessage()` (L451–L463): Adds timestamp prefix `[Timestamp: HH:MM:SS]\n`, pushes to both `messages` and `appendOnlyLog`
- `addAssistantMessage()` (L465–L480): Strips reasoning tokens, same timestamp prefix
- `addAssistantMessageWithTools()` (L482–L509): Same + attaches `tool_calls` array
- `addToolResult()` (L511–L528): Creates `{role:"tool", tool_call_id, name, content}` message
- `getToolContext()` (L530–L541): Returns tool execution context with cwd, env, timeout, diffPreview, signal, etc.

### 10.4 Token Estimation (L37–L39)

Delegates to `context-compressor.ts::estimateTokens()` (tiktoken-based).

### 10.5 `compactContext()` (L41–L80)

User-triggered compaction (`/compact`):
- Uses `compressContext()` from `context-compressor.ts` (L63)
- Replaces `ctx.messages` with compressed version (L72)
- Logs token savings

### 10.6 `warnOnContextLimit()` (L82–L102)

- At >90%: auto-compacts via `compactContext(ctx)` (L93)
- At >80%: just logs warning (L97–L99)

### 10.7 `normalizeToolMessageHistory()` (L104–L177)

Critical for context hygiene:
1. Filters out assistant messages with invalid `tool_calls` (no id, not function type, no name) (L111–L117)
2. Tracks unresolved tool_call_ids (L124–L126)
3. Drops tool messages whose `tool_call_id` doesn't match any assistant tool_call (L131–L139)
4. Second pass (L149–L176): Removes unresolved tool_calls from assistant messages, filters out empty assistant messages

### 10.8 Metadata Tracking

- `trackToolCall()` (L550–L553): Increments counter
- `trackFileRead()` (L555–L559): Appends to filesRead (deduplicated)
- `trackFileWritten()` (L561–L565): Appends to filesWritten (deduplicated)
- `trackCommand()` (L567–L569): Appends to commandsRun
- `updateMetadata()` (L543–L548): Merge partial updates
- `getContextSummary()` (L571–L587): Human-readable session summary

### 10.9 `warmupContext()` (L589–L608)

Non-blocking warmup: checks for `.git` directory and reads `package.json` name. Results only debug-logged.

### 10.10 `stripReasoningTokens()` (L30–L35)

Regex removal of `<think>`, `<thinking>`, `<reasoning>` blocks from content — used when adding assistant messages.

### 10.11 `createAgentContext()` (L221–L258)

Factory function that creates the initial `AgentContext` with resolved paths, loaded project instructions, and initialized memory/personality promises.

### 10.12 Gaps

| Issue | Lines | Severity |
|-------|-------|----------|
| `appendOnlyLog` is maintained but never read in analyzed files | L183 | Minor — may be used in UI |
| Daemon ping has 500ms timeout — tight | L343 | Low |
| `warmupContext` only debug-logs results, doesn't populate context | L589–L608 | Low — informational only |
| Skills section skipped if no userQuery | L281 | Minor — intentional |
| Project instructions loaded once at context creation, not refreshed | L205–L219 | Minor |

---

## 11. Swarm & Subagents (Task Execution & Serialization)

### 11.1 `isTerminal` Task State

Subagent and Swarm task lifecycle relies on a strict `isTerminal(status)` predicate.
- A task is considered terminal if its status is `"completed"`, `"failed"`, or `"killed"`.
- This predicate prevents double-finish mutations (e.g., if an error arrives *after* a success). It guarantees that once a subagent finishes, its state is frozen and no further status updates are accepted.

### 11.2 Subagent Timeout Hardening

To prevent hanging tasks and event loop leaks, the subagent manager implements robust timeout capabilities:
- **`READY_TIMEOUT_MS` (15s)**: A subagent process must signal that it is "ready" within 15 seconds of spawn, or it will be killed.
- **`HARD_KILL_GRACE_MS` (5s)**: When shutting down a subagent, the manager sends `SIGTERM` first. If the process does not exit within 5 seconds, it forcefully sends `SIGKILL`.
- **`AbortController` with `.unref()`**: External timeouts (`timeoutMs`) wire into an `AbortController`. The timer is `unref()`'d so it does not keep the Node.js event loop alive unnecessarily, preventing zombie processes.

### 11.3 Contextual Stream Yielding & Serialization

- **`ChunkReceiver`**: The swarm serialization format supports streamed results via a `ChunkReceiver` helper.
- Mid-stream tool messages and contextual updates are serialized over the IPC boundary, ensuring the parent harness can read the subagent's streamed results incrementally without waiting for the full buffer.
- When `sendMessageToTask` injects context into a running task, it routes through the shared `injectionQueue` (waking sleeping loops if needed) rather than mutating `ctx.messages` directly, avoiding reentrancy hazards.

---

## Overall Architecture Assessment

### Strengths
- **Clean separation of concerns:** Loop/compression/retry/self-healing/tool-processing are well-modularized
- **Defensive mid-stream tool dispatch:** Only read-only tools execute mid-stream; writes wait for full response
- **Robust retry logic:** Covers timeouts, rate limits, server errors with exponential backoff
- **Message normalization:** `normalizeToolMessageHistory` prevents orphaned tool messages from corrupting context
- **Dual context compression:** Both automatic (85% threshold, head/tail truncation) and manual (structured summary format)
- **Prefetch with invalidation:** Speculative prefetch with smart abort when writes conflict

### Critical Issues
1. **Self-healing legacy methods:** The `wrapToolFailure` pipeline only validates. While `applySpeculativeChanges()` exists, it's never called. However, this is largely mitigated by the new `runMultiPathSpeculation` loop which fully implements merge/discard logic.
2. **Type mismatch in model routing:** `classifyTask`'s 3rd parameter receives a `TaskClassification` (object) when it expects an array, making the tool-intent routing path dead code when called from runner.ts.
3. **Stub functions in context-compressor.ts:** `compressContextWithMetrics`, `progressiveCompress`, `createContextSummarizer`, `createSmartSummarizer` are all no-op stubs returning empty results — LLM-based summarization is NOT implemented.

### Dead Code Paths
| File | Function/Path | Reason |
|------|--------------|--------|
| model-router.ts L97–L129 | `classifyTask` pendingTools branch | Type mismatch — receives non-array |
| self-healing.ts L242–L247 | `applySpeculativeChanges()` | Never called |
| self-healing.ts L301–L330 | `parseFailureOutput()` / `injectFailureContext()` | Never called |
| context-compressor.ts L175–L191 | 4 summarizer stubs | Unimplemented placeholder |
| runner.ts L527–L535, L546–L554 | Personality update | Duplicated in try+finally |

### Error Handling Quality
- **Good:** runner.ts produces domain-specific `AgentError` with phase info and suggestions; tool-processing.ts handles parse errors, policy violations, permissions at every gate; retry.ts correctly classifies retryable vs non-retryable
- **Adequate:** self-healing.ts silently catches most errors (by design for non-critical validation); prefetcher.ts catches condition/mapper errors
- **Missing:** No circuit breaker for repeated API failures; no distinction between transient and permanent tool failures; post-hook errors silently swallowed
