# Tehuti CLI v1.2.1 — Evidence-Based Code Review Report

**Date:** 2026-07-13
**Scope:** ~53K TS across 157 source files + Rust NAPI core
**Reviewers:** 5 sub-agents (Architecture, Agent Core, TUI, API/Network, Testing) + direct investigation
**Running:** 738 tests pass, typecheck clean, 9 lint errors

---

## Methodology

Every finding is anchored to a `file:line` reference. Observations are stated before interpretation. Where the scope of a search is partial, that is disclosed. Six principles: evidence-only, observation before interpretation, pattern hunting, scope discipline, surfacing assumptions, acknowledging uncertainty.

---

## 🔴 CRITICAL (Fix Immediately)

### C1. `isDangerousCommand` is a no-op stub — bash security check does nothing

**Evidence:** `src/agent/tools/bash.ts:72-77`
```typescript
function isDangerousCommand(..._args: any[]): {
    dangerous: boolean;
    reason?: string;
} {
    return { dangerous: false };  // ← ALWAYS returns "safe"
}
```

The function has the full API shape (return type with `reason` field, exported, called at line 458-459 in `executeBash`) but the body is **empty**. It always returns `{ dangerous: false }`. Every dangerous command (`rm -rf /`, fork bombs, `curl | bash`, `DROP TABLE`, etc.) passes through unchecked.

**False confidence:** `src/agent/tools/bash.test.ts` has 30 tests, all passing. Every security test asserts `expect(result.dangerous).toBe(false)` — which is **technically correct** given the stub returns false, but the test names claim "should block [dangerous command]". The tests provide 100% false confidence.

**Impact:** Any LLM-prompted or user-injected dangerous command is executed unconditionally.

---

### C2. Parallel execution silently drops image/media results

**Evidence:** `src/agent/tools/parallel-executor.ts` — `truncateToolResultForModel` at lines 23-28 does simple string truncation instead of calling `formatToolResultForLLM` from `tool-processing.ts:43-57`.

The serial path (`tool-processing.ts:613`) correctly handles `metadata.base64` + `metadata.mimeType` by producing `ContentBlock[]` with embedded images. The parallel path has its own independent formatting that never produces image content blocks.

**Impact:** Any tool producing base64 image output (screenshots, vision analysis) when executed in parallel will have the image data silently stripped before the model sees it. Only plain text like `[Image: image/png]` survives if the tool's string output includes it.

---

### C3. bash.test.ts has inverted security assertions — systemic verification failure

**Evidence:** `src/agent/tools/bash.test.ts` — all 30 tests pass, but the security tests verify the **wrong polarity**:

| Test Claim (line) | Actual Assertion | Verifies |
|---|---|---|
| "should block rm -rf /" (L8) | `expect(result.dangerous).toBe(false)` | Passes for **non**-dangerous |
| "should block curl | bash" (L17) | `expect(result.dangerous).toBe(false)` | Passes for **non**-dangerous |
| "should block DROP TABLE" (L27) | `expect(result.dangerous).toBe(false)` | Passes for **non**-dangerous |
| "should block fork bomb" (L68) | `expect(result.dangerous).toBe(false)` | Passes for **non**-dangerous |
| "should block piped base64 decode" (L110) | `expect(result.dangerous).toBe(false)` | Passes for **non**-dangerous |

**Root cause:** `isDangerousCommand` returns `{ dangerous: false }` for all inputs (C1). The tests assert `false` — which is what the function returns. If someone implements the function correctly, **every test will break** because the assertions are inverted.

**Pattern scope:** Searched all test files for inverted assertion patterns using `dangerous === false` — this is the only instance. But it's the most security-critical tool in the codebase.

---

## 🔴 HIGH

### H1. 38 empty `catch {}` blocks across 17 files — systematic error swallowing

**Evidence:** Found 38 instances in non-test source files. Distribution:

| File | Count | Risk |
|------|-------|------|
| `src/agent/tools/bash.ts` | 5 | Process cleanup failures silently swallowed |
| `src/cli/commands/chat.ts` | 4 | UI state errors invisible |
| `src/agent/cache/persistent-cache.ts` | 4 | Disk write failures silently lost — data corruption invisible |
| `src/mcp/client.ts` | 3 | MCP transport errors invisible |
| `src/agent/loop/self-healing.ts` | 3 | Self-healing failures invisible to LLM |
| `src/agent/prefetcher.ts` | 2 | Prefetch errors invisible |
| `src/agent/context.ts` | 2 | Context loading errors (2 are defensible — missing project files) |
| `src/utils/errors.ts` | 2 | Error handler errors (meta) |
| `src/utils/update-checker.ts` | 2 | Update check failures invisible |
| `src/permissions/rules.ts` | 2 | Permission rule parse errors invisible |
| `src/agent/tools/search.ts` | 2 | Search errors invisible |
| `src/agent/tools/background.ts` | 1 | Background process errors invisible |
| `src/session/manager.ts` | 1 | Session save errors invisible |
| `src/session/health.ts` | 1 | Health check errors invisible |
| `src/hooks/executor.ts` | 1 | Hook execution errors invisible |
| `src/api/base-client.ts` | 1 | API client errors invisible |
| `src/cli/ui/components/CommandPalette.tsx` | 1 | UI errors invisible |
| `src/agent/loop/runner.ts` | 1 | Agent loop errors invisible |

**Impact:** Operational failures (disk full, permission denied, network timeout, corrupt data) become **completely invisible**. No logs, no user feedback, no metrics. This is the #1 cause of silent data loss in production systems.

---

### H2. OAuth tokens stored as plaintext on disk

**Evidence:** `src/api/oauth.ts:110-115`, `src/api/oauth.ts:249-254`

```typescript
oauthConfig.google = {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token || oauthConfig.google?.refreshToken,
    expiry: Date.now() + tokenData.expires_in * 1000,
};
saveGlobalConfig({ oauth: oauthConfig });  // Writes to ~/.tehuti.json
```

Refresh tokens (valid until revoked) are stored unencrypted. The daemon socket correctly uses `chmodSync(SOCKET_PATH, 0o600)` (`src/daemon/server.ts:217`), showing awareness of filesystem security — but this pattern is not extended to config or cache files.

**Also:** `src/api/response-cache.ts:109-123` — API response cache stores full conversation messages (which may contain secrets/PII) unencrypted to `.tehuti/api-cache/<hash>.json`.

---

### H3. No backpressure in SSE stream parser — event loop starvation

**Evidence:** `src/api/base-client.ts:665-727` — The main SSE parsing loop in `streamChat()` iterates chunks in a tight `while(true)` without yielding:

```typescript
while (true) {
    const { done, value } = await reader.read();
    // ... buffer management ...
    while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        yield result.data;  // ← No yield between parsed events
    }
    if (done) break;
}
```

`src/api/streaming.ts:227-234` documents the correct backpressure pattern (`setImmediate` every 16ms) in a separate `processStreamAsync()` that is **not used** by the main chat pipeline.

---

### H4. Agent loop message reordering is incorrect — works by accident

**Evidence:** `src/agent/loop/runner.ts:384-391`

```typescript
const newMessages = ctx.messages.splice(streamStartMessageCount);
const assistantMessage = newMessages.pop();  // Gets LAST tool result, not assistant
if (assistantMessage) {
    ctx.messages.push(assistantMessage);
}
ctx.messages.push(...newMessages);
```

After a streaming iteration with tool calls, the message array is `[..., assistant_msg_with_tool_calls, tool_result_1, ..., tool_result_N]`. The `.pop()` gets the **last tool result**, not the assistant message. Result order: `[tool_result_N, assistant_msg, tool_result_1, ..., tool_result_{N-1}]`. `normalizeToolMessageHistory` (line 231) cleans up the orphaned tool results on the next iteration — it works by accident, not by design.

---

### H5. AbortSignal listener leaks in WakeupQueue

**Evidence:** `src/agent/events.ts:68-79`

```typescript
return new Promise((resolve, reject) => {
    const resolver = (msg: string) => resolve(msg);
    this.waitingResolves.push(resolver);
    if (signal) {
        const onAbort = () => { ... reject(...); };
        signal.addEventListener('abort', onAbort, { once: true });
        // ← Never removed on normal resolve
    }
});
```

When the wakeup promise resolves normally, the abort listener stays attached. Over `maxIterations` (configurable 50-100+), this accumulates. `retry.ts:62-65` shows the correct pattern with `removeEventListener`.

---

### H6. Memory graph does full table scan — O(n²) optimization loop

**Evidence:** `src/agent/memory/graph.ts:135` — `SELECT * FROM nodes` loads entire table. `optimizeInsights` (line 287) then runs O(n²) comparison loop. The 5000-node cap in `initMemory` (memory/index.ts:22) shows awareness of the issue but only applies to startup reload, not queries.

---

## 🟡 HIGH — Infrastructure

### I1. 57.6% coverage gap — 80/139 source files without tests

**Evidence:** Coverage mapping (verified by script):

| Worst-offending directories | Coverage |
|---|---|
| `src/cli/commands/` | 14% (1/7 files tested) |
| `src/agent/tools/` | 33% (7/21) |
| `src/utils/` | 33% (4/12) |
| `src/daemon/` | 25% (1/4) |
| `src/terminal/` | 33% (2/6) |
| `src/api/` | 50% (5/10) |

**High-risk untested files:**
- `src/agent/loop/runner.ts` — core execution orchestrator
- `src/agent/loop/self-healing.ts` — error recovery
- `src/api/base-client.ts` — all HTTP communication
- `src/api/oauth.ts` — OAuth credentials
- `src/api/response-cache.ts` — API caching
- `src/daemon/server.ts` — daemon IPC server
- `src/permissions/rules.ts` — security rules engine
- `src/agent/subagents/refactor.ts` — background refactoring
- `src/mcp/tool-adapter.ts` — MCP tool conversion

---

### I2. No CI/CD pipeline — zero automated gates

**Evidence:** `.github/` contains only issue templates and PR template. **No `.github/workflows/` directory.** No husky, no pre-commit hooks, no lint-staged. Every commit bypasses all quality gates.

Combined with 57.6% coverage gap and 9 lint errors: there is **no automated quality enforcement** in the development lifecycle.

---

### I3. 72 files (46%) untouched in last 30 commits — code decay risk

**Evidence:** Last 30 commits touch only 102 of 157 source files. Untouched includes:

- `src/permissions/rules.ts` — permission engine (no tests, no recent changes)
- `src/api/oauth.ts` — OAuth tokens (no tests, no recent changes)
- `src/api/response-cache.ts` — cache layer (no tests, no recent changes)
- `src/agent/tools/registry.ts` — tool registration (no tests)
- `src/agent/model-router.ts` — model routing (no tests)
- `src/agent/parallel-executor.ts` — parallel execution (tests exist but file untouched)
- `src/agent/cache/` — entire cache layer (no tests, untouched)

---

### I4. 8 Biome rules suppressed + 7+ @ts-expect-error in non-test code

**Evidence:** `biome.json:20-29` disables:
- `noUnusedVariables`, `noUnusedImports` — weakens dead code detection
- `noExplicitAny` — extensive `any` usage across 30+ files
- `noNonNullAssertion` — no-non-null-assertion disabled

**7 `@ts-expect-error`** in non-test code (all TS6133/6192: unused variables). These exist because `tsconfig.json` has `noUnusedLocals: true` and `noUnusedParameters: true`, but the code contains intentionally unused variables (likely for prop symmetry or future use). The Biome suppression at the config level is the wrong fix — these should be individual suppressions with documented reasons.

---

### I5. No Rust tests for native NAPI core

**Evidence:** `rust-core/src/lib.rs` and `rust-core/src/parallel_grep.rs` contain no `#[test]` or `#[cfg(test)]` annotations. No dev-dependencies in `Cargo.toml`. The performance-critical parallel grep native module has zero Rust-level verification.

---

### I6. Zero benchmarks

**Evidence:** No `.bench.ts` files exist anywhere. No benchmark configuration. Performance regressions go undetected.

---

## 🟡 MEDIUM — TUI & UX

### U1. Duplicate viewport logic — useChatViewport.ts extracted but not wired

**Evidence:** `src/cli/commands/chat.ts:2305-2637` (350 lines) contains an **inline copy** of the viewport logic that was extracted to `src/cli/ui/hooks/useChatViewport.ts`. The hook is never imported in chat.ts. Both codebases are near-identical but live independently — a fix to one has zero effect on the other.

**Impact:** Any viewport scroll fix must be applied twice. The extracted hook is dead code.

---

### U2. Compaction markers accumulate without bound

**Evidence:** `src/cli/ui/chat-memory.ts:189-201` — `compactMessagesForUi()` keeps ALL compaction markers (no limit) while bounding non-marker messages to `UI_MAX_MESSAGES = 120`. After a long session with many manual or auto-compactions, markers can exceed meaningful messages.

Triggered at `chat.ts:3289-3302` via `onCheckpoint` on every `"context_compacted"` event.

---

### U3. `/restart` appears silent — process.exit fires before Ink renders

**Evidence:** `src/cli/commands/chat.ts:1449-1465` — `setImmediate(() => process.exit(0))` fires on the next event-loop tick before Ink's render cycle can flush save confirmations or error messages. Both success and failure paths appear silent to the user.

---

### U4. ProgressBar indeterminate mode has dead code

**Evidence:** `src/cli/ui/components/ProgressBar.tsx:61` — `(phase === "running" && false)` is always false. The indeterminate animation intended to activate during `phase === "running"` was neutered by the `&& false` literal.

---

### U5. ExpandableToolOutput 100ms interval runs for every pending tool

**Evidence:** `src/cli/ui/components/ExpandableToolOutput.tsx:218-231` — A 100ms `setInterval` runs for every pending tool, forcing re-renders. Multiple simultaneous pending tools (common in agentic sequences) means multiple concurrent intervals.

---

### U6. TodoList polls every second unconditionally

**Evidence:** `src/cli/ui/components/TodoList.tsx:67-75` — `setTodos(getTodos())` called every 1000ms with a new array reference, forcing re-render even when data hasn't changed.

---

## 🟢 LOW — Code Quality

### L1. Duplicated ANSI strip/slice across 3 files
`ExpandableToolOutput.tsx:41-46,56-87`, `SwarmVisualizer.tsx:61-68,85-118` — identical `ansi_strip_regex` and `sliceAnsi` functions duplicated.

### L2. Application performance: 5.3MB dist/ with 20+ chunks
`dist/` contains 26 JS files + 26 sourcemaps. 5 copies of `tree-sitter-javascript-*.node` (~3.3MB total) suggest build artifact duplication.

### L3. MCP stdio passes full process.env to child processes
`src/mcp/client.ts:229` — `env: { ...process.env, ...config.env }` leaks parent environment (including `process.env.TEHUTI_PERMISSION_RULES` from I4) to MCP child processes.

### L4. Telegram bot token in webhook URL path
`src/messaging/connector-manager.ts:306` — Bot token appears as path segment in webhook URL, exposing it in server access logs.

---

## Summary

| Severity | Count | Key Items |
|----------|-------|-----------|
| 🔴 CRITICAL | 3 | Stub security check, parallel image loss, inverted test assertions |
| 🔴 HIGH | 6 | 38 empty catches, OAuth plaintext, no SSE backpressure, message reordering, AbortSignal leaks, full table scan |
| 🟡 HIGH (Infra) | 6 | 57.6% coverage gap, no CI, 46% code untouched, 8 suppressed Biome rules, no Rust tests, zero benchmarks |
| 🟡 MEDIUM (TUI) | 6 | Duplicate viewport, compaction bloat, silent restart, dead code, interval overload, polling |
| 🟢 LOW | 4 | Code duplication, build bloat, env leakage, webhook path exposure |
| **Total** | **25** | |

---

## Recommended Actions (Priority Order)

### P0 — Fix in current sprint
1. **Implement `isDangerousCommand`** in `src/agent/tools/bash.ts` — return `{ dangerous: true, reason: "..." }` for known dangerous patterns
2. **Fix `bash.test.ts` assertions** — change `toBe(false)` to `toBe(true)` and verify the real function catches all listed patterns
3. **Fix parallel-executor image handling** — import and use `formatToolResultForLLM` from `tool-processing.ts`

### P1 — Next sprint
4. **Audit all 38 empty catch blocks** — at minimum log with context
5. **Encrypt OAuth tokens** — use OS keychain or node:crypto AEAD
6. **Add backpressure to SSE reader** — `setImmediate` every 16ms matching streaming.ts pattern
7. **Fix message reordering** — correctly filter tool results from assistant message
8. **Fix AbortSignal leaks** — add `removeEventListener` in resolve path

### P2 — Next cycle
9. **Set up CI pipeline** — GitHub Actions with `pnpm run test && pnpm run lint && pnpm run typecheck`
10. **Add tests for high-risk untested files** — runner.ts, self-healing.ts, base-client.ts, oauth.ts
11. **Add Rust tests** — `cargo test` with at minimum parallel_grep test cases
12. **Wire `useChatViewport.ts`** into chat.ts, remove inline duplicate
13. **Limit compaction markers** in chat-memory.ts
14. **Add response cache eviction** — LRU with size budget, expired file cleanup on get()
15. **Add size budget to API response cache** — max 50MB or 1000 entries

### P3 — Backlog
16. Replace `process.env.TEHUTI_PERMISSION_RULES` with file-based persistence
17. Extract shared ANSI utils from duplicated component code
18. Add benchmarks for critical paths
19. Set up pre-commit hooks with lint + typecheck
20. Audit and reduce build chunk count
