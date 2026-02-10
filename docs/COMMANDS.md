# Commands

## Core
- `/model <id>` set model directly
- `/m` quick model picker
- `/models` open model picker
- `/models list [query]` list models (paging + filter)
- `/models fav` list favorites
- `/models add <id>` add favorite
- `/models rm <id>` remove favorite
- `/providers` provider routing (OpenRouter)
- `/p` quick provider picker
- `/provider` switch base provider

## Session
- `/new` start a new session
- `/rename <title>` rename session
- `/resume <id>` resume last session
- `/transcript` open full transcript
- `/history [on|off]` show recent history at startup
- `/status` show current status
- `/context` show context usage
- `/worklog [on|off]` toggle action log
- `/output [full|compact|<chars>]` tool output size

## Custom Commands
- Put markdown files in `.tehuti/commands/` or `.claude/commands/`
- Put TOML files in `.gemini/commands/`
- Command name is the file name (e.g. `review.md` → `/review`)
- Subfolders are namespaced with `:` (e.g. `ops/review.md` → `/ops:review`)
- Use `$ARGUMENTS` to receive the full user input
- Use `$1`, `$2`, … for positional args
- Use `{path}` to inline a file (safe, truncated)
- Use `@{path}` to inline a file (Gemini-style); directories inline a listing
- Use `!{command}` to inline shell output (Gemini-style)
- Optional YAML frontmatter can define `description: ...`
- YAML frontmatter can also define `allowed-tools:` (list or comma-separated) to hint preferred tools.

## Tools & Permissions
- `/permissions [shell|write|external] [on|off]`
- `/allow-tool <tool>` allow tool
- `/deny-tool <tool>` deny tool
- `/allow-url <domain>` allow domain
- `/deny-url <domain>` deny domain
- `/list-dirs` show allowed paths
- `/add-dir <path>` add path
- `/just-bash` raw shell

## Diagnostics
- `/smoke` quick tool smoke test
- `/diagnostics` system checks
- `/grounding` extended system checks
- `/diff` git status/diff summary
