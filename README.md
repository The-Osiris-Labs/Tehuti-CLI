𓅞 Thoth, Tongue of Ra

Halls of Records • Balance of Ma'at • Architect of Truth

---

# 𓆣 Tehuti CLI - Architect of Truth

## The Mission Statement

Chaos has descended upon software development.

Every week, a new AI tool emerges. Every developer with access to an LLM spins up their own "revolutionary" project. Vibe coding has replaced engineering. "It works" has replaced "it is correct."

This ends now.

Tehuti is not another toy for hobbyists. It is not another chat interface wrapped in a terminal. It is the Architect of Truth—an elite, fully interactive, agentic AI coding assistant built for developers who understand that code is not about "shipping fast" but about shipping right.

Built with React (Ink), Tehuti goes beyond standard CLI tools by offering a rich, mouse-aware, natively scrolling TUI (Terminal User Interface) while packing serious multi-agent AI firepower.

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

## ✨ Divine Features

- **🧠 Multi-Model Wisdom:** Access 300+ models via OpenCode Go (Claude 3.5, GPT-4o, DeepSeek, Gemini).
- **🖥️ Elite TUI Experience:** A bespoke "Virtual Sliding Viewport" built in Ink allows for pixel-perfect layout stability, native line-by-line scrolling, and fully interactive, clickable tool outputs inside the terminal.
- **⚡ Parallel Execution:** Run up to 5 read-only tools concurrently for lightning-fast codebase analysis.
- **💾 Session Persistence:** Automatically save and load previous conversation states and cache trees to disk.
- **📋 Plan Mode (`/plan`):** Force the agent into a read-only exploration mode to propose architectural changes before touching your code.
- **🧠 Extended Thinking (`/thinking`):** Enable deep reasoning modes for complex debugging.
- **🎯 Skills System:** Auto-applies specific expertise (TypeScript, Git, Python) directly into the agent's system prompt based on the task type.
- **🔌 MCP Ready:** Native support for the Model Context Protocol, enabling connections to GitHub, Postgres, and browser tools.

---

## 📦 Installation & Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/The-Osiris-Labs/Tehuti-CLI-Revival.git
cd Tehuti-CLI-Revival

# 2. Install dependencies
npm install

# 3. Build the CLI
npm run build

# 4. Run the setup wizard to configure your OpenCode Go provider and API keys
npm run start -- init
```

### Usage

Once configured, you can launch Tehuti in interactive mode:
```bash
npm run start
```

Or pass a direct prompt (One-Shot Mode):
```bash
npm run start -- "Refactor the authentication logic in src/auth.ts"
```

Override models on the fly:
```bash
npm run start -- -m anthropic/claude-3.5-sonnet "Audit the security of the API"
```

---

## 📖 Interactive Slash Commands

Inside a running Tehuti session, use the following commands or trigger the Command Palette (Arrow keys or Mouse) when the input is empty:

| Command | Description |
|---------|-------------|
| `/help` | Show all commands |
| `/model <name>` | Change the active AI model |
| `/models` | List available models from OpenCode Go |
| `/thinking` | Toggle extended thinking mode for complex reasoning |
| `/plan` | Enter read-only planning mode |
| `/compact` | Force context compression to free up token space |
| `/skills` | List all active agent skills |
| `/save [name]` | Save current session with a name |
| `/load <id>` | Load a specific session by ID |
| `/sessions` | List recent sessions |
| `/cost` | Show session cost and token usage |
| `/stats` | Show cache performance and parallel execution metrics |
| `/clear` | Clear conversation history |
| `/exit` | Exit CLI |

---

## 🔮 Configuration (`~/.tehuti.json`)

Tehuti looks for its configuration in your home directory or locally in the project.

```json
{
  "provider": "opencode",
  "model": "deepseek-v4-flash",
  "fallbackModel": "deepseek-v4-flash",
  "maxTokens": 32000,
  "modelTiers": {
    "fast": "deepseek-v4-flash",
    "balanced": "minimax-m3",
    "deep": "anthropic/claude-3.5-sonnet"
  },
  "mcp": {
    "enabled": true
  }
}
```

---

## 🏗️ Architecture & Development Handoff

For agents or developers looking to contribute, please read the [HANDOFF.md](./HANDOFF.md) guide.

Tehuti uses a highly complex Ink (React) TUI. **Do not** attempt to modify the scrolling logic in `chat.ts` without understanding the `marginBottom: -scrollOffset` Virtual Sliding Viewport implementation. Standard array slicing or static rendering will destroy the clickability of tool outputs.

### Development Scripts
```bash
npm run start       # Run locally via tsx without building
npm run build       # Compile TypeScript
npm test            # Run the 400+ unit tests
npm run lint        # Run ESLint
```

---

## About TheOsirisLabs.com

Project Tehuti is a product of TheOsirisLabs.com — a laboratory dedicated to building tools that demand excellence.

We do not build chatbots. We do not build toys for the impatient. We build instruments of precision for developers who understand that code is a craft, not a commodity.

The chaos of modern AI development—the "vibe coders," the immature tools, the endless stream of half-baked projects—ends here.

## Contact & Links

| Resource | URL |
|----------|-----|
| **Main Repository** | https://github.com/The-Osiris-Labs/Tehuti-CLI-Revival |
| **IBIS (Sister Project)** | https://github.com/The-Osiris-Labs/IBIS-AGI-TRADER |
| **Website** | https://theosirislabs.com |

## Final Words

"To know how to understand is to know how to live."
— Ancient Egyptian wisdom, applicable today

---

𓅞 Thoth, Tongue of Ra

Halls of Records • Balance of Ma'at • Architect of Truth

From the House of OSIRIS — TheOsirisLabs.com