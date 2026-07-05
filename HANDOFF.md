# 𓆣 Tehuti CLI — Handoff Document

Contributor guide for the Tehuti CLI codebase. This document reflects **what the code actually does** as of June 2026. For agent-oriented instructions see [AGENTS.md](./AGENTS.md). For architecture depth see [PROJECT.md](./PROJECT.md).

---

## What Tehuti Is

Tehuti is a **TypeScript-only**, **Node.js 20+** terminal coding agent powered by React 19 and Ink 6:

- **Interactive mode:** React/Ink TUI in `src/cli/commands/chat.ts`
- **One-shot mode:** ANSI streaming via `src/terminal/buffered-writer.ts`
- **Agent loop:** `src/agent/loop/runner.ts` — stream LLM → execute tools → repeat
- **API:** Custom `fetch` + SSE clients (HTTP/3) in `src/api/` (not Vercel AI SDK)
- **Default provider:** OpenCode Go (`opencode` → `https://opencode.ai/zen/go/v1`, model `deepseek-v4-flash`)
- **Tools:** 73 registered native tools + dynamic MCP tools at runtime

**Not in the shipped path:** ai / @openrouter/ai-sdk-provider / @aiter/core deps (unused in src/). (Note: `rust-core/` is actively compiled to a `.node` binary and dynamically loaded in `src/agent/tools/search.ts` for fast case-sensitive pattern grep).

---

## Key Modules

| Path | Role |
|------|------|
| `src/index.ts` | Entry: undici init, Shiki, CLI bootstrap |
| `src/cli/commands/chat.ts` | **Monolith (~3,700 LOC):** CLI routing, Ink TUI, session handlers, agent callbacks, inline markdown renderer |
| `src/cli/ui/` | Extracted components (`CommandPalette`, `ConfigEditor`, hooks) |
| `src/agent/index.ts` | Tool registration, `runAgentLoop` / `runOneShot` public API |
| `src/agent/loop/runner.ts` | Core agent iteration loop |
| `src/agent/loop/tool-processing.ts` | Permissions (IBAC), hooks, cache, parallel/sequential dispatch |
| `src/api/openrouter.ts` | `OpenRouterClient` — generic OpenAI-compatible client (misnomer; handles OpenCode, OpenRouter, etc.) |
| `src/mcp/client.ts` | MCP manager (stdio, http, sse, websocket) |
| `src/config/loader.ts` | Config merge precedence |
| `src/terminal/output.ts` | `computeMessageLines()` for viewport height estimation |
| `src/terminal/markdown.ts` | ANSI markdown (one-shot mode only) |

---

## ⚠️ CRITICAL: TUI Viewport (Read Before Editing `chat.ts`)

Scrolling uses a **hybrid** approach. Both mechanisms matter.

### 1. Scroll position — negative margin (do not break)

```tsx
<Box overflow="hidden" justifyContent="flex-end">
  <Box flexDirection="column" marginBottom={-scrollOffset}>
    {messageElements}
  </Box>
</Box>
```

- `scrollOffset = 0` pins to bottom; higher values slide content up into history
- **Do not** slice the message array to *change scroll position* — that remounts Ink components and destroys scroll state, click handlers on tool outputs, and expand/collapse state

### 2. Render performance — `visibleMessages` slice (intentional)

For performance, the TUI also slices which messages Ink renders:

```ts
// chat.ts ~line 2030
return messages.slice(Math.min(sliceIndex, Math.max(0, messages.length - 50)));
```

- Negative margin handles **where** the viewport points
- Slicing limits **how many** messages Ink mounts
- Removing the slice without an alternative will hurt performance on long sessions
- Do not conflate "no slice for scrolling" with "never slice at all"

### Line height estimation

`computeMessageLines()` in `src/terminal/output.ts` drives scroll math. Known gap: array-shaped `msg.content` (e.g. `[{ type: "text" }, { type: "reasoning" }]`) is not handled — only `msg.blocks` or string `content`. This causes E2E tier1 test 26 to fail (expects 7 lines, gets 2).

---

## Agent Loop (Actual Flow)

```
runAgentLoop (runner.ts)
  1. setParentContext, getPrefetcher
  2. buildSystemPrompt if empty
  3. addUserMessage
  4. classifyTask + selectModel (once per session, keyword heuristics)
  5. syncMCPToolRegistry
  LOOP (maxIterations):
    a. manageContextWindow (deterministic array truncation at ~85%)
    b. normalizeToolMessageHistory
    c. streamChat → processStreamChunk → onToken/onThinking
    d. if no tool calls → return
    e. prefetcher.predict(toolCalls[0] only)
    f. processToolCalls (permissions, hooks, cache, parallel or sequential)
```

**Honest performance limits:**
- Parallel execution only when the model returns **multiple** tool calls in one turn (max 5 safe reads)
- Prefetch runs on the **first** tool call in each batch only
- Model routing runs **once** at session start, not per message

**Two compression systems:**
- In-loop: Deterministic array truncation (splicing out oldest messages) via `loop/compression.ts` (~85% threshold)
- `/compact`: cheap placeholder compaction via `compactContext()` in `context.ts` (no LLM)

---

## Tools

Registered in `src/agent/index.ts` at module load. MCP tools sync each loop iteration.

**Categories:** fs, search, repo_map, bash, web, git, memory, background, plan, skills, semantic (grepai binary), ast (parse_ast), swarm, kilocode, collaboration, custom provider, system (todo/task/question), MCP prompts, dynamic MCP.

**Dead code (implemented, not registered):** `grepai-*.ts` (~17 tools).

**Skills:** Prompt injection only. Three built-in (JS/TS, Python, Git) + user JSON in `~/.tehuti/skills/`. Activation is in-memory; not persisted.

**Memory graph:** SQLite DB at `~/.config/tehuti/memory/graph.db`. Merges Okapi BM25 sparse vector queries with Breadth-First search traversal on the relational edges, decaying scores by `0.5 ** depth`. Exposes Jaccard similarity-based optimization.

---

## Configuration

Merge order (`src/config/loader.ts`):

1. `DEFAULT_CONFIG` / Zod schema defaults
2. Global `conf` store (`~/.config/tehuti/`, written by wizard and `/config`)
3. Project cosmiconfig (`.tehuti.json`, etc.)
4. Environment: `TEHUTI_PROVIDER`, `TEHUTI_MODEL`, `TEHUTI_BASE_URL`, `TEHUTI_API_KEY`, provider-specific keys

Defaults: `provider: "opencode"`, `model: "deepseek-v4-flash"`.

---

## Known Gaps (Do Not Assume These Work)

| Feature | Status |
|---------|--------|
| **Palette `/load` submenu** | Passes session ID but `handleLoad` ignores it |
| **Mid-session auto-save** | None — only `/save` or clean exit (Ctrl+C with empty input) |
| **Two markdown pipelines** | Ink `renderMarkdown()` vs ANSI `renderMarkdownToAnsi()` — feature parity gaps |

---

## TUI Features (Working)

1. **Mouse support** (`@ink-tools/ink-mouse`) on Command Palette and Config Editor
2. **Terminal images** via `MediaViewer` / `terminal-image` (local files only; remote URLs rejected)
3. **Reasoning UI** — spinner + truncated thinking text during stream
4. **UI clash prevention** — input bar hidden when palette/config editor open; header collapses after first message
5. **Custom keyboard input** in `useChatInput.ts` — history, selection, bracketed paste, Emacs bindings

Extracted components: `CommandPalette.tsx`, `ConfigEditor.tsx`, `ExpandableToolOutput.tsx`, `TehutiHeader.tsx`, `MediaViewer.tsx`, `SwarmVisualizer.tsx`.

---

## Testing & Build

```bash
npm run typecheck   # tsc --noEmit
npm test            # 570 passed, 2 skipped (unit, src/**/*.test.ts)
npm run test:e2e    # 105 passed, 1 failed (106 total, tests/e2e/)
npm run build       # tsup → dist/index.js ~684 KB
npm run lint        # biome check src/
```

**Known E2E failure:** `tests/e2e/tier1.test.ts` test 26 — `computeMessageLines` array `content` handling.

See [TEST_INFRA.md](./TEST_INFRA.md) and [TEST_READY.md](./TEST_READY.md).

---

## Safe Change Guidelines

1. **Read this file and AGENTS.md before touching `chat.ts`**
2. **Do not break the negative-margin scroll model**
3. **Register new tools in `src/agent/index.ts`** via `registerTools([...])`
4. **Match existing patterns:** Zod params, `ToolResult`, `requiresPermission`, `isReadonly`
5. **Run full gate before PR:** `typecheck && test && test:e2e && build`
6. **Update docs** when changing defaults, tool lists, or config schema

---

## Related Docs

| Doc | Purpose |
|-----|---------|
| [README.md](./README.md) | User-facing overview |
| [AGENTS.md](./AGENTS.md) | AI agent instructions |
| [PROJECT.md](./PROJECT.md) | Architecture and milestones |
| [TEST_INFRA.md](./TEST_INFRA.md) | Test philosophy and tiers |
| [TEST_READY.md](./TEST_READY.md) | Current test status |