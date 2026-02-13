# Release Channels and Rollback Policy

## Channels
- `alpha`: fast integration channel, high change rate, rapid rollback allowed.
- `beta`: promotion from alpha after contracts/parity/perf/ops checks.
- `ga`: promotion from beta after migration and rollback drills pass.

## Promotion Criteria
1. Contracts and parity checks green.
2. Critical runtime and policy tests green.
3. Docs and runbook updates complete.
4. No unresolved high-severity regression in release notes.

## Rollback Triggers
1. Contract regression.
2. Critical parity regression.
3. Error-budget breach.
4. Unclassified production incident (failure not typed/diagnosable).

## Rollback Requirements
1. Config/schema toggles support immediate fallback.
2. Changelog identifies contract and behavior deltas.
3. Post-rollback validation re-runs critical checks.
