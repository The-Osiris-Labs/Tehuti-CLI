# SLO Baselines

Baseline operational targets for Tehuti production channels.

## Service Objectives

1. Agent task success rate: `>= 97%` over rolling 1h window.
2. Tool contract failure rate: `<= 3%` over rolling 1h window.
3. Agent task latency p95: `<= 1500ms`.
4. Tool latency p95: `<= 500ms`.
5. Provider failure-code spikes: no single provider/code pair should exceed `2x` its 7-day median without alerting.

## Promotion Guardrails (Alpha -> Beta -> GA)

1. `scripts/canary_gate.py` must pass.
2. `scripts/quality_gate.sh` must pass.
3. `tool_contract_failed_total` slope must be stable or improving vs previous release candidate.
4. `provider_failures_by_code` must not show new critical codes at >1% traffic.

## Alerting Thresholds

1. Critical: `agent_task_failed_total / agent_task_total > 5%` for 15m.
2. Warning: `tehuti_agent_task_latency_p95_ms > 1500` for 15m.
3. Warning: `tehuti_tool_latency_p95_ms > 500` for 15m.
4. Warning: any `surface_failure_code_total` new code appears and count > 20 in 15m.

## Diagnostics Workflow

1. Open `/api/metrics` for top-line counters and percentile families.
2. Open `/api/metrics/diagnostics?limit=50` for recent correlated events.
3. Filter by `trace_id` for one-request root cause.
4. Filter by `error_code` for broad incident patterns.
5. Verify `token_actual_source` / `cost_actual_source` before treating usage drift as provider regression.
