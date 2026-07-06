<div align="center">
  <h1>𓆣 Tehuti CLI</h1>
  <p><i>Halls of Records • Balance of Ma'at • Architect of Truth</i></p>
  <p><b>An advanced, high-performance Node.js terminal agent engineered for autonomous workflows, localized intelligence, and Model Context Protocol (MCP) integrations.</b></p>
  <br/>
  <p>
    <img src="https://img.shields.io/badge/Node.js-20%2B-green.svg" alt="Node.js 20+" />
    <img src="https://img.shields.io/badge/Architecture-Multi--Agent_Swarm-blue.svg" alt="Multi-Agent Swarm" />
    <img src="https://img.shields.io/badge/Protocol-MCP_Ready-purple.svg" alt="Model Context Protocol" />
  </p>
</div>

---

Tehuti is a highly specialized Node.js terminal coding assistant designed to bridge the gap between static CLI scripts and localized cognitive intelligence. It runs natively in your terminal, interfacing seamlessly with OpenAI-compatible APIs (OpenCode Go, OpenRouter, Anthropic, DeepSeek, local Ollama) to execute extraordinarily complex, autonomous engineering tasks. 

Named after Thoth (Tehuti), the Egyptian deity of wisdom and writing, the CLI combines a meticulously crafted Egyptian-themed Terminal User Interface (TUI) with a highly concurrent, multi-agent execution engine.

---

## 🧠 The Cognitive Range (The "Trueness" of Tehuti)

What makes Tehuti fundamentally different from conventional AI coding tools is its intrinsic "trueness" to the developer's local environment. It does not simply parse requests and generate code; it **lives** alongside the codebase. 

Through the combination of **Deep Temporal Awareness**, **Omnichannel Daemons**, and **Self-Healing Git Worktrees**, Tehuti deeply understands the passage of time, the chronological sequence of edits, and the exact consequences of its actions. Backed by an asynchronous SQLite personality graph, Tehuti passively learns your specific engineering standards from your command history and Git diffs, natively evolving its responses to perfectly match your architectural voice over months of interactions.

---

## 🌟 The Core Architectural Mechanics (50+ Deep Upgrades)

Tehuti has been structurally hardened at the deepest levels to support massive, uninterrupted autonomous workflows without UI stuttering, API throttling, or memory leaks.

### ⚡ Swarm & Concurrency Orchestration
- **Isolated Swarm Execution:** Massive multi-agent swarms are cleanly offloaded from the single-threaded Node.js event loop. Subagents are spawned in highly isolated child processes (`child_process.fork()`), communicating via strict IPC boundaries.
- **IPC Payload Chunking:** Gigabytes of LLM context and reasoning blocks are serialized and streamed in 512KB chunks across the IPC layer. This mathematically guarantees a locked 60fps TUI framerate even during the heaviest AI orchestration tasks.
- **Native Semantic Engine:** Bypassing JavaScript overhead entirely, Tehuti leverages a native Rust `.node` binary to execute ultra-fast, parallel semantic `grep` operations directly against your massive local filesystems.

### 🖥️ Advanced TUI & Interactive Interfaces
- **Interactive Sessions & Virtual Scrolling:** A stunning, mouse-aware TUI built on Ink 6 and React 19. It features `useVirtualScroll`, allowing developers to cleanly parse thousands of historical interactions at 60fps, supplemented by Vim keybindings (j/k/d/r), fuzzy search algorithms, and expandable virtual scroll tool outputs.
- **Global TUI Input Isolation:** A native `GlobalInputState` event manager completely isolates terminal inputs, ensuring absolute zero "input bleed" when navigating dynamic overlays, configuration editors, or command palettes.
- **Chronological Checklists:** Active workloads and tasks are not held in volatile memory. They are persisted natively to JSON backlogs (`backlog.json`) and rendered directly within the TUI via beautifully branded, interactive timelines that visually calculate their staleness (e.g., `[5m ago]`).

### 🌐 The Companion Daemon & Omnichannel Presence
- **Persistent Background Socket:** Tehuti operates continuously via a persistent background Unix Domain Socket (`tehutid.sock`). This daemon survives terminal closures and reboots, allowing for asynchronous long-running cognitive processes, background data gathering, and seamless state re-attachment.
- **Universal External Connectors:** A native Connector Manager bridges your localized terminal sessions directly to **Slack, Discord, Telegram, and WhatsApp**. You can converse with and command your local codebase intelligence from any device on Earth.
- **Jittered Exponential Backoffs:** Network adapters and WebSocket connectors intelligently manage latency. If the daemon drops connection, it smoothly backs off using randomized algorithms to prevent crashing the daemon or spamming LLM provider APIs.

### 🛡️ Safety, Sandboxing & Self-Healing
- **Speculative Ephemeral Worktrees:** Tehuti autonomously manages deployment risk. Destructive or massive codebase edits are isolated into timestamp-stamped Git branches (`tehuti-shadow-<epoch>`). Code is iteratively validated, compiled, and tested within this speculative sandbox before safely natively syncing (`rsync -a`) back into your active branch.
- **Hardened Docker Sandboxing:** Bash executions are heavily restricted by default. Staged calls drop all system privileges (`--cap-drop=ALL`), prevent internal escalations (`--security-opt=no-new-privileges`), block network interfaces (`--network none`), and strictly mount target workspaces as read-only.
- **AST Rollbacks & Process Group Isolation:** Every native codebase edit instantly triggers the generation of a localized `.bak` rollback file. Furthermore, runaway child processes or infinite-looping hooks spawned by the AI are terminated system-wide via atomic process-group `SIGKILLs`.

### ⏱️ Memory & Deep Temporal Awareness
- **Chronological Context Injection:** The LLM's core system prompt intrinsically understands time. It is dynamically fed the local timezone, exact ISO epochs, and daemon uptime calculations.
- **Sequential Messaging Markers:** To provide the AI with the organic "feel" of pacing, every single conversational turn is dynamically injected with a precise prefix (`[Timestamp: HH:MM:SS]`), giving it perfect temporal intuition regarding the latency between your replies.
- **Semantic Graph Decay:** Insight vectors stored within the SQLite memory graph asynchronously undergo an exponential mathematical time-decay logic. Obsolete memory pathways are actively purged to prevent permanent vector sprawl.
- **Rolling TTL Sweepers:** The background daemon operates a highly aggressive garbage collection cycle—pruning dangling Git worktrees, cleaning up stale `.bak` rollback files after 24 hours, and destroying localized cache payloads older than 7 days.

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
Routes your local interactive session straight through the persistent background daemon, allowing for massive asynchronous task completions and webhook bridging to external mobile or desktop clients.

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
