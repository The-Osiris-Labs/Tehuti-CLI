# API and Wire Contracts

This document defines stable response envelopes for Tehuti runtime surfaces.

## CLI Prompt Envelope (`tehuti.cli.prompt.v1`)

Use `--envelope` with non-interactive execution:

- `tehuti --prompt "..." --envelope`
- `echo "..." | tehuti --print --envelope`

Success response:

```json
{
  "schema": "tehuti.cli.prompt.v1",
  "status": "success",
  "bootstrap": {"schema": "tehuti.preflight.v1", "ok": true},
  "result": {
    "schema": "tehuti.agent_task.v1",
    "success": true
  },
  "events": [],
  "tool_contracts": [],
  "activity_events": []
}
```

## Wire Protocol (`tehuti.wire.v1`)

Input (JSON line):

```json
{"prompt":"your request"}
```

Success response:

```json
{
  "schema": "tehuti.wire.v1",
  "status": "success",
  "trace_id": "abc123def456",
  "turn_id": "turn123def456",
  "session_id": "session-id-or-null",
  "mode": "prompt",
  "bootstrap": {"schema": "tehuti.preflight.v1", "ok": true},
  "result": {"response": "model output", "events": [], "phase_events": [], "tool_contracts": [], "activity_events": []}
}
```

Failure response:

```json
{
  "schema": "tehuti.wire.v1",
  "status": "failed",
  "trace_id": "abc123def456",
  "turn_id": "turn123def456",
  "session_id": "session-id-or-null",
  "mode": "prompt",
  "bootstrap": {"schema": "tehuti.preflight.v1", "ok": true},
  "error": {
    "category": "internal",
    "code": "unclassified_error",
    "message": "message",
    "retryable": false,
    "details": {}
  }
}
```

Agent-task wire mode:

```json
{
  "mode": "agent_task",
  "task": "implement feature",
  "max_iterations": 10,
  "persist": true,
  "stream": true,
  "stream_phase": true
}
```

`persist` defaults to `true` in the `tehuti wire` command path; it can be disabled explicitly for stateless calls.

When `stream: true` is used with `mode: "agent_task"`, the wire server emits JSONL progress envelopes before the final response:

```json
{
  "schema": "tehuti.wire.progress.v1",
  "status": "in_progress",
  "trace_id": "abc123def456",
  "turn_id": "turn123def456",
  "session_id": "session-id-or-null",
  "mode": "agent_task",
  "sequence": 1,
  "timestamp": "2026-02-12T00:00:00",
  "event": {
    "schema": "tehuti.progress.v1",
    "event": "tool_start",
    "tool": "read"
  }
}
```

Derived activity narration events may also be emitted in the same `tehuti.wire.progress.v1` stream when tool results arrive:

```json
{
  "schema": "tehuti.wire.progress.v1",
  "status": "in_progress",
  "trace_id": "abc123def456",
  "turn_id": "turn123def456",
  "session_id": "session-id-or-null",
  "mode": "agent_task",
  "sequence": 2,
  "timestamp": "2026-02-12T00:00:01",
  "event": {
    "schema": "tehuti.activity.v1",
    "event": "activity",
    "tool": "read",
    "success": true,
    "summary": "Executed `read`"
  }
}
```

When `stream_phase: true` is set, projected phase timeline events (`tehuti.phase_stream.v1`) are also emitted through `tehuti.wire.progress.v1` envelopes.

## Web Prompt API (`tehuti.web.prompt.v1`)

Endpoint: `POST /api/prompt`

Success response:

```json
{
  "schema": "tehuti.web.prompt.v1",
  "status": "success",
  "trace_id": "abc123def456",
  "turn_id": "turn123def456",
  "bootstrap": {"schema": "tehuti.preflight.v1", "ok": true},
  "session_id": "session-id",
  "result": {"response": "model output"},
  "tool_contracts": []
}
```

Failure response:

```json
{
  "schema": "tehuti.web.prompt.v1",
  "status": "failed",
  "trace_id": "abc123def456",
  "turn_id": "turn123def456",
  "bootstrap": {"schema": "tehuti.preflight.v1", "ok": true},
  "error": {
    "category": "protocol",
    "code": "a2a_invalid_payload",
    "message": "message",
    "retryable": false
  }
}
```

## Web Agent Task API (`tehuti.web.agent_task.v1`)

Endpoint: `POST /api/agent_task`

Optional request fields:
- `progress_verbosity`: `minimal|standard|verbose`
- `parser_mode`: `strict|repair|fallback`

Success/failure envelope:

```json
{
  "schema": "tehuti.web.agent_task.v1",
  "status": "success",
  "trace_id": "abc123def456",
  "turn_id": "turn123def456",
  "bootstrap": {"schema": "tehuti.preflight.v1", "ok": true},
  "session_id": "session-id",
  "result": {
    "schema": "tehuti.agent_task.v1",
    "success": true,
    "session_id": "session-id",
    "response": "final response",
    "thoughts": "latest thought",
    "tool_calls": [],
    "iterations": 2,
    "latency_ms": 1234,
    "error": null,
    "parse_status": "structured",
    "parse_mode": "repair",
    "termination_reason": "final_response",
    "reconciliation": {
      "created": 1,
      "updated": 2,
      "completed": 1,
      "failed": 0,
      "tool_events": 3
    },
    "token_estimate": 123,
    "cost_estimate_usd": 0.0000615,
    "token_actual": 118,
    "cost_actual_usd": 0.000059,
    "token_actual_source": "provider",
    "cost_actual_source": "provider"
  },
  "events": [],
  "phase_events": [],
  "tool_contracts": [],
  "activity_events": []
}
```

Failure responses from web/wire/CLI envelope paths always project typed error fields:
- `category`
- `code`
- `message`
- `retryable`
- optional `details`

Agent-task `termination_reason` may include:
- `final_response`
- `max_iterations`
- `parser_error`
- `stuck_detected`
- `loop_exception`
- `insufficient_evidence`

## Preflight Contract (`tehuti.preflight.v1`)

`bootstrap` contains deterministic startup diagnostics:

```json
{
  "schema": "tehuti.preflight.v1",
  "ok": true,
  "summary": {"total_checks": 8, "failed_errors": 0, "failed_warnings": 0},
  "checks": []
}
```

## Tool Execution Contract (`tehuti.tool_result.v1`)

Runtime envelope returned by contract execution path:

```json
{
  "schema": "tehuti.tool_result.v1",
  "tool": {
    "name": "read",
    "args": {"path": "a.txt"},
    "idempotency_class": "safe_read",
    "risk_class": "low",
    "approval_policy": "auto",
    "latency_budget_ms": 30000,
    "retry_policy": "transient",
    "max_retries": 2
  },
  "trace": {
    "trace_id": "trace-123",
    "started_at": "2026-02-12T00:00:00",
    "ended_at": "2026-02-12T00:00:00",
    "latency_ms": 10
  },
  "status": "success",
  "result": {
    "ok": true,
    "output": "file content",
    "normalized_output": {"type": "text", "content": "file content"}
  },
  "error": null,
  "audit": {
    "schema": "tehuti.mutation_audit.v1",
    "audit_id": "a1b2c3d4e5f6"
  }
}
```

## Progress Event Contract (`tehuti.progress.v1`)

Progress callbacks emitted by agent/runtime surfaces use:

```json
{
  "schema": "tehuti.progress.v1",
  "event_version": "v1",
  "event": "tool_end",
  "sequence": 12,
  "session_id": "session-id",
  "trace_id": "abc123def456",
  "turn_id": "turn123def456",
  "timestamp": "2026-02-12T00:00:00",
  "surface": "agent_loop",
  "tool": "read",
  "success": true
}
```

## Phase Stream Contract (`tehuti.phase_stream.v1`)

Interactive shell phase telemetry is emitted as structured sequence events:

```json
{
  "schema": "tehuti.phase_stream.v1",
  "event_version": "v1",
  "event": "phase",
  "sequence": 4,
  "session_id": "session-id",
  "surface": "cli_interactive",
  "phase": "execute.start",
  "phase_group": "execute",
  "status": "progress",
  "detail": "shell (1/2) pytest -q",
  "elapsed_ms": 342,
  "timestamp": "2026-02-12T00:00:00",
  "meta": {
    "tool": "shell",
    "step": 1,
    "total": 2
  }
}
```

Additional contract notes:
- `phase_group` is the stable rollup key used for filtering/adaptive rendering.
- status normalization is strict to `progress|done|error|skipped`.
- model lifecycle phases may be emitted as `analyze.model.start` and `analyze.model.done` during request/retry/synthesis loops.
- phase events are also projected in CLI interactive envelopes as `phase_events` for replay-ready turn timelines.

## Metrics Contract Notes (`tehuti.metrics.v1`)

Metrics snapshots now include:
- `surface_failures_by_code`: failure counters grouped by surface
- `provider_failures_by_code`: failure counters grouped by provider
- percentile latency fields (`p50`, `p95`, `p99`) in latency families

## CLI Interactive Envelope (`tehuti.cli.interactive.v1`)

Interactive turns are projected to the session wire log and can optionally be printed with:

- `/envelope on`

Envelope shape:

```json
{
  "schema": "tehuti.cli.interactive.v1",
  "status": "success",
  "trace_id": "abc123def456",
  "turn_id": "turn123def456",
  "session_id": "session-id",
  "result": {
    "schema": "tehuti.agent_task.v1",
    "success": true,
    "response": "final response",
    "termination_reason": "final_response",
    "degraded": false
  },
  "events": [],
  "phase_events": [],
  "activity_events": [],
  "tool_contracts": []
}
```

`activity_events` carries human-readable operator activity narration as structured events (`tehuti.activity.v1`) so live CLI stream summaries can be replayed/analyzed without parsing terminal text.

Interactive event ordering for a tool-backed turn:
1. `iteration_start`
2. `tool_start`
3. `tool_end`
4. `loop_terminated`

Failure projection uses typed error fields aligned with wire/web envelopes:

```json
{
  "schema": "tehuti.cli.interactive.v1",
  "status": "failed",
  "trace_id": "abc123def456",
  "turn_id": "turn123def456",
  "session_id": "session-id",
  "error": {
    "category": "internal",
    "code": "unclassified_error",
    "message": "message",
    "retryable": false,
    "details": {}
  }
}
```

Degraded-success projection is used when provider/model execution fails but Tehuti recovers with local non-destructive evidence:

```json
{
  "schema": "tehuti.cli.interactive.v1",
  "status": "success",
  "result": {
    "schema": "tehuti.agent_task.v1",
    "success": true,
    "termination_reason": "provider_failure_recovered",
    "degraded": true
  },
  "events": [
    {
      "event": "loop_terminated",
      "termination_reason": "provider_failure_recovered",
      "has_error": false
    }
  ]
}
```

## Metrics Contract (`tehuti.metrics.v1`)

Endpoints:
- `GET /api/metrics` (JSON)
- `GET /api/metrics/diagnostics` (JSON diagnostics)
- `GET /metrics` (Prometheus-style text)

`/api/metrics` response:

```json
{
  "schema": "tehuti.metrics.v1",
  "counters": {},
  "tool_failures_by_code": {},
  "estimates": {
    "token_estimate_total": 0,
    "cost_estimate_usd_total": 0.0
  },
  "actuals": {
    "token_actual_total": 0,
    "cost_actual_usd_total": 0.0
  },
  "latency_ms": {
    "tool": {"count": 0, "min": 0, "max": 0, "avg": 0},
    "agent_task": {"count": 0, "min": 0, "max": 0, "avg": 0}
  },
  "diagnostics_recent": []
}
```

`/api/metrics/diagnostics` response:

```json
{
  "schema": "tehuti.diagnostics.v1",
  "count": 1,
  "items": [
    {
      "kind": "surface_result",
      "surface": "web_agent_task",
      "success": false,
      "latency_ms": 1200,
      "error_code": "a2a_timeout",
      "trace_id": "abc123def456",
      "turn_id": "turn123def456",
      "retryable": true
    }
  ]
}
```
