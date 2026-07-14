# Tehuti CLI — Project Overview & Architecture

Tehuti CLI is a TypeScript/Node.js terminal coding assistant with an Ink/React TUI, an OpenAI-compatible agent loop, and a large native tool registry. It targets developers who want a local, configurable harness—not a hosted IDE plugin. Default provider is **OpenCode Go** (`opencode`); the HTTP client is OpenAI-compatible and works with OpenRouter, local Ollama/LM Studio, and custom base URLs.

**What it is not:** It is not a hosted IDE plugin. The project runs completely locally. Following the v1.0.0 release, Tehuti also serves as a persistent personal companion via a background daemon. Subagent and swarm delegation features are fully operational: `delegate_task` spawns subagents via `fork()` for process isolation, with robust status tracking, timeouts, and leak-safe message passing. Legacy grepai-named tool files were purged; semantic search is handled by the registered `semantic` tools.

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
   |  loop/runner.ts    |  |  permissions    |  | StandardAPIClient|
   |  parallel executor |  |  hooks, MCP     |  |  (any OpenAI    |
   |  compressor        |  |                 |  |  compat endpoint)|
   |  prefetcher        |  +-----------------+  +-----------------+
   |  memory graph      |
   +----------+---------+
              |
   +----------v---------+
   |   Tool Registry    |
   |  86 native + MCP   |
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
- `StandardAPIClient` wraps any OpenAI-compatible endpoint configured in `TehutiConfig`.
- Anthropic-native format is not first-class; non-compatible providers throw at client creation.
- Subagent `delegate_task` spawns separate processes via `fork()`, but it is a local tool rather than a distributed multi-agent orchestration platform.
- Plan mode gates tools but is opt-in state, not enforced sandboxing.

### Supporting modules

| Module | Path | Role |
|--------|------|------|
| Parallel executor | `parallel-executor.ts` | Batches read-only tools (max 5 concurrent); serializes writes/interactive |
| Context compressor | `context-compressor.ts` | Triggers ~85% token threshold; deterministic array truncation (no LLM call) |
| Prefetcher | `prefetcher.ts` | Rule/history-based read prefetch; invalidated on writes/bash |
| Memory graph | `memory/graph.ts` | SQLite relational graph DB (`insights`, `edges`) + `personality` engine |
| Self-healing | `loop/self-healing.ts` | Ephemeral `git worktree` loops to speculatively test/verify code |
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

### Native inventory (86 registered in src/agent/index.ts)

| Category | Count | Examples |
|----------|------:|----------|
| Filesystem | 12 | `read`, `write`, `edit`, `list_dir`, `read_image`, `read_pdf`, … |
| Search | 4 | `glob`, `grep`, `find_references`, `go_to_definition` |
| AST / repo | 3 | `parse_ast`, `apply_diff`, `repo_map` |
| Semantic (grepai CLI) | 4 | `semantic`, `semantic_init`, `semantic_status`, `semantic_trace` |
| Bash | 1 | `bash` |
| Web | 3 | `web_fetch`, `web_search`, `code_search` |
| Git | 9 | `git_status` … `git_push` |
| Background | 4 | `start_background`, `list_processes`, … |
| System | 6 | `todo_write`, `todo_complete`, `todo_delete`, `task`, `question`, `wait_for_event` |
| Memory | 2 | `store_insight`, `query_memory` |
| Plan mode | 4 | `write_plan`, `exit_plan_mode`, `list_plans`, `read_plan` |
| Skills | 6 | `list_skills`, `activate_skill`, `create_reusable_skill` … |
| MCP prompts | 2 | `mcp_get_prompt`, `mcp_list_prompts` |
| Env | 1 | `env_inspect` |
| Network | 1 | `network_check` |
| Service | 1 | `service_status` |
| Swarm | 6 | `delegate_task`, `check_subagent_status`, `await_subagents`, `list_subagents`, `abort_subagent`, `send_message_to_subagent` |
| LSP | 4 | `lsp_find_references`, `lsp_go_to_definition`, `lsp_rename_symbol`, `lsp_hover` |
| KiloCode | 3 | `configure_memory_bank`, `clear_memory`, `configure_streaming` |
| KiloCode Advanced | 2 | `review_code`, `summarize_context` |
| Custom Provider | 4 | `configure_custom_provider`, `set_custom_header`, `remove_custom_header`, `get_custom_provider_info` |
| Collaboration | 1 | `collaboration` |
| Shadow Workspace | 1 | `test_speculatively` |
| **Total native** | **86** | |

### MCP (dynamic)

`mcpManager` connects stdio/SSE servers; `syncMCPToolRegistry` registers `mcp_<server>_<tool>` at loop start. Count varies per user config.

### Dead / unregistered code

The legacy `grepai*.ts` tool files were purged as part of Phase 3 cleanup and no longer exist. The registered `semantic.ts` tools (`semantic`, `semantic_init`, `semantic_status`, `semantic_trace`) wrap the bundled `tools/grepai` binary.

---

## API Layer

| File | Reality |
|------|---------|
| `api/standard-client.ts` | `StandardAPIClient`—generic OpenAI-compatible chat completions + streaming |
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
├── daemon/                  # Background server, socket IPC, state engine
├── messaging/               # Connectors (Slack, Discord, etc.) & sessions
├── mcp/                     # MCP client & tool adapter
├── session/                 # Atomic session save/load (`session.json`)
├── permissions/             # Tool permission prompts
├── terminal/                # ANSI output, markdown, computeMessageLines
└── utils/                   # mutex, telemetry, errors
```

Tests: unit co-located `src/**/*.test.ts`; E2E in `tests/e2e/**/*.test.ts`.

---

## Milestones (July 2026)

| # | Objective | Status | Notes |
|---|-----------|--------|-------|
| **M1** | E2E testing track (tiers 1–4) | **DONE** | 105/106 passing; 1 known fail (tier1 test 26) |
| **M2** | Agent core hardening | **DONE** | Self-healing loop, atomic writes, and personality learning merged |
| **M3** | Advanced tooling | **DONE** | Background daemon, messaging connectors, and robust Swarm lifecycle merged |
| **M4** | TUI polish | **DONE** | ANSI tables, scroll badges, and multi-line input merged |
| **M5** | Integration & adversarial hardening | **PLANNED** | Tier 5 adversarial suite not started |

---

## Baseline Verification (July 2026 - v1.0.0)

| Check | Result |
|-------|--------|
| Unit tests (`npm test`) | **570 passed**, **2 skipped** (572 total) |
| E2E (`npm run test:e2e`) | **105 passed**, **1 failed** (106 total) |
| Typecheck (`npm run typecheck`) | **Clean** (`tsc --noEmit`) |
| Build (`npm run build`) | **Success** — `dist/index.js` **~652 KB** |

---

## Advanced Architectural Streams

The following architectural streams have been newly integrated into the Tehuti-CLI ecosystem:

1. **Speculative Multi-Path Execution**: Allows the agent to explore multiple tool-execution or reasoning paths concurrently, evaluating outcomes before committing to the optimal solution.
2. **Autonomous MCP Workflow Orchestrator**: A robust system that orchestrates complex, multi-step workflows utilizing Model Context Protocol (MCP) tools entirely autonomously.
3. **Autonomous Speculative Background Refactor**: Continuously analyzes the codebase in the background and speculatively prepares safe, non-breaking refactors for user review.
4. **Cross-Platform Ambient Context Continuity**: Ensures seamless persistence and synchronization of agent memory, active tasks, and context across the CLI, background daemon, and messaging platforms.
5. **Swarm Profiler & Time-Travel Replay**: Provides deep introspection into swarm subagent lifecycles and performance, alongside a replay mechanism to step through past agent iterations for debugging.

---

## Known Gaps

1. **TUI:** `chat.ts` size (~3.7k lines) blocks maintainability; React duplicate-key warnings in some E2E renders.
2. **Memory:** Edge relations stored but unused in retrieval/prompt injection.
3. **Skills:** Built-in skill loader has `TODO`; activation is flag-only, not behavioral.
4. **Tools:** Legacy `grepai*.ts` tool files were purged in Phase 3 cleanup; semantic search is handled by registered `semantic.ts` tools wrapping the `tools/grepai` binary.
5. **Provider naming:** `StandardAPIClient` (`src/api/standard-client.ts`) handles OpenCode/default and any OpenAI-compatible provider.
6. **No Tier 5:** Adversarial/red-team E2E suite planned under M5 only.