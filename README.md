# 𓅞 Tehuti CLI

<img width="3142" height="710" alt="Tehuti Banner" src="https://github.com/user-attachments/assets/05aa5407-6d30-47a8-a88e-63e99f8fd9fc" />

**Thoth, Tongue of Ra**  
*Halls of Records • Balance of Ma'at • Architect of Truth*

Tehuti is a terminal-first AI engineering assistant focused on correctness, traceability, and operational discipline.

It is designed for real engineering work where outputs must be evidence-backed, state-aware, and contract-consistent across interfaces.

## Table of Contents

1. What Tehuti Is
2. Core Capabilities
3. Surface Modes (CLI, Wire, Web)
4. Quick Start
5. Configuration and Runtime State
6. Contract System (What is Guaranteed)
7. Architecture Map
8. Quality Gates and Release Safety
9. Repository Layout
10. Documentation Index
11. Version and Project Identity

## What Tehuti Is

Tehuti is a multi-surface agentic system with one core runtime model:

- Interactive shell for day-to-day engineering execution
- JSONL wire mode for automation and orchestration
- Web API/UI mode for service and remote consumption

Key principle: **no fabricated execution claims**. Tool-backed activity, progress events, and typed failure envelopes are first-class outputs.

## Core Capabilities

- Contract-first envelopes across CLI, wire, and web surfaces.
- Tool execution with metadata-aware safety and approval policy.
- Deterministic preflight diagnostics before execution.
- Structured progress timelines and phase events.
- Session persistence and resume by workspace.
- Cross-surface parity checks in CI.
- Release hygiene and secret-exposure blocking before push.

## Surface Modes

### 1. Interactive CLI

```bash
tehuti
```

Use this for iterative workflows with live streaming progress.

### 2. Non-interactive Prompt (print)

```bash
tehuti --print --prompt "review this repository and summarize risks"
```

Envelope mode for machine-consumable output:

```bash
tehuti --prompt "summarize this repo" --envelope
```

### 3. Wire / JSONL

Run wire mode:

```bash
tehuti wire
```

Example request:

```json
{"prompt":"summarize current branch changes"}
```

Agent-task example with streaming:

```json
{
  "mode": "agent_task",
  "task": "implement release checklist docs updates",
  "max_iterations": 10,
  "persist": true,
  "stream": true,
  "stream_phase": true
}
```

### 4. Web API/UI

Run web mode:

```bash
tehuti web --host 127.0.0.1 --port 5494
```

Primary endpoints:

- `POST /api/prompt`
- `POST /api/agent_task`
- `GET /api/models`
- `GET /api/providers`
- `GET /api/metrics`
- `GET /api/metrics/diagnostics`
- `GET /metrics`
- `GET/POST /api/config`

## Quick Start

```bash
cd /root/project-tehuti
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
tehuti --help
tehuti doctor
```

If using OpenRouter, create key file:

```bash
mkdir -p ~/.tehuti
cat > ~/.tehuti/keys.env <<'EOF'
OPENROUTER_API_KEY=your_api_key_here
EOF
```

## Configuration and Runtime State

Default home:

- `~/.tehuti` (or `TEHUTI_HOME`)

Important files:

- Config: `~/.tehuti/config.toml`
- Keys: `~/.tehuti/keys.env`
- Sessions: `~/.tehuti/sessions/<session_id>/...`
- Last-session metadata: `~/.tehuti/metadata.json`

Execution policy is explicit via config (`access_policy`, approval behavior, and tool restrictions).

## Contract System

Tehuti publishes stable envelopes and event contracts so integrations can rely on machine-readable behavior.

Major schemas:

- `tehuti.preflight.v1`
- `tehuti.tool_result.v1`
- `tehuti.progress.v1`
- `tehuti.phase_stream.v1`
- `tehuti.agent_task.v1`
- `tehuti.metrics.v1`
- `tehuti.cli.prompt.v1`
- `tehuti.cli.interactive.v1`
- `tehuti.wire.v1`
- `tehuti.wire.progress.v1`
- `tehuti.web.prompt.v1`
- `tehuti.web.agent_task.v1`

Typed failures always project:

- `category`
- `code`
- `message`
- `retryable`
- optional `details`

Detailed examples are documented in `docs/API_CONTRACTS.md`.

## Architecture Map

Core package: `src/tehuti_cli/`

Critical modules:

- `src/tehuti_cli/cli.py`: CLI entrypoint and command surfaces (`web`, `wire`, `doctor`, `tools`, `resume`)
- `src/tehuti_cli/core/runtime.py`: tool dispatch, sandbox/policy flow, contract execution
- `src/tehuti_cli/core/agent_loop.py`: loop states, parse modes, termination reasons, progress emission
- `src/tehuti_cli/agentic.py`: orchestrator over loop/runtime/memory/provider
- `src/tehuti_cli/core/tools.py`: tool registry and metadata
- `src/tehuti_cli/core/memory.py`: memory retrieval and policy controls
- `src/tehuti_cli/providers/`: provider adapters (`openrouter`, `openai`, `gemini`)
- `src/tehuti_cli/storage/`: config/session/path/metadata persistence
- `src/tehuti_cli/web/app.py`: FastAPI application and API contracts
- `src/tehuti_cli/ui/shell.py`: interactive shell UX and streaming execution display

## Quality Gates and Release Safety

Primary gate:

```bash
bash scripts/quality_gate.sh
```

Gate coverage includes:

- compile checks
- ADR and docs drift governance
- contract coverage and conformance parity
- migration safety checks
- performance gates (`smoke`, `sustained`, `long-session`, `memory-relevance`)
- rollback drill and one-command rollback checks
- canary gate validation
- release hygiene checks
- sensitive exposure checks
- critical runtime/protocol/parity tests

Additional direct checks:

```bash
python3 scripts/check_sensitive_exposure.py --strict
python3 scripts/check_release_hygiene.py --strict
python3 scripts/check_docs_drift.py
python3 scripts/check_version_consistency.py
```

## Repository Layout

- `src/tehuti_cli/` core implementation
- `tests/` contract/runtime/parity/perf coverage
- `docs/` user, operator, contracts, and program status docs
- `scripts/` gates, conformance runners, perf checks, release utilities
- `.github/workflows/` CI workflows

## Documentation Index

Start here for docs map:

- `docs/README.md`

Most used docs:

- `docs/GETTING_STARTED.md`
- `docs/USER_GUIDE.md`
- `docs/TROUBLESHOOTING.md`
- `docs/CONFIGURATION.md`
- `docs/OPERATOR_RUNBOOK.md`
- `docs/API_CONTRACTS.md`
- `docs/PARITY_MATRIX.md`
- `docs/EXECUTION_TRACKER.md` (canonical execution/status source)
- `docs/MAINTAINER_MAP.md`

## Version and Identity

- Package: `tehuti-cli`
- Version: `0.3.0`
- License: MIT

Tehuti is part of OSIRIS / TheOsirisLabs:

- truth over speed
- evidence over guesswork
- disciplined engineering over improvisation

If you require correctness, Tehuti is built for you.
