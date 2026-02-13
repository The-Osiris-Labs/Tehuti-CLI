# Retry and Backoff Policy

This policy describes runtime retry budgeting and backoff behavior for tool and loop edges.

## Tool Retries

`ToolRuntime.execute_with_validation` enforces retry attempts using tool metadata:

1. `max_retries` is capped by tool metadata (`ToolSpec.max_retries`).
2. `retry_policy=never` forces `max_retries=0`.
3. Retries occur only when classifier/policy marks the failure as retryable.

Backoff timing is configurable via `Config`:

- `retry_backoff_base_seconds` (default `1.0`)
- `retry_backoff_cap_seconds` (default `4.0`)

Per-tool scaling uses metadata class:

- `safe_read`: multiplier `2.0`
- `idempotent_write`: multiplier `1.5`
- other classes: multiplier `1.25`

Final delay: `min(base * multiplier^retry_count, cap)`

## Loop Stuck-Cycle Backoff

`AgentLoop` applies cycle backoff when identical tool-call signatures repeat.

Config fields:

- `loop_stuck_backoff_base_seconds` (default `1.0`)
- `loop_stuck_backoff_cap_seconds` (default `4.0`)

Delay formula:

`min(base * 2^(repeated_signature_count - 2), cap)`

## Contract and Test Coverage

- Tool metadata lint: `scripts/lint_tool_metadata.py`
- Retry parity tests: `tests/test_retry_semantics_parity.py`
- Loop backoff/transition tests: `tests/test_agent_loop.py`
