# 𓆣 Tehuti CLI - Agent Instructions

Welcome, divine scribe! This document provides sacred instructions for AI agents working with Tehuti CLI.

## 🏛️ The Purpose of Tehuti

Tehuti CLI is an AI-powered coding assistant that connects to OpenRouter. It serves as a modern-day scribe, helping developers transform ideas into code with wisdom and precision.

**Key Responsibilities:**
- Multi-model support via OpenRouter
- File system operations (read, write, edit, glob, grep)
- Bash command execution
- Web fetch and search capabilities
- MCP (Model Context Protocol) server integration

## 🏗️ Architecture Overview

```
src/
├── index.ts                          # Entry point (initializes API and CLI)
├── cli/                              # CLI commands and UI
│   ├── commands/
│   │   └── chat.ts                   # Main chat command (React/Ink UI)
│   ├── onboarding.ts                 # Initial API key configuration
│   └── ui/
│       └── components/               # React components
├── agent/                            # AI agent and tools
│   ├── index.ts                     # Agent loop with parallel execution
│   ├── context.ts                   # Context management
│   ├── context-compressor.ts        # Context summarization
│   ├── model-router.ts              # Model tier routing
│   ├── parallel-executor.ts         # Parallel tool execution
│   ├── prefetcher.ts                # Predictive prefetching
│   ├── skills/
│   │   ├── manager.ts               # Skills manager and built-in skills
│   │   └── tools.ts                 # Skills management tools
│   ├── cache/
│   │   ├── tool-cache.ts            # LRU cache for tool results
│   │   ├── persistent-cache.ts      # Disk persistence
│   │   └── invalidation.ts          # Cache invalidation
│   └── tools/
│       ├── fs.ts                    # File system tools (read, write, edit)
│       ├── search.ts                # Glob and grep tools
│       ├── bash.ts                  # Bash command tool
│       ├── web.ts                   # Web fetch and search tools
│       ├── git.ts                   # Git operations
│       └── system.ts                # System tools (question resolver)
├── api/                              # OpenRouter API client
│   ├── openrouter.ts                # OpenRouter API client (singleton)
│   ├── streaming.ts                 # Streaming response handling
│   ├── model-capabilities.ts        # Model capability detection
│   └── http-agent.ts                # Undici connection pooling
├── config/                          # Configuration management
├── branding/                        # Egyptian visual theme
├── permissions/                     # Permission system
├── mcp/                             # MCP integration
├── hooks/                           # Hook execution system
├── terminal/                        # Terminal utilities
├── session/                         # Session persistence
└── utils/                          # Utility functions
```

## 🛠️ Key Technologies

- **Runtime**: Node.js 20+
- **Language**: TypeScript (ESM)
- **CLI**: Commander.js + Ink (React for CLI)
- **AI**: OpenRouter API
- **Tools**: tinyglobby, ripgrep, just-bash
- **MCP**: @modelcontextprotocol/sdk
- **HTTP**: undici (connection pooling)

## 📜 Development Rituals

```bash
npm install          # Install dependencies
npm run build        # Build for production
npm test             # Run tests (405 tests)
npx tsc --noEmit    # Type check
```

## 🔮 Configuration

Configuration is loaded from:
1. `~/.tehuti.json` - User config (API key, default model)
2. Environment variables
3. Project `.tehuti.json`

**Priority order (highest to lowest):**
1. `OPENROUTER_API_KEY` / `TEHUTI_API_KEY` environment variables
2. `TEHUTI_MODEL` environment variable
3. Command-line options (`--model`)
4. `~/.tehuti.json` config file
5. Default model: `z-ai/glm-4.5-air:free`

### Model Selection Modes

Set `modelSelection` in config to control automatic model routing:
- `auto` - Automatically select model based on task complexity (default)
- `manual` - Always use the configured model
- `cost-optimized` - Prefer free/fast models
- `speed-optimized` - Always use fastest model

## 🚀 Performance Optimization System

Tehuti employs several divine optimization techniques:

### 1. Connection Pooling (undici)
- HTTP connection pooling via undici Agent
- Reduces latency for repeated API calls
- Initialized early in `src/index.ts`

### 2. Tool Result Caching
- LRU cache with TTL and size limits
- File mtime tracking for cache invalidation
- Automatic invalidation on write operations
- Persistence across sessions in `~/.tehuti/cache/`

### 3. Parallel Tool Execution
- Independent read-only tools run in parallel
- Up to 5 concurrent parallel executions
- Telemetry tracks parallel savings

### 4. LLM Tier Routing
- Automatic model selection based on task complexity
- Three tiers defined in `MODEL_TIERS`:
  - `fast` - Simple reads, listings (`z-ai/glm-4.5-air:free`)
  - `balanced` - Most tasks (`z-ai/glm-5:free`)
  - `deep` - Complex tasks (`anthropic/claude-sonnet-4`)
- Keyword-based task classification

### 5. Context Compression
- Progressive compression at 85k tokens
- LLM-based summarization with fallback
- Preserves critical messages (errors, decisions)
- Smart importance scoring for message retention

### 6. Predictive Prefetching
- Rule-based next-tool prediction
- History-based pattern learning
- Max 10 concurrent prefetch operations
- Prefetches file info, directory listings, git diffs

### 7. Performance Telemetry
- Track tool execution times
- Cache hit/miss rates
- Parallel execution savings
- Session stats via `/stats` command

## 🎨 Visual Theme

### Color Palette (Egyptian-Inspired)
| Color | Hex | Usage |
|-------|-----|-------|
| Gold | `#D4AF37` | Primary accent (Tehuti brand) |
| Sand | `#C2B280` | Secondary text, subtle elements |
| Coral | `#D97757` | User messages, prompts |
| Green | `#10B981` | Assistant responses |
| Nile | `#2E5A6B` | Subtle accents |
| Obsidian | `#1A1A2E` | Backgrounds |

### Hieroglyphic Symbols
| Symbol | Unicode | Usage |
|--------|---------|-------|
| 𓆣 | U+131A3 | Ibis (Tehuti symbol) |
| 𓁹 | U+13075 | Eye of Ra (visibility) |
| 𓂀 | U+13080 | Eye of Horus (errors) |
| 𓋹 | U+13269 | Ankh (success) |
| 𓏛 | U+1331B | Scroll (input/docs) |
| 𓆄 | U+13184 | Feather (user messages) |
| 𓂝 | U+13009 | Arm (navigation) |
| 𓊖 | U+13296 | Basket (lists) |

### UI Elements
- `𓆣` - Ibis hieroglyph (Tehuti symbol)
- `𓁹` - Eye indicator
- `𓋹` - Ankh for success
- `𓏛` - Scroll for input prompt
- `𓊖` - Bullet points

## 🛠️ Tool System

Tools are registered in `src/agent/tools/`. Each tool has:
- Zod schema for parameters
- Execute function returning `ToolResult`
- Permission requirements
- Category (safe/destructive)

### Tool Classification
- **Always allowed (safe tools):** read, glob, grep
- **Require permission (destructive):** write, edit, bash
- **Blocked in readonly mode:** All write operations

## 🏺 Session Management

Sessions stored in `~/.tehuti/sessions/`:
- Auto-save on exit (Ctrl+C)
- `/save [name]` - Save with custom name
- `/load <id>` - Load and rebuild context
- `/sessions` - List all sessions

Cache stored in `~/.tehuti/cache/`:
- Persists across sessions
- Auto-loads on startup
- Saves on exit

## 📝 Output Formatting System

### Buffered StreamWriter (`src/terminal/buffered-writer.ts`)
- ANSI-safe streaming with escape sequence preservation
- Unicode width calculation for Egyptian hieroglyphs
- Token batching with 30ms flush interval
- Word-aware line breaking
- Safe write operations with error handling
- Terminal resize handling via SIGWINCH
- `destroy()` method for proper cleanup

### Interactive Mode (Ink/React)
- Token batching with 50ms debounce
- Ref-based content accumulation
- Width constraints on message containers
- Text wrapping enabled on all components

### Output Utilities (`src/terminal/output.ts`)
- `wrap()` - ANSI-safe line breaking
- `truncate()` - Truncate with ellipsis
- `stripAnsi()` - Remove ANSI sequences

## 🌟 Current State

### Build Status
- TypeScript: No errors
- All 405 tests pass (2 TTL tests skipped)
- Build: 344KB output (`dist/index.js`)

### Skills System
New skills system implemented:
- `src/agent/skills/manager.ts` - Manages built-in and user-defined skills
- `src/agent/skills/tools.ts` - Five tools for skill management: list_skills, activate_skill, deactivate_skill, find_skills, get_skill
- Built-in skills for JavaScript/TypeScript, Python, and Git expertise
- Auto-applies relevant expertise based on task type
- Integrated into system prompt generation

### Chat UI Enhancements
Improved chat UI in `src/cli/commands/chat.ts`:
- Enhanced history navigation with better index management
- Improved input handling for backspace, delete, and cursor navigation
- Added copy-paste support (key combination detection)
- Added `/skills` command handler using `runOneShot` function
- Updated CommandPalette.tsx to include `/skills` command

### Markdown Rendering
Full ANSI markdown rendering implemented in `src/terminal/markdown.ts`:
- **Bold** rendered with ANSI bold
- *Italic* rendered with ANSI italic
- `inline code` rendered in cyan
- Code blocks with syntax highlighting and line numbers
- Headers with gold/coral colors
- Lists with coral bullets
- Tables with box-drawing characters
- Links with blue underline
- Blockquotes with dim styling

### Reasoning Model Support
Tehuti supports reasoning models that return content in `reasoning` field:
- Detection: `isReasoningModel()` in `src/api/model-capabilities.ts`
- Known models: `z-ai/glm-*`, `deepseek/deepseek-r1`, `openai/o1`, `openai/o3-mini`
- Streaming: `reasoning` field merged into content automatically

## 📜 Commands Available

| Command | Description |
|---------|-------------|
| `/help` | Show all commands |
| `/clear` | Clear conversation, new session |
| `/cost` | Show tokens and cost |
| `/stats` | Show performance metrics |
| `/models` | List free models on OpenRouter |
| `/model <name>` | Switch AI model |
| `/sessions` | List saved sessions |
| `/save [name]` | Save current session |
| `/load <id>` | Load session by ID |
| `/exit` | Exit CLI |

## 🗝️ Key Files

```
src/
├── cli/commands/chat.ts       # Main UI (React/Ink)
├── cli/ui/CommandPalette.tsx  # Command palette
├── agent/index.ts             # Agent loop with caching, parallel execution
├── agent/cache/               # LRU cache, tool cache, persistence
├── agent/parallel-executor.ts # Parallel tool execution
├── agent/model-router.ts      # LLM tier routing
├── agent/context-compressor.ts # Context summarization
├── agent/prefetcher.ts        # Predictive prefetching
├── api/openrouter.ts          # OpenRouter client (singleton)
├── api/http-agent.ts          # Undici connection pooling
├── utils/telemetry.ts         # Performance metrics
├── utils/mutex.ts             # Async mutex, semaphore
└── utils/concurrency.ts       # Promise concurrency utilities
```

## 🚀 Running Tehuti

```bash
# Direct
node dist/index.js

# With alias
alias tehuti='node /path/to/Tehuti-CLI/dist/index.js'
tehuti

# One-shot prompt
node dist/index.js "your prompt here"

# With specific model
node dist/index.js --model anthropic/claude-sonnet-4

# JSON output
node dist/index.js --json "prompt"

# Quiet mode (no tool output)
node dist/index.js --quiet "prompt"
```

## 📚 Session History

### 2026-02-25

**Skills System and Chat UI Enhancements:**

1. **Skills System Implementation** - Complete skills management system:
   - `src/agent/skills/manager.ts` - Manages built-in and user-defined skills
   - `src/agent/skills/tools.ts` - Five tools for skill management: list_skills, activate_skill, deactivate_skill, find_skills, get_skill
   - Built-in skills for JavaScript/TypeScript, Python, and Git expertise
   - Auto-applies relevant expertise based on task type
   - Integrated into system prompt generation

2. **Chat UI Improvements** - Enhanced user experience:
   - Added `/skills` command handler using `runOneShot` function
   - Updated CommandPalette.tsx to include `/skills`, `/thinking`, `/plan`, and `/compact` commands
   - Improved history navigation with better index management
   - Enhanced input handling for backspace, delete, and cursor navigation
   - Added copy-paste support (key combination detection)

3. **Model Selection Fix** - Updated model-router.ts:
   - Always respect manual model selection first
   - Improved logic for model selection modes
   - Fixed configuration precedence issues

**Files Modified This Session:**
- `src/agent/context.ts` - Integrated skills into system prompt
- `src/agent/index.ts` - Added skills tools registration
- `src/agent/model-router.ts` - Improved model selection logic
- `src/agent/tools/registry.ts` - Added createTool helper function
- `src/cli/commands/chat.ts` - Enhanced chat UI and command handlers
- `src/cli/ui/components/CommandPalette.tsx` - Added new commands

**New Files Created:**
- `src/agent/skills/manager.ts` - Skills manager
- `src/agent/skills/tools.ts` - Skills management tools

**Build Status:** ✅ Build succeeds, 344KB output, 405 tests pass