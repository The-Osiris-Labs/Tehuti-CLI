# Session Changes - 2026-02-12

This file captures the meaningful behavior changes delivered during this session.

## Summary

- Runtime startup is now guarded by deterministic preflight checks.
- Capability policy is explicit (`access_policy`) instead of implicit side effects.
- CLI, wire, and web surfaces now return typed, versioned, machine-readable envelopes.
- Agent loop now has explicit parser modes and termination reason codes.
- Tool execution now exposes a normalized contract envelope (`tehuti.tool_result.v1`) with metadata-driven safety behavior.
- Protocol reliability improved with stricter MCP/A2A typed failure handling.
- Quality gates now include long-session and memory-relevance performance checks.
- Remaining execution-plan items were integrated: universal contract paths, lifecycle/retry parity fixtures, richer telemetry, memory policy tiers, and release hardening automation.

## Detailed Changes

1. Reliability and bootstrap
- Added preflight subsystem in `src/tehuti_cli/core/preflight.py`.
- Added checks for Python runtime, venv presence, provider config, writable paths, core dependencies, and tool registry.
- Wired preflight enforcement into shell/print startup in `src/tehuti_cli/core/app.py`.
- Upgraded `doctor` in `src/tehuti_cli/cli.py` to report preflight check results.

2. Typed errors and diagnostics
- Added typed error categories in `src/tehuti_cli/core/errors.py`:
  - `config`
  - `bootstrap`
  - `tool`
  - `agent_loop`
  - `protocol`
  - `internal`
- Added reusable error payload projection for CLI/web responses.
- Wrapped CLI callback and web endpoints with structured failure responses.

3. Access policy contract
- Added `access_policy = "full"|"restricted"` to config in `src/tehuti_cli/storage/config.py`.
- `full` now deterministically coerces unrestricted runtime behavior:
  - `default_yolo = true`
  - shell/write/external enabled
  - no path/domain/tool allow/deny restrictions
  - `approval_mode = "auto"`
- Default remains `full` to preserve maximum-capability behavior.

4. Agent loop hardening
- Added parser modes in `src/tehuti_cli/core/agent_loop.py`:
  - `strict`
  - `repair`
  - `fallback`
- Added explicit loop termination reasons:
  - `final_response`
  - `max_iterations`
  - `should_continue_without_tools`
  - `parser_error`
  - `loop_exception`
- Added lifecycle/progress events:
  - `iteration_end`
  - `loop_terminated`
  - `loop_error`
- Added checkpoint-serializable fields on `AgentTurn`:
  - `iterations`
  - `parse_mode`
  - `parse_status`
  - `termination_reason`
  - `should_continue`

5. Tool contract enforcement and safety policy
- Added normalized tool execution envelope in `ToolRuntime.execute_contract` (`src/tehuti_cli/core/runtime.py`).
- Contract schema: `tehuti.tool_result.v1`.
- Contract includes tool metadata (`risk_class`, `approval_policy`, `latency_budget_ms`, `retry_policy`) and normalized trace/result/error sections.
- Smart approval mode now uses registry metadata for known tools (not risk-name heuristics), denying manual-policy tools when metadata requires it.
- Added metadata policy tests in `tests/test_tool_metadata_contract.py`.

6. Cross-surface contract parity and metrics
- Added wire handler contract projection (`tehuti.wire.v1`) in `src/tehuti_cli/cli.py`.
- Added reusable wire payload processor (`_process_wire_payload`) and direct contract tests.
- Added wire progress stream envelope (`tehuti.wire.progress.v1`) with stable IDs and sequence/timestamp ordering.
- Updated web prompt/agent-task responses to stable envelopes:
  - `tehuti.web.prompt.v1`
  - `tehuti.web.agent_task.v1`
- Web success/failure envelopes now include stable `trace_id` and `turn_id` in `src/tehuti_cli/web/app.py`.
- Added task result contract (`tehuti.agent_task.v1`) in `src/tehuti_cli/agentic.py`.
- Added telemetry collector in `src/tehuti_cli/core/telemetry.py`.
- Added metrics endpoints:
  - `GET /api/metrics` (JSON `tehuti.metrics.v1`)
  - `GET /metrics` (Prometheus-style text)

7. Protocol hardening (MCP and A2A)
- Hardened MCP error typing in `src/tehuti_cli/mcp_tools.py` for timeout/auth/not-found/invalid-payload/transport classes.
- Fixed runtime MCP configure dispatch in `src/tehuti_cli/core/runtime.py` to correctly pass `servers` and `output_path`.
- Hardened A2A client payload validation in `src/tehuti_cli/core/a2a_client.py`:
  - `send_task` rejects payloads missing both `result` and `status`
  - `get_task_state` requires `status.state` string
  - `stream_task_result` rejects non-object SSE payloads
  - `cancel_task` maps HTTP failures through typed protocol errors
- Expanded protocol conformance tests:
  - `tests/test_mcp_contract_errors.py`
  - `tests/test_a2a_protocol_errors.py`

8. UX output integrity
- Removed hardcoded/canned intent/thinking phrasing in `src/tehuti_cli/ui/shell.py`.
- Replaced static default plan text with dynamic, prompt-derived plan synthesis.
- Replaced static execution-summary response label (`generated|empty`) with measured output stats (lines/chars).
- Updated interactive shell status path to emit runtime/session metrics instead of placeholders.
- Added test coverage for dynamic thinking/plan/progress-summary behavior in `tests/test_shell_progress.py`.

9. Conformance and performance gates
- Expanded cross-surface conformance runner in `scripts/surface_conformance_runner.py`:
  - success-path parity for response/termination/event-order and ID projection
  - failure-path parity for `status`, `error_code`, `error_category`
- Added long-session perf gate: `scripts/perf_long_session.py`.
- Added memory relevance perf/quality gate: `scripts/perf_memory_relevance.py`.
- Integrated both into `scripts/quality_gate.sh`.

10. Execution-plan integration follow-through
- Universalized production runtime tool execution through contract-backed path:
  - `src/tehuti_cli/core/runtime.py` (`execute_with_tracing` now projects from `execute_contract`)
  - `src/tehuti_cli/ui/shell.py`
  - `src/tehuti_cli/ui/interactive.py`
  - `src/tehuti_cli/core/executor.py`
- Added fail-fast bypass regression test:
  - `tests/test_contract_path_enforcement.py`
- Expanded protocol lifecycle conformance with concurrent/partial-failure coverage:
  - `tests/test_protocol_lifecycle_conformance.py`
- Added retryability parity checks across surfaces:
  - `tests/test_retry_semantics_parity.py`
  - `tests/test_surface_conformance_runner.py`
  - `scripts/surface_conformance_runner.py`
- Expanded observability:
  - per-surface/per-provider failure counters
  - percentile latencies (`p50`, `p95`, `p99`)
  - correlation IDs (`trace_id`, `turn_id`) on every agent progress event
  - files: `src/tehuti_cli/core/telemetry.py`, `src/tehuti_cli/core/agent_loop.py`, `src/tehuti_cli/providers/llm.py`
- Closed provider-actuals ambiguity with explicit source classification:
  - `token_actual_source`, `cost_actual_source` in `src/tehuti_cli/agentic.py`
- Completed memory-policy tier work:
  - deterministic fused retrieval (`search_fused`)
  - retention/privacy controls (`max_entries`, `ephemeral`, `redact_sensitive`)
  - policy tests: `tests/test_memory_policy_controls.py`
- Added release hardening automation:
  - canary promotion gate: `scripts/canary_gate.py`
  - one-command rollback coverage: `scripts/rollback_one_command.py`
  - strict release hygiene check: `scripts/check_release_hygiene.py`
  - quality gate wiring: `scripts/quality_gate.sh`

11. Governance and docs
- Added ADR: `docs/adr/0001-runtime-foundation-and-capability-parity.md`.
- Added execution tracker: `docs/EXECUTION_TRACKER.md`.
- Updated contracts and parity docs:
  - `docs/API_CONTRACTS.md`
  - `docs/PARITY_MATRIX.md`
- Updated fixture baseline and changelog plumbing:
  - `docs/contract_baseline.json`
  - `docs/CONTRACT_DIFF_CHANGELOG.md`

12. Session extension: integration closure and hardening
- Interactive CLI envelope parity was tightened in `src/tehuti_cli/ui/shell.py`:
  - added `trace_id` + `turn_id` projection on `tehuti.cli.interactive.v1`
  - added typed interactive error envelope (`category`, `code`, `message`, `retryable`, `details`)
  - added interactive `tool_contracts` projection (`tehuti.tool_result.v1`)
- Runtime retry policy became explicitly parameterized in `src/tehuti_cli/storage/config.py` and `src/tehuti_cli/core/runtime.py`:
  - `retry_backoff_base_seconds`
  - `retry_backoff_cap_seconds`
  - metadata-aware backoff (`safe_read`/`idempotent_write`/other classes)
- Agent loop transition policy was formalized as a first-class artifact:
  - `LOOP_STATE_TRANSITIONS` in `src/tehuti_cli/core/agent_loop.py`
  - state table doc: `docs/LOOP_STATE_TABLE.md`
  - loop stuck-cycle backoff now config-driven:
    - `loop_stuck_backoff_base_seconds`
    - `loop_stuck_backoff_cap_seconds`
- Legacy interactive compatibility path (`src/tehuti_cli/ui/interactive.py`) was repaired:
  - fixed resume path to use `last_session.id`
  - implemented `_load_session(...)` history hydration from storage
  - implemented `_save_session_state(...)` context persistence
  - replaced deprecated loop-time default with `time.monotonic`
- Release hygiene checker (`scripts/check_release_hygiene.py`) was hardened:
  - detects nested `__pycache__` and `.tehuti_ci_probe/` churn
  - strict mode now blocks staged noisy artifacts while still reporting unstaged noise
- CI confidence was expanded with periodic full dependency coverage:
  - new workflow: `.github/workflows/full-deps-gate.yml`
- Added focused regression coverage:
  - `tests/test_cli_interactive_envelope_contract.py`
  - `tests/test_interactive_session_persistence.py`
  - extensions in:
    - `tests/test_shell_progress.py`
    - `tests/test_config_access_policy.py`
    - `tests/test_agent_loop.py`
    - `tests/test_tool_metadata_contract.py`
- Quality gate was updated to include new parity/session tests:
  - `scripts/quality_gate.sh`
- Added formal policy docs:
  - `docs/RETRY_BACKOFF_POLICY.md`
  - `docs/LOOP_STATE_TABLE.md`
- Updated canonical docs to reflect closure:
  - `docs/API_CONTRACTS.md`
  - `docs/PARITY_MATRIX.md`
  - `docs/EXECUTION_TRACKER.md`
  - `docs/CONFIGURATION.md`
  - `docs/README.md`
  - `docs/MAINTAINER_MAP.md`

13. Session extension: policy gating + diagnostics operationalization
- Added runtime policy consistency gate:
  - script: `scripts/check_runtime_policy_consistency.py`
  - quality gate wiring: `scripts/quality_gate.sh`
  - tracker CI check list updated in `docs/EXECUTION_TRACKER.md`
- Expanded surface conformance runner to include interactive CLI contract path:
  - `scripts/surface_conformance_runner.py` now emits `cli_interactive` fixture checks
  - validates interactive IDs, typed failure fields, and event ordering
- Enriched interactive envelope progress stream in `src/tehuti_cli/ui/shell.py`:
  - emits `iteration_start`, `tool_start`, `tool_end`, `loop_terminated`
  - keeps typed error and contract projection fields
- Added correlated diagnostics data-plane:
  - telemetry store now records recent diagnostic events in `src/tehuti_cli/core/telemetry.py`
  - new endpoint: `GET /api/metrics/diagnostics` in `src/tehuti_cli/web/app.py`
  - metrics snapshot includes `diagnostics_recent`
- Added tests for diagnostics and interactive conformance changes:
  - `tests/test_metrics_contract.py`
  - `tests/test_web_api_contract.py`
  - `tests/test_surface_conformance_runner.py`
  - `tests/test_shell_progress.py`
- Added operational SLO baseline document:
  - `docs/SLO_BASELINES.md`
  - linked in `docs/README.md`
- Expanded full dependency confidence workflow:
  - `.github/workflows/full-deps-gate.yml` now includes policy check and protocol/provider suites
- Added local artifact cleanup utility:
  - `scripts/clean_dev_artifacts.py`
  - referenced in `docs/OPERATOR_RUNBOOK.md`
- Added diagnostics fixture and updated contract baseline/changelog:
  - `tests/fixtures/contracts/diagnostics_sample.json`
  - `docs/contract_baseline.json`
  - `docs/CONTRACT_DIFF_CHANGELOG.md`

14. Session extension: interactive UX stabilization and noise reduction
- Reduced startup and turn-level noise in interactive shell:
  - compact startup remains default when banner is off (`src/tehuti_cli/ui/shell.py`)
  - turn metadata now suppresses intent/progress tables for short casual prompts unless tool evidence exists
- Improved command UX and safety:
  - unknown slash commands no longer fall through to the model; shell now prints explicit command guidance
  - `/exit` now exits cleanly without printing internal error payloads (`src/tehuti_cli/cli.py`)
- Improved provider failure readability:
  - provider-limit and billing failures are humanized in LLM adapter (`src/tehuti_cli/providers/llm.py`)
  - interactive notice for temporary model fallback is now informational (dim note) instead of warning-noise
- Removed intrusive runtime coercion of user preferences on shell startup:
  - full access policy still normalizes capability/safety booleans and allow/deny lists
  - shell no longer force-overwrites `approval_mode`, `execution_mode`, or `show_actions`
- Added/updated regression tests:
  - `tests/test_cli_main_flow.py`
  - `tests/test_shell_progress.py`
  - `tests/test_provider_usage_normalization.py`
  - new coverage for unknown slash command handling and short-chat meta suppression

15. Session extension: command ergonomics and operator-control depth pass
- Added typo-aware slash-command guidance:
  - unknown slash commands now suggest closest known commands (e.g., `/modle` -> `/model`)
  - guidance remains deterministic and non-LLM-routed
- Added UX preset control for interactive operation:
  - new command: `/ux [quiet|standard|verbose]`
  - presets configure `show_actions`, `progress_verbosity`, `tool_output_limit`, and `show_history` as a coordinated profile
  - `/ux` with no argument cycles profiles for rapid tuning in-session
- Updated command discoverability surfaces:
  - slash registry now includes `/ux`
  - `/help` includes `/ux` usage and intent
- Added focused regression tests:
  - unknown-command suggestion behavior
  - `/ux quiet` profile application
  - invalid `/ux` usage guardrail

16. Session extension: identity restoration + live execution stream pass
- Restored identity-forward startup defaults:
  - interactive CLI now defaults to banner enabled (`--banner` default true in `src/tehuti_cli/cli.py`)
  - compact startup mode was upgraded to preserve Tehuti/Thoth identity lines even when banner is not shown
- Removed table-first turn presentation:
  - replaced `Intent` table with streaming lines (`Intent: ...`, `Plan: ...`, optional `Active: ...`)
  - replaced `Execution Summary` table with single-line digest (`Digest: ...`)
- Reinforced live agent activity visibility:
  - removed status-spinner wrapper around turn execution so tool activity prints are continuously visible
  - tool action completion lines now emit regardless of `show_actions`; detailed panels remain verbosity-controlled
- Added regression tests for stream-style rendering:
  - intent/plan stream-line rendering (no table dependency)
  - digest-line rendering after turn completion

17. Session extension: dynamic phase stream (future-proof execution telemetry)
- Added structured phase-stream engine to interactive shell runtime:
  - sequenced phase events with elapsed timing and optional metadata
  - status-aware lifecycle (`progress`, `done`, `error`)
  - event persistence to session wire log for replay/diagnostics
- Phase model is adaptive by request and tool behavior:
  - top-level phases include `intake`, `analyze`, `execute`, `synthesize`, `respond`, `complete`
  - tool-aware subphases are inferred dynamically (`inspect|mutate|execute|retrieve|session|tool`)
  - per-tool start/done events include outcome + latency metadata
- Integrated phase events into both tool-call paths:
  - multi-tool batch calls (`type: tools`)
  - single-tool calls (`type: tool` and normalized variants)
- Added contract governance for phase stream:
  - API docs now include `tehuti.phase_stream.v1`
  - fixture added: `tests/fixtures/contracts/phase_stream_event.json`
  - baseline/changelog updated via contract diff tooling
- Added targeted regression coverage:
  - phase-event sequence/wire emission test
  - updated shell test stubs for phase stream compatibility

## Test and Validation Results

- Targeted suites (runtime/contracts/parity/protocol/perf) passed during implementation.
- `python3 scripts/surface_conformance_runner.py`: pass.
- `python3 scripts/perf_long_session.py`: pass.
- `python3 scripts/perf_memory_relevance.py`: pass.
- `bash scripts/quality_gate.sh`: pass.
- `python3 scripts/check_release_hygiene.py --strict`: pass (strict mode now enforces staged-noise blocking while reporting local unstaged churn).
- `python3 -m pytest -q tests/test_shell_progress.py tests/test_cli_main_flow.py tests/test_provider_usage_normalization.py`: pass.
- `bash scripts/quality_gate.sh`: pass after interactive UX stabilization changes.
- `python3 -m pytest -q tests/test_shell_progress.py tests/test_cli_main_flow.py tests/test_provider_usage_normalization.py`: pass after command ergonomics pass.
- `bash scripts/quality_gate.sh`: pass after `/ux` preset and slash-suggestion changes.
- `python3 -m pytest -q tests/test_shell_progress.py tests/test_cli_main_flow.py tests/test_provider_usage_normalization.py`: pass after identity + live-stream pass.
- `bash scripts/quality_gate.sh`: pass after identity + live-stream pass.
- `bash scripts/quality_gate.sh`: pass after dynamic phase-stream + contract fixture/baseline updates.
- `python3 -m py_compile src/tehuti_cli/ui/shell.py tests/test_shell_progress.py`: pass.
- Targeted pytest execution in this environment is currently blocked by missing runtime deps/plugins (`numpy`, `attrs`); full suite rerun for this increment is pending dependency-complete CI/local env.

18. Session extension: adaptive phase policy + replay-ready timeline projection
- Centralized phase-stream policy in `src/tehuti_cli/core/phase_stream.py`:
  - normalized phase statuses (`progress|done|error|skipped`)
  - stable phase grouping (`phase_group`) for filtering and dashboard aggregation
  - verbosity-aware rendering policy (`minimal|standard|verbose`)
  - metadata-aware tool lifecycle classification that scales across the full tool catalog
- Interactive shell now consumes centralized policy for phase emission:
  - emits `event_version` and `surface` fields on `tehuti.phase_stream.v1`
  - emits `phase_group` for every event
  - normalizes unknown phase/status inputs to stable contract values
- Interactive envelope projection now includes `phase_events`:
  - `tehuti.cli.interactive.v1` payload can replay per-turn phase timeline without scraping wire log
- Contract and fixture updates:
  - `docs/API_CONTRACTS.md` expanded phase-stream contract fields/notes
  - `tests/fixtures/contracts/phase_stream_event.json` updated with `event_version`, `surface`, `phase_group`
  - `docs/PARITY_MATRIX.md` now explicitly tracks phase-stream parity gap (CLI yes; wire/web pending)
- Added targeted tests:
  - new module tests: `tests/test_phase_stream.py`
  - shell tests expanded for new phase-stream fields and envelope projection behavior

19. Session extension: cross-surface phase timeline parity (wire/web)
- Added shared progress-to-phase projection to `src/tehuti_cli/core/phase_stream.py`:
  - maps agent-loop progress events into `tehuti.phase_stream.v1`
  - normalizes phase/status and preserves source metadata
- Wire agent-task path now includes projected phase timeline in final payload:
  - `result.phase_events` added in `src/tehuti_cli/cli.py`
  - optional live stream of phase projections over wire when `stream_phase=true`
- Web agent-task path now includes projected phase timeline:
  - `phase_events` added in `src/tehuti_cli/web/app.py`
- Contract/docs updates:
  - `docs/API_CONTRACTS.md` now documents wire/web `phase_events` and wire `stream_phase`
  - `docs/PARITY_MATRIX.md` updated to reflect cross-surface phase schema support
  - `docs/EXECUTION_TRACKER.md` updated status and next-priority wording
- Added/updated tests:
  - `tests/test_phase_stream.py` expanded with projection mapping coverage
  - `tests/test_wire_progress_stream.py` adds `stream_phase` coverage
  - `tests/test_wire_agent_task_contract.py` and `tests/test_web_api_contract.py` assert phase-event projection

20. Session extension: evidence integrity + context wiring + tracking reconciliation
- Added agent-loop evidence gate for autonomous execution:
  - `AgentLoop.run(..., require_tool_evidence=True)` now requires at least one successful tool result before finalization
  - emits `evidence_required` progress event when model attempts final response without evidence
  - introduces explicit termination reason `insufficient_evidence`
- Enabled evidence gating by default for `TehutiAgent.execute_task` via config:
  - new config key: `require_tool_evidence` (default `true`)
  - documented in `docs/CONFIGURATION.md`
- Improved memory/context behavior in `TehutiAgent`:
  - system prompts are now enriched with fused relevant memory context
  - context manager is now used in `chat` and `execute_task` flows for interaction capture
- Fixed sensitive-memory embedding leakage:
  - `redact_sensitive` mode now embeds redacted content, not raw sensitive content
- Added work-tracking reconciliation summary to task results:
  - `tehuti.agent_task.v1` now includes `reconciliation` counters:
    `created|updated|completed|failed|tool_events`
  - improves closure visibility for task-graph-driven/project planning workflows
- Added/updated tests:
  - `tests/test_agent_loop.py` adds evidence-gating behavior coverage
  - new `tests/test_agentic_integration.py` verifies evidence gating pass-through and reconciliation output
  - `tests/test_memory_policy_controls.py` verifies redacted embedding behavior

21. Session extension: interactive cycle stream deepening (no-table UX + model phase visibility)
- Refined turn framing language to reduce scaffold feel and improve operator readability:
  - `Intent` -> `Cycle`
  - `Plan` -> `Next`
  - `Digest` -> `Outcome`
- Tightened phase-line rendering to concise ordered format:
  - `phase[n]` format replaced with `[n] <phase>` sequence line for clearer live scanning.
- Added explicit model request/response phase projection in shell execution loop:
  - emits `analyze.model.start` before LLM request
  - emits `analyze.model.done` after response with response-size detail
  - applied across initial generation, post-tool synthesis, schema repair, and retry paths
- Added provider-error payload normalization in interactive loop:
  - detects raw provider error JSON payloads in model responses
  - returns actionable operator-facing messages (billing/spend-limit/model-unavailable) instead of leaking raw blobs
- Added startup preflight UX hints in shell welcome:
  - missing provider API key now surfaces immediately with `/setup`/`/login` guidance
  - free-tier model selection now shows a proactive reliability hint
- Fixed non-interactive slash-exit handling:
  - `run_once(\"/exit\")` now closes cleanly with decree line instead of raising `EOFError`
- Extended regression coverage:
  - updated stream label assertions in `tests/test_shell_progress.py`
  - added `test_chat_messages_with_phase_emits_model_start_and_done`
  - added provider-error normalization tests for spend-limit payload handling
  - added startup preflight hint and run-once exit behavior tests
- Future-proofing impact:
  - all major loop stages now project deterministic, parseable lifecycle signals
  - stream remains identity-forward while reducing fixed scaffolding language

22. Session extension: dependency-resilient runtime validation hardening
- Removed hard `numpy` dependency from memory embedding math path in `src/tehuti_cli/core/memory.py`:
  - vector normalization and cosine similarity now use pure-Python math
  - behavior remains deterministic while improving portability in restricted/runtime-minimal environments
- Validation execution was hardened for constrained hosts:
  - targeted pytest suites were run with `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1` to avoid unrelated global plugin dependency failures
  - validated suites:
    - `tests/test_shell_progress.py`
    - `tests/test_cli_main_flow.py`
    - `tests/test_phase_stream.py`
    - `tests/test_agent_loop.py`
    - `tests/test_agentic_integration.py`
    - `tests/test_wire_progress_stream.py`
    - `tests/test_wire_agent_task_contract.py`
    - `tests/test_web_api_contract.py`

23. Session extension: dead-code and orphan-capability integration cleanup
- Removed unused shell imports to reduce dead clutter in interactive runtime module:
  - dropped unused symbols (`WordCompleter`, `OBSIDIAN`, `PROMPT_THINKING`, `LengthPreference`)
- Closed command-surface integration drift:
  - commands implemented in `_handle_slash(...)` but previously not advertised are now registered/discoverable in `_slash_registry`
  - added: `/run`, `/help`, `/allow-all`, `/lockdown`, `/grounding`, `/history`, `/profile`, `/quit`
- Added regression guard to prevent future command-surface drift:
  - `tests/test_shell_progress.py::test_slash_registry_declares_operator_commands_for_discoverability`
- Structural audit result:
  - duplicate function-definition scan over `src/tehuti_cli` reported no duplicate function bodies shadowing each other
  - `_slash_registry` and `_handle_slash` command coverage now aligns (no unhandled registry entries / no hidden handlers in audit script output)

24. Session extension: truthful stream lifecycle and operator-style live reporting
- Fixed misleading success-path projection during provider/model failure:
  - provider-blocked turns no longer emit successful `execute.done`/`respond` lifecycle
  - interactive envelope now projects failed status for provider-blocked runs without executed tools
- Improved provider-blocked capability demo behavior:
  - when prompt requests capability demonstration and provider is unavailable, shell executes non-destructive local tool demo as fallback and reports it explicitly
- Reworked live stream copy to be less generic and closer to operator console semantics:
  - tool preview lines now use `Working:` + explicit `Preview:`
  - action start lines now use `Start:`
  - action completion lines now use `Done:` / `Fail:` with output details
  - phase lines now use concise `[n] phase -> detail` formatting
- Improved outcome truthfulness:
  - if no tool calls were possible due to provider failure, summary now reports `execution blocked before tools` instead of generic `no tool actions executed`
- Added/updated regression coverage:
  - provider-failure lifecycle projection in `_run_prompt`
  - provider-blocked summary labeling
  - stream copy assertions for `Working:` and `Done:`/`Fail:` output

25. Session extension: anti-generic response and evidence-grounding refinements
- Refined tool-requirement policy by prompt intent:
  - conversational prompts no longer hard-force tool execution
  - task/system/factual prompts still drive tool-backed behavior
- Improved fallback demo safety profile:
  - provider-down capability demo now uses low-risk local checks (`pwd`, workspace write-check, `python3 --version`) instead of broad directory listing
- Improved outcome clarity with dual-status semantics:
  - `primary=failed(provider)` and `fallback=succeeded(x/y)` are now surfaced when applicable
- Strengthened post-tool response grounding:
  - when tools run and response lacks evidence references, shell injects compact evidence digest from executed actions
- Improved shell narration semantics:
  - shell tool purpose now derived from objective context (`verification`, `filesystem`, `diagnostics`, etc.) instead of one generic phrase

26. Session extension: truthful interactive event projection + routing integrity
- Interactive envelope projection in `src/tehuti_cli/ui/shell.py` now prefers real turn progress events over synthetic reconstruction when available:
  - uses recorded `tehuti.progress.v1` events captured during execution
  - preserves real event ordering and avoids fabricated loop/tool timeline artifacts
- Tool contract projection in interactive envelopes now carries per-action trace linkage when present:
  - `trace_id` sourced from runtime trace event
  - `contract_schema` sourced from runtime contract metadata
- Interactive result payload now uses dynamic runtime-derived metadata instead of static placeholders:
  - `iterations` derived from recorded `iteration_start` events
  - `parse_status` now reflects structured-vs-text path
  - `latency_ms` now projects measured turn elapsed timing
- Conversational prompt path now bypasses tool loop by default (while operational prompts still run tool-backed loop):
  - avoids unsolicited shell/tool execution for short non-operational chat
  - keeps provider error normalization on direct chat path
- Fixed slash dispatch correctness bug:
  - `/status-all` now routes to full status handler before `/status` prefix check
- Added regression coverage:
  - `test_handle_slash_routes_status_all_before_status`
  - `test_run_prompt_conversational_path_skips_tool_loop`
  - `test_emit_interactive_envelope_uses_recorded_progress_events_when_present`

27. Session extension: enforced tool-evidence truthfulness + lower-noise stream defaults
- Removed heuristic planning-style narration from standard interactive flow:
  - `analyze` phase detail now reports factual runtime state (`building turn context`) instead of inferred intent text.
  - execution phase detail now reflects actual path (`running model/tool loop` vs `requesting direct model response`).
- Reduced default end-of-turn noise:
  - turn digest line is now verbose-only (`Turn summary`) instead of always-on `Outcome` output.
  - metadata preamble (`Cycle`/`Next`) is now verbose-only.
- Added evidence enforcement for tool-required prompts:
  - when model returns final text with zero tool calls, shell now runs a non-destructive grounding probe (`shell pwd`) before final response.
  - final response is replaced with explicit evidence-backed notice and real command result snippet.
  - provider-failure paths remain unchanged and continue to surface normalized actionable provider errors.
- Added runtime stream truthfulness for enforcement path:
  - emits `recover` event with enforcement reason.
  - emits tool lifecycle events for enforced probe (`operate.start`/`operate.done`), plus live shell output chunk streaming.
- Added regression coverage:
  - `test_run_prompt_enforces_grounding_when_tool_mode_returns_no_actions`
  - updated progress/meta tests to assert verbose-only summary/meta behavior.
- CLI PTY transcript validation performed:
  - confirmed live `Working/Start/Stream/Done` command output for enforced grounding path.
  - confirmed zero fabricated tool-demonstration claims when model skips tool execution.

28. Session extension: intent-aware evidence enforcement profiles
- Replaced single-command enforcement fallback (`shell pwd`) with intent-aware non-destructive probe selection:
  - `repository` profile -> `git status --short 2>/dev/null || echo git_status_unavailable`
  - `filesystem` profile -> `pwd && ls -1 | head -n 12`
  - `diagnostics` profile -> `uname -s && whoami`
  - `runtime` profile -> `python3 --version 2>/dev/null || echo python3_unavailable`
  - `grounding` profile -> `pwd` (default)
- Enforcement lifecycle now carries profile metadata through stream events (`recover`, `operate.start`, `operate.done`) to improve downstream diagnostics and replay clarity.
- Grounded fallback response now includes selected profile + executed command so users can immediately audit why that evidence was chosen.
- Added regression coverage:
  - `test_select_evidence_probe_is_intent_aware`
  - existing no-tool enforcement test updated to assert grounded profile content.
- PTY transcript verification confirms live stream/event behavior remains operator-visible while enforcing tool truthfulness.

29. Session extension: parser hardening + UX/phase regression closure
- Hardened mixed-output JSON extraction in shell tool loop:
  - `_extract_json` now supports:
    - clean JSON object fast path
    - fenced JSON extraction with dict-type validation
    - mixed text scanning using `json.JSONDecoder.raw_decode` from each object start
  - reduces false negatives when model returns valid JSON plus surrounding explanatory text.
- Removed dead no-op shell hooks that were adding maintenance noise without runtime behavior:
  - removed `_print_status_indicator`
  - removed `_print_sequence_summary`
- Closed outstanding regression gaps highlighted in execution review:
  - added `/ux` no-arg cycling test across quiet -> standard -> verbose -> quiet
  - extended phase projection test to assert cross-surface attribution (`surface`) and normalized `phase_group`
  - added mixed-text JSON extraction regression test for tool-loop parsing resilience.

30. Session extension: manual tool path consolidation (`/run`)
- Refactored `/run` command execution flow to use `_execute_runtime_tool_with_feedback(...)` instead of ad-hoc per-tool `runtime.execute_with_tracing(...)` blocks.
- Reduced duplication across manual tool execution branches (`read`, `write`, `shell`, `fetch`, generic JSON args), keeping live preview/action/stream behavior consistent with core loop paths.
- Preserved manual argument validation and usage guidance while centralizing runtime feedback rendering and shell chunk streaming behavior in one path.

31. Session extension: deeper traced-execution convergence + parser prioritization
- Introduced shared traced execution helper in shell runtime path:
  - added `_execute_traced_tool(...)` for consistent busy-state handling, timeout application, shell chunk streaming callback wiring, and elapsed-time extraction.
- Migrated additional tool execution surfaces to the shared traced helper:
  - macro tool expansion path (`_run_macro_tool`)
  - probe path (`_run_probe_tool` via shared feedback helper)
  - model-loop tool execution calls in `_run_with_tools`
  - smoke validation path (`_smoke`)
- Hardened JSON payload extraction prioritization for mixed model output:
  - when multiple JSON objects exist, parser now prefers tool-relevant objects (`type`, `tool`, `tools`, `tool_calls`, `name`) over generic dicts.
- Added regression coverage:
  - `test_extract_json_prefers_tool_payload_over_generic_object`

32. Session extension: explicit task-awareness projection and focus interaction
- Added explicit per-turn task context projection at prompt start:
  - `task_context` progress event now records objective, tool-required mode, execution mode, and computed turn plan.
- Added interactive `/focus` command for operator visibility:
  - displays current objective, current phase, execution mode (`tool-backed` vs `direct-chat`), last prompt summary, minion counts, last-turn action count, and active turn plan.
- Added runtime phase-awareness fielding:
  - shell now tracks current phase via phase-stream emission and resets to `idle` after each turn completes.
- Added regression coverage:
  - `test_handle_slash_routes_focus_command`
  - conversational prompt test now asserts task-context progress event emission.

33. Session extension: degraded-success truthfulness + bounded live stream events
- Corrected provider-failure lifecycle semantics when local fallback demo succeeds:
  - interactive envelope now reports `status=success` for recovered turns instead of hard-failed projection
  - termination reason now differentiates recovered vs unrecovered provider failures:
    - `provider_failure_recovered`
    - `loop_exception`
  - phase stream now emits truthful completion path:
    - recovered path: `respond(done)` + `complete(done)` with degraded message
    - unrecovered path: existing error completion lifecycle unchanged
- Extended interactive envelope projection contract with explicit termination overrides:
  - optional `termination_reason` and `has_error` now flow into projected `loop_terminated` and result metadata
  - result payload now includes `degraded` boolean for recovered-provider turns
- Added bounded structured live output events from shell execution:
  - stream callback now records `tool_stream` progress events (`tool`, `output`) while printing live `Stream:` lines
  - bounded to a per-turn cap to prevent event flooding during long commands
- Reduced noisy failure wording in phase lines:
  - removed hardcoded `FAILED` suffix from phase labels; status remains conveyed by style/status field
- Added regression coverage:
  - `test_run_prompt_provider_failure_with_local_demo_projects_degraded_success`
  - `test_shell_stream_callback_records_bounded_tool_stream_events`
- Verified with PTY capture (`script -q -c '.venv/bin/tehuti'`) that provider-blocked turns now show:
  - real fallback command execution (`Working/Start/Stream/Done`)
  - truthful degraded completion (`turn finished in degraded mode`) rather than generic failure tail.

34. Session extension: degraded contract fixtures + conformance enforcement
- Added explicit degraded-success contract fixture for interactive CLI envelope:
  - `tests/fixtures/contracts/cli_interactive_degraded_success.json`
  - captures `status=success`, `termination_reason=provider_failure_recovered`, `degraded=true`, and `loop_terminated.has_error=false`
- Expanded interactive envelope contract tests:
  - validates recovered termination reason projection and degraded flag behavior in runtime-emitted envelopes.
- Expanded surface conformance runner outputs:
  - normalized interactive projections now include `degraded`
  - added dedicated degraded fixture path in runner output to ensure this lifecycle remains observable in CI diagnostics.
- Added transcript-style regression test for degraded stream semantics:
  - asserts no hardcoded `FAILED` marker leaks into degraded recovered path
  - asserts explicit degraded response/complete stream lines are rendered.
- Updated API contract docs to document degraded-success interactive envelope semantics and loop termination fields.

35. Session extension: degraded conformance promoted from reporting to hard gate
- Upgraded `scripts/surface_conformance_runner.py` to hard-fail if degraded interactive semantics drift.
- Added explicit runner checks for degraded fixture invariants:
  - `status=success`
  - `termination_reason=provider_failure_recovered`
  - `degraded=true`
  - interactive event order includes `loop_terminated`
  - no typed error payload fields on recovered degraded success
- Added script-level regression test:
  - `tests/test_surface_conformance_runner.py` now executes the conformance runner and validates degraded block projection from real script output.
- Result: degraded recovery behavior is now contract-reported, test-covered, and CI-enforced by the same surface conformance gate path.

36. Session extension: interactive UX transcript gate integrated into quality gate
- Upgraded `scripts/ux_session_test.py` into a stable transcript-style UX regression runner aligned with current shell semantics.
- Replaced stale stream expectations in non-PTY fallback:
  - `Intent/Plan/Thinking` -> `Cycle/Next`
  - added degraded provider-recovery stream assertion (`rendering degraded response...`, `turn finished in degraded mode`, no hardcoded `FAILED` marker)
- Made PTY-path checks provider/model-id agnostic:
  - status now validates contract fields (`Provider`, `Model`, `Session`) instead of model string literals
  - help checks include modern operator commands (`/focus`)
  - added `/ux quiet` and `/ux standard` command behavior checks
- Integrated runner into CI hard gate:
  - `scripts/quality_gate.sh` now executes `python3 scripts/ux_session_test.py` as `ux session transcript`
- Full quality gate validates this new step and passes end-to-end.

37. Session extension: live activity narration + adaptive operator stream hardening
- Added explicit activity narration lines in interactive shell action rendering:
  - each completed action now emits a concise operator-facing line such as:
    - `• Edited <path> (+N -M lines)`
    - `• Wrote <path> [size/line evidence]`
    - `• Explored <path>`
    - `• Executed shell -> <command>`
  - narration is derived from real tool args/results, not synthetic post-hoc summaries.
- Phase stream lines now include explicit status symbols and clearer separators:
  - format moved from plain `[n] phase -> detail` to symbolized lifecycle rendering
  - improves quick readability while preserving existing structured event contract fields.
- Turn meta stream is now more adaptive:
  - `Cycle` line now reflects request traits + execution posture
  - `Guardrails` line added to expose current shell/write/external state for each turn.
- Evidence panel rendering default changed to stream-first behavior:
  - large `Evidence` panels now render in verbose mode only
  - standard mode keeps inline/live stream output concise and avoids oversized dumps.
- Busy-state truthfulness hardened across full turn lifecycle:
  - introduced depth-safe busy tracking (`_busy_enter`/`_busy_exit`)
  - shell status no longer flips to `ready` mid-turn while work is still in progress.
- UX transcript runner hardened for full-access default posture:
  - `scripts/ux_session_test.py` no longer assumes permission-deny behavior in all environments
  - duplicate-count assertion replaced with visibility assertion for PTY redraw-safe reliability.
- Validation:
  - `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 .venv/bin/pytest -q tests/test_shell_progress.py tests/test_cli_interactive_envelope_contract.py tests/test_surface_conformance_runner.py` passed.
  - `python3 scripts/ux_session_test.py` passed.
  - real PTY capture confirmed live stream now includes activity narration lines.

38. Session extension: structured activity stream projection (`tehuti.activity.v1`)
- Added dedicated per-turn `activity_events` projection in CLI interactive envelopes.
- Activity events are derived from executed actions and include:
  - `tool`
  - `success`
  - concise `summary` (same operator narrative used in live stream bullets).
- This separates operator narration from low-level progress lifecycle events:
  - existing `events` ordering contract remains stable (`iteration/tool/loop` events)
  - activity remains machine-readable for replay/debug UX and future wire/web parity work.
- Updated API contract docs for interactive envelopes to include `activity_events`.
- Added regression tests for:
  - action-line activity capture
  - envelope projection including `activity_events` when present.

39. Session extension: wire/web activity parity for agent-task surfaces
- Extended wire and web agent-task envelopes to project structured `activity_events` derived from `tool_end` progress events.
- Surface behavior now aligned:
  - `tehuti.cli.prompt.v1`: includes `activity_events`
  - `tehuti.wire.v1` (`mode=agent_task` result block): includes `activity_events`
  - `tehuti.web.agent_task.v1`: includes top-level `activity_events`
- Prompt-mode wire responses now include empty `activity_events` list for stable shape parity.
- Updated surface conformance normalizers and checks:
  - added `activity_count` normalization
  - conformance now fails if CLI/Wire/Web activity counts drift.
- Added/updated regression coverage:
  - wire contract and wire agent-task contract assertions for `activity_events`
  - web API contract assertions for `activity_events`
  - CLI prompt envelope contract assertions for `activity_events`
  - surface conformance test assertions for parity on `activity_count`.

40. Session extension: live wire-stream activity events
- Wire streaming path (`tehuti wire` with `stream=true`) now emits derived structured activity events in-flight:
  - envelope schema remains `tehuti.wire.progress.v1`
  - nested event schema is `tehuti.activity.v1`
  - emitted when `tool_end` progress arrives (success/failure summary line projected).
- This provides real-time operator narration to external stream consumers before final payload completion.
- Sequence semantics:
  - activity stream events are interleaved in the same monotonic sequence as progress stream events.
- Updated contracts/tests:
  - documented wire activity stream example in API contracts
  - updated `tests/test_wire_progress_stream.py` to assert activity stream emission and shape.

41. Session extension: command-aware live shell narration and meta stream cleanup
- Removed stale templated turn meta labels from interactive verbose stream:
  - `Cycle`/`Next` replaced by `Focus`/`Trace` to avoid synthetic plan text and better match real turn intent.
- Hardened shell preview relevance projection to be command-aware instead of objective-only:
  - examples now map truthfully in live stream (`pwd` -> working directory check, `pytest` -> verification, `python --version` -> runtime availability, `test -w` probes -> workspace write access).
- This reduces generic/hardcoded operator copy and keeps progress narration grounded in actual tool arguments.
- Updated regression coverage:
  - `tests/test_shell_progress.py` now validates command-aware shell relevance mapping.
  - `scripts/ux_session_test.py` now validates `Focus`/`Trace` turn-meta labels in transcript checks.
- Validated via real interactive PTY capture:
  - `script -q -c "printf 'tell me about your capabilities and demonstrate some non destructive\n/exit\n' | .venv/bin/tehuti" /tmp/tehuti_cli_capture_after.txt`
  - output confirms live stream shows command-specific narration during degraded fallback execution.

42. Session extension: pre-push sensitive exposure guard + artifact hardening
- Added staged-change security guard:
  - `scripts/check_sensitive_exposure.py`
  - blocks staged commits containing:
    - environment/cache/runtime artifact paths (`.venv`, `__pycache__`, `.pytest_cache`, `.mypy_cache`)
    - local runtime/session artifact paths (`.tehuti*`)
    - direct secret-bearing path shapes (`.env`, `keys.env`, private key suffixes)
    - high-confidence secret/token signatures and key-assignment patterns in staged file content.
- Integrated guard into quality gate:
  - `scripts/quality_gate.sh` now runs `python3 scripts/check_sensitive_exposure.py --strict`.
- Added regression tests for guard behavior:
  - `tests/test_sensitive_exposure_guard.py` covers forbidden path detection, placeholder allowlist behavior, and private key/token detection patterns.
- Hardened ignore/hygiene posture for local runtime activity:
  - `.gitignore` now explicitly ignores `.tehuti_ci_probe/`, `.tehuti_test_home/`, `.tehuti_test_sessions/`.
  - `scripts/check_release_hygiene.py` now treats `.tehuti/` and `.tehuti_test_home/` as noisy artifact prefixes.

## Remaining Known Risks

1. Provider-reported actual token/cost data still depends on upstream provider support; fallback classification is now explicit.

## Related Docs

- `RELEASE_NOTES_2026-02-12.md`
- `OUTPUT_POLICY_AUDIT_2026-02-12.md`
- `EXECUTION_TRACKER.md`
- `LOOP_STATE_TABLE.md`
- `RETRY_BACKOFF_POLICY.md`
- `adr/0001-runtime-foundation-and-capability-parity.md`
