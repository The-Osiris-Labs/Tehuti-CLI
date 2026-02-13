# Maintainer Map

This file is the practical map for making large Tehuti changes safely.

## Canonical Sources

1. Current implementation status: `docs/EXECUTION_TRACKER.md`
2. Contract schemas/envelopes: `docs/API_CONTRACTS.md`
3. Cross-surface parity posture: `docs/PARITY_MATRIX.md`
4. Contract governance policy: `docs/CONTRACT_GOVERNANCE.md`
5. Session and release history:
   - `docs/SESSION_CHANGES_2026-02-12.md`
   - `docs/RELEASE_NOTES_2026-02-12.md`
6. Archived planning context (non-canonical): `docs/archive/`

## Product Surfaces and Entry Points

1. CLI entrypoint and command wiring: `src/tehuti_cli/cli.py`
2. Interactive shell UX:
   - `src/tehuti_cli/ui/shell.py`
   - `src/tehuti_cli/ui/interactive.py` (legacy compatibility path; keep session behavior consistent)

Interactive ownership rule:
- Primary user-facing shell behavior and contract parity work must target `src/tehuti_cli/ui/shell.py`.
- `src/tehuti_cli/ui/interactive.py` is compatibility-only; keep resume/load/save behavior correct but avoid adding new primary UX flows there.
3. Web API and basic web UI: `src/tehuti_cli/web/app.py`
4. Runtime app bootstrap: `src/tehuti_cli/core/app.py`

## Runtime and Execution Core

1. Tool dispatch, sandboxing, approvals, contracts:
   - `src/tehuti_cli/core/runtime.py`
2. Tool metadata model and registry:
   - `src/tehuti_cli/core/tools.py`
3. Agent loop lifecycle, parser modes, termination reasons:
   - `src/tehuti_cli/core/agent_loop.py`
4. High-level agent orchestration:
   - `src/tehuti_cli/agentic.py`
5. Typed error model and envelope projection:
   - `src/tehuti_cli/core/errors.py`

## State, Session, and Memory

1. Config schema and policy coercion:
   - `src/tehuti_cli/storage/config.py`
2. Tehuti home and path resolution:
   - `src/tehuti_cli/storage/paths.py`
3. Session persistence (`context.jsonl`, `wire.jsonl`):
   - `src/tehuti_cli/storage/session.py`
4. Semantic memory, summarization, retrieval fusion:
   - `src/tehuti_cli/core/memory.py`
5. Checkpoint and planning storage:
   - `src/tehuti_cli/storage/checkpoint.py`
   - `src/tehuti_cli/storage/planning.py`

## Provider and Protocol Integrations

1. Provider abstraction and usage normalization:
   - `src/tehuti_cli/providers/llm.py`
2. Provider-specific adapters:
   - `src/tehuti_cli/providers/openrouter.py`
   - `src/tehuti_cli/providers/openai.py`
   - `src/tehuti_cli/providers/gemini.py`
3. MCP integration:
   - `src/tehuti_cli/mcp_tools.py`
4. A2A client and typed protocol errors:
   - `src/tehuti_cli/core/a2a_client.py`

## Contracts, Fixtures, and Tests

1. Contract fixtures: `tests/fixtures/contracts/`
2. Contract and parity tests:
   - `tests/test_contract_fixtures.py`
   - `tests/test_surface_conformance_runner.py`
   - `tests/test_contract_parity.py`
3. Tool contract path enforcement:
   - `tests/test_contract_path_enforcement.py`
4. Protocol lifecycle and retry parity:
   - `tests/test_protocol_lifecycle_conformance.py`
   - `tests/test_retry_semantics_parity.py`
5. Metrics and preflight contracts:
   - `tests/test_metrics_contract.py`
   - `tests/test_preflight.py`

## Release and Gate Tooling

1. Primary quality gate: `scripts/quality_gate.sh`
2. Governance and drift checks:
   - `scripts/check_adr_required.py`
   - `scripts/check_docs_drift.py`
   - `scripts/check_contract_coverage.py`
   - `scripts/check_version_consistency.py`
3. Conformance and safety:
   - `scripts/surface_conformance_runner.py`
   - `scripts/check_migration_safety.py`
4. Perf and operations:
   - `scripts/perf_smoke.py`
   - `scripts/perf_sustained.py`
   - `scripts/perf_long_session.py`
   - `scripts/perf_memory_relevance.py`
5. Release hardening:
   - `scripts/canary_gate.py`
   - `scripts/rollback_drill.py`
   - `scripts/rollback_one_command.py`
   - `scripts/check_release_hygiene.py`

## Change Playbook (Large Changes)

1. Modify runtime behavior in code.
2. Update or add contract fixtures in `tests/fixtures/contracts/` for visible schema changes.
3. Update contract docs in `docs/API_CONTRACTS.md`.
4. Update parity posture in `docs/PARITY_MATRIX.md` if cross-surface behavior changed.
5. Add/update ADR under `docs/adr/` for contract-shape/breaking changes.
6. Run `bash scripts/quality_gate.sh`.
7. Update release/session docs for notable behavior changes.

## Anti-Clash Rules

1. Never introduce new production tool paths that bypass `execute_contract`.
2. Keep typed error fields stable across surfaces:
   - `category`
   - `code`
   - `message`
   - `retryable`
3. Treat `docs/EXECUTION_TRACKER.md` as the single current status source.
4. Keep archived planning docs in `docs/archive/`; do not treat them as active backlog.
5. Keep package versions synchronized:
   - `pyproject.toml` `version`
   - `src/tehuti_cli/__init__.py` `__version__`
