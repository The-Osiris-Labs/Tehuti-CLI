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

Tehuti is a specialized Node.js terminal coding assistant designed to bridge the gap between static CLI scripts and localized intelligence. It runs natively in your terminal, interfacing seamlessly with OpenAI-compatible APIs to execute complex, autonomous engineering tasks. 

Named after Thoth (Tehuti), the Egyptian deity of wisdom and writing, the CLI combines a meticulously crafted Egyptian-themed Terminal User Interface (TUI) with a highly concurrent execution engine.

---

## 🚀 v1.1.0 Milestone Highlights
The latest `v1.1.0` release ("The Beast Awakens") introduces monumental architectural shifts and production-grade deep hardening, transforming Tehuti from a simple CLI into a persistent, uncrackable companion:
- **Production-Grade Security**: Full immunity to Prompt Injection (via XML wrapper defenses), Shell Injection (safe-spawn array executions), SQL Injection (parameterized bindings), and MCP Schema Poisoning.
- **Persistent Background Daemon:** Run Tehuti invisibly in the background with `tehuti daemon start`, maintaining active state and memory, safeguarded by absolute `try/catch` boundaries.
- **Omnichannel Connectors:** Native WebSockets and HTTP webhook integration for Discord, Slack, Telegram, and WhatsApp.
- **Swarm Orchestration:** Spin up multiple subagents concurrently (`fork()`) with chunked IPC serialization, strict liveness watchdogs, and zero memory leaks.
- **Self-Healing Execution:** Speculative `git worktree` sandboxes for tool execution. Failed edits are dynamically reverted and fed back to the LLM.
- **Ink 6 + React 19 TUI:** Completely overhauled, remount-free virtual scrolling Terminal UI capable of rendering infinite LLM context.

---

## 𓁹 The Eye of Ra: Autonomous Swarm Capabilities

Tehuti transcends single-threaded interaction by invoking a legion of autonomous worker agents—a veritable swarm operating under the absolute authority of the daemon. These god-tier capabilities transform Tehuti from a simple assistant into an omniscient, automated engineering syndicate:

- **Speculative Multi-Path Execution (Git Worktrees):** Tehuti fractures time itself by dynamically spinning up ephemeral `git worktree` sandboxes. It tests multiple complex architectural paths in parallel, executing test suites in perfect isolation. It merges only the flawless outcomes while banishing failed timelines to the void—all completely autonomously.
- **Autonomous MCP Pipelines:** Complete lifecycle mastery through dynamic Model Context Protocol pipelines. Subagents autonomously negotiate with connected MCP servers, discovering, routing, and chaining tools on the fly to forge continuous, self-sustaining execution loops.
- **Cross-Platform Context Continuity:** True omniscience across realms. Context flows unbroken from Discord and Slack webhooks directly back to the local CLI. Initiate a sprawling architecture refactor on your phone via Slack, and watch as Tehuti seamlessly continues the thread on your local machine.
- **Background Daemon Mastery (Chokidar):** The newly refactored daemon, vigilant as the Sphinx, uses `chokidar` for deep, leak-free filesystem orchestration. It silently watches over your project, triggering self-healing loops and managing subagent states without ever blocking your primary terminal session.
- **Swarm Profiler TUI:** Command the legion from the CLI. A breathtaking Ink 6 / React 19 Interactive Profiler allows you to observe multi-process (`fork()`) subagents in real-time. Monitor task lifecycles, inspect chunked IPC streams over wire protocol, and dictate execution states with Vim-bound precision (`j/k/d/r`).

---

## 🧠 Memory Architecture

Tehuti is designed to remember and adapt to your specific engineering environment over long periods of time.

- **Personality Learning Engine**: Analyzes Git diffs and command histories post-session to learn your style and formatting habits, persistently stored in an internal SQLite key-value store (`user_preferences` and `project_profiles`).
- **Semantic Graph Consolidation**: A background job continuously scans recent interaction logs and creates relational edges in an internal SQLite database (`~/.config/tehuti/memory/graph.db` containing `nodes` and `edges`) using an exponential decay weighting system.
- **Dual Context Compression**: 
  - **In-Loop Compression**: At ~85% capacity, the execution loop handles context compression deterministically via array truncation (splicing out oldest messages). This does **NOT** use LLM summarization, avoiding expensive LLM calls.
  - **User-Initiated `/compact`**: A lightweight command that uses a simple placeholder summary, keeping only the system prompt and the last 6 messages.

---

## ⚡ Execution & Swarm Concurrency

Tehuti is built for extended autonomous workflows.

- **Parallel Tool Execution**: Safe, read-only tools run in concurrent batches (max 5 concurrency) when the model emits multiple tool calls in a single turn. Write operations logically force sequential execution.
- **Rule-Based Prefetching**: Predicts and queues secondary data (e.g., `git_status` triggering a `git_diff` prefetch) on the first tool call of a batch to eliminate round-trip latency.
- **Connection Pooling**: Utilizes an `undici` Agent pool to substantially reduce TLS overhead across repeated LLM API invocations.
- **Swarm Delegation & Subagents**: Supports spawning autonomous subagents for specialized execution tasks via robust multi-process forking, dynamic chunked IPC serialization, and strict timeout resilience.
- **Dynamic MCP Integration**: Natively registers and mounts dynamic `mcp_*` tools at runtime using the `@modelcontextprotocol/sdk`.

---

## 🛡️ Self-Healing & Codebase Safety

- **Speculative Worktree Loops**: Tehuti creates ephemeral Git worktree branches for speculative edits, runs validation commands securely, injects failures directly back into the LLM context, and merges on success or discards on failure.
- **IBAC Permissions**: Code execution occurs through a sandboxed `just-bash` utility, explicitly coupled with Interactive Role-Based Access Control (IBAC) permission prompts. Destructive operations strictly require user authorization.
- **File System Sandboxing**: Strictly filters sensitive binary edits, bounds `listDir` to 1000 items, and appends entropy to backups to prevent destructive overrides.

---

## 🖥️ Interactive TUI Mechanics

Tehuti is shipped with an interactive Terminal User Interface built on Ink 6 and React 19.

- **Hybrid Viewport Architecture (See `HANDOFF.md`)**: Resolves massive log rendering without React remounts. Scrolling is achieved via a **negative margin** (`marginBottom={-scrollOffset}`) that physically slides the rendered column, paired with a dynamic `visibleMessages` array slice (with a 10-message fallback buffer) strictly for rendering performance.
- **Interactive Sessions UI**: Includes full Vim keybindings (`j/k/d/r`), mouse-hover support, and virtual scrolling.
- **Terminal Rendering Precision**: Features robust Markdown header parsing, `KaTeX` block formulas, and surrogate-pair safe ANSI truncation to prevent terminal bleeding.
- **Robust Keyboard Handling**: Native parsing for `xterm` CSI escape sequences (`[13~`, `[27;5;13~`) ensuring that Enter keys, Vim navigation, and shortcuts work flawlessly across all modern terminal emulators (iTerm2, Ghostty, WezTerm).
- **Expandable Tool Previews**: Built-in tool outputs automatically truncate into a styled 4-line preview block when collapsed, giving instant observability without cluttering the viewport.
- **Command Palette**: Type `/` to access built-in workflows including `/save`, `/load`, `/sessions`, and `/compact`.

For environments like SSH or tmux where mouse tracking is unavailable, set either environment variable below to launch in strict keyboard-only mode:

```bash
TEHUTI_DISABLE_MOUSE=1 npm run start
NO_MOUSE=1 npm run start
```

---

## 🌐 Background Daemon & Connectors

- **Active State Orchestration**: The `src/daemon/state-engine.ts` is fully wired, directly managing FS watchers (`chokidar`), cron schedules, and tracking swarm subagents.
- **macOS `launchd` Autostart**: Generates and installs a `launchd` plist so the persistent daemon survives system reboots.
- **IPC Unix Socket Server**: Operates a background server (`~/.tehuti/tehutid.sock`, created securely with mode `0o600`). Only the owning user can connect. Messaging-mode sessions exposing `bash` or write tools require explicit caller whitelisting.
- **Companion Mode**: A new interactive CLI (`tehuti companion`) that connects the foreground terminal directly to the running background daemon.
- **Omnichannel Connectors**: Native webhook and WebSocket listeners for Discord, Slack, Telegram, and WhatsApp are fully implemented. A central `messaging_sessions` SQLite table maps platform-specific sender IDs to native Tehuti sessions.

---

## 🔬 Advanced / Under the Hood

For a deeper dive into Tehuti's architecture, historical context, and technical evolution, refer to [PROJECT.md](PROJECT.md).

If you are an AI agent or building autonomous systems on top of Tehuti, please read the sacred instructions in [`.agents/AGENTS.md`](.agents/AGENTS.md).

---

## ⚡ Technical Highlights & Innovations

- **16ms Backpressure**: Hand-rolled streaming mechanisms designed to keep UI rendering latency under 16ms for real-time responsiveness.
- **AST Rollbacks**: Safely rollback code changes at the Abstract Syntax Tree level if syntactic validation fails during generation.
- **Dynamic Swarm Serialization & IPC Chunking**: Seamlessly serialize agent state and chunk IPC messages across Unix sockets for resilient background processing.
- **Docker Sandboxing**: Utilizes `--cap-drop=ALL` for secure, isolated code execution within bounded containers.

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
Tehuti dynamically routes models based on keyword heuristics to optimize for speed, depth, or balanced capabilities based on your prompt. Settings cascade from global configs down to environment variables (`TEHUTI_API_KEY`, `TEHUTI_MODEL`, `TEHUTI_PROVIDER`).
- **Default Provider**: `opencode` (`https://opencode.ai/zen/go/v1`)
- **Default Model**: `deepseek-v4-flash`

Run the interactive setup wizard to link your API keys:
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
