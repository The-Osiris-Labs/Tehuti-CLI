<div align="center">
  <h1>𓆣 Tehuti CLI</h1>
  <p><i>Halls of Records • Balance of Ma'at • Architect of Truth</i></p>
  <p><b>A beautifully crafted, high-performance terminal coding agent optimized for AI workflows.</b></p>
</div>

---

Tehuti is an advanced Node.js 20+ terminal agent designed to integrate directly into your workflow. It runs natively in your terminal, interfacing with OpenAI-compatible `/chat/completions` APIs to help you write, refactor, and understand code. 

Named after Thoth (Tehuti), the Egyptian deity of wisdom and writing, it combines a highly polished Egyptian-themed TUI with a high-performance, native-speed engine under the hood.

## 🌟 Key Features

- **Terminal UI:** We built a custom React 19 and Ink 6 terminal UI featuring a virtual sliding viewport, mouse-aware command palettes, and real-time ANSI token streaming. It delivers a fluid, immersive experience.
- **High-Performance Networking:** Tehuti utilizes a highly optimized `fetch` + Server-Sent Events (SSE) implementation over HTTP/3 with `undici` connection pooling, establishing raw, direct HTTP communication for low-latency streaming.
- **Native Semantic Capabilities:** Tehuti leverages a native Rust `.node` binary (`tehuti-core`) for parallel, fast semantic `grep` operations. 
- **Extensive Model Support:** Works out of the box with OpenCode Go (`deepseek-v4-flash` by default), and natively supports over 18 providers including OpenRouter, KiloCode, Anthropic, and local Ollama instances.
- **Extensibility:** Ships with around 68 built-in tools (filesystem, bash sandboxes, git, AST parsing) and fully supports the **Model Context Protocol (MCP)** via stdio, HTTP, SSE, or WebSocket to plug in any external capability.
- **Secure Access Control:** Integrates modern Identity-Based Access Control (IBAC) for fine-grained, secure tool permissions.

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
Tehuti can also be used in single-prompt mode for quick scripting or piping.

```bash
tehuti "Refactor the authentication logic in src/auth.ts"
tehuti -m deepseek-v4-flash "Summarize this repository"
tehuti -j "Return structured output"          # Emits pure JSON
tehuti -q "Quick answer without tool noise"   # Suppress tool logs
```

---

## ⚙️ Configuration

Tehuti gracefully merges settings from multiple sources (lowest to highest priority):
1. **Defaults:** The baseline (`deepseek-v4-flash` via `opencode`).
2. **Global Store:** Your wizard settings saved in `~/.config/tehuti/config.json`.
3. **Project Config:** A `.tehuti.json` file in your specific project directory.
4. **Environment Variables:** Things like `TEHUTI_API_KEY` or `TEHUTI_MODEL` for quick, on-the-fly overrides.

All chat sessions, memory graphs, and API caches are safely stored in `~/.tehuti/`.

### Terminal Accessibility

The interactive UI supports mouse-aware panes and command palettes. For environments where mouse tracking is unavailable or undesired, set either environment variable below to launch in keyboard-only mode:

```bash
TEHUTI_DISABLE_MOUSE=1 npm run start
NO_MOUSE=1 npm run start
```

If the terminal is left in a strange state after an interruption, start a new shell or run `reset`. Tehuti attempts to restore cursor, style, and mouse tracking modes during shutdown and fatal error handling.

---

<div align="center">
  <p><b>From the House of OSIRIS — TheOsirisLabs.com</b></p>
</div>
