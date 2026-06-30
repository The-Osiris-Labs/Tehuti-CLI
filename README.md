𓅞 Thoth, Tongue of Ra

Halls of Records • Balance of Ma'at • Architect of Truth

---

# 𓆣 Tehuti CLI

Tehuti is a Node.js 20+ agent CLI for software development. It runs a local agent loop against OpenAI-compatible `/chat/completions` APIs (custom `fetch` + SSE streaming via `undici`, not the Vercel AI SDK), presents a React/Ink terminal UI or one-shot ANSI streaming output, and exposes roughly 68 built-in tools plus dynamically registered MCP tools. The default provider is OpenCode Go (`https://opencode.ai/zen/go/v1`) with model `deepseek-v4-flash`. Egyptian theming (gold palette, hieroglyphs, deity naming) is visual branding only—it does not affect runtime behavior.

The shipped codebase is TypeScript-only. A `rust-core/` directory exists with artifacts but is not wired into the build or CLI path.

---

## Features

- OpenAI-compatible LLM client (`OpenRouterClient`) supporting ~18 named providers (OpenRouter, OpenCode, KiloCode, Ollama, LM Studio, Anthropic, OpenAI, xAI, DeepSeek, Google, and others) plus a custom provider adapter
- React/Ink TUI with mouse-aware command palette, virtual sliding viewport scrolling, and interactive config editor
- One-shot mode with live ANSI token streaming, optional JSON output (`-j`), and quiet mode (`-q`)
- Agent loop with tool-call caching, predictive prefetch for read-only tools, parallel execution of safe read-only tool batches (up to 5 concurrent), and LLM-driven context compression near window capacity
- ~68 registered tools covering filesystem, search, bash, git, web, semantic search, planning, memory, skills, swarm delegation, and more
- MCP client with four transports: `stdio`, `http`, `sse`, `websocket`
- Skills system: prompt injection only—3 built-in expertise profiles (JavaScript/TypeScript, Python, Git) plus user-defined JSON skills in `~/.tehuti/skills/`
- Session persistence via explicit `/save` and `/load` (no automatic mid-session checkpointing)
- Permission modes: interactive, trust, and read-only; plan mode for read-only exploration

---

## Installation & Quick Start

Requires Node.js 20 or later.

```bash
git clone https://github.com/The-Osiris-Labs/Tehuti-CLI-Revival.git
cd Tehuti-CLI-Revival
npm install
npm run build
```

Run the setup wizard to configure provider and API key:

```bash
npm run start -- init
# or after linking/installing globally:
tehuti init
```

Set an API key for the default OpenCode provider:

```bash
export OPENCODE_API_KEY=your-key-here
# TEHUTI_API_KEY also works across providers
```

Launch interactive mode:

```bash
npm run start
```

---

## Usage

### Interactive TUI

```bash
tehuti
# or during development:
npm run start
```

Type `/` with an empty input to open the command palette. Arrow keys, Tab completion, and mouse interaction are supported where the terminal allows.

### One-shot prompts

```bash
tehuti "Refactor the authentication logic in src/auth.ts"
tehuti -m deepseek-v4-flash "Summarize this repository"
tehuti -j "Return structured output"          # JSON response envelope
tehuti -q "Quick answer without tool noise"   # suppress intermediate tool output
```

### CLI flags

| Flag | Description |
|------|-------------|
| `-m, --model <model>` | Override the active model |
| `-p, --provider <id>` | Override provider (`opencode`, `openrouter`, `kilocode`, `ollama`, etc.) |
| `-d, --debug` | Enable debug logging |
| `-j, --json` | Emit final result as JSON (one-shot mode) |
| `-q, --quiet` | Suppress tool call/result output (one-shot mode) |
| `--diff` | Show diff preview before file edits |
| `--diff-auto` | Show diff preview and auto-approve |
| `--no-mcp` | Disable MCP server connections |
| `--reset-key` | Clear persisted credentials and re-run setup |
| `-v, --version` | Print version |

### Subcommands

| Command | Description |
|---------|-------------|
| `tehuti init` | Interactive setup wizard |
| `tehuti config` | Print current persisted config (API key masked) |
| `tehuti mcp [status\|tools\|connect\|disconnect]` | MCP server management |

Interactive mode requires a TTY. Piping or running without a prompt in a non-TTY environment exits with an error.

---

## Slash Commands

Available in interactive sessions (palette via `/` or direct typing):

| Command | Description |
|---------|-------------|
| `/help` (`/h`) | Show commands and keyboard shortcuts |
| `/clear` (`/cls`, `/c`, `Ctrl+L`) | Clear conversation history |
| `/model` | Switch model (interactive submenu) |
| `/models` | List models for the current provider |
| `/provider` | Switch provider (interactive submenu) |
| `/thinking` | Toggle extended thinking mode |
| `/plan` | Enter read-only plan mode |
| `/compact` | Force LLM context compression |
| `/skills` | List available skills |
| `/save [name]` | Save session to disk |
| `/load` | Load a saved session (submenu) |
| `/sessions` | List saved sessions |
| `/cost` | Show token usage and estimated cost |
| `/stats` | Show cache and parallel execution metrics |
| `/config` | Open interactive configuration editor |
| `/dashboard` | Toggle swarm observability dashboard |
| `/exit` (`/quit`, `/q`) | Exit the CLI |

---

## Configuration

Tehuti merges configuration from several sources. Understanding precedence helps avoid surprises.

### Config file discovery

Cosmiconfig searches upward from the current working directory for:

`.tehuti.json`, `.tehuti.yaml`, `.tehuti.yml`, `.tehuti.js`, `.tehuti.mjs`, `.tehuti.cjs`, or a `tehuti` key in `package.json`.

Wizard credentials and runtime overrides are also persisted via the `conf` package (global store keyed as `tehuti`). The `tehuti config` subcommand reads from this store.

### Merge precedence (`loadConfig`)

For most fields the effective order is:

1. **Defaults** from `DEFAULT_CONFIG` / Zod schema
2. **Global persisted store** (`conf`, written by the wizard and `/config`)
3. **Project config file** (cosmiconfig result)—overrides global for overlapping keys
4. **Environment variables**—override file/global where noted below

**Provider** (special case):

`TEHUTI_PROVIDER` → project file `provider` → global store `provider` → default (`opencode`)

**Model:**

`TEHUTI_MODEL` → project file → global store → default (`deepseek-v4-flash`)

**Base URL:**

`TEHUTI_BASE_URL` (highest) → otherwise resolved from the active provider's default (e.g. `https://opencode.ai/zen/go/v1` for `opencode`), using a `baseUrl` from the file or global store only when that same source also set the provider

**API key:**

`TEHUTI_API_KEY` or provider-specific env (e.g. `OPENCODE_API_KEY`, `OPENROUTER_API_KEY`) → `apiKey` in project file or global store → other provider env fallbacks

**Other env vars:**

- `TEHUTI_CUSTOM_PROVIDER` — JSON blob for custom provider settings
- `TEHUTI_DEBUG=true` — enable debug mode
- `${VAR}` and `$VAR` substitution inside config file string values

### Defaults

```json
{
  "provider": "opencode",
  "model": "deepseek-v4-flash",
  "fallbackModel": "deepseek-v4-flash",
  "maxTokens": 32000,
  "maxIterations": 50,
  "temperature": 0.7,
  "mcp": { "enabled": true, "servers": {} },
  "permissions": {
    "defaultMode": "interactive",
    "alwaysAllow": ["read", "glob", "grep", "web_fetch", "web_search"]
  }
}
```

See `.tehuti.example.json` for a fuller template including MCP server entries.

### User data paths

| Path | Purpose |
|------|---------|
| `~/.tehuti/skills/` | User-defined skill JSON files |
| `~/.tehuti/` | Session history, memory graph, API cache |
| `.tehuti/` (project) | Project-local API response cache |

---

## Architecture Overview

```
Entry (src/index.ts)
  → CLI / TUI (src/cli/commands/chat.ts)
    → Agent loop (src/agent/loop/)
      → OpenRouterClient (src/api/openrouter.ts)  — OpenAI-compatible fetch + SSE
      → Tool registry (src/agent/tools/)          — ~68 static tools + MCP dynamic tools
      → Parallel executor, prefetcher, context compressor, memory graph
    → MCP manager (src/mcp/)                      — 4 transports
```

Key modules:

- **Agent loop** coordinates LLM calls, streaming parse, tool dispatch, retries, and compression
- **OpenRouterClient** is the generic provider client name; it handles OpenCode, OpenRouter, and other OpenAI-compatible endpoints
- **Ink TUI** uses a hybrid viewport: negative margin (`marginBottom: -scrollOffset`) for scroll position, plus a `visibleMessages` slice for render performance—see [HANDOFF.md](./HANDOFF.md)
- **Skills** inject expertise text into the system prompt when activated; they do not add executable capabilities
- **MCP** registers remote tools into the same registry used by built-in tools

For deeper detail see [PROJECT.md](./PROJECT.md) (architecture and directory layout) and [HANDOFF.md](./HANDOFF.md) (contributor guide and TUI caveats).

Note: `ai`, `@openrouter/ai-sdk-provider`, and `@aiter/core` appear in `package.json` but are not imported from `src/`. The LLM path is the hand-rolled client in `src/api/openrouter.ts`.

---

## Development

```bash
npm run start       # Run via tsx without building
npm run build       # tsup → dist/index.js (~650 KB)
npm run typecheck   # tsc --noEmit
npm run lint        # biome check src/
npm test            # Vitest unit tests (~570 cases)
npm run test:e2e    # Vitest e2e tests (~106 cases)
npm run clean       # Remove dist/
```

**Test status (as of June 2026):**

- Unit: **570 passed**, **2 skipped** (572 total)
- E2E: **105 passed**, **1 failed** (106 total — `computeMessageLines` array `content` handling)
- Build output: `dist/index.js` ≈ 652 KB

---

## Known Limitations

These are current engineering realities, not roadmap promises:

- **Hooks system** — `src/hooks/executor.ts` is implemented and called from the agent loop, but hook definitions are not part of `TEHUTI_CONFIG_SCHEMA`; there is no supported config-file wiring yet
- **`question` tool UI** — `_QuestionPrompt` exists in `chat.ts` but is not mounted in the TUI render tree; the agent can call `question` but users may not see an interactive picker
- **No mid-session auto-save** — sessions persist only when you run `/save`; exiting without saving loses unsaved conversation state
- **Two markdown pipelines** — Ink TUI uses `renderMarkdown()` (React nodes); one-shot/ANSI mode uses `renderMarkdownToAnsi()` in `src/terminal/markdown.ts`; formatting can diverge between modes
- **Memory graph edges unused** — nodes are stored and injected into prompts; edge relationships are written to disk but not traversed at runtime
- **Not self-evolving** — despite older marketing copy, there is no autonomous self-modification or evolution loop
- **Rust core unwired** — `rust-core/` contains artifacts only; the shipped binary is pure TypeScript
- **Provider/runtime gap** — providers marked non–OpenAI-compatible in `providers.ts` (e.g. native Anthropic) are rejected unless routed through an OpenAI-compatible base URL or adapter

---

## Links

| Resource | URL |
|----------|-----|
| Repository | https://github.com/The-Osiris-Labs/Tehuti-CLI-Revival |
| IBIS (sister project) | https://github.com/The-Osiris-Labs/IBIS-AGI-TRADER |
| The Osiris Labs | https://theosirislabs.com |

---

𓅞 Thoth, Tongue of Ra

Halls of Records • Balance of Ma'at • Architect of Truth

From the House of OSIRIS — TheOsirisLabs.com