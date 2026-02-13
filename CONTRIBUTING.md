# Contributing

Thanks for helping improve Tehuti.

## Development Setup

```bash
cd /root/project-tehuti
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
```

## Before You Open a PR

1. Run tests.

```bash
python -m pytest -q
```

Contract-focused gate (recommended):

```bash
./scripts/quality_gate.sh
```

Security/exposure preflight (staged changes only):

```bash
python3 scripts/check_sensitive_exposure.py --strict
```

2. Verify touched modules compile.

```bash
python -m py_compile <files you changed>
```

3. Update docs for any user-visible behavior change.
4. Never commit local runtime artifacts or secrets (`.tehuti*`, `.env`, `keys.env`, private keys).

## Contribution Standards

- Keep output/result paths evidence-driven.
- Avoid fixed “success” phrasing when runtime output is available.
- Keep changes small and reviewable.
- Prefer explicit behavior contracts over implicit heuristics.
- Contract-visible changes must include:
  - fixture updates under `tests/fixtures/contracts/`
  - docs updates in `docs/API_CONTRACTS.md`
  - ADR updates in `docs/adr/`

## Documentation Rule

If behavior changes, docs must change in the same PR.

## Contract Governance

- Policy: `docs/CONTRACT_GOVERNANCE.md`
- Maintainer map: `docs/MAINTAINER_MAP.md`
- Release channels/rollback: `docs/RELEASE_CHANNELS.md`
- ADR template: `docs/adr/TEMPLATE.md`

## Version Consistency

Keep `pyproject.toml` `version` and `src/tehuti_cli/__init__.py` `__version__` in sync.

Check:

```bash
python3 scripts/check_version_consistency.py
```

## Reporting Issues

Include:
- expected behavior
- actual behavior
- repro steps
- environment details (`python --version`, provider, model)
