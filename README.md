<div align="center">
  <h1>𓆣 Tehuti CLI</h1>
  <p><i>Halls of Records • Balance of Ma'at • Architect of Truth</i></p>
  <p><b>An advanced, high-performance terminal coding agent optimized for autonomous AI workflows.</b></p>
</div>

---

Tehuti is a specialized Node.js 20+ terminal agent designed to integrate directly into your local development workflow. It runs natively in your terminal, interfacing with OpenAI-compatible `/chat/completions` APIs to execute autonomous coding tasks, orchestrate multi-agent swarms, and securely manage system interactions.

Named after Thoth (Tehuti), the Egyptian deity of wisdom and writing, the CLI combines a meticulously crafted Egyptian-themed Terminal User Interface (TUI) with a highly concurrent execution engine.

---

## 🌟 Core Architecture

- **Interactive Terminal UI:** Built on React 19 and Ink 6, featuring a virtual sliding viewport, mouse-aware command palettes, and real-time ANSI token streaming.
- **High-Performance Networking:** Utilizes a highly optimized `fetch` + Server-Sent Events (SSE) implementation over HTTP/3. It features `undici` connection pooling to establish direct, low-latency communication with LLM providers while seamlessly handling automated network backpressure and QUIC fallback retries.
- **Native Semantic Engine:** Leverages a native Rust `.node` binary (`tehuti-core`) to bypass JavaScript overhead, enabling ultra-fast, parallel semantic `grep` operations directly against the filesystem.
- **Context & Memory Graph:** Replaces naive array slicing with deterministic `semantic compaction`. Tehuti maps conversation histories into an asynchronous SQLite graph, isolating long-term insights and dynamically compressing context to stay rigorously within model token limits.

---

## 🛡️ Security & Access Control

Security is treated as a foundational primitive. Tehuti does not blindly execute LLM tool requests.

- **Identity-Based Access Control (IBAC):** All capabilities are gated by a strict IBAC layer. Read-only actions run dynamically in parallel, while destructive actions (writes, bash commands) pause execution to enforce explicit interactive prompts.
- **JIT Ephemeral Tokens:** Destructive tasks can be granted single-use, argument-bound ephemeral tokens. This enables multi-step autonomous workflows without sacrificing security against payload substitution attacks.
- **Deterministic MCP Namespacing:** Mitigates 64-character tool collision spoofing by automatically injecting MD5 hashes into truncated Model Context Protocol (MCP) bounds, ensuring untrusted external servers cannot hijack native system permissions.

---

## 🤖 Capabilities & Tools

Tehuti ships with **68 native built-in tools** designed for comprehensive repository manipulation:

- **Filesystem & AST:** Read, write, manipulate directories, and parse native Abstract Syntax Trees (AST) using Tree-Sitter.
- **Sandboxed Execution:** Securely execute bash commands to run tests, formatters, and builds.
- **Git Integration:** Full programmatic access to read history, stage, commit, and manage branches.
- **Web Intelligence:** Built-in web scraping, headless browser integration, and code-specific search tools.
- **Multi-Agent Swarm Orchestration:** Tehuti can dynamically spawn background subagents via `invoke_subagent`, delegating concurrent tasks (like research or QA) while continuing main-thread execution. Bidirectional communication is fully supported.

### Model Context Protocol (MCP) Support
Tehuti is fully extensible via the open **Model Context Protocol (MCP)**. You can dynamically attach external capabilities via standard IO, HTTP, SSE, or WebSocket. Tehuti automatically reads, maps, and registers MCP tool schemas directly into the agent's inference loop.

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
Run the interactive setup wizard to link your API keys and configure your default provider.
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

## 🛠️ Execution Modes

### Interactive Mode
The default mode. Features deep workflow persistence, expandable tool outputs, reasoning spinners, and full command palette support.

### One-Shot & Scripting Mode
Tehuti can be utilized as a standard UNIX utility for single-prompt automation.

```bash
tehuti "Refactor the authentication logic in src/auth.ts"
tehuti -m deepseek-v4-flash "Summarize this repository"
tehuti -j "Return structured output"          # Emits pure JSON
tehuti -q "Quick answer without tool noise"   # Suppresses intermediate tool logs
```

---

## ⚙️ Providers & Configuration

Tehuti natively supports 18+ providers including **OpenCode Go** (default), **OpenRouter**, **Anthropic**, **KiloCode**, and local **Ollama** instances. It dynamically routes models based on keyword heuristics to optimize for speed, depth, or balanced capabilities.

Settings gracefully cascade and merge from multiple sources (lowest to highest priority):
1. **Defaults:** `deepseek-v4-flash` via `opencode`.
2. **Global Store:** Wizard configurations stored in `~/.config/tehuti/config.json`.
3. **Project Config:** Local `.tehuti.json` project-overrides.
4. **Environment Variables:** `TEHUTI_API_KEY` or `TEHUTI_MODEL` for CI/CD pipelines and hot-swaps.

### Terminal Accessibility

The interactive UI fully supports mouse-aware panes and scrolling. For environments like SSH or tmux where mouse tracking is unavailable, set either environment variable below to launch in strict keyboard-only mode:

```bash
TEHUTI_DISABLE_MOUSE=1 npm run start
NO_MOUSE=1 npm run start
```

---

<div align="center">
  <p><b>From the House of OSIRIS — TheOsirisLabs.com</b></p>
</div>
