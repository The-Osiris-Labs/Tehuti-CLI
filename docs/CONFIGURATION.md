# Configuration

Tehuti stores configuration in `~/.tehuti/config.toml` and keys in `~/.tehuti/keys.env` by default. A local `keys.env` in the project root is also supported.

## Keys
- `OPENROUTER_API_KEY`
- `OPENAI_API_KEY`
- `GEMINI_API_KEY`

## Provider Defaults
- Provider: `openrouter`
- Model: `mistralai/devstral-2512:free`

## Sandbox Flags
- `default_yolo`: auto‑approve tools
- `allow_shell`: allow shell commands
- `allow_write`: allow file writes
- `allow_external`: allow external tool definitions
- `allowed_paths`: extra paths beyond the workdir
- `web_allow_domains` / `web_deny_domains`: URL allow/deny lists
- `show_actions`: show the action log in the UI
- `execution_mode`: `standard` | `autonomous` | `dominant`

## Files
- `~/.tehuti/tools.json`: external tools
- `~/.tehuti/mcp.json`: MCP tools
- `~/.tehuti/skills.json`: skill registry
- `.tehuti/commands/*.md` or `.claude/commands/*.md`: custom slash commands
- `.gemini/commands/*.toml`: Gemini-style custom commands
- `~/.tehuti/commands/*.md` or `~/.claude/commands/*.md`: global custom commands
- `~/.gemini/commands/*.toml`: global Gemini-style commands
