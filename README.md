# 𓅞 Tehuti CLI

<img width="3142" height="710" alt="Tehuti Banner" src="https://github.com/user-attachments/assets/05aa5407-6d30-47a8-a88e-63e99f8fd9fc" />

**Thoth, Tongue of Ra**  
*Halls of Records • Balance of Ma'at • Architect of Truth*

Tehuti is a terminal-first AI engineering assistant built for evidence, contracts, and operational reliability, not vibe coding.

## Why Tehuti

- Contract-first across CLI, wire, and web surfaces.
- Tool-backed outcomes with explicit progress and error typing.
- Strong release gates for docs drift, contract parity, rollback safety, and hygiene.
- Operator-grade runtime controls for access policy, approvals, telemetry, and diagnostics.

## Core Surfaces

1. Interactive CLI: `tehuti`
2. Non-interactive prompt mode: `tehuti --print --prompt "..."`
3. Wire/JSONL workflows for automation and replay
4. Web API/UI via FastAPI

## What Is Enforced

- Stable envelopes (`tehuti.cli.*`, `tehuti.wire.*`, `tehuti.web.*`)
- Tool result contract (`tehuti.tool_result.v1`)
- Progress/event contracts (`tehuti.progress.v1`, `tehuti.phase_stream.v1`)
- Typed failure taxonomy with retryability projection
- Cross-surface conformance via CI quality gate

Canonical execution status lives in `docs/EXECUTION_TRACKER.md`.

## Quick Start

```bash
cd /root/project-tehuti
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
tehuti --help
```

Launch interactive mode:

```bash
tehuti
```

Run one prompt and exit:

```bash
tehuti --print --prompt "review this repo and summarize risks"
```

## Configuration and Keys

Tehuti resolves state under `~/.tehuti` by default (or `TEHUTI_HOME`).

- Config: `~/.tehuti/config.toml`
- Keys: `~/.tehuti/keys.env`
- Sessions: `~/.tehuti/sessions/<session_id>/...`

Example keys file:

```bash
OPENROUTER_API_KEY=your_api_key_here
```

## Operator Commands

- `tehuti doctor` for environment and runtime checks
- `tehuti web` for API/UI mode
- `tehuti wire` for wire-format workflows
- `tehuti resume` to continue prior session context

Inside interactive shell:

- `/` for commands
- `?` for shortcuts
- `/ux quiet|standard|verbose` for stream verbosity control

## Quality Gate

Main hard gate: `scripts/quality_gate.sh`

The gate includes:

- compile checks
- ADR/governance checks
- docs drift
- contract coverage and parity conformance
- performance budgets
- rollback drills
- release hygiene
- sensitive exposure scan
- critical test suites

## Documentation Map

- Start: `docs/GETTING_STARTED.md`
- User workflows: `docs/USER_GUIDE.md`
- Troubleshooting: `docs/TROUBLESHOOTING.md`
- Configuration: `docs/CONFIGURATION.md`
- Operator runbook: `docs/OPERATOR_RUNBOOK.md`
- Contracts: `docs/API_CONTRACTS.md`
- Parity matrix: `docs/PARITY_MATRIX.md`
- Execution tracker (canonical): `docs/EXECUTION_TRACKER.md`
- Maintainer ownership: `docs/MAINTAINER_MAP.md`

Full index: `docs/README.md`

## Version

Current package version: `0.3.0`

## Project Ethos

Tehuti is part of OSIRIS / TheOsirisLabs:

- truth over speed
- evidence over guesswork
- engineering discipline over improvisation

If you demand correctness, use Tehuti.
