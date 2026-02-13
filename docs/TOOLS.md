# Tools Overview

Tehuti is tool-centric. Good results come from tool evidence, not guesswork.

## Tool Families

## File and Code

- `read`, `write`, `edit`
- `glob`, `grep`, `find`
- git helpers and diff/review paths

## Shell and Process

- `shell`
- PTY/session tools for long-running commands

## Web and External Data

- `fetch`, search tools
- provider-aware web access with allow/deny controls

## Runtime and Diagnostics

- status/trace/metrics-oriented tooling
- smoke/probe helpers

## Delegation and Orchestration

- background minion management
- task routing and progress tracking

## Output Contract

Tool outputs should be:
- real
- attributable
- compactly summarized with evidence preserved

Tehuti now avoids canned result placeholders in execution paths.

## Tool Result Envelope

Core runtime tool execution now emits a normalized envelope:

- schema: `tehuti.tool_result.v1`
- tool: `name`, `args`, `idempotency_class`
- trace: `trace_id`, `started_at`, `ended_at`, `latency_ms`
- status: `success|failed`
- result: `ok`, raw `output`, normalized output shape
- error: normalized error metadata when failed (`category`, `code`, `message`, `retryable`)

This contract is consumed by the agent loop for consistent telemetry and cross-surface behavior.

## Safe Usage Pattern

1. Start with read/search tools.
2. Execute minimal-change actions.
3. Verify with shell/tests.
4. Summarize using concrete evidence.

## Capability Controls

Use these to shape what Tehuti can do:

- `/permissions shell|write|external on|off`
- `/allow-tool <tool>` / `/deny-tool <tool>`
- `/allow-url <domain>` / `/deny-url <domain>`
- `/add-dir <path>` / `/list-dirs`
