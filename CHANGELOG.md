# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-07-11

### Feature Streams
- **Speculative Multi-Path Execution**: Hardened the self-healing execution pipeline utilizing ephemeral Git worktrees for robust failure validation and automatic rollback.
- **Autonomous MCP Pipelines**: Solidified the dynamic Model Context Protocol (MCP) integration, allowing autonomous tool discovery and payload sanitization at runtime.
- **Background Daemon Refactoring**: Stabilized the background daemon state engine (`tehutid.sock`) and IPC socket communications for crash-free, active background orchestration.
- **Cross-Platform Context Continuity**: Centralized session mapping via SQLite (`messaging_sessions`), enabling seamless context handoff across CLI, TUI, and messaging connectors.
- **Swarm Profiler Overlay**: Added advanced swarm process lifecycle tracking (`pending`, `running`, `completed`, `failed`), preventing task state duplication with `isTerminal()` status predicates.

## [1.1.0] - 2026-07-11

### Security & Hardening
- **Prompt Injection Defense**: Fully implemented XML-style `<file_content>` wrapping across all external inputs (e.g. `web_search`, `read` tools) to neutralize malicious instructions hidden in target files or websites.
- **Shell Injection Immunity**: Refactored all Git tools (e.g. `git_status`, `git_diff`) to utilize safe, array-based `spawn` execution rather than string-based `exec`, eliminating shell evaluation vulnerabilities.
- **MCP Payload Sanitization**: Enforced rigorous JSON Schema validation, 10-level recursion limits, and type coercion on dynamic Model Context Protocol (MCP) tool registrations.
- **SQL Injection Prevention**: Finalized audit confirming 100% of SQLite database queries (Memory Graph and Session Resolver) use parameterized `?` bindings.

### Stability & Performance
- **Swarm Memory Leak Fixes**: The Swarm Manager now explicitly unbinds IPC `message` event listeners and dereferences `AbortControllers` the exact millisecond child agent processes terminate, eliminating background memory bloat.
- **Zero-Overhead Tracing**: Rewrote the internal telemetry and trace engine to utilize fast base-36 IDs and implement a strict `NOOP` short-circuit when debug mode is disabled, completely bypassing closure allocation.
- **Asynchronous Deadlock Prevention**: Wrapped all multi-process locking mechanisms (`src/utils/mutex.ts`) with robust `finally` release blocks and underflow checks.
- **Daemon Error Boundaries**: Applied absolute `try/catch` enclosures around all background `chokidar` filesystem watchers and `cron` jobs, preventing unhandled promise rejections from crashing the master daemon.

### Refactoring & Code Quality
- **Biome Formatting**: Transitioned the entire codebase to Biome for lightning-fast, highly opinionated code formatting and linting.
- **Dead Code Elimination**: Purged hundreds of unused variables, unreachable branches, and obsolete exports across the agent loop, memory graphs, and TUI components based on rigorous `noUnusedLocals` checks.
- **Type Safety Audit**: Achieved 100% strict TypeScript compliance with zero `any`-cast masking in core directories.

## [1.0.0] - 2026-07-11

### Added
- **Background Daemon & State Engine**: Full background daemon support (`tehuti daemon start`) with Unix Socket IPC (`~/.tehuti/tehutid.sock`) and state engine multiplexing. Includes macOS `launchd` auto-start integration.
- **Companion Mode**: A new interactive companion mode (`tehuti companion`) that connects to the background daemon for persistent sessions.
- **Messaging Connectors**: First-class support for Discord, Slack, Telegram, and WhatsApp via WebSockets and HTTP webhook listeners, mapped natively to Tehuti sessions.
- **Swarm & Subagent Orchestration**: Robust multi-process forking, dynamic chunked IPC serialization, liveness watchdogs, and timeout resilience.
- **Self-Healing Execution**: Automatic ephemeral Git worktree generation for speculative tool execution with automated rollback on failure.
- **Personality Learning Engine**: Analyzes user commands and Git diffs to adapt the underlying system prompt dynamically over time.
- **Semantic Graph Memory**: Background graph consolidation job with exponential decay weighting.

### Changed
- **TUI Architecture**: Migrated to Ink 6 + React 19. Overhauled rendering for extreme log limits using a hybrid virtual viewport with negative margin scrolling to eliminate React remounts.
- **API Resilience**: Transitioned to `undici` connection pooling, implemented streaming catch-alls, full chunk context yielding, and cost estimation edge-case fixes.
- **Telemetry**: Enforced 1000-item circular bounds for telemetry payloads to prevent unbounded memory growth.
- **Dynamic Config Loader**: Swap API precedence and allow granular leaf-node deletion during fallback.

### Fixed
- **Terminal Rendering**: Patched Markdown headers exploding underlines, `html` and `blockKatex` token parsing, and surrogate-pair splitting logic.
- **File System Tools**: Bound `listDir` to 1000 items, rejected sensitive binary edits (`isBinaryFile`), appended entropy to backups, and explicitly bounded directory tools.
- **Git Safety**: Filtered `.tehuti/` from tracking tools, downgraded child process signals to graceful `SIGTERM`, and strictly capped diff output arrays to 50 lines on failure.
- **Permissions Framework**: Expanded Interactive Role-Based Access Control (IBAC) check bounds to block `rm -rf /` completely and properly intercept `PreToolUse` hooks before execution.

### Removed
- Legacy, blocking CLI prompts during async agent iterations.
- Standalone `grepai` binaries (replaced by native semantic node tools).

## [0.1.0] - 2026-05-15
- Initial Alpha Release.
