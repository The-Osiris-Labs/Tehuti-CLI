# Tehuti CLI

<img width="3142" height="710" alt="CleanShot 2026-02-12 at 05 28 20@2x" src="https://github.com/user-attachments/assets/05aa5407-6d30-47a8-a88e-63e99f8fd9fc" />

Tehuti is a terminal-first AI engineering assistant.

It can read code, run tools, execute shell commands (with policy controls), keep session context, and coordinate delegated background tasks.

This project is for two groups:
- People who want to **use** Tehuti effectively.
- People who want to **develop and operate** Tehuti safely.

If you are new, start here: `docs/GETTING_STARTED.md`.

## What Tehuti Is Good At

- Investigating codebases quickly.
- Running iterative tool-assisted workflows.
- Producing evidence-backed answers from actual command/tool output.
- Managing foreground and background task execution.

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

## Documentation

- Start here: `docs/README.md`
- Setup: `docs/GETTING_STARTED.md`
- Daily usage: `docs/USER_GUIDE.md`
- Configuration: `docs/CONFIGURATION.md`
- Tools and capabilities: `docs/TOOLS.md`
- Troubleshooting: `docs/TROUBLESHOOTING.md`
- Operator runbook: `docs/OPERATOR_RUNBOOK.md`
- Execution tracker (current source of truth): `docs/EXECUTION_TRACKER.md`

## Default Model

Default OpenRouter model:
- `qwen/qwen3-coder:free`

## API Keys

By default Tehuti reads keys from:
- `~/.tehuti/keys.env` (or `TEHUTI_HOME/keys.env`)

Example:

```bash
OPENROUTER_API_KEY=your_api_key_here
```
