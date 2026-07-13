# Tehuti Troubleshooting Guide

> 𓂀 Common issues, diagnostic steps, and solutions for Tehuti CLI.

---

## Quick Diagnostics

Before diving into specific issues, run these diagnostic commands:

```bash
# Check environment health
tehuti doctor

# Check daemon status
tehuti companion --ping

# View recent trace logs
tehuti trace tail --follow

# Check current config
cat ~/.tehuti/config.json
```

---

## Installation Issues

### `Error: Cannot find module '@napi-rs/...'`

**Cause**: Rust native module not built or incompatible platform.

**Solution**:
```bash
# Rebuild the Rust core
npm run build:rust

# Or full clean rebuild
rm -rf node_modules dist rust-core/target
npm install
npm run build
```

**Platform notes**:
- Apple Silicon (M1/M2/M3): Requires `@napi-rs/cli` and Rust toolchain
- Linux ARM64: Pre-built binaries may not exist; build from source
- Windows: Requires Visual Studio Build Tools for Rust compilation

---

### `Node.js version >= 20.0.0 required`

**Cause**: Tehuti requires Node.js 20+ for native ESM and modern APIs.

**Solution**:
```bash
# Check current version
node --version

# Update via nvm (recommended)
nvm install 20
nvm use 20

# Or via Homebrew
brew install node@20
```

---

## Configuration Issues

### `API key is required`

**Cause**: No API key configured for the selected provider.

**Solutions** (pick one):

1. **Environment variable** (recommended for CI):
   ```bash
   export TEHUTI_API_KEY="your-key-here"
   ```

2. **Config file** (`.tehuti.json` in project root):
   ```json
   {
     "apiKey": "your-key-here",
     "provider": "openrouter"
   }
   ```

3. **Interactive wizard**:
   ```bash
   tehuti init
   ```

**Common mistake**: Using the wrong environment variable name. Check `src/config/providers.ts` for provider-specific env vars.

---

### `Invalid API key format`

**Cause**: API key validation failed (length or prefix check).

**Solution**:
- OpenRouter keys start with `sk-or-`
- Check for trailing whitespace: `echo "$TEHUTI_API_KEY" | wc -c`
- Verify key is not expired (check provider dashboard)

---

### Config not loading from `.tehuti.json`

**Cause**: Cosmiconfig search order or file syntax error.

**Diagnostic**:
```bash
# Check if file is valid JSON
cat .tehuti.json | jq .

# Check Tehuti's config resolution
TEHUTI_DEBUG=1 tehuti chat 2>&1 | grep "config"
```

**Search order** (first match wins):
1. `.tehuti.json`
2. `.tehuti.yaml` / `.tehuti.yml`
3. `.tehuti.js` / `.tehuti.mjs` / `.tehuti.cjs`
4. `package.json` → `"tehuti"` key

**Common issue**: YAML config requires the `yaml` package:
```bash
npm install yaml
```

---

## Agent Loop Issues

### Agent hangs after tool execution

**Cause**: Tool execution timeout or deadlock in async mutex.

**Diagnostic**:
```bash
# Enable debug logging
TEHUTI_DEBUG=1 tehuti chat

# Check trace log for stuck tool
tehuti trace tail --follow | grep "tool_start"
```

**Solution**:
- Increase tool timeout in config:
  ```json
  {
    "tools": {
      "timeout": 120000
    }
  }
  ```
- Kill hanging process: `pkill -f tehuti`
- Check for infinite loops in bash scripts

---

### Context window overflow (`Context at 95% capacity`)

**Cause**: Session has accumulated too many messages/tokens.

**Solutions**:

1. **Manual compaction** (recommended):
   ```
   /compact
   ```
   Keeps system prompt + last 6 messages.

2. **Start new session**:
   ```bash
   tehuti chat --new
   ```

3. **Increase context limit** (if model supports it):
   ```json
   {
     "kilocode": {
       "contextManagement": {
         "maxContextLength": 200000
       }
     }
   }
   ```

**Note**: Automatic compression triggers at 85% capacity. If you see 95%, compression failed or model context is too small.

---

### Tool calls not executing

**Cause**: Permission denied or tool not registered.

**Diagnostic**:
```bash
# List all available tools
tehuti tools

# Check permission mode
cat .tehuti.json | jq '.permissions.defaultMode'
```

**Solutions**:

1. **Switch to trust mode** (auto-approve all tools):
   ```json
   {
     "permissions": {
       "defaultMode": "trust"
     }
   }
   ```

2. **Add tool to always-allow list**:
   ```json
   {
     "permissions": {
       "alwaysAllow": ["bash", "write_file", "edit_file"]
     }
   }
   ```

3. **Check tool registration** (for custom tools):
   ```bash
   tehuti tools --json | grep "my_custom_tool"
   ```

---

## Daemon Issues

### `Daemon not running`

**Cause**: Background daemon not started or crashed.

**Solution**:
```bash
# Start daemon
tehuti daemon start

# Check status
tehuti companion --ping

# View daemon logs
tail -f ~/.tehuti/daemon.log
```

**macOS autostart**:
```bash
# Install launchd plist
tehuti daemon install

# Check launchd status
launchctl list | grep tehuti
```

---

### `Socket connection refused`

**Cause**: Unix socket not found or permissions issue.

**Diagnostic**:
```bash
# Check socket exists
ls -la ~/.tehuti/tehutid.sock

# Check permissions (should be 0600)
stat -f "%Lp" ~/.tehuti/tehutid.sock
```

**Solution**:
```bash
# Fix permissions
chmod 600 ~/.tehuti/tehutid.sock

# Restart daemon
tehuti daemon stop
tehuti daemon start
```

---

### Daemon consuming high CPU

**Cause**: Chokidar file watcher in tight loop or memory leak.

**Diagnostic**:
```bash
# Check daemon process
ps aux | grep tehuti | grep daemon

# Monitor CPU usage
top -pid $(pgrep -f "tehuti daemon")
```

**Solution**:
- Add `.tehutiignore` to exclude large directories:
  ```
  node_modules/
  dist/
  .git/
  ```
- Restart daemon: `tehuti daemon restart`
- Check for memory leaks: `tehuti trace stats`

---

## MCP Issues

### MCP server connection timeout

**Cause**: MCP server not responding or transport misconfigured.

**Diagnostic**:
```bash
# Check MCP server status
tehuti tools | grep mcp_

# Test stdio transport
echo '{"jsonrpc":"2.0","method":"initialize","id":1}' | npx my-mcp-server
```

**Solution**:
- Increase timeout in config:
  ```json
  {
    "mcpServers": {
      "my-server": {
        "timeout": 60000
      }
    }
  }
  ```
- Check server logs (if accessible)
- Verify transport type (`stdio`, `http`, `sse`, `websocket`)

---

### MCP tools not appearing

**Cause**: MCP server connected but tools not synced.

**Diagnostic**:
```bash
# Check if MCP tools registered
tehuti tools --json | jq '.[] | select(.category == "mcp")'
```

**Solution**:
- Restart daemon to re-sync: `tehuti daemon restart`
- Check MCP server logs for tool discovery errors
- Verify `mcpServers` config is correct

---

## TUI Issues

### Terminal rendering broken (garbled output)

**Cause**: Terminal emulator incompatibility or ANSI escape sequence issue.

**Diagnostic**:
```bash
# Check terminal capabilities
echo $TERM
echo $COLORTERM
```

**Solutions**:

1. **Disable mouse tracking** (for SSH/tmux):
   ```bash
   TEHUTI_DISABLE_MOUSE=1 tehuti chat
   ```

2. **Force basic colors** (if TrueColor unsupported):
   ```bash
   FORCE_COLOR=1 tehuti chat
   ```

3. **Use compatible terminal**:
   - Recommended: iTerm2, Ghostty, WezTerm, Alacritty
   - Avoid: Default macOS Terminal.app (limited ANSI support)

---

### Vim keybindings not working

**Cause**: Terminal not sending correct escape sequences.

**Diagnostic**:
```bash
# Test key input
tehuti chat --debug
# Press 'j' and check debug output
```

**Solution**:
- Check terminal key mappings
- Update to latest Tehuti version (keyboard handling improvements)
- Report issue with terminal emulator version

---

## Memory & Performance Issues

### High memory usage (> 1GB)

**Cause**: Large session history or memory graph growth.

**Diagnostic**:
```bash
# Check memory graph size
ls -lh ~/.config/tehuti/memory/graph.db

# Check session size
ls -lh ~/.tehuti/sessions/
```

**Solution**:
- Compact session: `/compact`
- Clear old sessions:
  ```bash
  rm ~/.tehuti/sessions/*.json
  ```
- Rebuild memory graph:
  ```bash
  rm ~/.config/tehuti/memory/graph.db
  tehuti chat  # Will rebuild on next session
  ```

---

### Slow tool execution

**Cause**: Tool timeout, network latency, or resource contention.

**Diagnostic**:
```bash
# Check tool timing
tehuti trace tail | grep "tool_duration"
```

**Solution**:
- Increase tool timeout in config
- Check network connectivity (for web tools)
- Disable parallel tool execution (if causing contention):
  ```json
  {
    "agent": {
      "parallelTools": false
    }
  }
  ```

---

## Messaging Connector Issues

### Discord bot not responding

**Cause**: Bot token invalid or intents not enabled.

**Diagnostic**:
```bash
# Check connector status
tehuti doctor | grep discord
```

**Solution**:
- Verify bot token in config:
  ```json
  {
    "messaging": {
      "discordToken": "your-bot-token"
    }
  }
  ```
- Enable Message Content Intent in Discord Developer Portal
- Check bot has permission to read/send messages in channel

---

### Slack webhook not firing

**Cause**: Webhook URL incorrect or app token missing.

**Solution**:
- Verify Slack app tokens:
  ```json
  {
    "messaging": {
      "slackAppToken": "xapp-...",
      "slackBotToken": "xoxb-..."
    }
  }
  ```
- Check Slack app has `chat:write` and `channels:history` scopes
- Verify webhook URL is correct in Slack app settings

---

## Session Issues

### `/resume` not finding session

**Cause**: Session not saved or CWD mismatch.

**Diagnostic**:
```bash
# List recent sessions
ls -lt ~/.tehuti/sessions/ | head

# Check session CWD
cat ~/.tehuti/sessions/<session-id>.json | jq '.cwd'
```

**Solution**:
- Sessions are keyed by CWD. Ensure you're in the same directory:
  ```bash
  cd /path/to/project
  tehuti --resume
  ```
- Manually load session by ID:
  ```bash
  tehuti chat --session <session-id>
  ```

---

### Session lost after crash

**Cause**: Atomic write failed or disk full.

**Diagnostic**:
```bash
# Check for partial session files
ls -la ~/.tehuti/sessions/*.partial

# Check disk space
df -h ~/.tehuti/
```

**Solution**:
- Recover partial session:
  ```bash
  mv ~/.tehuti/sessions/<id>.partial ~/.tehuti/sessions/<id>.json
  tehuti chat --session <id>
  ```
- Free disk space and retry

---

## Debugging Techniques

### Enable verbose logging

```bash
# Debug mode (all modules)
TEHUTI_DEBUG=1 tehuti chat

# Debug specific module
TEHUTI_DEBUG=agent tehuti chat
TEHUTI_DEBUG=mcp tehuti chat
TEHUTI_DEBUG=daemon tehuti chat
```

### Trace log analysis

```bash
# Follow live trace
tehuti trace tail --follow

# Search for errors
tehuti trace search "error"

# Show specific trace event
tehuti trace show <trace-id>

# View swarm lifecycle
tehuti trace tree
```

### Network inspection

```bash
# Enable HTTP debug logging
NODE_DEBUG=http tehuti chat

# Capture API requests (requires mitmproxy or similar)
HTTPS_PROXY=http://localhost:8080 tehuti chat
```

---

## Getting Help

If you're still stuck:

1. **Check existing issues**: https://github.com/The-Osiris-Labs/Tehuti-CLI/issues
2. **Run `tehuti doctor`** and include output in issue
3. **Attach trace log**: `tehuti trace tail > trace.log`
4. **Include environment info**:
   ```bash
   node --version
   npm --version
   uname -a
   ```

---

## Known Limitations

- **Context window**: Automatic compression at 85% may lose context in very long sessions
- **Parallel tools**: Max 5 concurrent read-only tools (write operations force sequential)
- **MCP transports**: WebSocket support is experimental
- **Memory graph**: Consolidation runs every 15min; recent events may not be indexed immediately
- **Daemon mode**: Not supported on Windows (Unix socket requirement)

---

> 𓆣 May Tehuti's wisdom guide your debugging journey.
