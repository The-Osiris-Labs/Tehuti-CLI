# Tehuti CLI — Test Readiness Report

Honest status of the test suite as of **June 2026**.

---

## Summary

| Suite | Result |
|-------|--------|
| Unit (`npm test`) | **570 passed**, **2 skipped** (572 total) |
| E2E (`npm run test:e2e`) | **105 passed**, **1 failed** (106 total) |
| Typecheck | **Pass** |
| Build | **Pass** (~652 KB `dist/index.js`) |

**Not 100% green.** One E2E failure is documented and reproducible.

---

## Commands

```bash
# From project root
npm install
npm run typecheck
npm test              # unit tests
npm run test:e2e      # end-to-end tests
npm run build
```

Full gate (recommended before merge):

```bash
npm run typecheck && npm test && npm run test:e2e && npm run build
```

---

## E2E Breakdown

| File | Tests | Status |
|------|------:|--------|
| `tests/e2e/tier1.test.ts` | 48 | 47 pass, **1 fail** |
| `tests/e2e/tier2.test.ts` | 41 | Pass |
| `tests/e2e/tiers3-4.test.ts` | 13 | Pass |
| `tests/e2e/baseline.test.ts` | 2 | Pass |
| `tests/e2e/queue.test.ts` | 2 | Pass |
| **Total** | **106** | **105 / 106** |

---

## Known Failing Test

**File:** `tests/e2e/tier1.test.ts`  
**Suite:** `F5: Chat UI & Custom Viewport Scrolling`  
**Test:** **Test 26** — `should calculate correct line count for array content with reasoning blocks`

**Failure:**
```
AssertionError: expected 2 to be 7
```

**Cause:** Test passes `content` as an array of `{type, content}` blocks:

```typescript
content: [
  { type: "text", content: "Hello" },
  { type: "reasoning", content: "Thinking process details\nsecond line of thoughts" },
]
```

`computeMessageLines` in `src/terminal/output.ts` only reads `msg.blocks` or **string** `msg.content`. Array-shaped `content` yields empty blocks → counts header (1) + margin (1) = **2**, not the expected **7**.

**Fix options:** Normalize array `content` to `blocks` in `computeMessageLines`, or update the test to use `blocks` (product decision pending).

---

## Feature Checklist (F1–F8)

Caveats noted where behavior is partial.

### F1: Parallel Executor
- [x] Classifies parallel vs sequential vs interactive tool calls
- [x] Respects concurrency cap and abort signals
- [x] Integrates with prefetch cache hits
- [ ] Full production race-condition guarantees (heuristic classification only)

### F2: Context Compressor
- [x] Preserves system/rules and recent messages (unit + E2E)
- [x] Triggers near context limit; structural `[Condensed]` fallback
- [ ] LLM summarization path fully deterministic in all environments

### F3: Predictive Prefetcher
- [x] Schedules read-only prefetches from rules/history
- [x] Evicts stale patterns; aborts on writes/bash
- [ ] Prediction accuracy not validated beyond rule tables

### F4: Memory Graph
- [x] Atomic writes; corruption backup files
- [x] Scoped nodes; priority ordering; `MAX_NODES` eviction
- [ ] **Edges stored but not used** in search or system prompt
- [ ] Not true graph traversal—flat top-N injection

### F5: Chat UI & Viewport
- [x] `computeMessageLines` for string content and `blocks`
- [x] Viewport scroll offset math (tier1 tests 25, 27–30)
- [ ] **Array `content` line counting broken** (test 26)
- [ ] `chat.ts` monolith (~3.7k lines)—refactor needed for maintainability

### F6: Slash Command Palette
- [x] Fuzzy search with scores
- [x] Nested submenus; cursor/Vim navigation
- [ ] Occasional React duplicate-key warnings in E2E logs

### F7: Config Editor
- [x] Renders provider/model/temperature fields
- [x] Tab split; min/max validation on numeric fields
- [x] Draft state and cancel paths
- [ ] Not all runtime subsystems hot-reload without restart

### F8: Advanced Tooling
- [x] Tree-sitter `parse_ast` and `repo_map`
- [x] `find_references` / `go_to_definition`
- [x] Registry register/unregister/bulk ops
- [x] `semantic*` tools registered (grepai CLI backend)
- [ ] Requires external `grepai` binary for semantic features
- [ ] Legacy `grepai*.ts` tool files exist but are **not registered**

---

## Tier 3 & 4 Spot Check

All **13** tests in `tiers3-4.test.ts` passing, including:

- Cross-feature: prefetch+parallel, compressor+memory, palette+config editor
- Scenarios: greenfield TS project, multi-file refactor, debug loop, long-session compression, session persistence

---

## When Is It "Ready"?

Ready for **development merge** when:

1. Tier1 test 26 is fixed or explicitly waived with updated `computeMessageLines` contract.
2. `npm run typecheck && npm test && npm run build` stay green.
3. E2E ≥ 105/106 with the single failure tracked.

Ready for **release** additionally requires M5 adversarial suite and M2 agent hardening changes committed and stable.