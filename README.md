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

### Performance Magic

- **Context Caching**: 90% cost reduction on cached tokens
- **Model Routing**: Automatic tier selection (fast/balanced/deep)
- **Context Compression**: LLM-based summarization at 85k tokens
- **Predictive Prefetching**: Rule-based next-tool prediction
- **Connection Pooling**: undici HTTP connection pooling for efficiency

---

## 📦 Installation

### Prerequisites

- **Node.js 20+** (modern runtime for the divine interface)
- **OpenRouter API Key** (your passport to the AI pantheon)

### Quick Setup

```bash
# Clone the repository
git clone https://github.com/The-Osiris-Labs/Tehuti-CLI
cd Tehuti-CLI

# Install dependencies
npm install

# Build for production
npm run build

# Create a convenient alias
alias tehuti='node /path/to/Tehuti-CLI/dist/index.js'
```

### Obtain Your OpenRouter API Key

1. Visit [openrouter.ai](https://openrouter.ai)
2. Sign up or log in
3. Navigate to [Keys](https://openrouter.ai/keys)
4. Click "Create Key"
5. Copy your key (starts with `sk-or-v1-`)

### Set Your API Key

```bash
# Option 1: Environment variable (recommended)
export OPENROUTER_API_KEY="sk-or-v1-your-key-here"

# Option 2: Add to ~/.zshrc or ~/.bashrc for persistence
echo 'export OPENROUTER_API_KEY="sk-or-v1-your-key-here"' >> ~/.zshrc
source ~/.zshrc

# Option 3: Run setup wizard
tehuti init
```

## 🎯 Quick Start

### Interactive Mode

```bash
tehuti
```

You'll be greeted with the divine interface:
```
𓆣 Tehuti - Scribe of Code Transformations
Ask me anything about your code...

>
```

### One-Shot Queries

```bash
tehuti "fix the bug in auth.ts"
tehuti "optimize this SQL query"
tehuti "write a Python function to calculate fibonacci numbers"
```

### Specific Model Selection

```bash
# Use Claude Sonnet for complex reasoning
tehuti --model anthropic/claude-sonnet-4 "refactor this TypeScript codebase"

# Use a fast free model
tehuti --model z-ai/glm-4.5-air:free "explain this React component"
```

---

## 📖 Interactive Slash Commands

| Command | Description |
|---------|-------------|
| `/help` | Show all commands |
| `/model <name>` | Change model |
| `/models` | List available free models |
| `/save [name]` | Save session with name |
| `/load <id>` | Load session by ID |
| `/sessions` | List recent sessions |
| `/cost` | Show session cost and tokens |
| `/stats` | Show performance metrics |
| `/clear` | Clear history |
| `/exit` | Exit CLI |

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

Config is stored in `~/.tehuti.json`:

```json
{
  "apiKey": "sk-or-v1-...",
  "model": "z-ai/glm-4.5-air:free",
  "modelSelection": "auto",
  "permissions": { "mode": "interactive" },
  "maxIterations": 5
}
```

### Model Selection Modes

- `auto` - Automatically select model based on task complexity (default)
- `manual` - Always use the configured model
- `cost-optimized` - Prefer free/fast models
- `speed-optimized` - Always use fastest model

## 🏺 Recommended Models

| Model | Use Case |
|-------|----------|
| `z-ai/glm-4.5-air:free` | Default free model |
| `meta-llama/llama-3.3-70b-instruct:free` | Large context |
| `deepseek/deepseek-r1:free` | Reasoning |
| `google/gemini-2.0-flash-exp:free` | Fast |
| `anthropic/claude-sonnet-4` | Complex tasks |

---

## 🔧 Development

```bash
# Install dependencies
npm install

# Build for production
npm run build

# Run directly
npm start

# Run tests
npm test

# Type check
npx tsc --noEmit

# Lint
npm run lint
```

### Project Structure

```
src/
├── index.ts                          # Entry point
├── cli/                              # CLI commands and UI
│   ├── commands/chat.ts             # Main chat command (React/Ink UI)
│   └── ui/components/               # React components
├── agent/                            # AI agent and tools
│   ├── index.ts                     # Agent loop with parallel execution
│   ├── context-compressor.ts        # Context summarization
│   ├── model-router.ts              # Model tier routing
│   ├── parallel-executor.ts         # Parallel tool execution
│   ├── prefetcher.ts                # Predictive prefetching
│   └── tools/                       # 25+ tools
├── api/                              # OpenRouter API client
│   └── openrouter.ts                # OpenRouter API client (singleton)
├── config/                          # Configuration management
├── branding/                        # Egyptian visual theme
├── permissions/                     # Permission system
├── mcp/                             # MCP integration
├── hooks/                           # Hook execution system
├── terminal/                        # Terminal utilities
├── session/                         # Session persistence
└── utils/                          # Utility functions
```

## 🔍 Troubleshooting

### "API key is required"
```bash
export OPENROUTER_API_KEY="sk-or-v1-your-key"
```

### "Web search requires Exa API key"
```bash
export EXA_API_KEY="your-exa-key"
```

### "ripgrep is not installed"
```bash
# macOS
brew install ripgrep

# Linux
apt install ripgrep
```

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