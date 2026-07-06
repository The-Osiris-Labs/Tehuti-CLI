<div align="center">
  <h1>𓆣 Tehuti CLI: Autonomous Multi-Agent Coding Swarm</h1>
  <p><i>Halls of Records • Balance of Ma'at • Architect of Truth</i></p>
  <p><b>An advanced, high-performance Node.js terminal coding agent optimized for autonomous AI workflows, local LLMs, and Model Context Protocol (MCP).</b></p>
  <br/>
  <p>
    <img src="https://img.shields.io/badge/Node.js-20%2B-green.svg" alt="Node.js 20+" />
    <img src="https://img.shields.io/badge/Architecture-Multi--Agent_Swarm-blue.svg" alt="Multi-Agent Swarm" />
    <img src="https://img.shields.io/badge/Protocol-MCP_Ready-purple.svg" alt="Model Context Protocol" />
  </p>
</div>

---

Tehuti is a specialized Node.js terminal coding assistant designed to bridge the gap between static scripts and localized cognitive intelligence. It runs natively in your terminal, interfacing with OpenAI-compatible APIs (OpenRouter, Anthropic, DeepSeek, local Ollama) to execute complex, autonomous engineering tasks. 

Named after Thoth (Tehuti), the Egyptian deity of wisdom, the CLI combines a meticulously crafted Egyptian-themed Terminal User Interface (TUI) with a highly concurrent, multi-agent execution engine.

---

## 🧠 The Cognitive Range (The "Trueness" of Tehuti)

What makes Tehuti fundamentally different from other AI coding tools is its intrinsic "trueness" to the developer's environment. It does not just read code; it lives alongside the codebase. 

Through the combination of **Deep Temporal Awareness**, **Omnichannel Daemons**, and **Self-Healing Git Worktrees**, Tehuti understands the passage of time, the sequence of edits, and the consequences of its actions. Backed by an asynchronous SQLite personality graph, Tehuti passively learns your specific engineering standards from your command history and Git diffs, evolving its responses to perfectly match your architectural voice.

---

## 🌟 The 50+ Core Architectural Upgrades

Tehuti has been structurally hardened to support massive, uninterrupted autonomous workflows without UI stuttering or memory leaks.

### ⚡ Swarm & Concurrency
- **Isolated Swarm Execution:** Massive multi-agent swarms are cleanly offloaded from the Node.js event loop into isolated child processes (`child_process.fork()`).
- **Native Semantic Engine:** Utilizes a native Rust `.node` binary to bypass JavaScript overhead, enabling ultra-fast, parallel semantic `grep` operations.
- **IPC Payload Chunking:** Gigabytes of LLM context are serialized and streamed in chunks, guaranteeing a locked 60fps TUI framerate even during heavy orchestration.

### 🖥️ Advanced TUI & Interface
- **Interactive Sessions & Virtual Scrolling:** A stunning, mouse-aware TUI built on Ink 6 featuring `useVirtualScroll`, Vim keybindings (j/k/d/r), fuzzy search, and Expandable Tool Outputs.
- **Global TUI Input Isolation:** A native event manager completely neutralizes terminal "input bleed" when navigating dynamic overlays and command palettes.
- **Chronological Checklists:** Tasks are persisted natively to JSON backlogs and rendered via a branded, interactive timeline UI.

### 🌐 Companion Daemon & Omnichannel
- **Persistent Background Socket:** The `tehutid.sock` companion daemon survives terminal closures and reboots, handling background garbage collection and long-running cognitive processes.
- **Universal Connectors:** Natively bridges your terminal sessions directly to **Slack, Discord, Telegram, and WhatsApp**.
- **Jittered Exponential Backoffs:** Network adapters intelligently manage latency and disconnects without crashing the daemon or spamming LLM APIs.

### 🛡️ Safety & Self-Healing
- **Speculative Ephemeral Worktrees:** Destructive edits are isolated into timestamped Git branches (`tehuti-shadow-<epoch>`), iteratively tested, and only merged back upon verifiable success.
- **Hardened Docker Sandboxing:** Bash executions drop all privileges (`--cap-drop=ALL`), block external network interfaces, and natively restrict workspaces to read-only mounts.
- **AST Rollbacks & Process Isolation:** Native codebase edits instantly generate localized `.bak` rollback files. Runaway child processes are terminated globally via atomic process-group `SIGKILLs`.

### ⏱️ Memory & Temporal Awareness
- **Chronological Context Injection:** The LLM's system prompt natively understands local timezones, ISO epochs, and the exact chronological sequence of conversation turns via injected message prefixes.
- **Semantic Graph Decay:** Vector insights asynchronously undergo an exponential mathematical time-decay logic, actively purging obsolete memory pathways via SQLite optimizations.
- **Rolling TTL Sweepers:** The background daemon aggressively prunes dangling Git worktrees, stale `.bak` files, and 7-day-old cache payloads automatically.

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
The default mode. Features deep workflow persistence, the Interactive Sessions UI, expandable tool outputs, reasoning spinners, and full command palette support.

### Companion Mode
Routes an interactive session through the persistent background daemon, allowing for asynchronous task completion and external connector integration on mobile or desktop clients.

### One-Shot & Scripting Mode
Tehuti can be utilized as a standard UNIX utility for single-prompt automation.

```bash
tehuti "Refactor the authentication logic in src/auth.ts"
tehuti -m deepseek-v4-flash "Summarize this repository"
tehuti -j "Return structured output"          # Emits pure JSON
tehuti -q "Quick answer without tool noise"   # Suppresses intermediate tool logs
```

---

## ⚙️ Providers & Model Routing

Tehuti natively supports 18+ providers including **OpenCode Go**, **OpenRouter**, **Anthropic**, **KiloCode**, and local **Ollama** instances. It dynamically routes models based on keyword heuristics to optimize for speed, depth, or balanced capabilities.

Settings gracefully cascade and merge from multiple sources (lowest to highest priority):
1. **Defaults:** `deepseek-v4-flash` via `opencode`.
2. **Global Store:** Configurations stored in `~/.config/tehuti/config.json`.
3. **Project Config:** Local `.tehuti.json` project-overrides.
4. **Environment Variables:** `TEHUTI_API_KEY` or `TEHUTI_MODEL` for CI/CD pipelines.

---

<div align="center">
  <p><b>From the House of OSIRIS — TheOsirisLabs.com</b></p>
</div>
