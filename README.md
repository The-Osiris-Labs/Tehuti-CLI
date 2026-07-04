𓅞 Thoth, Tongue of Ra

Halls of Records • Balance of Ma'at • Architect of Truth

---

# 𓆣 Tehuti CLI

Tehuti is a highly-optimized, Node.js 20+ terminal coding agent. It interfaces with OpenAI-compatible `/chat/completions` APIs using custom HTTP connection pooling (`undici`), providing a fast and deterministic TUI or streaming ANSI experience. The default provider is OpenCode Go (`https://opencode.ai/zen/go/v1`) with model `deepseek-v4-flash`. Egyptian theming is strictly visual branding.

---

## 🏗️ Architectural Truths

Tehuti is engineered for performance and strict defensive execution constraints.

- **Rust Core is Active:** The `rust-core/` directory compiles to a native `.node` binary that is actively invoked in production via `@napi-rs/cli` to power high-speed semantic search (`parallelGrep`).
- **Defensive Parallelism:** The tool executor strictly segregates operations. Read-only tools (like `grep` or `list_dir`) parallelize up to 5 concurrent streams. Destructive tools (writes, bash execution) act as strict barriers, forcing sequential safety checks.
- **Deterministic Context Compression:** When context reaches ~85% of capacity, the agent loop uses deterministic array truncation (splicing out the oldest non-system messages) instead of expensive LLM-based summarization.
- **TUI Virtual Viewport:** The React/Ink TUI handles scrolling by applying CSS-style negative margins to a sliding viewport, combined with a hybrid `visibleMessages` slice to ensure ultra-performant terminal rendering without remounting components.
- **Wired Telemetry & Hooks:** Both the telemetry module (`getTelemetry()`) and the lifecycle hooks system are fully wired and execute strictly during the agent loop.
- **Zero Vercel AI SDK:** The networking layer uses a hand-rolled `fetch` + Server-Sent Events (SSE) parsing implementation instead of bloated external AI libraries.

---

## 🛠️ Features

- **OpenAI-Compatible Networking:** Connects to ~18 named providers (OpenCode, OpenRouter, KiloCode, Anthropic, etc.) via custom connection pooling.
- **Dynamic Tool Registry:** ~68 built-in tools covering filesystem, bash sandboxing, AST parsing, and semantic search, perfectly integrated with dynamic MCP tools (via `stdio`, `http`, `sse`, or `websocket`).
- **Modes:** 
  - Interactive React/Ink TUI with a mouse-aware command palette.
  - One-shot mode with live ANSI streaming or structured JSON output (`-j`).
  - Read-only Plan Mode for exploratory research.
- **Extensibility:** User-defined JSON skills (`~/.tehuti/skills/`) are injected into system prompts without adding direct executable footprint.

---

## 🚀 Quick Start

Requires Node.js 20 or later.

```bash
git clone https://github.com/The-Osiris-Labs/Tehuti-CLI-Revival.git
cd Tehuti-CLI-Revival
npm install
npm run build
```

**Production Build:** The production bundle `dist/index.js` is highly compressed (~684 KB).

Run the interactive setup wizard:
```bash
npm run start -- init
```

Launch the interactive agent loop:
```bash
npm run start
```

---

## ⚙️ Configuration Precedence

Tehuti resolves configuration through a strict hierarchy (lowest to highest):

1. **Defaults** (`DEFAULT_CONFIG` in `src/config/schema.ts`)
2. **Global Store** (managed by `conf` via `~/.config/tehuti/config.json`)
3. **Project Config** (`.tehuti.json` via cosmiconfig)
4. **Environment Variables** (e.g., `TEHUTI_API_KEY`, `TEHUTI_MODEL`, `TEHUTI_PROVIDER`)

*Note: Persistent caches (Tool results, API data) are stored in `~/.tehuti/cache/`.*

---

## 🚧 Current Engineering Reality

- **No Mid-Session Auto-Save:** Sessions must be explicitly persisted via the `/save` command.
- **Divergent Markdown Pipelines:** The Ink TUI uses `renderMarkdown()` for React node conversion, while the one-shot mode relies on `renderMarkdownToAnsi()`.
- **Memory Graph Traversal:** While graph nodes are injected into prompt contexts, relational edge traversal is stored on disk but not actively utilized at runtime.

---

𓅞 Thoth, Tongue of Ra

From the House of OSIRIS — TheOsirisLabs.com