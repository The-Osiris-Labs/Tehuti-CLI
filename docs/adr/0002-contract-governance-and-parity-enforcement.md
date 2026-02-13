# ADR 0002: Contract Governance and Parity Enforcement

## Status
- Accepted

## Context
- Tehuti requires stable contract behavior across CLI, wire, and web surfaces.
- Existing enforcement relied on partial/static checks and allowed drift between runtime schema usage, docs, and fixtures.
- Protocol failures (especially A2A/MCP paths) needed typed error alignment with the global failure taxonomy.

## Decision
- Introduce dynamic governance checks that detect contract-sensitive changes from git diff content and require ADR updates.
- Enforce contract coverage by scanning runtime schema IDs and validating:
  - documentation presence (`docs/API_CONTRACTS.md`)
  - fixture presence (`tests/fixtures/contracts/`)
- Promote parity by projecting normalized `tool_contracts` summaries in CLI and web envelopes.
- Standardize protocol failure typing by introducing `ProtocolError` and mapping A2A transport/payload failures to stable codes.
- Add deterministic performance smoke checks and capability baseline tests to block regressions toward reduced behavior.

## Consequences
- CI now blocks merges when contract docs/fixtures drift from runtime behavior.
- Consumers can rely on explicit `tool_contracts` fields instead of event scraping.
- Protocol failure handling is more predictable for operations and downstream automation.

## Validation
- Added/updated checks:
  - `scripts/check_adr_required.py`
  - `scripts/check_docs_drift.py`
  - `scripts/check_contract_coverage.py`
  - `scripts/perf_smoke.py`
  - `scripts/quality_gate.sh`
- Added fixtures under `tests/fixtures/contracts/`.
- Added regression tests for:
  - protocol error typing
  - deterministic context/memory behavior
  - capability baseline and contract projection behavior

## Rollback Plan
- Revert CI checks and envelope additions independently if integration issues arise.
- Retain schema fixture corpus to preserve contract history.
- Re-run quality gate and parity fixture after rollback to verify consistency.
