# Troubleshooting

This page is optimized for fast recovery.

## Install/import issues

Symptom:
- `ModuleNotFoundError: No module named 'tehuti_cli'`

Fix:
1. activate `.venv`
2. run `pip install -e .`
3. run `tehuti --help`

## API/auth issues

Symptom:
- model calls fail with auth or provider errors

Fix:
1. verify key in `~/.tehuti/keys.env`
2. verify `api_key_env` matches the key name
3. run `/diagnostics`

## Model availability issues

Symptom:
- free-tier or provider-specific model errors

Fix:
1. retry once
2. choose another model via `/model` or config
3. inspect provider/model status with `/status-all`

## PTY exhaustion (`out of pty devices`)

Fix:
1. close stale sessions/processes
2. use one-shot mode for immediate work:
   - `tehuti --print --prompt "..."`
3. reduce concurrent delegated tails/follows

## State path permissions

Symptom:
- write failures under `~/.tehuti`

Fix:
1. set writable home:
   - `export TEHUTI_HOME=/path/to/writable/.tehuti`
2. rerun command

## Long-running noise management

Use:
1. `/verbosity minimal`
2. `/worklog off`
3. `/output compact`
4. `/delegate status <id>` instead of always following logs

## “Stuck” delegates

Triage:
1. `/delegate list`
2. `/delegate status <id>`
3. `/delegate logs <id>`

Recovery:
1. `/delegate stop <id>`
2. restart with tighter scope and explicit success criteria
