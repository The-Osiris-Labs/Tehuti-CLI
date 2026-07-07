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

## 🧠 Memory Architecture

Tehuti is designed to remember and adapt to your specific engineering environment over long periods of time.

- **Personality Learning Engine**: Analyzes Git diffs and command histories post-session to learn your style and formatting habits, persistently stored in an internal SQLite key-value store (`user_preferences` and `project_profiles`).
- **Semantic Graph Consolidation**: A background job continuously scans recent interaction logs and creates relational edges in an internal SQLite database (`insights` and `edges`) using an exponential decay weighting system.
- **Dual Context Compression**: The execution loop dynamically manages its context window. At ~85% capacity, it seamlessly executes a deterministic array truncation (splicing out oldest messages) without incurring expensive LLM calls. For user-initiated compression, the `/compact` command executes a lossy summarization to retain only critical system context and the most recent interactions.

---

## ⚡ Execution & Swarm Concurrency

Tehuti is built for massive, uninterrupted autonomous workflows.

- **Parallel Tool Execution**: Safe, read-only tools run in highly concurrent batches (max 5 concurrency) when the model emits multiple tool calls in a single turn. Write operations logically force sequential execution.
- **Rule-Based Prefetching**: Predicts and queues secondary data (e.g., `git_status` triggering a `git_diff` prefetch) on the first tool call of a batch to eliminate round-trip latency.
- **Connection Pooling**: Utilizes an `undici` Agent pool to substantially reduce TLS overhead across repeated LLM API invocations.
- **Swarm Delegation**: Supports spawning autonomous subagents for specialized execution tasks.
- **Dynamic MCP Integration**: Natively registers and mounts dynamic `mcp_*` tools at runtime using the `@modelcontextprotocol/sdk`.

---

## 🛡️ Self-Healing & Codebase Safety

- **Speculative Worktree Loops**: Tehuti creates ephemeral Git worktree branches for speculative edits, runs validation commands securely, injects failures directly back into the LLM context, and merges on success or discards on failure.
- **IBAC Permissions**: Code execution occurs through a sandboxed `just-bash` utility, explicitly coupled with Interactive Role-Based Access Control (IBAC) permission prompts. Destructive operations strictly require user authorization.

---

## 🖥️ Interactive TUI Mechanics

Tehuti is shipped with an incredibly rich, interactive Terminal User Interface built on Ink 6 and React 19.

- **Hybrid Viewport Architecture**: Handles massive logs natively by combining a dynamic `visibleMessages` array slice with negative margins for performant, remount-free virtual scrolling.
- **Interactive Sessions UI**: Includes full Vim keybindings (`j/k/d/r`), mouse-hover support, and virtual scrolling.
- **Command Palette**: Type `/` to access built-in workflows including `/save`, `/load`, `/sessions`, and `/compact`.

For environments like SSH or tmux where mouse tracking is unavailable, set either environment variable below to launch in strict keyboard-only mode:

```bash
TEHUTI_DISABLE_MOUSE=1 npm run start
NO_MOUSE=1 npm run start
```

---

## 🌐 Background Daemon & Connectors

- **macOS `launchd` Autostart**: Generates and installs a `launchd` plist so the persistent daemon survives system reboots.
- **IPC Unix Socket**: Operates a background server (`~/.tehuti/tehutid.sock`) mapping interactive sessions asynchronously. 
- **Omnichannel Connectors**: Integrates deeply with Discord, Slack, Telegram, and WhatsApp via WebSockets and HTTP webhook listeners. A central `messaging_sessions` SQLite table maps platform-specific sender IDs back to native Tehuti sessions.

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
