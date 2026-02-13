# Contract Governance

## Rule
Any change that affects externally visible contract behavior must include:
1. Schema/fixture updates.
2. Compatibility tests.
3. Documentation updates.
4. An ADR entry under `docs/adr/`.

## Contract Scope
- `tehuti.progress.v1`
- `tehuti.tool_result.v1`
- `tehuti.agent_task.v1`
- `tehuti.metrics.v1`
- `tehuti.preflight.v1`
- CLI/Wire/Web envelope schemas documented in `docs/API_CONTRACTS.md`

## Semver Policy
1. Patch: non-breaking internal/runtime fixes; no contract shape change.
2. Minor: additive backward-compatible contract fields.
3. Major: breaking shape/semantic changes; require new schema version namespace.

## Required Evidence in PR
1. Updated fixtures in `tests/fixtures/contracts/` when contract-visible behavior changes.
2. Passing contract/parity tests.
3. ADR reference for contract-breaking or contract-shape changes.

## Enforcement
CI enforces:
1. ADR requirement for contract changes.
2. Contract fixture and parity tests.
3. Docs drift check for schema references.
