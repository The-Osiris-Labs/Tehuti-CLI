# Release Notes - 2026-02-12

## Highlights

- Contract-first runtime and surface behavior now enforced across CLI/wire/web paths.
- Better real-time execution visibility with state-derived progress outputs.
- Deterministic runtime preflight checks integrated into startup paths.
- Explicit access policy contract (`access_policy`) added.
- Agent loop termination reason codes and parser modes introduced.
- Versioned tool result contract (`tehuti.tool_result.v1`) introduced and expanded.
- Surface conformance and performance gates tightened in CI.
- Remaining execution-plan priorities are now integrated and validated in quality gate.

## Output Integrity Improvements

- Removed canned execution-result phrasing in key runtime paths.
- Fallback responses now reflect actual tool evidence/output.
- Runtime write/edit operations now report dynamic summaries.
- Intent/plan/execution summary UI copy now derives from live prompt/runtime state.
- Removed specific hardcoded low-quality UI text in shell intent/summary flows.

## Reliability and Runtime Foundation

- Added typed error categories and structured error payloads for CLI/web.
- Added preflight diagnostics in `doctor` (runtime, deps, writable paths, tool registry).
- Added deterministic startup gating in shell/print/web execution paths.
- Improved parser and termination metadata persistence per turn.

## Agent and Tool Execution Integrity

- Agent loop emits explicit lifecycle events:
  - `iteration_end`
  - `loop_terminated`
  - `loop_error`
- Loop persists parse/execution metadata per turn.
- Tool runtime returns normalized execution envelope with:
  - trace id
  - latency
  - idempotency/risk/approval/retry metadata
  - normalized error classification
- Smart approval mode now uses per-tool metadata for known tools (not name heuristics).

## API, Protocol, and Metrics Contracts

- Stable wire response contract: `tehuti.wire.v1`.
- Stable wire progress stream contract: `tehuti.wire.progress.v1`.
- Stable CLI non-interactive response contract: `tehuti.cli.prompt.v1`.
- Stable web response contracts:
  - `tehuti.web.prompt.v1`
  - `tehuti.web.agent_task.v1`
- Web envelopes now include stable `trace_id` and `turn_id` on success and failure paths.
- Stable task contract: `tehuti.agent_task.v1`.
- Stable metrics contract and endpoints:
  - `GET /api/metrics` (`tehuti.metrics.v1`)
  - `GET /metrics` (Prometheus-style text)
- Added token/cost estimate and provider-backed actual usage telemetry fields.
- Added explicit actual-usage source fields in task outputs:
  - `token_actual_source`: `provider|estimate_fallback`
  - `cost_actual_source`: `provider|estimate_fallback`
- Added failure retryability parity checks across CLI/wire/web contracts.

## MCP and A2A Hardening

- MCP errors now map to typed classes for timeout/auth/not-found/invalid-payload/transport conditions.
- Runtime MCP configure dispatch fixed to pass `servers` and `output_path` correctly.
- A2A payload validation hardened:
  - invalid/missing `result` and `status` handling
  - strict `status.state` requirements
  - non-object stream payload rejection
  - typed error mapping for cancel/status/send flows
- Added protocol conformance tests for these scenarios.
- Added lifecycle conformance tests for discovery/invoke/stream/cancel/resume and concurrent partial-failure handling.

## Quality Gate Expansion

- Added/expanded mandatory checks:
  - contract coverage
  - docs drift
  - contract diff changelog
  - tool metadata lint
  - cross-surface conformance runner
  - rollback drill
  - rollback one-command coverage (binary/config/schema toggles)
  - canary promotion gate (error-budget + latency threshold checks)
  - strict release hygiene (artifact churn blocker)
  - performance: smoke + sustained + long session + memory relevance
  - critical runtime/protocol/parity tests

## Session Extension Hardening (Post-closure)

- Interactive CLI envelope contract parity tightened:
  - `trace_id`/`turn_id` now projected in `tehuti.cli.interactive.v1`
  - typed interactive failure envelope aligned with wire/web (`category`, `code`, `message`, `retryable`, `details`)
  - interactive `tool_contracts` projection added
- Runtime retry/backoff now explicitly parameterized and metadata-aware:
  - config fields for retry and stuck-loop backoff budgets
  - per-tool retry delay adapts by idempotency class
- Agent loop transition policy formalized as explicit, test-backed constant (`LOOP_STATE_TRANSITIONS`) and documented state table.
- Legacy interactive compatibility path session persistence fixed (load/save/resume correctness).
- Release hygiene enforcement refined to block staged noise while tolerating local unstaged artifact churn in strict mode.
- Added scheduled/manual full dependency confidence workflow:
  - `.github/workflows/full-deps-gate.yml`
- Added policy/reference docs:
  - `docs/LOOP_STATE_TABLE.md`
  - `docs/RETRY_BACKOFF_POLICY.md`

## Session Extension Operations Upgrade

- Added runtime policy consistency enforcement:
  - `scripts/check_runtime_policy_consistency.py`
  - integrated into `scripts/quality_gate.sh`
- Surface conformance runner now includes interactive CLI envelope checks (`cli_interactive`):
  - ID projection
  - typed error parity
  - deterministic event ordering
- Added diagnostics API for correlated debugging:
  - `GET /api/metrics/diagnostics` (`tehuti.diagnostics.v1`)
  - `tehuti.metrics.v1` now includes `diagnostics_recent`
- Added SLO baseline guidance:
  - `docs/SLO_BASELINES.md`
- Expanded full dependency workflow coverage:
  - added policy, protocol, and provider-focused checks in `.github/workflows/full-deps-gate.yml`
- Added local artifact cleanup utility:
  - `scripts/clean_dev_artifacts.py`

## Session Extension UX Stabilization

- Interactive shell now prefers compact, lower-noise behavior for routine chat turns:
  - startup stays compact when banner is disabled
  - intent/execution meta tables are suppressed for short casual prompts unless tool evidence exists
- Unknown slash commands now return immediate command guidance instead of being sent to the model.
- `/exit` path now exits without emitting internal unclassified error payloads.
- Provider limit/billing/rate-limit failures are now surfaced as user-readable guidance rather than raw provider blobs.
- Temporary model fallback notices are now informational (dim note) instead of warning-noise.
- Shell startup no longer force-overwrites user preference controls (`approval_mode`, `execution_mode`, `show_actions`) under full policy.
- Regression coverage expanded for interactive UX behavior:
  - `tests/test_cli_main_flow.py`
  - `tests/test_shell_progress.py`
  - `tests/test_provider_usage_normalization.py`

## Session Extension UX Ergonomics (Deep Pass)

- Added typo-aware slash-command suggestions for unknown commands, preventing dead-end command UX.
- Added `/ux` preset command (`quiet|standard|verbose`) to apply coordinated interaction profiles:
  - action log visibility
  - progress verbosity
  - tool output compactness
  - startup history visibility
- Added `/ux` cycling (no argument) for rapid profile switching during active sessions.
- Updated help/registry surfaces to include `/ux` as a first-class operator control.
- Added targeted tests for command suggestion and UX preset guardrails.

## Session Extension Identity + Streaming UX Pass

- Restored identity-forward startup default by enabling banner by default in interactive CLI startup.
- Upgraded compact startup path to keep Tehuti/Thoth identity framing visible even without full banner mode.
- Removed table-centric per-turn presentation:
  - `Intent` table replaced by stream lines (`Intent`, `Plan`, optional `Active`)
  - `Execution Summary` table replaced by single digest line
- Improved operator visibility during execution:
  - removed spinner wrapper that obscured live tool activity
  - ensured tool result lines stream continuously during execution across tool-call paths
- Added tests covering stream-line intent rendering and digest output behavior.

## Session Extension Dynamic Phase Stream

- Added dynamic, sequenced phase-stream telemetry for interactive execution with timing metadata.
- Runtime now emits adaptable phase lifecycle events across any request/tool sequence:
  - request lifecycle phases (`intake`, `analyze`, `execute`, `synthesize`, `respond`, `complete`)
  - tool lifecycle subphases inferred by operation class (`inspect`, `mutate`, `execute`, `retrieve`, `session`, fallback `tool`)
- Added status-aware phase outcomes (`progress`, `done`, `error`) with structured wire persistence.
- Added contract artifact:
  - documented `tehuti.phase_stream.v1` in `docs/API_CONTRACTS.md`
  - fixture: `tests/fixtures/contracts/phase_stream_event.json`
- Updated contract baseline/changelog to keep CI governance strict for new phase events.

## Session Extension Adaptive Phase Policy + Timeline Replay

- Added centralized phase-stream policy module:
  - stable status normalization (`progress|done|error|skipped`)
  - stable `phase_group` derivation for filtering and aggregations
  - verbosity-aware render policy for low-noise and high-fidelity modes
  - metadata-aware tool lifecycle mapping resilient to expanding tool inventory
- Interactive shell phase events now include:
  - `event_version`
  - `surface`
  - `phase_group`
- Interactive envelope projection now includes `phase_events` so each turn can be replayed as a full lifecycle timeline.
- Updated docs/fixtures/parity tracking for the expanded phase-stream contract.

## Session Extension Cross-Surface Phase Projection

- Wire and web agent-task responses now include `phase_events` projected from agent-loop progress.
- Added optional wire live phase-stream projection (`stream_phase=true`) over `tehuti.wire.progress.v1`.
- Projection uses centralized policy (`core.phase_stream`) so lifecycle mapping remains consistent as new events and tools are added.

## Session Extension Evidence Integrity + Reconciliation

- Added evidence-gated finalization path for autonomous agent tasks (`require_tool_evidence`).
- Added explicit insufficient-evidence termination handling in agent loop.
- `TehutiAgent` now enriches prompts with fused memory context and uses context manager interaction capture in task/chat flows.
- Sensitive-memory redaction now avoids embedding raw sensitive text.
- Agent-task result contract now includes reconciliation counters for task/workflow closure tracking.

## Session Extension Cycle Stream Deepening

- Refined interactive turn framing labels:
  - `Intent` -> `Cycle`
  - `Plan` -> `Next`
  - `Digest` -> `Outcome`
- Tightened phase stream readability by replacing `phase[n]` formatting with concise ordered stream lines (`[n] <phase>`).
- Added explicit model lifecycle visibility in live stream:
  - `analyze.model.start` emitted before each LLM request
  - `analyze.model.done` emitted after response receipt
  - applied to initial, retry, schema-repair, and post-tool synthesis paths
- Added provider-error payload normalization in shell loop so billing/spend-limit/model-unavailable responses are surfaced as actionable guidance instead of raw JSON blobs.
- Added startup preflight hints at welcome time for:
  - missing provider API credentials (`/setup`/`/login` guidance)
  - free-tier model reliability caveat
- Fixed `run_once(\"/exit\")` slash handling to close cleanly rather than bubbling `EOFError`.
- Added regression coverage for:
  - updated turn framing labels in shell tests
  - model phase start/done emission behavior

## Session Extension Runtime Portability Hardening

- Removed hard `numpy` requirement from memory vector math path (`core/memory.py`) by switching normalization and cosine similarity to pure-Python math.
- This keeps memory/context features functional in constrained environments where optional ML stack deps are unavailable.
- Verified targeted suites for shell/phase/agent/wire/web UX contracts in constrained mode using `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1`.

## Session Extension Orphan-Capability Cleanup

- Removed unused imports in `ui/shell.py` to reduce dead code surface.
- Registered previously hidden-but-implemented slash commands in shell command registry (`/run`, `/help`, `/allow-all`, `/lockdown`, `/grounding`, `/history`, `/profile`, `/quit`) so discoverability matches runtime capability.
- Added regression test to lock command-registry discoverability for key operator commands.
- Confirmed no duplicate function-definition shadowing detected in `src/tehuti_cli` structural audit.

## Session Extension Truthful Tool-Stream Logic

- Fixed interactive lifecycle logic so provider/model failures are not reported as successful execute/respond turns.
- Added provider-unavailable local fallback demo for capability-demonstration prompts using real non-destructive tools (when permitted), with explicit operator-facing labeling.
- Reworked stream wording toward operational console style:
  - `Working:` / `Preview:`
  - `Start:`
  - `Done:` / `Fail:`
  - concise phase lines: `[n] phase -> detail`
- Updated outcome summary semantics to report `execution blocked before tools` for provider-blocked turns.

## Session Extension Evidence-True Response Behavior

- Relaxed hard-force tool policy for purely conversational prompts while preserving tool-backed execution for operational/factual prompts.
- Replaced broad fallback listing demo with safer non-destructive checks for provider-down capability demonstrations.
- Added dual-status outcome projection for provider-failure turns with fallback execution (`primary` vs `fallback` result visibility).
- Added automatic evidence digest injection when tools were executed but model final text is generic/non-grounded.
- Improved shell activity narration to derive command purpose from objective context rather than generic static wording.

## Session Extension Interactive Truthfulness and Dispatch Corrections

- Interactive envelopes now prefer recorded per-turn progress events when available, instead of reconstructing all progress from final action list only.
- Interactive result metadata now projects runtime-derived values (`iterations`, `parse_status`, `latency_ms`) instead of static placeholders.
- Interactive tool-contract projection now preserves per-action trace linkage (`trace_id`, `contract_schema`) when runtime provides it.
- Conversational prompts now use direct response path (no tool loop by default), reducing unsolicited tool execution noise while keeping operational prompts tool-backed.
- Fixed slash command routing precedence so `/status-all` no longer gets shadowed by `/status`.
- Added regression tests for:
  - `/status-all` routing precedence
  - conversational no-tool prompt path
  - recorded progress event projection in interactive envelope

## Session Extension Enforced Tool-Evidence and Stream Noise Reduction

- Interactive stream defaults now prioritize factual runtime projection over inferred plan narration.
- Standard mode no longer prints end-of-turn digest lines; turn summary is verbose-only.
- Tool-required prompts are now evidence-enforced:
  - if model returns final text without issuing tools, Tehuti runs a non-destructive grounding probe (`shell pwd`) and returns the real result instead of model-only claims.
- Enforcement path emits explicit `recover` + tool lifecycle events and supports live shell chunk streaming.
- Added regression test coverage for tool-evidence enforcement and verbosity-gated summary behavior.
- Verified via real PTY CLI transcript that:
  - live execution stream is visible (`Working`, `Start`, `Stream`, `Done`)
  - fabricated tool-demonstration text is replaced by actual executed evidence when needed.

## Session Extension Intent-Aware Evidence Profiles

- Evidence enforcement now selects non-destructive probes by request intent instead of always using a single grounding command.
- Profiles implemented:
  - `repository`, `filesystem`, `diagnostics`, `runtime`, `grounding` (default).
- Enforcement stream events now include profile context, and final grounded responses include both selected profile and executed command for auditability.
- Added regression tests validating profile selection and grounded response projection.

## Session Extension Parser and Phase-Attribution Hardening

- Interactive tool-loop JSON extraction is now more robust for mixed model output (plain JSON, fenced JSON, and embedded JSON in surrounding text).
- Removed dead no-op sequence/status shell hooks to reduce maintenance drift in interactive runtime code.
- Added regression coverage for:
  - `/ux` no-arg preset cycling behavior
  - phase-event projection surface/group attribution
  - mixed-text JSON extraction in tool-loop parsing.

## Session Extension Manual Tool Execution Consolidation

- `/run` manual tool execution paths now reuse a shared runtime feedback helper instead of maintaining duplicated per-tool execution code.
- This aligns manual execution behavior with the main interactive loop for preview/start/stream/result rendering and reduces drift risk.

## Session Extension Traced Execution Convergence

- Added shared traced execution helper in interactive shell runtime and migrated additional call paths (macro expansion, probes, model-loop tool calls, smoke checks) to this common execution primitive.
- This reduces runtime-call fragmentation and keeps busy-state, shell stream callback wiring, timeout semantics, and elapsed-time capture consistent.
- JSON extraction now prioritizes tool-relevant objects when mixed responses contain multiple JSON objects.

## Session Extension Task Awareness and Focus Interaction

- Added explicit per-turn `task_context` progress event projection so task intent/mode/plan are captured in turn telemetry.
- Added `/focus` interactive command to expose live objective/phase/mode/recent-action context to users while Tehuti is operating.
- Shell phase tracking now resets deterministically to `idle` between turns.

## Session Extension Degraded-Success Lifecycle and Stream Event Hardening

- Provider-failure turns that recover with local non-destructive demo evidence now project as truthful degraded success instead of unconditional failure.
- Interactive envelope projection now supports explicit lifecycle override fields:
  - `termination_reason` (`final_response`, `loop_exception`, `provider_failure_recovered`)
  - `has_error` override for consistent downstream interpretation
- Interactive result contract now includes `degraded` boolean for recovered-provider turns.
- Shell live output callback now emits bounded structured `tool_stream` progress events while printing real-time stream lines.
- Phase-line copy no longer appends hardcoded `FAILED` text; status semantics remain in structured phase status and styling.
- Added regression tests for degraded-success lifecycle and bounded stream-event projection.

## Session Extension Degraded Contract and Conformance Lock-In

- Added explicit contract fixture for recovered degraded interactive envelopes (`provider_failure_recovered` + `degraded=true`).
- Surface conformance runner now reports a dedicated degraded interactive fixture path and normalizes `degraded` status in interactive results.
- Added transcript-style regression asserting degraded stream output is truthful (`rendering degraded response...`, `turn finished in degraded mode`) and free of stale hardcoded `FAILED` markers.
- Updated API contracts doc with degraded-success envelope example and `loop_terminated` semantics (`termination_reason`, `has_error`).

## Session Extension Degraded Conformance Hard-Fail Enforcement

- Surface conformance runner now hard-fails on degraded lifecycle drift (not report-only).
- Enforced degraded interactive invariants in runner:
  - success status with recovered termination reason
  - degraded flag true
  - expected interactive event order including `loop_terminated`
  - no error-category/code/retryable projection on recovered degraded success
- Added a script-level test executing the runner and validating degraded projection from live runner output.

## Session Extension UX Transcript Gate in CI

- Upgraded and stabilized `scripts/ux_session_test.py` as a transcript-style UX regression check.
- Updated UX assertions to current shell behavior (`Cycle/Next` framing, degraded recovery stream semantics, provider-agnostic status checks).
- Added `/ux` preset checks (`quiet`, `standard`) to transcript validation.
- Integrated UX transcript runner into `scripts/quality_gate.sh` as a required gate stage.

## Session Extension Live Operator Stream and Activity Narration

- Interactive action rendering now emits explicit operator narration lines (`• Edited`, `• Wrote`, `• Explored`, `• Executed`) derived from real tool execution context.
- Phase stream line rendering now uses explicit status symbols for faster scanability during long turns.
- Turn meta output is more adaptive and now includes per-turn guardrail visibility (`shell/write/external`).
- Evidence panel policy changed to stream-first defaults:
  - large `Evidence` panels are verbose-mode only
  - standard mode prioritizes concise live stream readability.
- Busy-state tracking now uses depth-safe lifecycle handling, preventing false `ready` status while a turn is still active.
- UX transcript regression runner now supports full-access default behavior and PTY redraw noise:
  - deny-path assertion no longer assumes restricted posture in all environments
  - execution visibility assertion no longer relies on brittle single-occurrence counting.

## Session Extension Structured Activity Events

- CLI interactive envelopes now include `activity_events` with schema `tehuti.activity.v1`.
- Activity summaries are generated from real executed actions and expose the same operator-facing narrative in structured form.
- Progress lifecycle events remain unchanged; activity is projected in a dedicated list for compatibility and replay tooling.

## Session Extension Cross-Surface Activity Parity

- Added `activity_events` projection to:
  - CLI prompt envelope (`tehuti.cli.prompt.v1`)
  - wire agent-task result block (`tehuti.wire.v1`)
  - web agent-task envelope (`tehuti.web.agent_task.v1`)
- Surface conformance runner now normalizes and checks `activity_count` parity across CLI/Wire/Web success fixtures.
- Contract tests updated to enforce activity stream presence and shape on all relevant surfaces.

## Session Extension Wire Activity Streaming

- `tehuti wire` streaming mode now emits derived `tehuti.activity.v1` events via `tehuti.wire.progress.v1` envelopes during execution.
- Activity stream events are emitted from `tool_end` progress updates with monotonic sequence ordering and tool-level summaries.
- This enables real-time activity rendering for stream consumers without waiting for final envelope completion.

## Session Extension Command-Aware Shell Narration

- Interactive turn-meta stream now uses `Focus`/`Trace` labels instead of templated `Cycle`/`Next` phrasing.
- Live shell tool narration is now command-aware and maps common commands to truthful operator intent:
  - `pwd` -> working directory confirmation
  - `pytest`/test commands -> verification runs
  - version probes -> runtime availability checks
  - workspace write probes (`test -w ...`) -> write-access validation
- Regression checks updated:
  - `tests/test_shell_progress.py` for command-aware shell relevance
  - `scripts/ux_session_test.py` for updated turn-meta transcript semantics

## Session Extension Sensitive Exposure Guard

- Added `scripts/check_sensitive_exposure.py` to block staged commits that include:
  - environment/cache/runtime artifacts (`.venv`, `__pycache__`, `.pytest_cache`, `.mypy_cache`)
  - local runtime/session artifacts (`.tehuti*`)
  - secret-bearing file shapes (`.env`, `keys.env`, private key suffixes)
  - high-confidence secret/token signatures and explicit key assignments.
- Integrated into required CI gate:
  - `scripts/quality_gate.sh` now runs `python3 scripts/check_sensitive_exposure.py --strict`.
- Added regression coverage in `tests/test_sensitive_exposure_guard.py`.
- Hardened local artifact posture:
  - `.gitignore` expanded for `.tehuti_ci_probe/`, `.tehuti_test_home/`, `.tehuti_test_sessions/`
  - release-hygiene noise prefixes now include `.tehuti/` and `.tehuti_test_home/`.

## Operational Docs

- Added/updated operator and troubleshooting runbooks.
- Added comprehensive project execution plan.
- Added output policy audit document.
- Added ADR for runtime/capability design decisions.
- Added executable plan tracker with stream-level status and gates.
