# Tehuti Architecture

> 𓆣 System design, module boundaries, and data flow for the Tehuti CLI agent.

---

## Overview

Tehuti is a high-performance Node.js terminal coding assistant built with TypeScript. It runs natively in your terminal, interfacing with OpenAI-compatible APIs to execute complex, autonomous engineering tasks.

### Design Principles

1. **TypeScript-first**: Strict typing throughout, ESM modules, no `any` in hot paths
2. **OpenAI-compatible API layer**: Custom clients in `src/api/` — not Vercel AI SDK
3. **Deterministic context management**: Array-truncation compression, not LLM summarization
4. **Sandboxed execution**: IBAC permissions, git worktree speculation, bounded tools
5. **Pluggable providers**: Standard, KiloCode, Custom provider clients with runtime capability resolution

---

## Module Map

```
src/
├── index.ts              # Entry point (CLI bootstrap)
├── agent/                # Core agent loop, tools, memory, swarm
│   ├── index.ts          # Tool registration + runAgentLoop export
│   ├── context.ts        # AgentContext creation + system prompt builder
│   ├── loop/             # Agent loop runner, compression, retry, self-healing
│   ├── cache/            # LRU cache, persistent cache, tool cache
│   ├── memory/           # SQLite graph, vector store, personality, consolidation
│   ├── tools/            # ~66 built-in tool definitions (bash, fs, git, web, etc.)
│   ├── skills/           # Skill manager + skill tools
│   ├── subagents/        # Subagent spawning + refactor specialist
│   └── swarm/            # Multi-process swarm manager + IPC serialization
├── api/                  # Provider API clients
│   ├── base-client.ts    # Abstract base (streaming + tool-call parsing)
│   ├── standard-client.ts # OpenAI-compatible client (singleton pattern)
│   ├── kilocode.ts       # KiloCode provider adapter
│   ├── custom-provider.ts # User-defined custom provider
│   ├── streaming.ts      # SSE stream parser
│   ├── response-cache.ts # LRU response cache (dedup identical prompts)
│   ├── cost.ts           # Token cost estimation
│   └── models.ts         # Model registry + capabilities
├── cli/                  # Commander entry + Ink TUI
│   ├── index.ts          # createProgram() — Commander setup
│   ├── commands/          # chat, daemon, companion, doctor, skills, tools, trace
│   └── ui/               # React components, hooks, command palette
├── config/               # Configuration system
│   ├── schema.ts         # Zod schemas for all config sections
│   ├── loader.ts         # Cosmiconfig loader + env var resolution
│   ├── providers.ts      # Provider metadata (baseUrl, auth, capabilities)
│   ├── wizard.ts         # Interactive setup wizard
│   └── token-encryption.ts # OAuth token encryption at rest
├── daemon/               # Background daemon
│   ├── server.ts         # Unix socket IPC server (JSONL protocol)
│   ├── client.ts         # Daemon client for companion mode
│   ├── state-engine.ts   # FS watchers, cron, swarm tracking
│   └── launch-agent.ts   # macOS launchd plist generator
├── messaging/            # Omnichannel connectors
│   ├── connector-manager.ts # Discord, Slack, Telegram, WhatsApp
│   ├── formatters.ts     # Platform-specific message formatting
│   ├── session-resolver.ts # Map platform sender → Tehuti session
│   └── types.ts          # Connector interfaces
├── mcp/                  # Model Context Protocol
│   ├── client.ts         # MCP client (stdio/http/sse/websocket)
│   ├── tool-adapter.ts   # Convert MCP tools → Tehuti ToolDefinition
│   └── index.ts          # Public exports
├── permissions/          # Tool execution gates
│   ├── index.ts          # Permission checker (interactive/trust/readonly)
│   ├── rules.ts          # Rule engine
│   └── prompts.ts        # Interactive prompts
├── hooks/                # Pre/Post tool hooks
│   └── executor.ts       # Hook config parser + bash executor
├── session/              # Session persistence
│   ├── manager.ts        # Atomic save/load to ~/.tehuti/sessions/
│   ├── health.ts         # Session health checks
│   └── index.ts          # Public exports
├── terminal/             # Terminal rendering
│   ├── output.ts         # ANSI output + line computation
│   ├── markdown.ts       # Markdown rendering (KaTeX, tables)
│   ├── highlighter.ts    # Shiki syntax highlighter
│   ├── capabilities.ts   # Terminal capability detection
│   └── buffered-writer.ts # 16ms backpressure writer
└── utils/                # Shared utilities
    ├── debug.ts          # Namespaced debug logger
    ├── errors.ts         # Error formatting + terminal restore
    ├── logger.ts         # Consola-based structured logger
    ├── mutex.ts          # Async mutex for shared state
    ├── trace.ts          # Per-second trace collector (JSONL ring buffer)
    ├── telemetry.ts      # Anonymous telemetry (opt-in)
    └── concurrency.ts    # Pool/semaphore primitives
```

---

## Data Flow

### Agent Loop (simplified)

```
User Input
    │
    ▼
┌─────────────────────────────────┐
│  buildSystemPrompt()            │  ← project instructions + memory + personality
└─────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────┐
│  createProviderClient()         │  ← StandardAPIClient / KiloCode / Custom
└─────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────┐
│  runAgentLoop() (runner.ts)     │
│  ┌───────────────────────────┐  │
│  │ Stream LLM response       │  │
│  │ Accumulate tool calls     │  │
│  │ Permission check          │  │
│  │ Execute tools (parallel   │  │
│  │   for read-only)          │  │
│  │ Prefetch on 1st tool      │  │
│  │ Check context size (~85%) │  │
│  │   → compress if needed    │  │
│  │ Re-enter loop             │  │
│  └───────────────────────────┘  │
└─────────────────────────────────┘
    │
    ▼
  Result → TUI / Daemon / Messaging Connector
```

### Context Compression Flow

```
Messages[] → estimateTokens() → check threshold (85%)
    │
    ├── Below threshold → continue
    │
    └── Above threshold →
        compressContext() → keepFirst(1) + keepLast(20)
        → extract digest (actions/decisions/recoveries)
        → persist digest to compactionHistory[]
        → move full transcript to archive.json
        → render digest as system marker
```

### Memory Graph Flow

```
Tool Execution → Session Events
    │
    ▼
consolidation.ts (background, every 15min)
    │
    ├── Scan recent interactions
    ├── Create nodes (file, function, concept)
    ├── Create edges (uses, imports, relates_to)
    ├── Apply exponential decay weighting
    └── Persist to graph.db (SQLite)
         │
         ▼
    getSystemPromptMemory() → injected into system prompt
```

---

## Key Architecture Decisions

### 1. Why Custom API Clients (not Vercel AI SDK)?

**Decision**: Hand-rolled `StandardAPIClient` in `src/api/standard-client.ts`

**Rationale**:
- Full control over SSE streaming + tool-call accumulation
- Support for non-standard provider extensions (KiloCode thinking tokens, custom headers)
- Avoid Vercel AI SDK's React-coupled architecture in a CLI context
- Direct access to raw token usage, cache metrics, and cost tracking

### 2. Why Deterministic Context Compression?

**Decision**: Array truncation (splice oldest messages) instead of LLM summarization

**Rationale**:
- Zero additional LLM API cost during long sessions
- Predictable latency (no extra round-trip)
- Full transcript preserved in `archive.json` (no data loss)
- Structured digest captures key decisions without LLM hallucination risk

### 3. Why Unix Socket for Daemon IPC?

**Decision**: `~/.tehuti/tehutid.sock` with mode `0o600`

**Rationale**:
- No port conflicts (unlike TCP)
- OS-level access control (only owning user)
- Lower latency than HTTP loopback
- JSONL protocol for simplicity and debuggability (`tehuti trace`)

### 4. Why SQLite for Memory?

**Decision**: `better-sqlite3` for graph.db, personality.db, sessions

**Rationale**:
- Zero-config embedded database
- Synchronous API (no async overhead for hot paths)
- Parameterized queries (SQL injection immune)
- ACID transactions for session atomicity

### 5. Why Git Worktrees for Self-Healing?

**Decision**: Speculative `git worktree` branches for tool execution

**Rationale**:
- True isolation (no dirty state in working tree)
- Parallel evaluation of multiple fix strategies
- Atomic merge-on-success / discard-on-failure
- Zero cleanup needed (worktrees are ephemeral)

### 6. Why Singleton Pattern for API Clients?

**Decision**: `StandardAPIClient.getInstance(config)`

**Rationale**:
- Connection pooling (undici Agent) persists across calls
- Avoid redundant TLS handshakes
- Config-change detection via configKey comparison
- Simple reset mechanism for testing

---

## Security Architecture

### Defense Layers

| Layer | Mechanism | Location |
|-------|-----------|----------|
| Prompt Injection | XML wrapper defenses | `agent/loop/runner.ts` |
| Shell Injection | Safe-spawn array execution | `agent/tools/bash.ts` |
| SQL Injection | Parameterized bindings | `agent/memory/db.ts` |
| MCP Schema Poisoning | Zod validation | `mcp/tool-adapter.ts` |
| File System | Sandboxed writes, bounds checking | `agent/tools/fs.ts` |
| Permissions | IBAC interactive/trust/readonly | `permissions/` |

### OAuth Token Encryption

API keys and OAuth tokens are encrypted at rest using `src/config/token-encryption.ts`. Encryption uses AES-256-GCM with a machine-derived key.

---

## Performance Characteristics

| Metric | Target | Mechanism |
|--------|--------|-----------|
| UI render latency | < 16ms | Buffered writer, virtual scrolling |
| Tool execution | Parallel (max 5) | Read-only detection + pool |
| HTTP overhead | Minimized | undici connection pool + keep-alive |
| Memory | Bounded | LRU cache (50MB), ring buffer trace |
| Context size | Auto-managed | 85% threshold compression |
| Daemon IPC | < 1ms | Unix socket + JSONL |

---

## Extension Points

### Adding a New Tool

1. Create `src/agent/tools/my-tool.ts`
2. Export a `ToolDefinition` with `name`, `description`, `parameters` (Zod), `execute`
3. Register in `src/agent/index.ts` via `registerTools([myTool])`
4. Add tests alongside the module

### Adding a New Provider

1. Add provider metadata to `src/config/providers.ts`
2. If OpenAI-compatible: works automatically via `StandardAPIClient`
3. If custom protocol: extend `BaseAPIClient` (see `KiloCodeClient`)

### Adding a New MCP Transport

1. Implement transport in `src/mcp/client.ts`
2. Add to `MCPTransportTypeSchema` in `src/config/schema.ts`
3. MCP tools auto-register via `syncMCPToolRegistry()`

---

## File Sizes & Complexity

| File | Lines | Notes |
|------|-------|-------|
| `cli/commands/chat.ts` | ~3,700 | Monolith: CLI + TUI + agent integration |
| `agent/context.ts` | ~730 | System prompt builder |
| `config/schema.ts` | ~810 | All Zod schemas |
| `config/loader.ts` | ~436 | Cosmiconfig + env resolution |
| `daemon/server.ts` | ~310 | IPC server |
| `agent/memory/graph.ts` | ~550 | SQLite memory graph |

> **Note**: `chat.ts` is a known monolith. Read `HANDOFF.md` before editing.
