# Tehuti CLI — Project Overview & Architecture

Tehuti CLI is a TypeScript/Node.js terminal coding assistant with an Ink/React TUI, an OpenAI-compatible agent loop, and a large native tool registry. It targets developers who want a local, configurable harness—not a hosted IDE plugin. Default provider is **OpenCode Go** (`opencode`); the HTTP client is OpenAI-compatible and works with OpenRouter, local Ollama/LM Studio, and custom base URLs.

**What it is not:** It is not a hosted IDE plugin. The project runs completely locally. Subagent and swarm delegation features are fully operational. Legacy grepai-named tool files are present in the source tree but not registered, as the primary semantic search functionality is handled by the registered `semantic` tools.

---

## System Architecture

Three pillars: **Agent Core**, **TUI**, and **Tools**.

```
                         +----------------------+
                         |   Entry (index.ts)   |
                         +----------+-----------+
                                    |
                         +----------v-----------+
                         |  CLI / Ink TUI       |
                         |  chat.ts (~3.7k ln)  |
                         +----------+-----------+
                                    |
              +---------------------+---------------------+
              |                     |                     |
   +----------v---------+  +--------v--------+  +--------v--------+
   |    Agent Core      |  |  Config/Session |  |  API Layer      |
   |  loop/runner.ts    |  |  permissions    |  |  OpenRouterClient|
   |  parallel executor |  |  hooks, MCP     |  |  (misnomer: any |
   |  compressor        |  |                 |  |  OAI-compat URL)|
   |  prefetcher        |  +-----------------+  +-----------------+
   |  memory graph      |
   +----------+---------+
              |
   +----------v---------+
   |   Tool Registry    |
   |  73 native + MCP   |
   | dynamic at runtime |
   +--------------------+
```

---

## Agent Core

### Agent loop (`src/agent/loop/`)

`runAgentLoop` in `runner.ts` drives the lifecycle:

1. Build/refresh system prompt (skills, memory, project instructions).
2. Append user message; optionally route model tier via `model-router.ts`.
3. Sync MCP tools into the registry (`syncMCPToolRegistry`).
4. **Iterate** (up to `config.maxIterations`):
   - Compress context if near limit (`manageContextWindow`).
   - Stream chat completion via provider client (`withRetry`, max 3 retries).
   - Parse tokens, reasoning/thinking deltas, tool calls.
   - If no tool calls → return success.
   - Classify and execute tool calls (`processToolCalls` → parallel executor).
5. Track cost/telemetry; honor `AbortSignal`.

**Limitations (honest):**

- Bounded by `maxIterations`; no unbounded autonomy.
- Model routing is heuristic (`classifyTask`), not learned.
- Context compression may call the LLM; falls back to structural truncation on failure.
- Prefetcher is rule-based; predictions can be wrong or stale.
- `OpenRouterClient` name is historical—it wraps any OpenAI-compatible endpoint configured in `TehutiConfig`.
- Anthropic-native format is not first-class; non-compatible providers throw at client creation.
- Subagent `delegate_task` spawns in-process workers; not a full multi-agent orchestration platform.
- Plan mode gates tools but is opt-in state, not enforced sandboxing.

### Supporting modules

| Module | Path | Role |
|--------|------|------|
| Parallel executor | `parallel-executor.ts` | Batches read-only tools (max 5 concurrent); serializes writes/interactive |
| Context compressor | `context-compressor.ts` | Triggers ~85% token threshold; LLM summary or `[Condensed]` fallback |
| Prefetcher | `prefetcher.ts` | Rule/history-based read prefetch; invalidated on writes/bash |
| Memory graph | `memory/graph.ts` | SQLite relational graph DB at `~/.config/tehuti/memory/graph.db` |
| Caches | `cache/` | LRU + persistent tool result cache |
| Skills | `skills/manager.ts` | Keyword-matched expertise **injected into system prompt only** |

### Memory graph

- **Relational Storage:** Managed via `better-sqlite3` under `~/.config/tehuti/memory/graph.db`. It tracks `nodes` (with schema attributes like `id`, `type`, `content`, `metadata` containing `cwd`/importance/priority) and `edges` (mapping `source_id` to `target_id` relations).
- **Retrieval & Traversal:** Combines Okapi BM25 sparse vector keyword scores with Breadth-First Search (BFS) graph neighbor traversals (decay factor `0.5 ** depth`).
- **De-duplication & Optimization:** Employs Jaccard token overlap calculations. If node similarity is $> 0.85$, priorities, access counts, and active edge coordinates are merged into a single record, and the duplicate is pruned.

### Skills

Skills are **prompt injection only**. `buildSystemPrompt` calls `findRelevantSkills(userQuery)` and appends an expertise block. Tool wrappers (`list_skills`, `activate_skill`, etc.) toggle metadata; they do not load separate executors or change tool behavior.

---

## TUI (Terminal User Interface)

Built with **React 19 + Ink 6** (`src/cli/commands/chat.ts`).

| Piece | Location | Notes |
|-------|----------|-------|
| Main shell | `chat.ts` | **Monolithic (~3,682 lines)**—chat loop, rendering, key handling, agent wiring |
| Viewport | `chat.ts` + `terminal/output.ts` | Negative `marginBottom` sliding window over message list |
| Components | `cli/ui/components/` | `CommandPalette`, `ConfigEditor`, `ExpandableToolOutput`, `MediaViewer`, `SwarmVisualizer`, `TehutiHeader` |
| Hooks | `cli/ui/hooks/` | `useChatInput`, `useChatState` |
| Line math | `terminal/output.ts` | `computeMessageLines`, `wrap`, ANSI markdown rendering |

**Warning:** Refactors should peel logic out of `chat.ts` first; most TUI regressions trace to this file.

**Known TUI gap:** `computeMessageLines` expects `msg.blocks` or string `content`; array-shaped `content` (used in tier1 test 26) is not handled—returns header + margin only.

Palette uses Fuse.js fuzzy search. Egyptian palette (gold/obsidian/sand/coral) via `branding/` and `terminal/output.ts`.

---

## Tools

### Registry (`src/agent/tools/registry.ts`)

Zod-validated definitions → JSON Schema for the API. Categories: `fs`, `bash`, `web`, `mcp`, `system`, `git`, `search`, `development`.

### Native inventory (73 registered in src/agent/index.ts)

| Category | Count | Examples |
|----------|------:|----------|
| Filesystem | 12 | `read`, `write`, `edit`, `list_dir`, `read_image`, `read_pdf`, … |
| Search | 4 | `glob`, `grep`, `find_references`, `go_to_definition` |
| AST / repo | 2 | `parse_ast`, `repo_map` |
| Semantic (grepai CLI) | 4 | `semantic`, `semantic_init`, `semantic_status`, `semantic_trace` |
| Bash | 1 | `bash` |
| Web | 3 | `web_fetch`, `web_search`, `code_search` |
| Git | 9 | `git_status` … `git_push` |
| Background | 4 | `start_background`, `list_processes`, … |
| System | 4 | `todo_write`, `task`, `question`, `wait_for_event` |
| Memory | 2 | `store_insight`, `query_memory` |
| Plan mode | 2 | `write_plan`, `exit_plan_mode` |
| Skills | 6 | `list_skills`, `activate_skill`, `create_reusable_skill` … |
| MCP prompts | 2 | `mcp_get_prompt`, `mcp_list_prompts` |
| Swarm | 4 | `delegate_task`, `check_subagent_status`, `abort_subagent` … |
| KiloCode / custom | 10 | provider-specific configurators |
| Collaboration | 3 | collaboration session helpers |
| Shadow Workspace | 1 | `test_speculatively` |
| **Total native** | **73** | |

### MCP (dynamic)

`mcpManager` connects stdio/SSE servers; `syncMCPToolRegistry` registers `mcp_<server>_<tool>` at loop start. Count varies per user config.

### Dead / unregistered code

These files define tools but are **not** in `registerTools([...])`:

- `grepai.ts`, `grepai-cache.ts`, `grepai-mcp.ts`, `grepai-advanced.ts` (~17 duplicate/overlapping grepai wrappers)

`semantic.ts` is the registered path; grepai files are legacy/duplicate.

---

## API Layer

| File | Reality |
|------|---------|
| `api/openrouter.ts` | `OpenRouterClient`—generic OpenAI-compatible chat completions + streaming |
| `api/custom-provider.ts` | Custom headers/base URL adapter |
| `api/kilocode.ts` | KiloCode-specific client |
| `config/schema.ts` | Default `provider: "opencode"`, `baseUrl: https://opencode.ai/zen/go/v1` |
| `config/providers.ts` | Provider metadata, auth headers, tier defaults |

Streaming parser: `api/streaming.ts`. Reasoning models: `api/model-capabilities.ts`.

---

## Codebase Layout

```
src/
├── index.ts                 # CLI entry
├── cli/commands/chat.ts     # TUI + chat (monolith)
├── cli/ui/                  # Ink components & hooks
├── agent/
│   ├── index.ts             # Tool registration, runAgentLoop export
│   ├── loop/                # runner, retry, compression, tool-processing
│   ├── tools/               # Native tools + registry
│   ├── memory/              # Graph persistence
│   ├── skills/              # Prompt-only expertise
│   ├── cache/               # LRU + disk cache
│   └── swarm/               # Subagent manager
├── api/                     # HTTP clients & streaming
├── config/                  # Schema, loader, wizard, providers
├── mcp/                     # MCP client & tool adapter
├── session/                 # Session save/load
├── permissions/             # Tool permission prompts
├── terminal/                # ANSI output, markdown, computeMessageLines
└── utils/                   # mutex, telemetry, errors
```

Tests: unit co-located `src/**/*.test.ts`; E2E in `tests/e2e/**/*.test.ts`.

---

## Milestones (June 2026)

| # | Objective | Status | Notes |
|---|-----------|--------|-------|
| **M1** | E2E testing track (tiers 1–4) | **IN_PROGRESS** | 105/106 passing; 1 known fail (tier1 test 26) |
| **M2** | Agent core hardening | **IN_PROGRESS** | Uncommitted changes across loop, context, parallel-executor, memory |
| **M3** | Advanced tooling | **IN_PROGRESS** | `ast.ts`, `semantic.ts` registered; grepai duplicates still dead |
| **M4** | TUI polish | **IN_PROGRESS** | Viewport/palette work ongoing; `chat.ts` still monolithic |
| **M5** | Integration & adversarial hardening | **PLANNED** | Tier 5 adversarial suite not started |

---

## Baseline Verification (June 2026)

| Check | Result |
|-------|--------|
| Unit tests (`npm test`) | **570 passed**, **2 skipped** (572 total) |
| E2E (`npm run test:e2e`) | **105 passed**, **1 failed** (106 total) |
| Typecheck (`npm run typecheck`) | **Clean** (`tsc --noEmit`) |
| Build (`npm run build`) | **Success** — `dist/index.js` **~652 KB** |

---

## Known Gaps

1. **E2E:** Tier1 test 26 — `computeMessageLines` ignores array `content`; expects 7 lines, gets 2.
2. **TUI:** `chat.ts` size (~3.7k lines) blocks maintainability; React duplicate-key warnings in some E2E renders.
3. **Memory:** Edge relations stored but unused in retrieval/prompt injection.
4. **Skills:** Built-in skill loader has `TODO`; activation is flag-only, not behavioral.
5. **Tools:** ~17 grepai tool definitions exist but are not registered; overlap with `semantic.ts`.
6. **Subagents:** `delegate_task` is basic in-process spawning, not isolated worker pools.
7. **Provider naming:** `OpenRouterClient` used for OpenCode/default—confusing for contributors.
8. **M2 work:** Large uncommitted diff (agent loop, TUI, tools)—stability not yet merged/released.
9. **No Tier 5:** Adversarial/red-team E2E suite planned under M5 only.