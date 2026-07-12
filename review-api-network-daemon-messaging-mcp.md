# Evidence-Based Review: API, Network, Daemon, Messaging & MCP Layers

**Project:** Tehuti CLI v1.2.1  
**Root:** `~/Projects/Tehuti-CLI-Revival`  
**Scope:** src/api/, src/agent/tools/web.ts, src/terminal/, src/messaging/, src/daemon/, src/mcp/, src/permissions/  
**Date:** 2026-07-13  

---

## Observation Methodology

Every finding below is anchored to a specific `file:line` reference. Claims about what the code "should do" vs. what it "actually does" are distinguished. Six principles were applied: evidence-only, observation before interpretation, pattern hunting, scope discipline, surfacing assumptions, and acknowledging uncertainty.

---

## Top 5 Issues Ranked by Severity

---

### 🔴 #1: OAuth tokens and API cache stored as plaintext on disk (HIGH — persistent credential leakage)

**Observation:** Two independent subsystems persist sensitive data to `~/.tehuti/` without encryption, hashing, or access-control beyond default filesystem permissions.

**Evidence A — OAuth tokens:**

`src/api/oauth.ts:110-115`
```typescript
oauthConfig.google = {
    accessToken: tokenData.access_token,
    refreshToken:
        tokenData.refresh_token || oauthConfig.google?.refreshToken,
    expiry: Date.now() + tokenData.expires_in * 1000,
};
saveGlobalConfig({ oauth: oauthConfig });
```

`src/api/oauth.ts:249-254` (refresh path, same pattern):
```typescript
oauthConfig.google = {
    ...oauthConfig.google,
    accessToken: tokenData.access_token,
    expiry: Date.now() + tokenData.expires_in * 1000,
};
saveGlobalConfig({ oauth: oauthConfig });
```

`saveGlobalConfig()` writes to a JSON config file (typically `~/.tehuti.json`). Access tokens and long-lived refresh tokens are stored as plaintext. A refresh token (valid until revoked) exposed through file read gives persistent account access.

**Evidence B — API response cache:**

`src/api/response-cache.ts:109-123`
```typescript
const cacheEntry: APIResponseCacheEntry = {
    messages,          // ← Full conversation messages (may contain secrets in prompts)
    options: { ... },
    response,          // ← Full API response (may contain PII the LLM generated)
    timestamp: Date.now(),
    ttl: options?.ttl ?? DEFAULT_TTL,
};
await writeFile(cachePath, JSON.stringify(cacheEntry));
```

The cache key is a SHA-256 hash (truncated to 16 hex chars, line 32), but the **value** is the full, unencrypted messages+response written to `.tehuti/api-cache/<hash>.json`. The TTL (15 min default, line 45) controls cache validity in memory but the file persists on disk until `clear()` is called (line 129).

**Pattern check:** Two separate persistence sites with no encryption. The daemon socket (`src/daemon/server.ts:217`) correctly uses `chmodSync(SOCKET_PATH, 0o600)` and umask `0o177` (line 200), showing awareness of filesystem security — but this pattern is not extended to config or cache files.

**Assumption surfaced:** The code assumes `~/.tehuti/` is only readable by the user. No explicit permission setting on the config file or cache directory. On multi-user systems or after backup extraction, these files are unprotected.

---

### 🔴 #2: HTTP Agent singleton can be initialized after API calls — global dispatcher race condition (HIGH — network config bypass)

**Observation:** The HTTP agent configuration is disconnected from the API client initialization, creating a window where API calls use undici's default Agent instead of the configured one.

**Evidence:**

`src/api/http-agent.ts:29-50`
```typescript
export function initializeHttpAgent(config: HttpAgentConfig = {}): void {
    if (globalAgent) {
        return;  // ← Silent no-op if already initialized
    }
    // ...creates Agent with keepAliveTimeout: 60000, connections: 50, etc.
    globalAgent = new Agent({ ... });
    setGlobalDispatcher(globalAgent);
}
```

`src/api/base-client.ts:640` — direct `fetch()` call with no agent check:
```typescript
const res = await fetch(this.getChatCompletionsUrl(), {
    method: "POST",
    headers: await this.buildHeaders(),
    body: JSON.stringify(body),
    signal: combinedSignal,
});
```

**What actually happens:** The `base-client.ts` never calls `initializeHttpAgent()` or checks `getAgent()`. If the agent init happens after the first `fetch()` call — or never happens — undici's default Agent applies (different pool sizing, no custom timeout, no TCP keep-alive). Worse, the `if (globalAgent) return;` guard (line 30) means only the **first** call to `initializeHttpAgent()` takes effect; a late call with correct config is silently ignored.

**Pattern check:** `src/agent/tools/web.ts:208` also uses bare `fetch()` for web page fetching, bypassing the configured agent entirely. Three fetch sites (API client, web fetch, OAuth token exchange at `oauth.ts:80`) all use vanilla `fetch()` with no reference to the agent singleton.

**Evidence C — missing proxy support:**

`src/api/http-agent.ts:36-47` — the `Agent()` constructor options don't include `connect.proxy` or any proxy configuration. No `HTTP_PROXY`/`HTTPS_PROXY` env var integration exists anywhere in the file.

---

### 🔴 #3: SSE stream parser has no backpressure yielding — can starve event loop (HIGH — UI responsiveness)

**Observation:** The primary SSE parsing loop in `base-client.ts` iterates chunks in a tight loop without yielding to the event loop between parsed events. A separate function in `streaming.ts` implements backpressure correctly but is NOT used by the main path.

**Evidence — main SSE parser (no backpressure):**

`src/api/base-client.ts:665-727`
```typescript
while (true) {
    const { done, value } = await reader.read();
    // ... buffer management ...
    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        // ← Parse and yield synchronously inside inner while loop
        yield result.data as unknown as StandardStreamChunk;
    }
    if (done) break;
}
```

**Evidence — backpressure-aware alternative exists but is unused for main path:**

`src/api/streaming.ts:227-234`
```typescript
// HTTP/3 Backpressure-Aware SSE concepts:
// Yielding to the event loop when processing a fast stream prevents buffer bloat
// and allows underlying HTTP/3 / TCP stack to manage flow control (backpressure).
const now = Date.now();
if (now - lastYield > yieldThresholdMs) {
    await new Promise((resolve) => setImmediate(resolve));
    lastYield = now;
}
```

This `processStreamAsync()` in `streaming.ts` correctly uses `setImmediate` to yield to the event loop every `yieldThresholdMs` (default 16ms). But this is a separate async generator — the main streaming path through `base-client.ts`'s `streamChat()` does NOT use it. The comment acknowledges the concept but doesn't apply it to the actual SSE parser.

**Impact:** When the API sends many small SSE chunks rapidly, the tight `while` loop in `base-client.ts` monopolizes the microtask queue. Other async operations (UI updates, tool processing, network health checks) are starved until the stream pauses.

**Uncertainty:** I was unable to determine definitively whether `processStreamAsync()` in `streaming.ts` is called from any code path. `search_files` shows no caller references outside its own file in the `src/` tree. It may be exported for external use but the primary chat pipeline uses `streamChat()` from `base-client.ts`.

---

### 🔴 #4: Response cache has unbounded disk growth, no LRU eviction, and stale files persist past TTL (HIGH — disk pressure, data persistence)

**Observation:** The disk-based response cache has no size budget, no eviction policy beyond age-based bulk clear, and expired entries remain on disk until explicitly swept.

**Evidence — no capacity limit:**

`src/api/response-cache.ts:47-61` — singleton, no constructor config for max size or max files.

`src/api/response-cache.ts:64-93` — `get()` checks TTL (line 84) and returns `null` for expired entries, but does **not** delete the stale file.

`src/api/response-cache.ts:129-153` — `clear()`:
```typescript
async clear(options?: { olderThan?: number }): Promise<number> {
    // ...
    for (const file of files) {
        if (file.endsWith(".json")) {
            const filePath = join(this.cacheDirectory, file);
            const fileStat = await stat(filePath);
            if (
                !options?.olderThan ||
                Date.now() - fileStat.mtimeMs > options.olderThan
            ) {
                await unlink(filePath);
                clearedCount++;
            }
        }
    }
    return clearedCount;
}
```

Clear only happens when explicitly called. Without an `olderThan` argument, it clears everything. No automatic size-based eviction exists. The daemon's garbage collector (`src/daemon/server.ts:231-244`) calls `sweepCacheDir()` every 12 hours, but that's a different cache (the persistent tool cache), not this API response cache.

**Pattern check:** The daemon's IPC buffer has a proper 10MB limit (`src/daemon/server.ts:36-40`). The daemon's log rotation truncates at 50MB (`src/daemon/server.ts:248`). But the API cache layer has no equivalent safeguard.

---

### 🟡 #5: Permission rules persisted in `process.env` — visible to child processes, lost on restart (MEDIUM — security policy leakage)

**Observation:** The `PermissionManager` serializes its rule set into `process.env`, making it visible to every child process the CLI spawns and losing it when the process exits.

**Evidence:**

`src/permissions/rules.ts:132-148`
```typescript
private loadRules(): void {
    try {
        const stored = process.env.TEHUTI_PERMISSION_RULES;
        if (stored) {
            const parsed = JSON.parse(stored);
            if (Array.isArray(parsed)) {
                this.rules = parsed;
            }
        }
    } catch {}
}

private saveRules(): void {
    try {
        process.env.TEHUTI_PERMISSION_RULES = JSON.stringify(this.rules);
    } catch {}
}
```

**What this means:**
1. **Leak to child processes**: Any tool that spawns a subprocess (bash tool, git commands, background processes) inherits `process.env`, including the serialized permission rules array. A malicious subprocess could read this environment variable.
2. **No persistence**: Rules added during a session are lost when the process exits. There's no file-based persistence for user-granted permissions.
3. **Size limit**: Environment variables on most platforms are limited to 128KB–4MB depending on OS, creating a hard ceiling on rule count.

**Assumption surfaced:** The code uses `process.env` as a "persistence" layer, which is actually just in-process memory with the side effect of leaking to child processes. The intent was probably ephemeral session storage, but the side channel to child processes is unexamined.

---

## Additional Findings (Medium/Low Severity)

### API Layer

**6. API key appears in singleton cache key** — `src/api/standard-client.ts:25`: `const configKey = \`${config.provider || "openrouter"}:${config.apiKey}:${resolvedBaseUrl}:${config.model}\`;` — the API key is part of an in-memory deduplication key. Not a direct vulnerability (the key is already in `this.apiKey`), but it creates an additional in-memory location where the key exists. Same pattern in `CustomProviderClient` (`src/api/custom-provider.ts:30-37`). **Severity: Low.**

**7. OpenRouter prefix validation logged but no-op** — `src/api/standard-client.ts:72-74`: `if (isStrictOpenRouter && !apiKey.startsWith("sk-or-")) { // Specific openrouter prefix validation could be logged here. }` — the comment promises logging that doesn't exist. **Severity: Low.**

**8. KiloCode `reviewCode()` assumes LLM returns parseable JSON** — `src/api/kilocode.ts:206`: `return JSON.parse(content || "{}");` — calls `JSON.parse()` on LLM-generated content without catching parse errors. If the LLM returns non-JSON text, this throws an unhandled exception. Same pattern at `src/api/kilocode.ts:238`. **Severity: Medium.**

**9. Cost tracker rounding is display-only** — `src/api/cost.ts:165-169`: `formatCost()` uses `toFixed(4)` for display but the underlying `totalCost` in `SessionCostTracker` accumulates raw floating-point values. The base currency is implicitly USD with no configuration surface. **Severity: Low.**

**10. Model capability detection is purely heuristic** — `src/api/model-capabilities.ts:11-38`: `isReasoningModel()` splits model names on `/[^a-z0-9]/` and checks against a hardcoded Set of tokens. This works for known models but will misclassify any model whose name contains "o1", "r1", etc. as patterns rather than version identifiers (e.g., a future model named "nebula-reasoner-o1" vs "nebula-o1-classifier"). `getReasoningField()` (line 56) uses substring matching for Anthropic/Claude to pick "thinking" vs "reasoning" — this is a reasonable heuristic but brittle. **Severity: Low.**

### Web Tools

**11. Credential leakage in error text** — `src/agent/tools/web.ts:508`: The `Authorization` header template literal appears correctly formed (`Bearer ${apiKey}`), but line 349 has the same pattern. The `handleResponseError` sanitizer in `base-client.ts:496-499` shows awareness that error bodies may contain credentials. However, `web.ts`'s error paths (lines 291-304, 475-482) return `error.message` directly — if the error contains URL/credentials, they leak. **Severity: Low-Medium.**

**12. No rate limiting on web operations** — All web operations (`webFetch`, `webSearch`, `codeSearch`) lack client-side rate limiting. The Exa SDK and OpenRouter API may have server-side limits, but there's no client-side throttling, queue management, or circuit breaker. **Severity: Low.**

**13. TurboDownService removes nav/footer/header/aside** — `src/agent/tools/web.ts:618-627`: The HTML-to-markdown conversion strips `nav`, `footer`, `header`, `aside` elements. This may remove navigation context, breadcrumbs, and sidebar content that is relevant to understanding the page. **Severity: Low** (design choice).

### Terminal Layer

**14. `getColors()` called once at module scope, not per-render** — `src/terminal/markdown.ts:85`: `const COLORS = getColors();` — the color palette is resolved at module load time, not on each call to `renderMarkdownToAnsi()`. If the terminal capabilities change mid-session (e.g., window moves between monitors with different color support), the change won't be reflected until module re-import. **Severity: Low.**

**15. `renderMarkdownToAnsi()` renders full document each call** — `src/terminal/markdown.ts:375-388`: Every call re-lexes and re-renders the full markdown. No incremental rendering. The `StreamingOutputManager` (`src/terminal/buffered-writer.ts:298-440`) batches tokens and periodically flushes rendered markdown, but each flush re-renders the entire accumulated content, not just the delta. **Severity: Low** (performance).

### Messaging

**16. Telegram bot token in URL path** — `src/messaging/connector-manager.ts:306`: The webhook route is `/telegram/${telegramBotToken}` — the bot token appears as part of the URL path, which means it will be logged in server access logs and potentially exposed in error pages. A UUID or HMAC-based path would be more secure. **Severity: Medium.**

**17. Webhook server on port 3333 with no authentication** — `src/messaging/connector-manager.ts:44-51`: `ensureWebhookServer()` creates an HTTP server on port 3333 that handles requests for any path. While individual webhook handlers check secrets, the server itself has no authentication layer, so it's subject to DoS and port-scanning attacks. **Severity: Low-Medium.**

**18. `connectWithBackoff()` is dead code** — `src/messaging/connector-manager.ts:96-142`: Marked with `noUnusedPrivateClassMembers` suppression and `@ts-expect-error`. The actual reconnection logic is duplicated inline in `initSlackSocketMode` and `initDiscordGateway`. **Severity: Low** (code quality).

### Daemon

**19. Daemon client has no connect timeout** — `src/daemon/client.ts:13`: `this.client = net.createConnection(SOCKET_PATH);` — no timeout on the connection attempt. If the socket file exists but the daemon is unresponsive, the connection hangs indefinitely. The server creates sockets with `socket.setTimeout(300000)` (5 min, `server.ts:27`), but the client doesn't set a connect timeout. **Severity: Medium.**

**20. State engine has no disk persistence** — `src/daemon/state-engine.ts:18-24`: All state (active contexts, child processes, FS event queue) is in-memory. On daemon restart, all state is lost. No snapshot/restore mechanism exists. **Severity: Low** (by design, but undocumented assumption).

### MCP

**21. Stdio transport passes all env vars to child process** — `src/mcp/client.ts:229`: `env: { ...process.env, ...config.env } as Record<string, string>` — the MCP stdio transport inherits the entire parent process environment. This includes `process.env.TEHUTI_PERMISSION_RULES` (issue #5), API keys, and potentially other secrets. The SDK's `StdioClientTransport` also supports a filtered env approach but this code spreads the full current env. **Severity: Medium** (amplifies issue #5).

**22. WebSocket transport doesn't support authentication headers** — `src/mcp/client.ts:289`: `return new WebSocketClientTransport(new URL(config.url));` — unlike the SSE and HTTP transports which accept `config.headers`, the WebSocket transport passes no headers or connection options. WebSocket MCP servers requiring auth headers in the initial HTTP upgrade cannot be used. **Severity: Low** (missing feature).

### Permissions

**23. `check()` returns "prompt" as fallback for any tool not in rules** — `src/permissions/rules.ts:221`: The default return from `check()` is `"prompt"`, meaning every unrecognized tool triggers an interactive prompt. Combined with the lack of persistent rules (issue #5), this means every session starts with no remembered decisions. **Severity: Low** (by design, but creates friction).

**24. Synchronous SQLite operations in session resolver** — `src/messaging/session-resolver.ts:65-84, 120-136, 151-158`: The session resolver uses `db.prepare().run()` synchronously inside what should be async message handling. SQLite is fast for these operations, but synchronous I/O in an async context blocks the event loop. **Severity: Low.**

---

## Summary Statistics

| Layer | Files Reviewed | Issues Found | High | Medium | Low |
|-------|---------------|-------------|------|--------|-----|
| API        | 11   | 9  | 2  | 2  | 5  |
| Web Tools  | 1    | 3  | 0  | 0  | 3  |
| Terminal   | 5    | 2  | 0  | 0  | 2  |
| Messaging  | 3    | 4  | 0  | 2  | 2  |
| Daemon     | 4    | 2  | 0  | 1  | 1  |
| MCP        | 2    | 2  | 0  | 1  | 1  |
| Permissions| 2    | 3  | 1  | 0  | 2  |
| **Total**  | **28** | **24** | **4** | **6** | **14** |

---

## Recommended Actions (by issue #)

1. **#1 (P0):** Encrypt OAuth tokens at rest using OS keychain (macOS Keychain, Linux secret-tool) or at minimum derive an encryption key and use `node:crypto` AEAD before writing to config. Apply same treatment to API response cache — either encrypt entries or warn users that `.tehuti/api-cache/` contains plaintext conversation data.

2. **#2 (P0):** Add explicit `initializeHttpAgent()` call at the start of `base-client.ts`'s constructor or at API module init. Remove the silent `if (globalAgent) return;` guard and replace with proper re-initialization. Consider making the http-agent module self-initializing on first import.

3. **#3 (P0):** Add event-loop yielding via `setImmediate` or `queueMicrotask` in the SSE parser's inner while loop after each `yield`, matching the already-documented pattern in `streaming.ts`.

4. **#4 (P1):** Add a max cache size (e.g., 50MB or 1000 entries) with LRU eviction to the response cache. Sweep expired entries on `get()` rather than leaving stale files. Wire the existing daemon GC to sweep the API cache.

5. **#5 (P1):** Replace `process.env`-based rule persistence with file-based storage (e.g., `.tehuti/permissions.json` with `0o600` permissions). Remove the environment variable entirely to prevent child-process leakage.
