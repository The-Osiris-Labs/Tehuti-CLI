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

Tehuti is a highly specialized Node.js terminal coding assistant designed to bridge the gap between static CLI scripts and localized intelligence. It runs natively in your terminal, interfacing seamlessly with OpenAI-compatible APIs (OpenCode Go, OpenRouter, Anthropic, DeepSeek, local Ollama) to execute complex, autonomous engineering tasks. 

Named after Thoth (Tehuti), the Egyptian deity of wisdom and writing, the CLI combines a meticulously crafted Egyptian-themed Terminal User Interface (TUI) with a highly concurrent, multi-agent execution engine.

---

## 🧠 Advanced Recall & Memory Architecture

What distinguishes Tehuti is its profound capability to remember, contextualize, and adapt to your specific engineering environment over long periods of time. The agent does not treat each session as a blank slate.

- **SQLite Personality Graph:** Tehuti runs a localized, asynchronous SQLite vector graph. It passively learns your coding style and architectural preferences by continuously scraping and analyzing Git diffs and command histories, natively evolving its responses to match your engineering voice.
- **Semantic Exponential Time-Decay:** Memory is managed mathematically. Insight vectors undergo an exponential time-decay logic ($W \times e^{-\lambda t}$) based on last-accessed metrics. Obsolete memory pathways are actively purged to prevent permanent vector sprawl, ensuring the agent retrieves only highly relevant, modern context.
- **Deterministic Context Compression:** Instead of relying on lossy, expensive LLM summarization to manage massive conversation histories, Tehuti employs a rigorous deterministic array truncator that mathematically splices out the oldest conversational turns at 85% capacity, preserving the structural integrity of the active context window.
- **`<think>` Token Stripping:** To prevent severe context degradation during marathon multi-agent sessions, Tehuti rigorously strips raw reasoning tokens (`<think>` and `<thinking>` blocks) from historical assistant messages before they are passed back into the active payload.

---

## 🌟 Core System Mechanics

Tehuti has been structurally hardened to support massive, uninterrupted autonomous workflows without UI stuttering, API throttling, or memory leaks.

### ⏱️ Temporal & Sequential Codebase Awareness
- **Deep Temporal Injection:** The LLM's system prompt natively understands local timezones, exact ISO epochs, and daemon uptime. Furthermore, every conversational turn is dynamically injected with a precise prefix (e.g., `[Timestamp: HH:MM:SS]`), granting the AI organic intuition regarding the latency and sequence between replies.
- **Sequential File Epoch Intuition:** Filesystem payloads dynamically calculate and inject relative timeframes (e.g., `modified_relative: "3 seconds ago"`). The AI never hallucinates temporal sequences when auditing massive repositories; it inherently knows the precise chronological order of codebase edits.
- **Chronological Architectures:** Workloads and implementation plans are not held in volatile RAM. They are persisted to JSON backlogs and forcefully sorted by exact ISO 8601 birth-time descending, ensuring the LLM sequence-matches modern vs. obsolete plans flawlessly.

### ⚡ Swarm & Concurrency Orchestration
- **Isolated Swarm Execution:** Multi-agent swarms are cleanly offloaded from the single-threaded Node.js event loop. Subagents run in highly isolated child processes (`child_process.fork()`), communicating via strict IPC boundaries.
- **IPC Payload Chunking:** Gigabytes of context are serialized and streamed in 512KB chunks, mathematically guaranteeing a locked 60fps TUI framerate even during the heaviest LLM orchestrations.
- **Native Semantic Engine:** Bypassing JavaScript overhead entirely, Tehuti leverages a native Rust `.node` binary to execute ultra-fast, parallel semantic `grep` operations directly against your local filesystem.

### 🖥️ Interactive TUI Interfaces
- **Virtual Scrolling Sessions:** A stunning, mouse-aware TUI built on Ink 6 and React 19. It leverages `useVirtualScroll`, enabling users to parse thousands of historical interactions at 60fps with Vim keybindings (j/k/d/r), while an internal `Fuse.js` engine guarantees `updated_at` chronological search perfection.
- **Global TUI Input Isolation:** A native `GlobalInputState` event manager completely isolates terminal inputs, ensuring zero "input bleed" when navigating dynamic overlays, configuration editors, or command palettes.

### 🌐 The Companion Daemon & Omnichannel Integration
- **Persistent Background Socket:** Tehuti operates continuously via a background Unix Domain Socket (`tehutid.sock`). This daemon survives terminal closures and reboots, handling asynchronous garbage collection and long-running cognitive processes.
- **Universal External Connectors:** A native Connector Manager bridges localized terminal sessions directly to **Slack, Discord, Telegram, and WhatsApp**. You can converse with your local codebase intelligence from any device.
- **SQLite Omnichannel Resolution:** To prevent `SQLITE_BUSY` crashes when external webhooks trigger massive concurrent payloads, session resolution is backed by an SQLite `messaging_sessions` table heavily shielded by a 1,000-capacity LRU memory cache.
- **Jittered Exponential Backoffs:** Network adapters intelligently manage latency. If the daemon drops connection, it smoothly backs off using randomized algorithms to prevent daemon crashes or API rate-limiting.

### 🛡️ Safety, Sandboxing & Self-Healing
- **Speculative Ephemeral Worktrees:** Destructive codebase edits are isolated into timestamped Git branches (`tehuti-shadow-<epoch>`). Code is iteratively validated, compiled, and tested within this speculative sandbox before natively syncing (`rsync -a`) back into your active branch.
- **Hardened Docker Sandboxing:** Bash executions are heavily restricted. Staged calls drop all system privileges (`--cap-drop=ALL`), prevent internal escalations (`--security-opt=no-new-privileges`), block network interfaces (`--network none`), and strictly mount target workspaces as read-only.
- **AST Rollbacks & Process Group Isolation:** Every native codebase edit instantly triggers the generation of a localized `.bak` rollback file. Runaway child processes or infinite-looping hooks spawned by the AI are terminated system-wide via atomic process-group `SIGKILLs`.

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
*Pro tip: Type `/` in the chat to open the interactive command palette!*

---

## 🛠️ Execution Modes

### Interactive Mode
The default interface. Features deep workflow persistence, the Interactive Sessions UI, infinitely expandable tool outputs, reasoning spinners, and full command palette support.

### Companion Mode
Routes your local interactive session straight through the persistent background daemon, allowing for asynchronous task completions and webhook bridging to external mobile or desktop clients.

### One-Shot & Scripting Mode
Tehuti can be utilized as a standard UNIX utility for single-prompt CI/CD automation.

```bash
tehuti "Refactor the authentication logic in src/auth.ts"
tehuti -m deepseek-v4-flash "Summarize this repository"
tehuti -j "Return structured output"          # Emits pure JSON
tehuti -q "Quick answer without tool noise"   # Suppresses intermediate tool logs
```

---

## ⚙️ Providers & Model Routing

Tehuti natively supports 18+ providers including **OpenCode Go** (default), **OpenRouter**, **Anthropic**, **KiloCode**, and local **Ollama** instances. It dynamically routes models based on keyword heuristics to optimize for speed, depth, or balanced capabilities based on your exact prompt.

Settings gracefully cascade and merge from multiple sources (lowest to highest priority):
1. **Defaults:** `deepseek-v4-flash` via `opencode`.
2. **Global Store:** Wizard configurations stored in `~/.config/tehuti/config.json`.
3. **Project Config:** Local `.tehuti.json` project-overrides.
4. **Environment Variables:** `TEHUTI_API_KEY` or `TEHUTI_MODEL` for rapid CI/CD pipelines.

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
