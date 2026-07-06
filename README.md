<div align="center">
  <h1>𓆣 Tehuti CLI</h1>
  <p><i>Halls of Records • Balance of Ma'at • Architect of Truth</i></p>
  <p><b>An advanced, high-performance Node.js terminal agent engineered for autonomous workflows, localized memory, and Model Context Protocol (MCP) integrations.</b></p>
  <br/>
  <p>
    <img src="https://img.shields.io/badge/Node.js-20%2B-green.svg" alt="Node.js 20+" />
    <img src="https://img.shields.io/badge/Architecture-Multi--Agent_Swarm-blue.svg" alt="Multi-Agent Swarm" />
    <img src="https://img.shields.io/badge/Protocol-MCP_Ready-purple.svg" alt="Model Context Protocol" />
  </p>
</div>

---

Tehuti is a specialized Node.js terminal coding assistant designed to bridge the gap between static CLI scripts and localized intelligence. Equipped natively with **75 specialized tools**, it runs natively in your terminal, interfacing seamlessly with OpenAI-compatible APIs (OpenCode Go, OpenRouter, Anthropic, DeepSeek, local Ollama) to execute complex, autonomous engineering tasks. 

Named after Thoth (Tehuti), the Egyptian deity of wisdom and writing, the CLI combines a meticulously crafted Egyptian-themed Terminal User Interface (TUI) with a highly concurrent, multi-agent execution engine.

---

## 🧠 Advanced Recall & Structural Memory

Tehuti actively remembers, contextualizes, and adapts to your specific engineering environment over long periods of time. 

- **SQLite Personality Graph & Immunity:** Tehuti passively learns your coding style by analyzing Git diffs and command histories. While standard memory pathways undergo an exponential time-decay logic ($W \times e^{-\lambda t}$) to purge obsolete contexts, memories explicitly typed as `project_rule` or `critical_fact` are strictly immune to decay and are permanently retained.
- **Deterministic Context Compression:** Instead of relying on lossy, expensive LLM summarization to manage massive conversation histories, Tehuti employs a rigorous deterministic array truncator that mathematically splices out the oldest conversational turns at 85% capacity. It further protects the active window by aggressively stripping raw `<think>` and `<thinking>` tokens from historical assistant messages.
- **Config Schema Salvaging:** Configuration is hyper-resilient. Environment variables can be natively interpolated inside `.tehuti.json`. If a configuration file is corrupted or malformed, the Zod validation engine surgically drops only the corrupted fields and gracefully salvages the rest, preventing daemon startup failures.
- **Chronological Markdown Plans:** Implementation workloads are persisted to disk as `.md` files and inherently sorted chronologically (ascending) natively within the tool execution logic.

---

## ⚡ Swarm Concurrency & Network Stack

Tehuti is structurally hardened to support massive, uninterrupted autonomous workflows without UI stuttering, API throttling, or memory leaks.

- **Dynamic Swarm Serialization:** Multi-agent swarms run in highly isolated child processes (`child_process.fork()`). The Swarm Manager can fully export and import subagent states (`importState()`), automatically cleaning up orphaned and killed tasks natively across daemon reboots.
- **IPC Payload Chunking & Throttling:** Gigabytes of context are serialized and streamed via IPC in 512KB chunks. Furthermore, to eliminate TUI lag during massive generation bursts, the IPC layer dynamically throttles UI token-update emissions to every 20 tokens.
- **16ms Backpressure Yielding & Undici Pooling:** The HTTP/3 and SSE streaming stack is actively designed to yield to the Node event loop every 16ms to prevent buffer bloat during gigabyte payload streams. It leverages `undici` Agent Pools to manage `keepAliveTimeout` and multiplexing.
- **Advanced MCP Capabilities:** The native MCP client goes beyond basic tool mapping. It explicitly supports 4 transport layers (`stdio`, `sse`, `http`, `websocket`), handles real-time resource subscriptions, and enforces granular security via `toolFilter` allowlists and denylists.

---

## 🛡️ AST Rollbacks & Codebase Safety

- **AST Validation:** Before applying critical codebase edits, Tehuti automatically stages a `.tmp.aci.<filename>` and runs a zero-emission TypeScript AST validation (`npx tsc --noEmit`). The edit is aborted if the generated syntax is invalid.
- **Timestamped Rollbacks & TTLs:** Every native codebase edit instantly triggers the generation of a timestamped `.bak` rollback file. These backups are rigorously managed, enforcing a strict 5-file retention limit and a localized 24-hour Time-To-Live (TTL) auto-delete policy.
- **Sandboxed Execution:** Code execution natively utilizes `just-bash` coupled with explicit IBAC permission prompts to ensure user verification before any destructive commands touch the host system. Hooks explicitly filter dangerous environments (like `LD_PRELOAD`) before execution.

---

## 🖥️ Interactive TUI Mechanics

Tehuti is shipped with an incredibly rich, interactive Terminal User Interface built on Ink 6 and React 19.

- **Negative Margin Viewport:** The primary chat utilizes a highly performant "negative margin" hack (`marginBottom={-scrollOffset}`) to gracefully handle infinite scroll streams without forcing costly React remounts on massive arrays.
- **In-Terminal Dashboards & Visualizers:**
  - **Swarm Observability Dashboard:** Track active subagents, their current task, and token usage in real time natively in the terminal.
  - **Interactive Todo List:** Visually render active, queued, and completed tasks alongside priority indicators.
  - **Media Viewer:** Render local images and media via ANSI blocks natively in the CLI stream.
  - **Interactive Prompts:** Tehuti halts execution seamlessly to present interactive multiple-choice menus and manual Y/n execution blocks for critical tools.
- **Extensive Command Palette:** Type `/` to access 11+ hidden slash commands including `/cost`, `/stats`, `/thinking`, `/skills` (activate/deactivate specific agent skillsets), `/config` (in-terminal editor), and `/dashboard`.

---

## 🌐 The Companion Daemon

- **macOS `launchd` Autostart:** The daemon natively generates and installs a `com.tehuti.daemon.plist` into `~/Library/LaunchAgents` to persist flawlessly across system reboots, piping stdout and stderr to `~/.tehuti/tehutid.*.log`.
- **7-Day Background Cache Sweeper:** The daemon continuously manages disk health, running an aggressive background garbage collection cycle that purges cached tool outputs older than 7 days.
- **Persistent Socket:** The TUI attaches to a background Unix Domain Socket (`tehutid.sock`), allowing complex workflows and multi-agent swarms to run asynchronously even if you close the terminal window.

---

## 🚀 Getting Started

Tehuti requires Node.js 20 or later.

### 1. Install
```bash
git clone https://github.com/The-Osiris-Labs/Tehuti-CLI.git
cd Tehuti-CLI
npm install
npm run build
```

### 2. Configure
Run the interactive setup wizard to link your API keys and configure your default provider.
```bash
npm run start -- init
```

### 3. Launch
Drop into the interactive loop or launch the background daemon:
```bash
npm run start          # Start the interactive TUI mode
tehuti daemon start    # Start the persistent background daemon
tehuti companion       # Connect the TUI to the background daemon
```

<div align="center">
  <p><b>From the House of OSIRIS — TheOsirisLabs.com</b></p>
</div>
