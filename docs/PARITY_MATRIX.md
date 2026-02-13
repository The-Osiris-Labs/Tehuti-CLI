# Surface Parity Matrix

This matrix tracks semantic parity across Tehuti execution surfaces.

## Legend

- `yes`: implemented and tested
- `partial`: implemented but not fully conformance-tested
- `no`: not implemented

## Contracts and Behaviors

| Capability | CLI Interactive | CLI Wire | Web/API |
|---|---|---|---|
| Typed error payloads | yes | yes | yes |
| Failure status/code/category parity (conformance fixtures) | yes | yes | yes |
| Stable response envelope | partial (`tehuti.cli.interactive.v1` projection + richer terminal rendering) | yes (`tehuti.wire.v1`) | yes (`tehuti.web.*.v1`) |
| Stable trace identifiers (`trace_id`, `turn_id`) | yes | yes | yes |
| Tool result contract projection (`tehuti.tool_result.v1`) | yes | yes (agent-task mode projection) | yes (agent-task projection) |
| Progress event schema (`tehuti.progress.v1`) | yes | yes (`tehuti.wire.progress.v1`) | yes |
| Phase stream schema (`tehuti.phase_stream.v1`) | yes | yes (result projection + optional stream) | yes (result projection) |
| Loop termination reasons in contract output | yes | yes | yes |
| Preflight startup checks | yes | yes | yes |
| Metrics export (`tehuti.metrics.v1`) | partial (CLI command view, not API server) | no | yes (`/api/metrics`, `/metrics`) |
| Success-path event order parity check | yes | yes | yes |
| Failure-path parity check (`error_code`,`error_category`) | yes | yes | yes |
| Failure retryability parity (`retryable`) | yes | yes | yes |

## Current Gaps

1. CLI interactive rendering is intentionally richer than envelope projection; parity checks target contract fields and event structure, not terminal styling detail.
2. Provider actual token/cost population is explicit but still dependent on provider-side reporting availability.
3. Wire/web phase projection is currently sourced from agent-loop progress mapping; direct runtime-native phase emission is still CLI-first.

## Next Milestone Targets

1. Preserve contract-path enforcement and retryability parity in CI.
2. Expand lifecycle fixtures further as new protocol operations are added.
3. Extend metrics diagnostics and dashboards on top of current per-surface/per-provider counters.
4. Keep phase mapping policy aligned as new progress event families are introduced.
