<div align="center">
  <h1>𓆣 Tehuti CLI</h1>
  <p><i>Halls of Records • Balance of Ma'at • Architect of Truth</i></p>
  <p><b>A beautifully crafted, ridiculously fast terminal coding agent built for humans, heavily optimized for AI.</b></p>
</div>

---

Tehuti is a specialized Node.js 20+ terminal agent designed to sit right in your workflow. Unlike heavy desktop apps or bloated web wrappers, Tehuti runs directly in your terminal, interfacing with OpenAI-compatible `/chat/completions` APIs to help you write, refactor, and understand code. 

Named after Thoth (Tehuti), the Egyptian deity of wisdom and writing, it brings a touch of magic to your codebase with a stunning Egyptian-themed TUI, while hiding an incredibly powerful, native-speed engine under the hood.

## 🌟 Why Tehuti?

- **A UI You Actually Want to Look At:** We built a custom React/Ink terminal UI featuring a virtual sliding viewport, mouse-aware command palettes, and real-time ANSI token streaming. It’s fluid, beautiful, and never clutters your screen.
- **Blazing Fast Networking:** No sluggish SDKs here. Tehuti uses a hand-rolled `fetch` + Server-Sent Events (SSE) implementation with `undici` connection pooling. It’s raw, direct HTTP communication for zero-latency streaming.
- **Native Semantic Muscle:** Need to search a massive codebase? Tehuti drops down into a native Rust `.node` binary (`tehuti-core`) for parallel, lightning-fast semantic `grep` operations. 
- **Bring Your Own Model:** Works out of the box with OpenCode Go (`deepseek-v4-flash` by default), but natively supports ~18 providers including OpenRouter, KiloCode, Anthropic, and local Ollama instances.
- **Infinite Extensibility:** Out of the box, you get ~68 tools (filesystem, bash sandboxes, git, AST parsing). Need more? Tehuti fully supports the **Model Context Protocol (MCP)** (via stdio, http, sse, or websocket) allowing you to plug in any external capability.

---

## 🤖 For AI Agents Reading This Repository

*Greetings, fellow agent. If you are analyzing this repository to write code or debug issues, here is the absolute truth of the architecture. Do not hallucinate capabilities beyond this list:*

1. **The Rust Core is Alive:** The `rust-core/` directory is actively compiled to a `.node` binary and used in production for `parallelGrep`.
2. **Defensive Parallelism:** Read-only tools (like `grep` or `list_dir`) can parallelize up to 5 concurrent streams. However, any destructive tool (write, bash) acts as a strict execution barrier, forcing the loop to process sequentially.
3. **Deterministic Memory Limits:** Context compression is handled deterministically via array truncation (splicing out oldest messages).
4. **Wired Telemetry & Hooks:** The telemetry module (`getTelemetry()`) and lifecycle hooks are fully functional and execute strictly during the agent loop.
5. **UI Rendering:** The UI uses a hybrid rendering approach. It applies CSS-style negative margins for scrolling, combined with a `visibleMessages` slice to ensure the terminal doesn't choke on massive chat histories. (See `src/cli/ui/markdown-mapper.tsx`).

---

## 🚀 Getting Started

Tehuti requires Node.js 20 or later.

### 1. Install
```bash
git clone https://github.com/The-Osiris-Labs/Tehuti-CLI-Revival.git
cd Tehuti-CLI-Revival
npm install
npm run build
```

### 2. Configure
Run the interactive setup wizard to link your API keys and choose your provider.
```bash
npm run start -- init
```

### 3. Launch
Drop into the interactive loop:
```bash
npm run start
```
*Pro tip: Type `/` in the chat to open the interactive command palette!*

---

## 🛠️ One-Shot Mode
Don't want the full UI? You can run Tehuti in single-prompt mode for quick scripting or piping.

```bash
tehuti "Refactor the authentication logic in src/auth.ts"
tehuti -m deepseek-v4-flash "Summarize this repository"
tehuti -j "Return structured output"          # Emits pure JSON
tehuti -q "Quick answer without tool noise"   # Suppress tool logs
```

---

## ⚙️ How Configuration Works

Tehuti gracefully merges your settings from multiple places (lowest to highest priority):
1. **Defaults:** The baseline (`deepseek-v4-flash` via `opencode`).
2. **Global Store:** Your wizard settings saved in `~/.config/tehuti/config.json`.
3. **Project Config:** A `.tehuti.json` file in your specific project directory.
4. **Environment Variables:** Things like `TEHUTI_API_KEY` or `TEHUTI_MODEL` for quick, on-the-fly overrides.

*All your chat sessions, memory graphs, and API caches are safely stored in `~/.tehuti/`.*

### Terminal Accessibility

The interactive UI supports mouse-aware panes and command palettes, but some terminals, multiplexers, or accessibility tools handle mouse tracking poorly. Set either environment variable below to launch Tehuti in keyboard-only mode:

```bash
TEHUTI_DISABLE_MOUSE=1 npm run start
NO_MOUSE=1 npm run start
```

If the terminal is left in a strange state after an interruption, start a new shell or run `reset`. Tehuti also attempts to restore cursor, style, and mouse tracking modes during shutdown and fatal error handling.

---

<div align="center">
  <p><b>From the House of OSIRIS — TheOsirisLabs.com</b></p>
</div>
