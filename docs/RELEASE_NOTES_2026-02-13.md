# Release Notes - 2026-02-13

## Highlights

- Repository is now release-clean with runtime artifacts removed from version control tracking.
- Strict safety/hygiene gates are resilient to legitimate cleanup commits.
- Quality gate passes end-to-end after hygiene hardening.

## What Changed

1. Repo hygiene baseline improved
- `.venv`, cache bytecode, and local package metadata are no longer tracked in git.
- `.gitignore` was consolidated to reduce drift and duplicate rules.

2. Pre-push safety checks improved
- Sensitive exposure scanner now evaluates only added/changed/renamed/copied staged content.
- Release hygiene checker now treats deletions as cleanup, not churn regressions.

3. Regression coverage added
- `tests/test_sensitive_exposure_guard.py`
- `tests/test_release_hygiene.py`

## Validation Snapshot

- `python3 scripts/check_sensitive_exposure.py --strict` passed.
- `python3 scripts/check_release_hygiene.py --strict` passed.
- `bash scripts/quality_gate.sh` passed.

## Notes

- Remote synchronization requires working DNS/network access to `github.com`.
