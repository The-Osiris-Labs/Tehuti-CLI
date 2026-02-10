# Project Tehuti

Project Tehuti is a terminal‑native agent that turns natural language into concrete actions with evidence. The interface is ceremonial but minimal, and the execution log shows actions as they happen.

## Quick Start
1. Create a keys file:
```
export OPENROUTER_API_KEY="..."
```
or add it to `keys.env`.

2. Run:
```
tehuti
```

## Capabilities
- Natural‑language commands with tool execution (`read`, `write`, `shell`, `fetch`, PTY tools).
- OpenRouter‑first routing with `/models` and `/providers`.
- Evidence‑first execution log with explicit tool outputs.
- Evidence panel for long outputs.
- Sessions, transcripts, and configurable tool sandbox.
- `/status` for quick runtime context.
- Custom slash commands from `.tehuti/commands`, `.claude/commands`, and `.gemini/commands`.

## Structure
- `src/tehuti_cli/core/` runtime, tools, and PTY handling
- `src/tehuti_cli/providers/` OpenRouter/OpenAI/Gemini adapters
- `src/tehuti_cli/storage/` config, sessions, and metadata
- `src/tehuti_cli/ui/` terminal UX and theming
- `src/tehuti_cli/utils/` shared helpers

## Commands
- `tehuti` interactive shell
- `tehuti --print -p "..."` print mode
- `tehuti web` minimal web UI
- `tehuti wire` JSONL protocol
- `tehuti acp` ACP‑compatible alias of wire

## Docs
- `docs/ARCHITECTURE.md`
- `docs/COMMANDS.md`
- `docs/CONFIGURATION.md`
- `docs/UX.md`
- `STYLE_GUIDE.md`
