# Tehuti CLI — Testing Infrastructure

Testing philosophy, feature inventory (F1–F8), architecture tiers, and coverage thresholds for Tehuti CLI Revival.

---

## 1. Test Philosophy

Three pillars:

1. **Behavioral verification** — Assert observable outcomes (tool results, rendered lines, config validation), not internal structure or naming.
2. **Deterministic isolation** — Mock external LLM HTTP; E2E uses isolated temp homes (`tests/e2e/.tmp-home-*` via `TEST_HOME`), never the real `~/.tehuti/`.
3. **Layered coverage** — Unit tests co-located with modules; E2E tiers stack from baselines → boundaries → cross-feature → scenarios.

---

## 2. Feature Inventory (F1–F8)

Eight integrated features. Descriptions below include **honest limitations**.

| ID | Feature | What it does | Limitations |
|----|---------|--------------|-------------|
| **F1** | Parallel Executor | Classifies tool calls; runs read-only tools concurrently (max 5); serializes writes/interactive | Heuristic classification; misclassified tools can race; abort propagates but not fully stress-tested in prod |
| **F2** | Context Compressor | Compresses history near ~85% context; LLM summary or `[Condensed]` structural fallback | LLM path needs live API in some tests (mocked in E2E); may drop non-critical messages; timing-sensitive unit tests |
| **F3** | Predictive Prefetcher | Rule/history-based prefetch of read-only tools into cache | Predictions are best-effort; invalidated on writes/bash; no ML |
| **F4** | Memory Graph | Relational SQLite graph DB at `~/.config/tehuti/memory/graph.db`; scoped nodes | Edges are traversed in `searchGraph` via BFS with decay, but system prompt construction utilizes flat top-N rule injection |
| **F5** | Chat UI & Viewport | Ink TUI; sliding viewport via negative margins; `computeMessageLines` | Logic split across monolithic `chat.ts` and `output.ts`; array `content` not supported in line counter |
| **F6** | Command Palette | Slash commands; Fuse fuzzy search; nested submenus; Vim keys | Submenu coverage partial; some React key warnings in E2E |
| **F7** | Config Editor | In-TUI form for provider, model, temperature, tokens | Validates schema constraints; does not hot-reload all runtime paths without save |
| **F8** | Advanced Tooling | Tree-sitter `parse_ast`, `repo_map`, grep/definition tools, `semantic` (grepai CLI) | Semantic tools require external `grepai` binary; grepai duplicate tool files are **not registered** |

---

## 3. Test Architecture

Four E2E tiers plus focused suites:

```
+-------------------------------------------------------------+
|  Tier 4: Real-World Scenarios (5 tests)                     |
|  Greenfield, refactor, debug loop, compression, persistence |
+-------------------------------------------------------------+
                              |
+-------------------------------------------------------------+
|  Tier 3: Cross-Feature Interactions (8 tests)               |
|  F1+F3, F2+F4, F5+F6, F1+F4, F2+F8, F5+F7, F3+F8, F6+F7   |
+-------------------------------------------------------------+
                              |
+-------------------------------------------------------------+
|  Tier 2: Feature Boundaries (41 tests)                      |
|  Limits, corruption, abort, concurrency caps, edge cases    |
+-------------------------------------------------------------+
                              |
+-------------------------------------------------------------+
|  Tier 1: Feature Baselines (48 tests)                     |
|  Happy-path per F1–F8                                       |
+-------------------------------------------------------------+
```

### Tier summaries

- **Tier 1** (`tests/e2e/tier1.test.ts`, 48 tests): Baseline behavior per feature. **1 known failure:** test 26 (`computeMessageLines` + array content).
- **Tier 2** (`tests/e2e/tier2.test.ts`, 41 tests): Boundaries—`MAX_NODES`, token budgets, corrupt graph backup, viewport edge widths, palette constraints.
- **Tier 3** (`tests/e2e/tiers3-4.test.ts`, tests 1–8): Pairwise feature interaction (prefetch+parallel, compressor+memory, palette+viewport, etc.).
- **Tier 4** (`tests/e2e/tiers3-4.test.ts`, tests 9–13): Simulated dev workflows (greenfield TS project, multi-file rename, debug loop, long session compression, config/session persistence).
- **Baseline** (`tests/e2e/baseline.test.ts`, 2 tests): CLI one-shot / JSON mode smoke.
- **Queue** (`tests/e2e/queue.test.ts`, 2 tests): Multi-turn tool queue and API retry on retryable errors.

**Total E2E: 106 tests** (105 passing, 1 failing as of last run).

### Unit tier

- **Location:** `src/**/*.test.ts` (configured in `vitest.config.ts`).
- **Scope:** Registry, executor, compressor, memory graph, API streaming mocks, TUI helpers, individual tools.
- **Stress variants:** `*.stress.test.ts` for mutex, registry, graph, context compressor.

---

## 4. Coverage Thresholds

| Gate | Threshold | July 2026 status |
|------|-----------|------------------|
| Unit tests | **711+** pass, **0** skip | 711 pass, 0 skip |
| E2E tests | **105+** pass | 105/106 (1 known fail) |
| Typecheck | `tsc --noEmit` zero errors | Clean |
| Build | `tsup` succeeds | `dist/index.js` ~652 KB |

### Commands

```bash
./scripts/bootstrap.sh # One-shot setup, compile native deps, typecheck, and full test suite
npm run typecheck    # strict TS
npm test             # unit: src/**/*.test.ts
npm run test:e2e     # e2e: tests/e2e/**/*.test.ts
npm run build        # production bundle
```

### Isolation policy

- Set `TEST_HOME` to a temp directory for E2E (handled in test setup).
- Do not read/write real `~/.tehuti.json` or `~/.tehuti/` during tests.
- Mock LLM streams in queue/baseline tests; live API not required for CI pass (except where explicitly integration-tested).

---

## 5. Test File Map

| Path | Tests | Role |
|------|------:|------|
| `tests/e2e/tier1.test.ts` | 48 | F1–F8 baselines |
| `tests/e2e/tier2.test.ts` | 41 | Boundaries & limits |
| `tests/e2e/tiers3-4.test.ts` | 13 | Cross-feature + scenarios |
| `tests/e2e/baseline.test.ts` | 2 | CLI smoke |
| `tests/e2e/queue.test.ts` | 2 | Retry & tool queue |
| `src/**/*.test.ts` | 711 | Module unit tests |

E2E config: `vitest.e2e.config.ts` (includes `tests/e2e/**/*.test.ts` only).