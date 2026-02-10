# Architecture

Project Tehuti is a thin orchestration layer around tool execution, provider adapters, and a terminal‑first UX. The design goal is evidence‑first execution with minimal friction.

## Components
- **UI** (`src/tehuti_cli/ui/`)
  - Prompt session, completions, banners, and output formatting.
  - Action log + Evidence panel for tool results.
- **Core runtime** (`src/tehuti_cli/core/`)
  - Tool sandbox and tool execution.
  - PTY management for interactive subprocesses.
- **Providers** (`src/tehuti_cli/providers/`)
  - OpenRouter, OpenAI, Gemini clients.
  - Provider selection + model routing.
- **Storage** (`src/tehuti_cli/storage/`)
  - Config, sessions, metadata.
- **Utils** (`src/tehuti_cli/utils/`)
  - Environment loader, logging, shared helpers.
- **Docs** (`docs/`)
  - System, configuration, UX, and command references.

## Execution Flow
1. User prompt enters the shell.
2. LLM returns either a final response or a tool call JSON.
3. Tools run inside `ToolRuntime` with sandbox checks.
4. Results are displayed with evidence as tools finish.
