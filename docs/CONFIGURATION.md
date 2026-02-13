# Configuration

Tehuti configuration lives at:
- `~/.tehuti/config.toml`
- or `$TEHUTI_HOME/config.toml`

## Minimal Example

```toml
[provider]
type = "openrouter"
model = "qwen/qwen3-coder:free"
api_key_env = "OPENROUTER_API_KEY"
base_url = "https://openrouter.ai/api/v1"

access_policy = "full"
default_yolo = true
allow_shell = true
allow_write = true
allow_external = true
execution_mode = "dominant"
approval_mode = "auto"
progress_verbosity = "standard"
agent_parser_mode = "repair"
```

## Key Runtime Controls

- `access_policy`: `full|restricted`. `full` enforces unrestricted runtime defaults.
- `default_yolo`: broad permission mode.
- `allow_shell`, `allow_write`, `allow_external`: capability toggles.
- `allow_tools`, `deny_tools`: explicit tool policy lists.
- `allowed_paths`: file sandbox expansion.
- `web_allow_domains`, `web_deny_domains`: network domain policy.
- `show_actions`: chronicle visibility baseline.
- `progress_verbosity`: `minimal|standard|verbose`.
- `agent_parser_mode`: `strict|repair|fallback` default parser policy for `TehutiAgent` surfaces.
- `require_tool_evidence`: require at least one successful tool result before agent-task finalization.
- `retry_backoff_base_seconds`, `retry_backoff_cap_seconds`: adaptive tool retry backoff tuning.
- `loop_stuck_backoff_base_seconds`, `loop_stuck_backoff_cap_seconds`: stuck-cycle loop backoff tuning.
- `tool_output_limit`: output shaping for evidence panels.

## Provider Configuration

Tehuti supports:
- `openrouter`
- `openai`
- `gemini`

Provider values are in:
- `[provider]` active provider block
- `[providers.openrouter]`, `[providers.openai]`, `[providers.gemini]`

## Environment Variables

- `OPENROUTER_API_KEY`
- `OPENAI_API_KEY`
- `GEMINI_API_KEY`
- `TEHUTI_HOME`
- `TEHUTI_ASCII=1` for ASCII-friendly rendering

## Behavior Notes

- Startup runs deterministic preflight checks (`python`, environment, writable paths, dependencies, tool registry in `doctor`).
- OpenRouter model coherence is maintained between active and provider-specific fields.
- If primary state paths are not writable, Tehuti falls back to writable paths.
