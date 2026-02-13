# User Guide

This guide focuses on real usage, not internals.

## Runtime Modes

- `tehuti`: interactive shell.
- `tehuti --print --prompt "..."`: one-shot execution.

## Core Commands

- `/help` list commands.
- `/status` concise current state.
- `/status-all` full state and capabilities.
- `/diagnostics` runtime checks.
- `/tools` tool and sandbox info.
- `/context` context/token summary.

## Execution Visibility

Tehuti shows proactive progress while it works.

- Tool previews: what is about to run and why.
- Agent loop progress: iterations, tool start/end, optional thoughts.
- Phase timeline stream: ordered lifecycle events with status (`progress|done|error`).
- Model phases: explicit model request/response markers during each loop stage.
- Turn framing: `Cycle` and `Next` lines before execution, `Outcome` line after completion.
- Objective hints in status bar during active turns.
- Startup preflight hints: warns if provider key is missing and when using free-tier models likely to throttle/fallback.

## Output Noise Controls

- `/verbosity minimal|standard|verbose`
  - `minimal`: least chatter
  - `standard`: default
  - `verbose`: full progress detail
- `/worklog on|off`
  - controls chronicle/action-line stream
- `/output full|compact|<chars>`
  - controls evidence payload size

## Delegated Background Work

Start and manage background agents:

- `/delegate start <task>`
- `/delegate list`
- `/delegate status <id>`
- `/delegate logs <id>`
- `/delegate follow <id>`
- `/delegate stop <id>`

When in doubt:
- Use `status` for quick snapshots.
- Use `follow` only when debugging live behavior.

## Planning and Sessions

- `/plan <text>` set plan.
- `/plan` show active plan.
- `/new` start a new session.
- `/resume <session-id>` resume a session.
- `/transcript` inspect full conversation context.

## Practical Pattern

1. Ask Tehuti to inspect.
2. Let it gather evidence via tools.
3. Ask for a concise risk/action summary.
4. Delegate longer parallel work if needed.
