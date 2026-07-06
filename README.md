<div align="center">
  <h1>𓆣 Tehuti CLI</h1>
  <p><i>Halls of Records • Balance of Ma'at • Architect of Truth</i></p>
  <p><b>An advanced, high-performance terminal coding agent optimized for autonomous AI workflows.</b></p>
</div>

---

Tehuti is a specialized Node.js 20+ terminal agent designed to integrate directly into your local development workflow. It runs natively in your terminal, interfacing with OpenAI-compatible APIs to execute autonomous coding tasks, orchestrate multi-agent swarms, and securely manage system interactions.

Named after Thoth (Tehuti), the Egyptian deity of wisdom and writing, the CLI combines a meticulously crafted Egyptian-themed Terminal User Interface (TUI) with a highly concurrent execution engine.

---

## 🌟 Core Architecture

- **Interactive Terminal UI:** Built on React 19 and Ink 6, featuring a virtual sliding viewport, mouse-aware command palettes, an Interactive Sessions UI with virtual scrolling, Vim keybindings, and mouse hover support, alongside real-time ANSI token streaming.
- **Global TUI Input Isolation:** A native event manager completely isolates terminal input, guaranteeing zero "input bleed" when navigating dynamic overlays, command palettes, or virtual scrolls.
- **Persistent Companion Daemon:** Tehuti operates via a persistent background daemon (`tehutid.sock`). This enables long-running cognitive processes, background garbage collection, and seamless re-attachment to ongoing sessions across reboots.
- **Omnichannel Presence:** A native connector manager equipped with jittered exponential backoffs allows Tehuti to reliably extend its presence beyond the terminal, bridging sessions to Slack, Discord, Telegram, and WhatsApp.
- **Isolated Swarm Execution:** Swarm orchestrations are natively offloaded from the Node.js event loop into isolated child processes (`child_process.fork()`), utilizing IPC chunking to ensure zero UI stuttering during massive multi-agent parallel generation.
- **Native Semantic Engine:** Leverages a native Rust `.node` binary to bypass JavaScript overhead, enabling ultra-fast, parallel semantic `grep` operations directly against the filesystem.

---

## 🧠 Cognitive Systems

- **Self-Healing Worktrees:** Tehuti autonomously manages risk by isolating destructive tasks into ephemeral Git branches (`tehuti-shadow-<epoch>`). Code is iteratively validated and tested within this speculative worktree before safely merging back into your active branch.
- **Deep Temporal Awareness:** Tehuti intrinsically understands time. Through rolling background garbage collection, persistent ISO 8601 task tracking, and systemic chronological decay logic within its memory graph, the agent natively understands the sequence of codebase edits and conversation pacing.
- **Personality Learning Engine:** Backed by an asynchronous SQLite graph, Tehuti passively learns your coding style and preferences from Git diffs over time, dynamically adapting its responses to align with your personal engineering standards.
- **Backlog & Planner Persistence:** Natively writes and organizes historical implementation plans and JSON-backed task backlogs, rendering them chronologically via a beautifully branded, interactive Ink Checklist directly inside the chat UI.

---

## 🛡️ Security & Access Control

Security is treated as a foundational primitive. Tehuti does not blindly execute LLM tool requests.

- **Identity-Based Access Control (IBAC):** All capabilities are gated by a strict IBAC layer. Read-only actions run dynamically in parallel, while destructive actions (writes, bash commands) pause execution to enforce explicit interactive prompts.
- **Hardened Docker Sandboxing:** Bash executions are heavily restricted. Staged calls drop all privileges (`--cap-drop=ALL`), prevent escalations, block network interfaces, and strictly mount workspaces as read-only by default.
- **AST Rollbacks & Process Isolation:** All native LLM file edits instantly generate localized `.bak` rollback variants. Misbehaving hooks or infinite-looping child processes are aggressively neutralized via atomic process-group `SIGKILL` signals.
- **JIT Ephemeral Tokens:** Destructive tasks can be granted single-use, argument-bound ephemeral tokens, enabling multi-step autonomous workflows without sacrificing security against payload substitution attacks.

---

## 🤖 Capabilities & Tools

Tehuti ships with **73 native built-in tools** designed for comprehensive repository manipulation:

- **Filesystem & AST:** Read, write, manipulate directories, and parse native Abstract Syntax Trees (AST) using Tree-Sitter.
- **Sandboxed Execution:** Securely execute bash commands to run tests, formatters, and builds.
- **Git Integration:** Full programmatic access to read history, stage, commit, and manage branches.
- **Multi-Agent Swarm Orchestration:** Tehuti dynamically spawns background subagents via `delegate_task`, delegating concurrent tasks (like research or QA) while continuing main-thread execution.
- **Model Context Protocol (MCP):** Fully extensible via standard IO, HTTP, SSE, or WebSocket. Tehuti automatically reads, maps, and registers MCP tool schemas directly into the agent's inference loop.

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
npm run start          # Start interactive mode
tehuti daemon start    # Start the background daemon
tehuti companion       # Connect to the background daemon
```
*Pro tip: Type `/` in the chat to open the interactive command palette!*

---

## 🛠️ Execution Modes

### Interactive Mode
The default mode. Features deep workflow persistence, an Interactive Sessions UI with fuzzy search, expandable tool outputs, reasoning spinners, and full command palette support.

### Companion Mode
Routes an interactive session through the persistent background daemon, allowing for asynchronous task completion and external connector integration.

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
