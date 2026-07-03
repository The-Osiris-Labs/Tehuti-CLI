# 𓆣 Tehuti CLI — Agent Instructions

Sacred instructions for AI agents working in this codebase. This document reflects **what the code actually does**, not roadmap promises.

## 🏛️ Purpose

Tehuti CLI is a **TypeScript-only**, **Node.js 20+** terminal coding agent. It connects to LLM providers through custom HTTP clients in `src/api/` (native `fetch` + hand-rolled SSE parsing). The default provider is **OpenCode Go** (`opencode` → `https://opencode.ai/zen/go/v1`).

**Runtime reality:** The shipped binary is pure Node/TS. A `rust-core/` directory exists in the repo but is **not linked into the runtime** — do not assume Rust is active.

**Core responsibilities:**
- Interactive TUI chat (`src/cli/commands/chat.ts`) and one-shot CLI prompts
- Agent loop with tool execution (`src/agent/loop/runner.ts`)
- File system, search, bash, web, git, MCP, memory, skills, and extension tools
- Session persistence and Egyptian-themed terminal output

---

## 🏗️ Architecture

```
Tehuti-CLI-Revival/
├── src/
│   ├── index.ts                    # Entry: HTTP agent init, CLI bootstrap
│   ├── api/                        # Provider clients (fetch + SSE streaming)
│   │   ├── openrouter.ts           # OpenRouter / OpenCode / compatible providers
│   │   ├── kilocode.ts             # KiloCode provider client
│   │   ├── custom-provider.ts      # Custom OpenAI-compatible adapter
│   │   ├── streaming.ts            # Stream chunk processing
│   │   ├── model-capabilities.ts   # Reasoning model detection
│   │   ├── http-agent.ts           # undici connection pooling
│   │   ├── cost.ts                 # Per-request cost tracking
│   │   └── models.ts               # Model list fetching
│   ├── agent/
│   │   ├── index.ts                # Tool registration, public agent API
│   │   ├── loop/
│   │   │   ├── runner.ts           # ★ Agent loop (stream → tools → repeat)
│   │   │   ├── tool-processing.ts  # Permission checks, cache, parallel dispatch
│   │   │   ├── compression.ts      # LLM-based context compression in loop
│   │   │   └── retry.ts            # API retry wrapper
│   │   ├── context.ts              # Messages, system prompt, compactContext()
│   │   ├── context-compressor.ts   # LLM summarization for compression
│   │   ├── model-router.ts         # Keyword-based tier routing (session start)
│   │   ├── parallel-executor.ts    # Parallel safe read-only tools
│   │   ├── prefetcher.ts           # Rule-based next-tool prefetch
│   │   ├── cache/                  # LRU tool cache + disk persistence
│   │   ├── skills/                 # Built-in + user skills
│   │   ├── memory/                 # Insight graph
│   │   ├── subagents/              # Subagent spawning (system tools)
│   │   ├── swarm/                  # Swarm delegation support
│   │   ├── shadow-workspace.ts     # ⚠️ DEAD — not registered
│   │   └── tools/                  # All tool implementations
│   ├── cli/
│   │   ├── index.ts                # Commander program
│   │   ├── commands/
│   │   │   └── chat.ts             # ★ Monolithic TUI (~3700 LOC)
│   │   └── ui/
│   │       ├── components/         # Ink/React components
│   │       └── hooks/              # useChatState, useChatInput
│   ├── config/
│   │   ├── loader.ts               # Config merge precedence
│   │   ├── schema.ts               # Zod schema + DEFAULT_CONFIG
│   │   ├── providers.ts            # Provider registry + base URLs
│   │   └── wizard.ts               # First-run setup wizard
│   ├── mcp/                        # MCP client + dynamic tool adapter
│   ├── hooks/                      # Hook executor (code exists, config unwired)
│   ├── permissions/                # Permission prompts and rules
│   ├── session/                    # Session save/load
│   ├── terminal/                   # Markdown, buffering, highlighting
│   ├── branding/                   # Egyptian theme constants
│   └── utils/                      # Telemetry, debug, mutex, logger
├── tests/e2e/                      # End-to-end tests
├── tools/grepai                    # Bundled grepai binary (used by semantic tools)
├── dist/index.js                   # Production bundle (~650 KB)
├── rust-core/                      # Not in runtime — experimental/unwired
├── AGENTS.md                       # This file
└── HANDOFF.md                      # TUI scroll architecture — read before editing chat.ts
```

### Architectural notes

| Component | Reality |
|-----------|---------|
| `chat.ts` | Monolithic: CLI routing, Ink TUI, slash commands, agent invocation, config editor — all in one file |
| `agent/index.ts` | Registers tools, exposes `runAgentLoop` / `runOneShot`; delegates loop to `loop/runner.ts` |
| `api/openrouter.ts` | Singleton client used for OpenRouter, OpenCode, and other OpenAI-compatible providers |
| MCP tools | Static prompt tools registered at startup; server tools registered dynamically via `syncMCPToolRegistry()` |

---

## 🛠️ Key Technologies

| Layer | Choice |
|-------|--------|
| Runtime | Node.js ≥ 20 (ESM) |
| Language | TypeScript only |
| CLI framework | Commander.js |
| TUI | Ink 6 + React 19 |
| Validation | Zod |
| Config | `conf` (global) + cosmiconfig (project) |
| HTTP | `fetch` + undici Agent pooling |
| Search | `@lvce-editor/ripgrep`, `tinyglobby` |
| Shell | `just-bash` (sandboxed bash tool) |
| MCP | `@modelcontextprotocol/sdk` |
| AST | `tree-sitter` + `tree-sitter-typescript` |
| Lint | Biome (not ESLint) |
| Build | tsup |
| Test | Vitest |

---

## 📜 Development

```bash
npm install          # Install dependencies
npm run build        # Production bundle → dist/index.js (~650 KB)
npm test             # 570 unit tests (2 skipped)
npm run test:e2e     # 106 e2e tests (1 known failure in tier1.test.ts)
npm run typecheck    # tsc --noEmit (clean)
npm run lint         # biome check src/
npm start            # tsx src/index.ts (dev)
```

**Current verified status (2026-06-29):**
- Unit: **570 passed**, 2 skipped
- E2E: **105 passed**, 1 failed (known: `tests/e2e/tier1.test.ts` line-count assertion)
- TypeScript: **clean**
- Build output: **~668 KB** (`dist/index.js`)

---

## 🔮 Configuration

Loaded in `src/config/loader.ts`. **Precedence (lowest → highest):**

1. `DEFAULT_CONFIG` (`src/config/schema.ts`)
2. Global conf store (`~/.config/tehuti/config.json` via `conf` package)
3. Project cosmiconfig (`.tehuti.json`, `.tehuti.yaml`, `.tehuti.yml`, `.tehuti.js`, `package.json` `tehuti` key)
4. Environment variables (override file values)

**Defaults:**
- Model: `deepseek-v4-flash`
- Provider: `opencode`
- Base URL: resolved per provider (`https://opencode.ai/zen/go/v1` for opencode)

**Key environment variables:**

| Variable | Effect |
|----------|--------|
| `TEHUTI_MODEL` | Override model |
| `TEHUTI_PROVIDER` | Override provider |
| `TEHUTI_BASE_URL` | Override API base URL |
| `TEHUTI_API_KEY` | API key (highest priority) |
| Provider-specific keys | e.g. `OPENROUTER_API_KEY` (see `providers.ts`) |
| `TEHUTI_DEBUG` | Enable debug logging |
| `TEHUTI_CUSTOM_PROVIDER` | JSON override for custom provider config |

**Model selection modes** (`modelSelection` in config):
- `auto` — keyword heuristics route to fast/balanced/deep tiers (default)
- `manual` — always use configured `model`
- `cost-optimized` / `speed-optimized` — prefer cheaper/faster tiers

Model routing runs **once at session start** in `runner.ts` (not per iteration).

---

## 🔄 Agent Loop Flow

Entry: `runAgentLoop()` in `src/agent/index.ts` → `src/agent/loop/runner.ts`

```
1. createAgentContext / setParentContext
2. Build system prompt (first message only)
3. addUserMessage
4. Model routing (keyword classifyTask → selectModelForClassification) — once
5. syncMCPToolRegistry() — register dynamic mcp_* tools
6. LOOP (maxIterations, default 50):
   a. manageContextWindow() — LLM compression if >85% context (compression.ts)
   b. normalizeToolMessageHistory()
   c. client.streamChat() — SSE stream via fetch
   d. processStreamChunk() — tokens, thinking, tool_calls
   e. If no tool calls → return content
   f. prefetcher.predict() on FIRST tool call only in the batch
   g. processToolCalls() — permissions, hooks, cache, parallel/sequential execution
   h. Add tool results to context → next iteration
7. saveCacheToDisk on shutdown
```

**Two compression systems (do not conflate):**

| System | Trigger | Method | File |
|--------|---------|--------|------|
| In-loop compression | Auto at ~85% of `maxContextLength` during agent loop | LLM summarization via `compressContext()` | `loop/compression.ts`, `context-compressor.ts` |
| `/compact` command | User-initiated slash command | Simple placeholder summary, keeps system + last 6 messages | `context.ts` → `compactContext()` |

---

## 🛠️ Tools

Registered in `src/agent/index.ts` via `registerTools([...])`:

| Category | Tools |
|----------|-------|
| **AST** | `parse_ast` |
| **Filesystem** | `read`, `write`, `edit`, `create_dir`, `delete_file`, `delete_dir`, `copy`, `move`, `list_dir`, `file_info`, `read_image`, `read_pdf` |
| **Search** | `glob`, `grep`, `find_references`, `go_to_definition` |
| **Repo** | `repo_map` |
| **Bash** | `bash` |
| **Web** | `web_fetch`, `web_search`, `code_search` |
| **System** | `todo_write`, `task`, `question` |
| **MCP prompts** | `mcp_get_prompt`, `mcp_list_prompts` |
| **Memory** | `store_insight`, `query_memory` |
| **Background** | `start_background`, `list_processes`, `read_output`, `kill_process` |
| **Plan mode** | `write_plan`, `exit_plan_mode` |
| **Git** | `git_status`, `git_diff`, `git_log`, `git_add`, `git_commit`, `git_branch`, `git_remote`, `git_pull`, `git_push` |
| **Skills** | `list_skills`, `activate_skill`, `deactivate_skill`, `find_skills`, `get_skill`, `create_reusable_skill` |
| **Semantic** | `semantic`, `semantic_init`, `semantic_status`, `semantic_trace` (wraps `tools/grepai` binary) |
| **Workspace**| `shadow_workspace` |
| **KiloCode** | `configure_memory_bank`, `clear_memory`, `configure_streaming`, `configure_context_management`, `review_code`, `summarize_context` |
| **Collaboration** | `configure_collaboration`, `invite_collaborator`, `leave_collaboration` |
| **Custom provider** | `configure_custom_provider`, `set_custom_header`, `remove_custom_header`, `get_custom_provider_info` |
| **Swarm** | `delegate_task`, `check_subagent_status` |
| **Dynamic MCP** | `mcp_<server>_<tool>` — registered at runtime from connected MCP servers |

### Dead / unregistered code

These files exist but are **not** in `registerTools()`:

| File | Notes |
|------|-------|
| `src/agent/tools/grepai.ts` | Standalone grepai tools — superseded by `semantic.ts` |
| `src/agent/tools/grepai-cache.ts` | Grepai cache tools — not registered |
| `src/agent/tools/grepai-mcp.ts` | Grepai MCP serve tools — not registered |
| `src/agent/tools/grepai-advanced.ts` | Advanced grepai config — not registered |

Do not assume these are available to the agent unless you register them.

### Tool permissions

- **Safe (parallel-eligible):** read, glob, grep, list_dir, web_fetch, web_search, git_status, git_log, git_diff, etc. (`SAFE_PARALLEL_TOOLS` in `parallel-executor.ts`)
- **Destructive (require permission):** write, edit, bash, git_write ops
- **Interactive:** `question` — blocks parallel execution
- **Readonly mode:** blocks all write tools

---

## ⚡ Performance (Honest Limits)

What actually works vs. what marketing might imply:

| Feature | Reality |
|---------|---------|
| **Parallel execution** | Only when the model returns **multiple tool calls in a single turn**. Safe read-only tools run in parallel (max 5 concurrency). Writes and `question` force sequential. |
| **Prefetching** | `prefetcher.predict()` runs on the **first tool call only** in each batch (`runner.ts` line ~220). Rule-based (read → file_info/list_dir, git_status → git_diff). Max 10 queued prefetches. |
| **Model routing** | Keyword heuristics (`DEEP_KEYWORDS`, `FAST_KEYWORDS`) applied **once at session start**, not per message or per tool. |
| **Tool cache** | LRU with mtime invalidation; persists to `~/.config/tehuti/` cache dir. Helps repeated identical reads. |
| **Connection pooling** | undici Agent in `http-agent.ts` — reduces TLS overhead for repeated API calls. |
| **Context compression** | Two separate systems (see above). In-loop uses an extra LLM call. `/compact` is cheap but lossy. |
| **Telemetry** | `getTelemetry()` always collects in-memory metrics for `/stats`. The `telemetry: true` config flag is **not wired** — collection happens regardless. |

---

## ⚠️ TUI Warnings

**Before editing `src/cli/commands/chat.ts`, read [HANDOFF.md](./HANDOFF.md).**

### Virtual sliding viewport (critical)

Scrolling uses a **negative margin**, not array slicing for scroll position:

```tsx
<Box flexDirection="column" marginBottom={-scrollOffset}>
```

- Parent has `overflow="hidden"`
- Negative `marginBottom` physically slides the rendered column
- **Do not** slice the full message array for scrolling — causes React remounts and destroys scroll state

### Hybrid performance slice

For rendering performance, `visibleMessages` **does** slice messages to viewport + buffer:

```ts
// chat.ts ~line 2030
return messages.slice(Math.min(sliceIndex, Math.max(0, messages.length - 50)));
```

This is intentional: negative margin handles scroll position; slicing limits what Ink renders. Do not remove the hybrid approach without understanding both mechanisms.

### Other TUI facts

- Mouse support via `@ink-tools/ink-mouse` on Command Palette and Config Editor
- Input bar hidden when palette/config editor is open
- `TehutiHeader` collapses after first message
- Reasoning models show spinner + truncated thinking text (not bordered blocks)

---

## 🚧 Known Gaps (Unwired Features)

| Feature | Status |
|---------|--------|
| **grepai standalone tools** | Full tool suite in `grepai*.ts` files — dead code; use `semantic` tools instead |
| **rust-core** | Present in repo, not in Node runtime |

---

## 🎨 Visual Theme

Egyptian-inspired palette (see `src/branding/`):

| Color | Hex | Usage |
|-------|-----|-------|
| Gold | `#D4AF37` | Primary accent, Tehuti brand |
| Sand | `#C2B280` | Secondary text |
| Coral | `#D97757` | User messages |
| Green | `#10B981` | Assistant responses |
| Nile | `#2E5A6B` | Subtle accents |
| Obsidian | `#1A1A2E` | Backgrounds |

Key symbols: 𓆣 (ibis/Tehuti), 𓁹 (visibility), 𓂀 (errors), 𓋹 (success), 𓏛 (input), 𓊖 (lists)

---

## 🗝️ Key Files

| File | Why it matters |
|------|----------------|
| `src/cli/commands/chat.ts` | Entire interactive TUI — tread carefully |
| `HANDOFF.md` | Scroll/viewport architecture |
| `src/agent/loop/runner.ts` | Agent loop orchestration |
| `src/agent/index.ts` | Tool registration, public API |
| `src/agent/loop/tool-processing.ts` | Tool dispatch, permissions, caching |
| `src/config/loader.ts` | Config precedence |
| `src/config/schema.ts` | Defaults and validation |
| `src/api/openrouter.ts` | Primary provider client + SSE |
| `src/agent/parallel-executor.ts` | Parallel tool batching |
| `src/agent/context-compressor.ts` | LLM summarization |
| `src/agent/context.ts` | `compactContext()` for `/compact` |
| `src/mcp/client.ts` | MCP connection + dynamic tools |
| `src/terminal/markdown.ts` | ANSI markdown rendering |

---

## 🚀 Running Tehuti

```bash
node dist/index.js                          # Interactive TUI
node dist/index.js "your prompt"              # One-shot
node dist/index.js --model <id> "prompt"     # Override model
node dist/index.js --json "prompt"            # JSON output
node dist/index.js --quiet "prompt"           # Suppress tool output
```

Sessions: `~/.config/tehuti/sessions/` (save/load via `/save`, `/load`, `/sessions`)

---

## 📚 Session History

### 2026-07-02 — Completing Missing Features
- Registered `shadowWorkspaceTool` and `createReusableSkillTool`.
- Confirmed `hooks`, `telemetry`, `MCP sampling`, and `Question UI` were already fully wired in previous recent commits.

### 2026-06-29 — AGENTS.md rewrite

Rewrote this document to match actual codebase state:
- Corrected defaults (`deepseek-v4-flash`, `opencode`)
- Documented monolithic `chat.ts` and `loop/runner.ts` split
- Listed registered vs. dead tools honestly
- Documented hybrid TUI viewport (negative margin + `visibleMessages` slice)
- Recorded unwired features (hooks, telemetry flag, MCP sampling, question UI)
- Updated test counts (570 unit, 106 e2e with 1 known fail) and build size (~650 KB)