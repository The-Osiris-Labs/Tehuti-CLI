# Operator Runbook

This runbook is for people running Tehuti during real work, not demos.

## Delegate Monitoring: `status` vs `follow`

Use `/delegate status <id>` when you need:
- current state
- what the minion is working on
- recent activity without log spam

Use `/delegate follow <id>` only when:
- you are actively debugging a running task
- you need line-by-line progression

## Output Volume Controls

- `/verbosity minimal|standard|verbose`
- `/worklog on|off`
- `/output compact|full|<chars>`

These knobs are independent and should be tuned intentionally.

## Fast Triage Flow (Foreground + Background)

1. `/status`
2. `/status-all`
3. For delegates: `/delegate list` then `/delegate status <id>`
4. If needed: `/delegate logs <id>`
5. If stuck: `/delegate stop <id>` and relaunch with narrower task definition

## Telemetry Endpoints

For web/API deployments, use:

- `GET /api/metrics` for JSON metrics (`tehuti.metrics.v1`)
- `GET /api/metrics/diagnostics` for correlated diagnostics (`tehuti.diagnostics.v1`)
- `GET /metrics` for Prometheus-style text

Minimum checks during incidents:

1. `tool_contract_failed_total` trend
2. top `tool_failures_by_code`
3. `tehuti_tool_latency_avg_ms`
4. `tehuti_agent_task_latency_avg_ms`

Correlated drill-down:

1. Pull latest diagnostics: `GET /api/metrics/diagnostics?limit=50`
2. If a failure has `trace_id`, filter: `GET /api/metrics/diagnostics?trace_id=<id>`
3. If a failure code spikes, filter: `GET /api/metrics/diagnostics?error_code=<code>`
4. Confirm retry posture (`retryable`) and latency trend for the same trace.
5. For agent task failures, confirm `token_actual_source` / `cost_actual_source` to separate provider-reporting gaps from runtime regressions.

## Deterministic Non-Interactive Runs

When automation needs stable parsing, use envelope mode:

1. `tehuti --prompt "task" --envelope`
2. `echo "task" | tehuti --print --envelope`

These return `tehuti.cli.prompt.v1` payloads instead of plain text output.

## Release Safety Commands

Before promoting a release channel, run:

1. `bash scripts/quality_gate.sh`
2. `python3 scripts/contract_diff_changelog.py --check`
3. `python3 scripts/check_migration_safety.py`
4. `python3 scripts/rollback_drill.py`
5. `python3 scripts/clean_dev_artifacts.py --apply` (recommended before release packaging on local environments)

Use `python3 scripts/contract_diff_changelog.py --update-baseline` only after approved contract changes.

## Operational Rule of Thumb

- Prefer concise visibility first.
- Escalate to deep logs only when needed.
- Keep tasks explicit about expected deliverables.
