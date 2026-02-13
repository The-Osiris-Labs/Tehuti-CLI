# Executive Plan Execution Tracker

## Program North Star
- Objective: deliver a contract-first, fully tool-capable, deterministic, and operationally diagnosable Tehuti across CLI, wire, and web.
- Definition of done:
1. Every user-visible outcome is traceable to model/tool/system state.
2. Every surface emits stable versioned envelopes.
3. Every failure is typed with category/code/reason/retryable.
4. Regressions are blocked in CI before merge.
5. Every release is reversible with validated rollback paths.

## Gate Policy (Hard Stop)
Every stream milestone must pass all gates:
1. Code complete.
2. Tests complete.
3. Docs complete.
4. Ops validation complete.

## Stream Ownership
| Stream | Owner | Backup | Status |
|---|---|---|---|
| Runtime/Loop Integrity | `@owner-runtime` | `@backup-runtime` | complete |
| Tool Contract + Safety | `@owner-tools` | `@backup-tools` | complete |
| Surface/Protocol Parity | `@owner-parity` | `@backup-parity` | complete |
| Observability + Operations | `@owner-ops` | `@backup-ops` | complete |
| UX/Output Quality | `@owner-ux` | `@backup-ux` | complete |
| Test/Docs/Release Engineering | `@owner-release` | `@backup-release` | complete |

## Program Board (Timeframe-Agnostic)

### Program setup and governance
- [x] `docs/EXECUTION_TRACKER.md` is canonical backlog and status source.
- [x] ADR governance enforced for contract/schema changes.
- [x] CI policy locked: contracts, parity, critical tests, migration safety, perf checks, docs drift.
- [x] Release channels and promotion/rollback policy published (`alpha`, `beta`, `ga`).

### Contract-first backbone
- [x] Versioned contracts defined and fixture-covered:
  - `tehuti.progress.v1`
  - `tehuti.tool_result.v1`
  - `tehuti.agent_task.v1`
  - `tehuti.metrics.v1`
  - CLI/Wire/Web envelopes
- [x] Golden fixtures and compatibility tests added.
- [x] Contract linter/coverage checks integrated in quality gate.
- [x] Contract diff changelog + baseline checks integrated.

### Runtime + state-machine hardening
- [x] Parser policy matrix (`strict|repair|fallback`) implemented.
- [x] Typed terminal reasons in loop contract and tests.
- [x] Deterministic preflight consumed by CLI/web/wire startup paths.
- [x] Typed failure taxonomy integrated at runtime boundaries.
- [x] Transition-matrix enforcement formalized as explicit artifact and test-backed constant (`LOOP_STATE_TRANSITIONS`).
- [x] Adaptive backoff and retry budgeting now metadata/config parameterized for loop/tool edges.

### Tooling contracts + safety
- [x] `tehuti.tool_result.v1` integrated for primary runtime tool path.
- [x] Metadata fields (`risk_class`, `idempotency`, `approval_policy`, `latency_budget_ms`, `retry_policy`) enforced by metadata lint checks.
- [x] Smart approval mode now metadata-driven for known tools.
- [x] Mutation audit envelope with correlation-ready identifiers.
- [x] Restricted/full policy tests present.
- [x] Eliminate remaining legacy execution paths that bypass `execute_contract`.

### Surface and protocol parity
- [x] Unified stable envelopes across wire and web; CLI envelope mode present for non-interactive use.
- [x] Shared conformance runner and fixtures exist.
- [x] Success-path parity checks for response, termination reason, event ordering, and ID projection.
- [x] Failure-path parity checks for status/error code/error category.
- [x] MCP and A2A error classification now typed for key failure classes.
- [x] Broaden lifecycle parity fixtures for concurrent cancellation/retry/resume and partial-failure recovery.
- [x] Retryability parity assertions across CLI/wire/web (`retryable`).

### Observability + operator readiness
- [x] Metrics contract and endpoints (`/api/metrics`, `/metrics`).
- [x] Correlation identifiers projected across wire/web envelopes (`trace_id`, `turn_id`, `session_id`).
- [x] Provider usage normalization supports estimate and actual token/cost metrics where available.
- [x] Expand per-surface and per-failure-class quantile/counter diagnostics.
- [x] Add provider-level failure counters and latency buckets.
- [x] Ensure correlation IDs are projected on every agent progress event.
- [x] Classify actual usage source (`provider` vs `estimate_fallback`) in task contract outputs.

### Memory + context system
- [x] Deterministic context packing and memory determinism tests.
- [x] Memory relevance benchmark gate integrated.
- [x] Tiered memory retrieval includes deterministic fusion (`semantic + lexical`) for context enrichment.
- [x] Retention/privacy controls added (`max_entries`, `ephemeral`, `redact_sensitive`) with policy tests.

### UX/output integrity
- [x] Removed known canned/static status messaging from core shell paths.
- [x] Dynamic plan/progress/summary behavior is test-covered.
- [x] Contract output parity checks included in CI gate.
- [x] Expand regression coverage for longer interactive workflow summaries.

### Test/docs/release engineering
- [x] Quality gate script includes governance, contracts, parity, migration safety, perf, rollback drill, and critical tests.
- [x] Contract changelog automation and migration safety checks integrated.
- [x] Release docs and rollback drill script present.
- [x] Add canary error-budget automation and promotion blockers.
- [x] Add one-command rollback coverage for binary/config/schema toggles.
- [x] Add strict release hygiene gate and clean-artifact enforcement.

## CI Required Checks
- `compile`: `python3 -m compileall -q src/tehuti_cli tests scripts`
- `adr governance`: `python3 scripts/check_adr_required.py`
- `docs drift`: `python3 scripts/check_docs_drift.py`
- `version consistency`: `python3 scripts/check_version_consistency.py`
- `runtime policy consistency`: `python3 scripts/check_runtime_policy_consistency.py`
- `contract coverage`: `python3 scripts/check_contract_coverage.py`
- `migration safety`: `python3 scripts/check_migration_safety.py`
- `contract diff changelog`: `python3 scripts/contract_diff_changelog.py --check`
- `tool metadata lint`: `python3 scripts/lint_tool_metadata.py`
- `surface conformance`: `python3 scripts/surface_conformance_runner.py`
- `perf`: `perf_smoke`, `perf_sustained`, `perf_long_session`, `perf_memory_relevance`
- `rollback drill`: `python3 scripts/rollback_drill.py`
- `rollback one-command`: `python3 scripts/rollback_one_command.py`
- `canary gate`: `python3 scripts/canary_gate.py --channel-from alpha --channel-to beta --metrics-file scripts/fixtures/canary_metrics_ok.json`
- `release hygiene`: `python3 scripts/check_release_hygiene.py --strict`
- `sensitive exposure`: `python3 scripts/check_sensitive_exposure.py --strict`
- `critical tests`: contract/runtime/protocol/parity pytest suites
- periodic full dependency confidence run: `.github/workflows/full-deps-gate.yml`

## Current Status Snapshot

### Completed foundations
- Access policy contract and deterministic coercion.
- Deterministic preflight + `tehuti.preflight.v1`.
- Typed error categories and normalized error payloads.
- Agent loop termination reasons + parser modes.
- `tehuti.tool_result.v1` and mutation audit envelope integration.
- CLI/Wire/Web stable envelope rollout with documented contract fixtures.
- Metrics contract and endpoints with estimate + actual usage fields.
- Contract governance checks in repo and CI (`adr`, docs drift, runtime schema coverage).
- Deterministic context packing with configurable token budget.
- Typed A2A and MCP protocol failures with conformance tests.
- Surface conformance runner validating success and failure parity.
- Surface conformance runner now includes interactive CLI envelope parity checks (IDs/errors/event ordering).
- Surface conformance runner now validates failure retryability parity (`retryable`) across surfaces.
- Long-session and memory relevance perf gates in quality gate.
- Contract-path enforcement test prevents production `runtime.execute(...)` bypass.
- Protocol lifecycle conformance suite covers discovery/invoke/stream/cancel/resume and concurrent partial-failure cases.
- Telemetry now includes per-surface/per-provider failure counters plus percentile latency stats.
- Telemetry now includes correlated diagnostics view (`tehuti.diagnostics.v1`) with trace/error filtering endpoint.
- Agent progress events now include correlation identifiers (`trace_id`, `turn_id`) on every emission.
- Memory system now supports retention/privacy policy controls and deterministic fused retrieval.
- Release hardening includes canary gating, rollback one-command coverage, and strict hygiene checks.
- Interactive CLI envelope now projects typed errors, trace IDs, and tool-contract metadata parity fields.
- Full-dependency confidence workflow added for periodic integration coverage.
- Interactive UX defaults stabilized: compact startup, short-chat meta suppression, unknown slash command guardrails, and cleaner provider failure messaging.
- Interactive UX now includes coordinated operator presets (`/ux quiet|standard|verbose`) and typo-aware slash suggestions for faster command recovery.
- Interactive UX now restores identity-forward startup defaults and prefers live stream-line turn telemetry over table-centric intent/summary panels.
- Interactive turn framing now uses lower-scaffold stream labels (`Focus`, `Trace`) to preserve operator context without table-style UI.
- Interactive shell now normalizes raw provider-error payloads (billing/spend-limit/unavailable) into actionable operator guidance.
- Interactive welcome now provides startup preflight hints for missing credentials and free-tier model reliability risk.
- Non-interactive slash exit (`run_once`) now terminates deterministically without leaking internal EOF handling.
- Interactive runtime now emits adaptive phase-stream telemetry (`tehuti.phase_stream.v1`) with sequence/timing/status metadata for replay-ready execution visibility.
- Phase-stream policy is now centralized and metadata-aware (`src/tehuti_cli/core/phase_stream.py`) to keep tool lifecycle classification resilient as tool inventory evolves.
- Interactive runtime now emits explicit model lifecycle phase events (`analyze.model.start|done`) across initial and retry/synthesis paths.
- Memory vector math no longer requires `numpy` for baseline operation (`src/tehuti_cli/core/memory.py`), improving portability in restricted environments.
- Interactive shell command registry is now aligned with implemented handlers (no hidden operator commands on the slash surface).
- Interactive provider-blocked turns now project truthful failure lifecycle instead of success-like execute/respond completion.
- Interactive stream copy now uses explicit operator-style action verbs (`Working`, `Start`, `Done`, `Fail`) with concise phase sequencing.
- Interactive prompt handling now distinguishes conversational vs operational prompts for tool requirement policy (capability preserved; forced-tool chatter reduced).
- Interactive post-tool responses now enforce evidence visibility via compact digest injection when model output is generic.
- Tool-required turns now enforce minimum executed evidence when model returns final text without tool calls (non-destructive grounding probe + real output projection).
- Tool-evidence enforcement now uses intent-aware deterministic non-destructive profiles (`repository|filesystem|diagnostics|runtime|grounding`) to better match user task domain.
- Standard interactive mode suppresses turn-summary/meta scaffolding by default; verbose mode retains deep diagnostics.
- Tool-loop mixed-output parser now uses robust JSON object decoding for embedded/fenced payloads, reducing missed tool invocation opportunities from mixed model text.
- Phase-stream regression coverage now asserts cross-surface attribution fields (`surface`, `phase_group`) for projected phase events.
- `/ux` command behavior now has explicit regression coverage for no-arg cycling across quiet/standard/verbose presets.
- `/run` manual execution paths now reuse shared runtime feedback execution, reducing per-tool duplication and output drift.
- Core shell tool paths now increasingly converge on shared traced execution (`_execute_traced_tool`), including macro/probe/model-loop/smoke surfaces.
- Interactive shell now projects explicit per-turn `task_context` telemetry and exposes `/focus` for live objective/phase/mode visibility.
- Provider-blocked interactive turns now distinguish hard failure vs recovered degraded completion with explicit termination reasons.
- Interactive shell live stream now projects bounded `tool_stream` progress events for in-flight shell output visibility.
- Interactive degraded-success lifecycle is now fixture-backed and conformance-reported (`provider_failure_recovered` + `degraded` projection).
- Interactive degraded-success lifecycle is now conformance-hard-failed in runner checks (status/reason/degraded/event-order/error-shape invariants).
- Interactive UX transcript regression runner is now part of required quality gate (`scripts/ux_session_test.py`).
- Interactive action stream now includes explicit operator narration lines (`Edited/Wrote/Explored/Executed`) driven by real tool context.
- CLI interactive envelopes now project `activity_events` (`tehuti.activity.v1`) for structured narration replay.
- CLI prompt, wire agent-task, and web agent-task surfaces now project `activity_events` parity for consistent cross-surface narration telemetry.
- Wire streaming (`tehuti.wire.progress.v1`) now emits in-flight derived `tehuti.activity.v1` events for real-time activity-aware clients.
- Staged-change security gate now blocks committing local runtime artifacts and high-confidence secret patterns before push.
- Standard interactive mode now defaults to stream-first rendering; large evidence panels are verbose-only.
- Busy-state tracking now spans full turn lifecycle with depth-safe semantics to avoid false `ready` state during active work.
- Turn meta stream now includes live guardrail projection (`shell/write/external`) for per-turn execution posture visibility.
- Interactive envelope projection now prefers recorded turn progress events over synthetic action-only reconstruction when available.
- Interactive envelope result metadata now uses runtime-derived `iterations`/`parse_status`/`latency_ms` instead of static fallback placeholders.
- Slash dispatch precedence now guarantees `/status-all` reaches full-status path (no `/status` prefix shadowing).
- CLI interactive envelopes now include `phase_events` projection for per-turn timeline replay and diagnostics correlation.
- Wire and web agent-task surfaces now project `phase_events` using shared progress-to-phase mapping; wire can also stream projected phase events when `stream_phase=true`.
- Agent loop now supports evidence-gated finalization for agent-task execution (`require_tool_evidence`), reducing unsupported final responses when no tool evidence exists.
- Agent-task outputs now include reconciliation metadata (`created|updated|completed|failed|tool_events`) to improve closure tracking for planning/task workflows.
- Memory redaction policy now avoids embedding raw sensitive content in `redact_sensitive` mode.
- Repository hygiene baseline now enforces non-tracked runtime artifacts (`.venv`, caches, local egg-info) with deletion-aware strict safety gates.
- Full quality gate currently passing.

### Active risks
1. Provider-backed usage actuals still depend on upstream provider reporting; fallback classification now explicit.

## Current Maintenance Priorities

1. Preserve strict release hygiene in CI and pre-release workflow.
2. Keep runtime/local artifact directories out of git index (cleanup-only deletions must remain gate-safe).
3. Keep provider-actual telemetry source classification stable as providers evolve.
4. Expand metrics diagnostics and dashboard overlays on top of current per-surface/per-provider counters.
5. Keep interactive conformance assertions aligned as new progress event families are added.
6. Continue focused UX hardening on interactive flow:
   - tune default verbosity for coding vs chat intents
   - keep slash-command UX deterministic and non-LLM for command failures
   - add transcripted end-to-end golden checks for startup/error/exit behavior
   - evaluate adaptive default preset selection by prompt intent and workspace mode
   - add interactive snapshots validating live stream visibility during long-running tool calls
   - map projected phase-stream events into web diagnostics views for timeline-first triage
   - converge phase-group semantics between shell streaming and agent-loop progress callbacks for unified downstream dashboards
   - add explicit contract fixtures for agent-task reconciliation metadata and insufficient-evidence termination paths
   - add startup/turn-end golden snapshots for standard-vs-verbose mode stream behavior and model phase visibility
   - add dedicated CI lane for constrained-environment validation (`PYTEST_DISABLE_PLUGIN_AUTOLOAD=1`) to protect operator UX on minimal hosts
   - add CI/static check to assert `_slash_registry` ↔ `_handle_slash` parity automatically
  - expand `tool_stream` coverage beyond shell into additional tool families that support incremental output
  - enforce degraded interactive parity against wire/web agent-task lifecycle semantics where recovery strategies exist
   - add CI golden tests that force no-tool model responses and assert chosen evidence profile + live stream projection
   - complete remaining execution-path convergence by routing all shell tool paths through one orchestrator abstraction with unified retry/approval semantics
   - reduce `ui/shell.py` monolith by splitting lifecycle/event-projection/rendering concerns into dedicated modules
   - add first-class operator activity event schema for `edited/explored/executed` so bullet narration is contract-addressable across CLI/wire/web

## Regression Handling Policy
1. Reproduce with a failing test/fixture first.
2. Implement fix with contract-safe behavior.
3. Update runbook/docs if operational behavior changed.
4. Backport or rollback based on channel policy and blast radius.
