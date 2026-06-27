𓅞 Thoth, Tongue of Ra

Halls of Records • Balance of Ma'at • Architect of Truth

---

# 𓆣 Tehuti CLI - Architect of Truth

## The Mission Statement

Chaos has descended upon software development.

Every week, a new AI tool emerges. Every developer with access to an LLM spins up their own "revolutionary" project. Vibe coding has replaced engineering. "It works" has replaced "it is correct."

This ends now.

Tehuti is not another toy for hobbyists. It is not another chat interface wrapped in a terminal. It is the Architect of Truth—a tool built for developers who understand that code is not about "shipping fast" but about shipping right.

## OSIRIS — The Mother Company

OSIRIS — God of the afterlife, transition, and rebirth. OSIRIS oversees the reincarnation of Egyptian deities into cutting-edge AI technology.

OSIRIS represents:
- **Transition** — From chaos to order
- **Rebirth** — Ancient wisdom into modern form
- **Afterlife** — Knowledge that never dies

## The Deities

| Deity | Hieroglyph | Role | Status |
|-------|------------|------|--------|
| **Tehuti** | 𓅞 | Truth, Order, Engineering Excellence | 🏛️ Active |
| **IBIS** | 𓃠 | AGI Trading & Pattern Recognition | 🔗 Live |

## The Problem Statement

The AI development landscape has descended into chaos. Every amateur with LLM access spins up half-baked "tools." Vibe coding replaces engineering. "It works" replaces "it is correct."

## The Solution

Tehuti is not for everyone. It is for the engineer who understands that code is craft, not commodity. It remembers, it reasons, it executes with precision. It demands excellence—and delivers it.

## Call to Action

If you are here to build something real, something lasting, something correct—welcome home.

---

## 🚀 Run Tehuti Right Now

You have two paths. The **Rust core binary** is ready with zero setup and gives the full 𓅞 Egyptian experience (model registry, subagents, temporal memory, Ma'at self-reflection).

```bash
# From the project directory
cd Projects/Tehuti-CLI-Revival   # or wherever you cloned

# Easiest — the mature Rust core (no keys needed to boot & see the harness)
./rust-core/target/release/tehuti

# With demo of providers / subagents
./rust-core/target/release/tehuti --demo

# Help + usage
./rust-core/target/release/tehuti --help
```

**Full TypeScript agent harness** (Ink TUI, commander CLI, real tools + MCP loop):

```bash
# One-time
npm install

# Interactive
npm run start
# or
npx tsx src/index.ts

# One-shot prompt (after you have a key configured)
npm run start -- "fix the bug in src/foo.ts"

# With overrides
npm run start -- -p kilocode -m deepseek-v4-flash "explain this"

# Setup wizard
npm run start -- init     # or npx tsx src/index.ts init
```

Other UIs:
- OpenTUI (rich): `bun src/tui-opentui.tsx` (Bun is installed on many systems)
- After build: `npm run build && node dist/index.js`

Global convenience:
```bash
npm link          # then just `tehuti` anywhere
# or alias
alias tehuti='node /path/to/Tehuti-CLI/dist/index.js'
```

---

## ✨ Why Tehuti?

Tehuti isn't just another AI coding assistant. It's a **complete reimagining** of how humans and AI collaborate on code.

### Divine Features

- **🧠 Multi-Model Wisdom** - Choose from 300+ models via OpenRouter (Claude, GPT, Gemini, DeepSeek)
- **⚡ Parallel Execution** - Up to 5 tools run concurrently for lightning-fast results
- **💾 Session Persistence** - Save, resume, and name conversations like ancient scrolls
- **📋 Plan Mode** - Read-only exploration before making changes (avoid costly mistakes)
- **🪝 Hooks System** - Deterministic automation (format on save, lint before commit)
- **🧠 Extended Thinking** - Claude Sonnet/Opus reasoning mode for complex tasks
- **📄 Project Instructions** - Auto-load CLAUDE.md, TEHUTI.md, or AGENTS.md
- **🔧 25+ Tools** - Read, write, edit, bash, glob, grep, web search, sub-agents
- **🔌 MCP Integration** - Full Model Context Protocol support
- **🖼️ Image & PDF Reading** - Native support for vision models
- **🔄 Background Processes** - Run and manage long-running commands
- **🔒 Safe Execution** - Permission prompts for dangerous operations
- **🎯 Skills System** - Auto-apply expertise based on task type (JavaScript/TypeScript, Python, Git)

### Performance Magic

- **Context Caching**: 90% cost reduction on cached tokens
- **Model Routing**: Automatic tier selection (fast/balanced/deep)
- **Context Compression**: LLM-based summarization at 85k tokens
- **Predictive Prefetching**: Rule-based next-tool prediction
- **Connection Pooling**: undici HTTP connection pooling for efficiency

---

## 📦 Installation & First Run

### Fastest Path (Rust Core — Recommended to start)

No Node, no keys, no build. The binary already contains the self-evolving harness (ReAct, sub-agents, memory, MCP-ready, Egyptian TUI text).

```bash
git clone https://github.com/The-Osiris-Labs/Tehuti-CLI
cd Tehuti-CLI
./rust-core/target/release/tehuti
```

See the banner, model registry (grok-4.3, claude-fable-5, etc.), and internal Ma'at notes immediately.

### Full TypeScript Harness (extensible agent + TUI)

```bash
git clone https://github.com/The-Osiris-Labs/Tehuti-CLI
cd Tehuti-CLI
npm install
npm run start          # dev (tsx, no build needed)
# or build once
npm run build && node dist/index.js
```

### Configuration (required for real LLM calls)

Copy the example and edit:

```bash
cp .tehuti.example.json ~/.tehuti.json
# or keep local .tehuti.json
```

Minimal for KiloCode (default in example):

```json
{
  "provider": "kilocode",
  "model": "deepseek-v4-flash",
  "apiKey": "your-kilo-or-other-key-here"
}
```

**For GitHub MCP** (powerful repo/PR tools via natural language):

Set the token:

```bash
export GITHUB_PERSONAL_ACCESS_TOKEN="ghp_..."
```

The example already includes the github MCP server. Enable/disable with `"mcp": { "enabled": true }`.

Other providers supported: openrouter, custom, anthropic, openai, gemini, xai (via keys or OAuth in Rust core).

Run the wizard anytime:

```bash
npm run start -- init
# or
tehuti init
```

### Quick one-liner after setup

```bash
npm run start -- "refactor the auth module with proper error handling"
```

## 🎯 Quick Start

### Rust Core (zero friction, see the living harness)

```bash
./rust-core/target/release/tehuti
./rust-core/target/release/tehuti --demo
```

You will see the 𓅞 banner, temporal context, current model registry, and notes about sub-agents, parallel execution, and Ma'at self-reflection.

### TS Harness

```bash
npm run start
```

### One-Shot + Flags

```bash
tehuti "fix the bug in auth.ts"
tehuti -p kilocode -m deepseek-v4-flash "explain the agent loop"
tehuti --model anthropic/claude-fable-5 "plan the next feature"
tehuti --no-mcp --quiet "quick task"
```

See everything:

```bash
tehuti --help
tehuti mcp --help
```

Inside a running session use sacred inscriptions (slash commands) such as `/plan`, `/compact`, `/recall`, `/inscribe`, `/save`. Full list in `docs/user-guide/04-sacred-inscriptions.md`.

---

## 📖 Interactive Slash Commands

| Command | Description |
|---------|-------------|
| `/help` | Show all commands |
| `/model <name>` | Change model |
| `/models` | List available free models |
| `/thinking` | Toggle extended thinking mode for complex reasoning |
| `/plan` | Enter plan mode (read-only exploration) |
| `/compact` | Compact context to free up token space |
| `/skills` | List all available skills |
| `/save [name]` | Save session with name |
| `/load <id>` | Load session by ID |
| `/sessions` | List recent sessions |
| `/cost` | Show session cost and tokens |
| `/stats` | Show performance metrics |
| `/clear` | Clear history |
| `/exit` | Exit CLI |

## 🎯 Skills System

Tehuti features an intelligent skills system that automatically detects and applies relevant expertise based on your task type. This ensures that the AI has the right context and knowledge to handle your specific coding challenge.

### Built-in Skills

| Skill ID | Name | Description |
|----------|------|-------------|
| `javascript-expert` | JavaScript/TypeScript Expert | Deep knowledge of JavaScript and TypeScript programming languages |
| `python-expert` | Python Expert | Expert knowledge of Python programming language and its ecosystems |
| `git-expert` | Git Expert | Advanced knowledge of Git version control system |

### Using Skills

```bash
# List all available skills
/skills

# Toggle extended thinking mode (for complex reasoning)
/thinking

# Enter plan mode (read-only exploration)
/plan

# Compact context to free up token space
/compact
```

## 🛠️ Available Tools

### File Operations
- `read` - Read file with line numbers
- `write` - Write to file
- `edit` - String replacement
- `read_image` - Image → base64 for vision
- `read_pdf` - PDF text extraction
- `glob` - File pattern matching
- `grep` - Content regex search

### Execution
- `bash` - Shell commands
- `start_background` - Background process
- `list_processes` - List processes
- `read_output` - Read process output
- `kill_process` - Kill process

### Web & Search
- `web_fetch` - Fetch URL content
- `web_search` - Exa web search
- `code_search` - Exa code search

### System
- `todo_write` - Task management
- `task` - Spawn sub-agent
- `write_plan` - Write implementation plan

## 🏛️ Project Instructions

Tehuti automatically loads project-specific instructions from these files (in order):

1. `CLAUDE.md` - Claude Code compatible
2. `TEHUTI.md` - Tehuti-specific
3. `AGENTS.md` - General agent instructions
4. `.claude.md` or `.tehuti.md` - Hidden config

**Example CLAUDE.md:**
```markdown
# Project Instructions

- Use TypeScript with ESM modules
- Follow existing code patterns
- Run tests before committing
- Never commit .env files
```

## 🔮 Configuration

The authoritative config lives at `~/.tehuti.json` (or local `.tehuti.json`). Start from the example:

```bash
cp .tehuti.example.json ~/.tehuti.json
```

Current shape (KiloCode default + GitHub MCP ready):

```json
{
  "provider": "kilocode",
  "model": "deepseek-v4-flash",
  "fallbackModel": "minimax/minimax-m2.5:free",
  "maxTokens": 32000,
  "permissions": {
    "defaultMode": "interactive"
  },
  "mcp": {
    "enabled": true,
    "servers": {
      "github": { "transport": "http", "url": "https://api.githubcopilot.com/mcp/", ... }
    }
  }
}
```

Run the wizard:

```bash
tehuti init
tehuti config     # inspect current
```

Rust core also reads similar state + supports OAuth flows for several providers.

## 🏺 Recommended / Current Registry Models (2026-06)

The harness surfaces a live registry (see Rust startup):

- xai/grok-4.3
- openai/gpt-5.5
- anthropic/claude-fable-5
- gemini/gemini-3.5-flash
- Many free / OpenRouter options via KiloCode or direct

Override with `-m` / `--model` or in config. The system recommends based on task.

---

## 🔧 Development

```bash
npm install
npm run start                 # dev TS (tsx + Ink TUI)
npm run build                 # produce dist/
./rust-core/target/release/tehuti   # the Rust core any time

npm test
npm run typecheck
npm run lint
```

### Project Structure (Hybrid)

- `rust-core/target/{release,debug}/tehuti` — self-contained mature Rust harness (ratatui-era Egyptian TUI text, ReAct, memory, subagents, MCP, self-mod)
- `src/` — full TypeScript agent harness (commander + Ink/OpenTUI UIs, agent loop, MCP client, tools, sessions, config)
- `docs/user-guide/` — sacred records (getting started, inscriptions, sessions...)

Key files:
- `src/index.ts` + `src/cli/commands/chat.ts` — CLI entry + Ink TUI
- `src/agent/` — ReAct loop, parallel, context, subagents, tools
- `src/mcp/` — generic MCP (stdio/http)
- `src/config/` — schema + loader (kilocode default etc.)
- `src/branding/` — hieroglyphs, ASCII, Egyptian visuals
- `.tehuti.example.json` — full example with MCP GitHub server
```

## 🔍 Troubleshooting

### API key required / invalid (TS path)

```bash
export KILO_API_KEY=...     # default provider in .tehuti.example
# or
tehuti init
tehuti config
```

The Rust binary boots and demonstrates the full harness without keys (real provider calls need valid credentials).

### GitHub MCP / tools

```bash
export GITHUB_PERSONAL_ACCESS_TOKEN=ghp_your_pat_with_repo_scope
# Verify
tehuti mcp list
```

### Other

- Ripgrep is vendored via a dep in most environments.
- For the OpenTUI experience: have Bun (`bun --version`).
- Use `--debug` (TS) or just run the Rust binary for rich internal logging.
- Sessions & state live under `~/.tehuti/sessions` (TS) or /tmp (Rust handoff).

---

## 📜 License

MIT License - feel free to use Tehuti for your coding adventures!

## 🌍 Contributing

Contributions are welcome! Check out [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## 📞 Support

If you encounter issues or have questions:
1. Check the [FAQ](https://github.com/The-Osiris-Labs/Tehuti-CLI/wiki/FAQ)
2. Open an issue on GitHub
3. Join our Discord community

---

## About TheOsirisLabs.com

Project Tehuti is a product of TheOsirisLabs.com — a laboratory dedicated to building tools that demand excellence.

We do not build chatbots. We do not build toys for the impatient. We build instruments of precision for developers who understand that code is a craft, not a commodity.

The chaos of modern AI development—the "vibe coders," the immature tools, the endless stream of half-baked projects—ends here.

## Contact & Links

| Resource | URL |
|----------|-----|
| **Main Repository** | https://github.com/The-Osiris-Labs/Tehuti-CLI |
| **IBIS (Sister Project)** | https://github.com/The-Osiris-Labs/IBIS-AGI-TRADER |
| **Website** | https://theosirislabs.com |

## Final Words

"To know how to understand is to know how to live."
— Ancient Egyptian wisdom, applicable today

---

𓅞 Thoth, Tongue of Ra

Halls of Records • Balance of Ma'at • Architect of Truth

From the House of OSIRIS — TheOsirisLabs.com