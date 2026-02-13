# Session Changes - 2026-02-13

This session focused on repository hygiene, release safety, and pre-push readiness.

## Summary

- Removed tracked runtime artifacts from git index (`.venv`, `__pycache__`, `.pyc`, `.egg-info`) without deleting local files.
- Hardened hygiene/security checks to correctly handle cleanup commits (deleted noisy files should not fail strict gates).
- Verified full quality gate pass after cleanup and guardrail updates.

## Detailed Changes

1. Repository hygiene cleanup
- Normalized `.gitignore` to remove duplication and keep explicit runtime/build ignores.
- Untracked environment/runtime artifacts from git index:
  - `.venv/`
  - `src/**/__pycache__/`
  - `*.pyc`
  - `src/tehuti_cli.egg-info/`
- Preserved local developer environment files on disk (index-only cleanup).

2. Sensitive exposure gate fix
- Updated `scripts/check_sensitive_exposure.py` staged-file selection to ignore deleted paths:
  - now uses `git diff --cached --name-only --diff-filter=ACMR -z`
- Added regression test:
  - `tests/test_sensitive_exposure_guard.py::test_staged_paths_ignores_deleted_entries`

3. Release hygiene gate fix
- Updated `scripts/check_release_hygiene.py` so deletion-only noise cleanup does not fail strict mode.
- Added helper `_is_deletion_status(...)` and filtered noisy/staged noisy sets accordingly.
- Added regression tests:
  - `tests/test_release_hygiene.py`

4. Verification
- `python3 scripts/check_sensitive_exposure.py --strict` -> pass
- `python3 scripts/check_release_hygiene.py --strict` -> pass
- `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 .venv/bin/pytest -q tests/test_sensitive_exposure_guard.py tests/test_release_hygiene.py` -> pass
- `bash scripts/quality_gate.sh` -> pass

5. Operational note
- Remote URL is token-free (`https://github.com/The-Osiris-Labs/Tehuti-CLI.git`).
- Remote fetch remains environment-blocked when DNS/network is unavailable (`Could not resolve host: github.com`).
