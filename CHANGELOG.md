# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
