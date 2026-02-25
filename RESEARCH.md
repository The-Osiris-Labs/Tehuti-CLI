# Claude Code Replica Research - Complete Guide for Tehuti CLI

## Executive Summary

This document compiles comprehensive research on building a Claude Code replica that connects to OpenRouter with multi-model support, providing the same user experience as the original.

---

## 1. Claude Code Architecture

### Three-Layer System

```
┌─────────────────────────────────────────────────────────┐
│                    EXTENSION LAYER                       │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐    │
│  │   MCP   │  │  Hooks  │  │ Skills  │  │ Plugins │    │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘    │
│  External tools, deterministic automation, domain       │
│  expertise, packaged extensions                          │
├─────────────────────────────────────────────────────────┤
│                    DELEGATION LAYER                      │
│  ┌─────────────────────────────────────────────────┐    │
│  │              Subagents (up to 10 parallel)       │    │
│  │   Explore | Plan | General-purpose | Custom      │    │
│  └─────────────────────────────────────────────────┘    │
│  Isolated contexts for focused work, returns summaries  │
├─────────────────────────────────────────────────────────┤
│                      CORE LAYER                          │
│  ┌─────────────────────────────────────────────────┐    │
│  │         Main Conversation Context                │    │
│  │   Tools: Read, Edit, Bash, Glob, Grep, etc.     │    │
│  └─────────────────────────────────────────────────┘    │
│  Your primary interaction; limited context; costs money │
└─────────────────────────────────────────────────────────┘
```

### Key Insight
Most users work entirely in the Core Layer, watching context bloat and costs climb. Power users push exploration and specialized work to the Delegation Layer.

---

## 2. Core Tools (Claude Code)

### File System Tools

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `Read` | Read file contents with line numbers | `file_path`, `offset`, `limit` |
| `Write` | Create/overwrite file | `file_path`, `content` |
| `Edit` | String replacement editing | `file_path`, `old_string`, `new_string`, `replace_all` |
| `NotebookEdit` | Edit Jupyter notebooks | `notebook_path`, `cell_number`, `source` |
| `Glob` | File pattern matching | `pattern`, `path` |
| `Grep` | Content regex search | `pattern`, `path`, `include`, `output_mode`, `-n`, `-C` |
| `LS` | Directory listing | `path` |

### Execution Tools

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `Bash` | Execute shell commands | `command`, `description`, `timeout`, `workdir` |
| `BashOutput` | Read background process output | `pid` |
| `KillShell` | Kill background process | `pid` |

### Web & Search Tools

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `WebFetch` | Fetch web content | `url`, `format`, `timeout` |
| `WebSearch` | Search the web | `query`, `allowed_domains` |

### System Tools

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `TodoWrite` | Task management | `todos` |
| `Task` | Spawn sub-agents | `prompt`, `subagent_type`, `description` |
| `AskUserQuestion` | Interactive prompts | `questions` |

### MCP Tools

| Tool | Description |
|------|-------------|
| `mcp__{server}__{tool}` | Dynamic MCP tool discovery and execution |

---

## 3. CLI Commands & Flags

### Interactive Commands

```bash
claude                           # Start interactive REPL
claude "query"                   # Start with initial prompt
claude -p "query"                # Print mode (one-shot)
claude -c                        # Continue most recent session
claude -r "session-id"           # Resume specific session
claude --model opus              # Use specific model
claude --fork-session            # Fork for parallel exploration
```

### Important Flags

| Flag | Description |
|------|-------------|
| `--model` | Set model (sonnet, opus, haiku, or full name) |
| `--dangerously-skip-permissions` | Skip all permission prompts |
| `--allowedTools` | Tools that don't prompt for permission |
| `--disallowedTools` | Tools that are blocked |
| `--max-turns` | Limit agentic turns |
| `--output-format` | text, json, stream-json |
| `--permission-mode` | acceptEdits, plan, auto-accept |
| `--mcp-config` | Load MCP servers from JSON |
| `--debug` | Enable debug logging |
| `--worktree` | Isolated git worktree |

### Slash Commands (Interactive)

| Command | Description |
|---------|-------------|
| `/help` | Show commands |
| `/model [name]` | Switch model |
| `/cost` | Show token usage and cost |
| `/compact` | Compact conversation |
| `/clear` | Clear context |
| `/status` | Session info |
| `/mcp` | MCP server status |
| `/exit` | Exit CLI |

---

## 4. Subagent System (Task Tool)

### Agent Types

| Type | Purpose | Tools Available |
|------|---------|-----------------|
| `general` | Multi-step tasks, research | All tools |
| `explore` | Codebase exploration | Read, Glob, Grep, LS |
| `plan` | Planning and architecture | Read-only tools |
| `code` | Code generation | Edit, Write, Read, Bash |
| `debug` | Debugging | All tools |

### Subagent Architecture

```
Main Claude Session (You interact here)
    ↓
    ├─→ Task Tool invocation
    │       ↓
    │   Sub-Agent (Specialized Claude instance)
    │       ├─→ Has own context & memory
    │       ├─→ Access to specific tools
    │       ├─→ Works autonomously
    │       └─→ Returns results when done
    │
    └─→ You continue working (if background)
```

### Best Practice
Use Haiku for exploration subagents (5x cheaper), Sonnet/Opus for main work.

---

## 5. Permission System

### Permission Modes

| Mode | Description |
|------|-------------|
| `interactive` | Ask for each destructive action |
| `acceptEdits` | Auto-accept file edits, ask for bash |
| `plan` | Read-only exploration, no execution |
| `auto-accept` | Allow everything |

### Permission Rule Syntax

```json
{
  "permissions": {
    "allow": [
      "Read",
      "Glob", 
      "Grep",
      "Bash(npm run:*)",
      "Bash(git:*)",
      "Edit(src/**)",
      "mcp__github"
    ],
    "deny": [
      "Read(.env*)",
      "Read(secrets/**)",
      "Bash(rm -rf:*)",
      "Bash(sudo:*)"
    ],
    "ask": [
      "WebFetch",
      "Bash(curl:*)"
    ]
  }
}
```

---

## 6. Hooks System

Hooks are **deterministic** - they always run regardless of model behavior.

### Hook Types

| Hook | When it Runs |
|------|--------------|
| `PreToolUse` | Before tool execution (can block) |
| `PostToolUse` | After tool success |
| `Notification` | When permission prompts show |
| `SubagentStop` | When subagent ends |
| `PreCommit` | Before git commit |

### Example: Auto-format on edit

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "npx prettier --write \"$FILE_PATH\""
          }
        ]
      }
    ]
  }
}
```

---

## 7. MCP (Model Context Protocol)

### What MCP Provides

- External tool integration (databases, APIs, services)
- Resource templates (dynamic content)
- Prompts (reusable templates)
- 3000+ available integrations

### Configuration

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "mcp-server-filesystem",
      "args": ["--root", "."]
    },
    "github": {
      "command": "mcp-server-github",
      "env": {
        "GITHUB_TOKEN": "${GITHUB_TOKEN}"
      }
    },
    "postgres": {
      "command": "mcp-server-postgres",
      "args": ["postgres://localhost/mydb"]
    }
  }
}
```

---

## 8. Configuration Hierarchy

```
Level          Location                              Scope
─────────────────────────────────────────────────────────────
Enterprise     /etc/claude-code/managed-settings.json All users
CLI flags      Command-line arguments                Current session
Local project  .claude/settings.local.json           Personal, current project
Shared project .claude/settings.json                  Team via git
User           ~/.claude/settings.json               All your projects
State          ~/.claude.json                        Runtime state
```

### CLAUDE.md (Project Instructions)

Create in project root - Claude reads it every session:

```markdown
# Project Instructions

## Build Commands
- `npm run build` - Build for production
- `npm run test` - Run tests
- `npm run lint` - Check code style

## Coding Standards
- Use TypeScript strict mode
- Prefer functional components
- Write tests for new features

## Architecture
- Frontend: React + Vite
- Backend: Node.js + Express
- Database: PostgreSQL
```

---

## 9. OpenRouter Integration

### API Compatibility

OpenRouter provides OpenAI-compatible API with tool calling support across all models.

### Tool Calling Flow

```
1. Send request with tools definition
   ↓
2. Model responds with tool_calls
   ↓
3. Execute tool locally
   ↓
4. Send tool result back
   ↓
5. Model provides final response
```

### Request Example

```json
{
  "model": "anthropic/claude-sonnet-4",
  "messages": [...],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "read_file",
        "description": "Read file contents",
        "parameters": {
          "type": "object",
          "properties": {
            "file_path": { "type": "string" }
          },
          "required": ["file_path"]
        }
      }
    }
  ]
}
```

### Prompt Caching (Critical for Cost)

OpenRouter supports `cache_control` for Anthropic models:

```json
{
  "messages": [
    {
      "role": "system",
      "content": [
        {
          "type": "text",
          "text": "Large system prompt...",
          "cache_control": { "type": "ephemeral" }
        }
      ]
    }
  ]
}
```

- Cache writes: 1.25x base price (5-min) or 2x (1-hour)
- Cache reads: 0.1x base price (90% savings!)

---

## 10. Model Recommendations

### By Task Type

| Task | Recommended Model | Why |
|------|-------------------|-----|
| Quick file search | Haiku | Fast, cheap |
| Bug fix with tests | Sonnet | Balanced |
| Architecture review | Opus | Deep reasoning |
| Subagent exploration | Haiku | Cost-efficient |
| Complex debugging | Opus | Adaptive thinking |
| Daily coding | Sonnet | Best balance |

### Pricing (February 2026)

| Model | Input/1M | Output/1M |
|-------|----------|-----------|
| Haiku 4.5 | $1 | $5 |
| Sonnet 4.6 | $3 | $15 |
| Opus 4.6 | $5 | $25 |

### Long Context Pricing (>200K input)

| Model | Standard Input | Long Input | Standard Output | Long Output |
|-------|---------------|------------|-----------------|-------------|
| Opus 4.6 | $5 | $10 | $25 | $37.50 |
| Sonnet 4.6 | $3 | $6 | $15 | $22.50 |

---

## 11. Session Management

### Session Persistence

- Sessions stored as JSONL transcripts
- Can resume by ID or name
- `/compact` summarizes older conversation
- Sessions can be forked for parallel exploration

### Session Commands

```bash
claude -c                        # Continue most recent
claude -r "session-id"           # Resume by ID
claude --resume "name"           # Resume by name
claude -r "base" --fork-session  # Fork for parallel work
```

---

## 12. What Tehuti CLI Currently Has vs Needs

### ✅ Already Implemented

- Multi-model support via OpenRouter
- Core tools: Read, Write, Edit, Glob, Grep, Bash
- Permission system with interactive prompts
- MCP client for tool integration
- Context caching for Anthropic models
- Web search via Exa API
- Sub-agent spawning (basic)
- Image and PDF reading
- Background process management
- CLI with interactive REPL

### ❌ Missing for Full Parity

| Feature | Priority | Effort |
|---------|----------|--------|
| Plan mode (read-only exploration) | High | 4h |
| Agent teams (parallel subagents) | High | 8h |
| Extended thinking mode | Medium | 4h |
| Skills system (auto-apply expertise) | Medium | 6h |
| Hooks system (deterministic automation) | High | 4h |
| Session persistence/resume | High | 3h |
| CLAUDE.md auto-loading | Low | 1h |
| Git worktree isolation | Low | 2h |
| `/compact` context summarization | Medium | 4h |
| Slash command extensibility | Medium | 3h |
| Desktop/IDE integrations | Low | 20h+ |
| Remote agent support | Low | 8h |

---

## 13. Recommended Next Steps for Tehuti CLI

### Immediate (P0)

1. **Session Persistence** - Save/load conversations
2. **Plan Mode** - Read-only exploration before execution
3. **Hooks System** - Deterministic automation

### Short-term (P1)

4. **Extended Thinking** - Toggle for complex reasoning
5. **Context Compaction** - Auto-summarize old context
6. **Skills System** - Auto-apply domain expertise

### Medium-term (P2)

7. **Agent Teams** - Parallel subagent coordination
8. **CLAUDE.md Support** - Auto-load project instructions
9. **Better Slash Commands** - Extensible command system

---

## 14. Key Learnings

### What Makes Claude Code Powerful

1. **Agentic, not chat** - It acts, doesn't just suggest
2. **Permission layers** - Safety with flexibility
3. **Subagents** - Prevents context bloat
4. **Hooks** - Deterministic automation (prompts are probabilistic)
5. **MCP** - Extensibility without code changes
6. **Model tiering** - Use the right model for each task

### Critical User Experience Elements

1. **Interactive REPL** with context display
2. **Slash commands** for quick actions
3. **Permission prompts** for dangerous operations
4. **Session resume** for long-running work
5. **Cost tracking** built-in
6. **Model switching** mid-session

### Cost Optimization Patterns

1. Use Haiku for subagent exploration (5x cheaper)
2. Enable prompt caching (90% savings on repeated context)
3. Use plan mode for free exploration
4. Set max turns to prevent runaway conversations
5. Compact proactively to reduce token usage
