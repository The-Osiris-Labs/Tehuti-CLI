# Configuration Reference

## The Two Config Files

Tehuti uses two configuration files:

| File | Purpose | Location |
|------|---------|----------|
| `config.toml` | Main settings | `~/.tehuti/config.toml` |
| `keys.env` | API keys and secrets | `~/.tehuti/keys.env` |

---

## config.toml

This file controls Tehuti's behavior. Here's a complete example with all options:

```toml
[provider]
type = "openrouter"                              # openrouter, openai, or gemini
model = "stepfun/step-3.5-flash:free"            # Model to use
base_url = "https://openrouter.ai/api/v1"        # API endpoint (usually auto-detected)
api_key_env = "OPENROUTER_API_KEY"               # Environment variable for API key

[permissions]
default_yolo = true                              # Auto-approve all tools?
allow_shell = true                               # Allow shell commands?
allow_write = true                               # Allow file writes?
allow_external = true                            # Allow external tools?

[paths]
allowed_paths = ["/home/me/projects"]            # Where Tehuti can read/write
denied_paths = ["/etc", "/root/.ssh"]            # Always blocked

[web]
web_allow_domains = ["github.com", "api.example.com"]  # Allowed domains
web_deny_domains = ["malicious.com"]             # Blocked domains

[execution]
execution_mode = "autonomous"                    # standard, autonomous, dominant
max_turns = 10                                   # Max tool cycles per request

[ui]
show_banner = true                               # Show welcome banner
show_history = true                              # Show message history
show_actions = true                              # Show tool execution details

[logging]
level = "INFO"                                   # DEBUG, INFO, WARNING, ERROR
audit_enabled = true                             # Log all actions?
```

---

## keys.env

This file stores your API keys. It should **never** be committed to version control.

```bash
# Your API keys - one per line
OPENROUTER_API_KEY=sk-or-v1-your-key-here
OPENAI_API_KEY=sk-your-key-here
GEMINI_API_KEY=your-gemini-key-here
```

---

## Provider Configuration

### OpenRouter (Recommended for Starters)

```toml
[provider]
type = "openrouter"
model = "stepfun/step-3.5-flash:free"  # Free model, works great
# or any other model from https://openrouter.ai/models
api_key_env = "OPENROUTER_API_KEY"
```

Get your key at [openrouter.ai](https://openrouter.ai).

### OpenAI

```toml
[provider]
type = "openai"
model = "gpt-4o"                         # or gpt-4o-mini, o1, etc.
api_key_env = "OPENAI_API_KEY"
```

Get your key at [platform.openai.com](https://platform.openai.com).

### Google Gemini

```toml
[provider]
type = "gemini"
model = "gemini-2.0-flash-exp"           # or gemini-1.5-pro
api_key_env = "GEMINI_API_KEY"
```

Get your key at [aistudio.google.com](https://aistudio.google.com).

---

## Permission Modes

### YOLO Mode (Convenient)

```toml
[permissions]
default_yolo = true
```

Everything is auto-approved. No "Are you sure?" prompts.

**Pros:** Fast, frictionless
**Cons:** Risk of accidental damage

### Interactive Mode (Balanced)

```toml
[permissions]
default_yolo = false
allow_shell = true
allow_write = true
```

You approve risky operations.

### Lockdown Mode (Safe)

```toml
[permissions]
default_yolo = false
allow_shell = false
allow_write = false
```

Only read operations allowed.

---

## Path Restrictions

Control where Tehuti can read and write:

```toml
[paths]
allowed_paths = [
    "/home/me/projects",
    "/work/codebase",
    "/tmp/tehuti"
]
denied_paths = [
    "/etc",
    "/root",
    "/home/*/.ssh",
    "/home/*/.aws"
]
```

**Best Practice:** Be as specific as possible. Instead of `/home/me`, use `/home/me/my-project`.

---

## Web Access Control

```toml
[web]
# Only these domains can be fetched
web_allow_domains = [
    "api.github.com",
    "docs.example.com",
    "pypi.org"
]

# These are always blocked
web_deny_domains = [
    "malicious-site.com",
    "tracker.example.com"
]
```

Set `web_allow_domains` to an empty list for unrestricted access (with YOLO mode).

---

## Execution Modes

### Standard

```toml
[execution]
execution_mode = "standard"
```

One request → one response. Tehuti doesn't loop.

### Autonomous

```toml
[execution]
execution_mode = "autonomous"
```

Tehuti can call multiple tools in sequence until the task is done.

### Dominant

```toml
[execution]
execution_mode = "dominant"
```

Tehuti is more assertive. Will make decisions to complete tasks.

---

## UI Customization

```toml
[ui]
show_banner = true        # Show the Egyptian-themed welcome banner
show_history = true       # Show last 6 messages on startup
show_actions = true       # Show tool execution with colors
```

---

## Environment Variables

Some settings can also be controlled via environment variables:

| Variable | Effect |
|----------|--------|
| `TEHUTI_ASCII` | Use ASCII-only symbols (no Egyptian hieroglyphs) |
| `TEHUTI_MODE` | Override execution mode (standard/autonomous/dominant) |
| `TEHUTI_HTTP_REFERER` | HTTP Referer header for API calls |
| `TEHUTI_API_TITLE` | X-Title header for API calls |

Example:
```bash
export TEHUTI_ASCII=1      # Plain text symbols
export TEHUTI_MODE=autonomous
```

---

## Example Configurations

### Developer Machine (Full Access)

```toml
[provider]
type = "openrouter"
model = "stepfun/step-3.5-flash:free"
api_key_env = "OPENROUTER_API_KEY"

[permissions]
default_yolo = true

[paths]
allowed_paths = ["/Users/me/code", "/work"]
denied_paths = []
```

### Shared/CI Environment (Restricted)

```toml
[provider]
type = "openrouter"
model = "stepfun/step-3.5-flash:free"
api_key_env = "OPENROUTER_API_KEY"

[permissions]
default_yolo = false
allow_shell = true
allow_write = true

[paths]
allowed_paths = ["/work/project"]
denied_paths = ["/etc", "/root", "/home"]

[web]
web_allow_domains = ["github.com", "gitlab.com"]
```

### Code Review Mode (Read-Only)

```toml
[provider]
type = "openrouter"
model = "anthropic/claude-sonnet-4-20250514"
api_key_env = "ANTHROPIC_API_KEY"

[permissions]
default_yolo = false
allow_shell = false
allow_write = false
allow_external = false

[paths]
allowed_paths = ["/work/project"]
denied_paths = ["/etc", "/root", "/home"]
```

---

## Troubleshooting Config Issues

### "Provider type not recognized"

Make sure `type` is exactly one of: `openrouter`, `openai`, `gemini`

```toml
# Wrong
type = "OpenRouter"

# Right
type = "openrouter"
```

### "API key not found"

1. Check that `keys.env` exists in `~/.tehuti/`
2. Verify the environment variable name matches
3. Make sure the key is valid

```bash
cat ~/.tehuti/keys.env
```

### "Path not allowed"

The path must be in `allowed_paths`. Use absolute paths:

```toml
# Wrong
allowed_paths = ["."]

# Right
allowed_paths = ["/absolute/path/to/project"]
```

### "Web fetch blocked"

The domain isn't in `web_allow_domains`:

```toml
[web]
web_allow_domains = ["api.github.com"]  # Add your domain here
```

---

## File Locations Summary

| Purpose | Path |
|---------|------|
| Config | `~/.tehuti/config.toml` |
| Keys | `~/.tehuti/keys.env` |
| Model cache | `~/.tehuti/cache/models_*.json` |
| Logs | `~/.tehuti/logs/` (if enabled) |

---

**Need more help?** See [GETTING_STARTED.md](GETTING_STARTED.md) or [USER_GUIDE.md](USER_GUIDE.md).
