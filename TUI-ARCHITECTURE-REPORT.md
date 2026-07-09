# Tehuti CLI TUI Architecture — Exhaustive Analysis Report

> **Evidence-backed, line-level analysis of every TUI source file.**
> Project: `/Users/youssefsala7/Projects/Tehuti-CLI-Revival/`
> Total `chat.ts` size: 4199 lines, 110KB.

---

## (1) `chat.ts` Architecture — The 4199-Line Monolith

### 1.1 CLI Routing & Program Construction (Lines 3872–4199)

The `createProgram()` function at **line 3872** builds the Commander.js program:

```
3872| export function createProgram(): Command {
3873|   const program = new Command();
3874|   program.name("tehuti") ...
3879|   .option("-m, --model <model>", ...)
3880|   .option("-p, --provider <provider>", ...)
3884|   .option("-d, --debug", ...)
3886|   .option("-j, --json", ...)
3895|   .option("-c, --continue", ...)
3896|   .option("--companion", ...)
3897|   .argument("[prompt]", "One-shot prompt")
3898|   .action(async (prompt?, options?) => { ... })
```

**Two operational modes** in the action handler (line 3898):
- **One-shot mode** (line 3912): If `prompt` is provided, creates an `AgentContext`, runs `runAgentLoop` with `StreamingOutputManager` callbacks for token/toolcall streaming, outputs JSON or plain text. Never renders Ink.
- **Interactive TUI mode** (line 4013): If no `prompt`, monkey-patches `process.stdout.write` to inject `\x1b[?2026h`/`l` (synchronized output mode) around each write (lines 4014–4025), then calls `render(<App ...>)` from Ink.

**Subcommands** attached at the bottom:
- `program.addCommand(daemonCommand())` — line 4195
- `program.addCommand(companionCommand())` — line 4196
- `init` subcommand (line 4049): `runSetupWizard()`
- `config` subcommand (line 4056): display masked config
- `mcp` subcommand (line 4070): MCP server management (status/tools/connect/disconnect/refresh)

### 1.2 App Component & Mouse Wrapper (Lines 3829–3870)

The `App` function wraps `ChatUI` in a `MouseProvider` from `@ink-tools/ink-mouse`:

```
3829| function App({ companionMode, apiKey, model, diffPreview, cfg, continueSession, onExit }) {
3853|   const [mouseEnabled, setMouseEnabled] = useState(initialMouseEnabled);
3855|   return React.createElement(MouseProvider, { autoEnable: false },
3858|     React.createElement(ChatUI, { ... mouseEnabled, onToggleMouse: () => setMouseEnabled(!mouseEnabled) })
```

Mouse is enabled if `TEHUTI_DISABLE_MOUSE !== "1"` and `NO_MOUSE !== "1"` and `process.stdout.isTTY` (line 3848–3851).

### 1.3 ChatUI Component — The Core Renderer (Lines 594–3826)

`ChatUI` at **line 594** is a single React function of ~3200 lines. It receives `apiKey`, `model`, `diffPreview`, `cfg`, `continueSession`, `onExit`, `mouseEnabled`, `onToggleMouse`, `companionMode`.

#### 1.3.1 State Initialization (Lines 615–678)

All state is managed by `useChatState` hook (line 678), returning 26 state variables. Additionally, a local `commandPaletteInitialQuery` state (line 679).

#### 1.3.2 Provider Resolution System (Lines 682–848)

A multi-layer provider resolution chain:
- `normalizedProvider` (line 682): `useMemo` to normalize runtime provider
- `resolveRuntimeApiKey` (line 686): `useCallback` — resolves apiKey through: explicit key → env var → runtime state → config → undefined
- `resolveRuntimeProviderState` (line 727): `useCallback` — resolves full provider state (provider, baseUrl, apiKey, customProvider)
- `applyRuntimeProviderState` (line 784): `useCallback` — writes resolved state to `ctxRef.current.config`
- `persistRuntimeProviderState` (line 820): `useCallback` — saves to global config
- `getActiveConfig` (line 839): `useCallback` — returns merged config

#### 1.3.3 Request Management (Lines 866–891)

```
866| const requestGenerationRef = useRef(0);
867| const requestControllerRef = useRef<AbortController | null>(null);
869| const abortActiveRequest = useCallback(() => { ... });
878| const beginRequest = useCallback(() => { ... });
888| const isCurrentRequest = useCallback((requestId, signal) => ...);
```

Each new request increments `requestGenerationRef` and creates a fresh `AbortController`. `isCurrentRequest` gates all callbacks to prevent stale responses from updating UI.

#### 1.3.4 Reset System (Lines 894–962)

`resetConversation` aborts active requests, clears messages, resets all state, optionally creates a new session.

#### 1.3.5 Companion Mode / Daemon Client (Lines 976–1026)

When `companionMode` is true, a `TehutiDaemonClient` is instantiated (line 979). Messages received from the daemon (`token`, `toolCall`, `toolResult`, `completion`, `error`) are routed to `agentEventBus.emit("streamEvent", ...)` (lines 991–1013).

#### 1.3.6 Terminal Size Tracking (Lines 1028–1051)

```
1028| const [terminalSize, setTerminalSize] = useState({ rows: stdout?.rows || 24, columns: stdout?.columns || 80 });
```

Debounced resize handler (100ms timeout, line 1037).

#### 1.3.7 Periodic Auto-Save (Lines 1053–1066)

Every 60 seconds, `sessionManager.saveSession` is called if `sessionId` and `ctxRef.current` exist.

#### 1.3.8 Pending Session Flush Registry (Lines 1071–1077)

```
1071| useEffect(() => {
1073|   setPendingSessionFlush({ sessionId, ctx: ctxRef.current });
```

Uses the module-level `pendingSessionFlush` variable (line 125) so SIGINT/SIGTERM handlers can persist the session.

### 1.4 VIEWPORT SCROLL MODEL — The Negative Margin Hybrid (Lines 1079–2204)

THIS IS THE MOST CRITICAL ARCHITECTURAL PATTERN.

#### 1.4.1 Mouse Wheel Support (Lines 1079–1086)

```
1079| const scrollContainerRef = useRef(null);
1080| useOnWheel(scrollContainerRef, (event) => {
1081|   if (event.button === "wheel-up") scrollLineUp();
1082|   else if (event.button === "wheel-down") scrollLineDown();
```

#### 1.4.2 Viewport Height Calculation (Lines 1088–1939)

```
1088| const terminalHeight = terminalSize.rows;
1089| const terminalWidth = terminalSize.columns;
1090| const headerHeight = 3;
1091| const inputHeight = 3;
1092| const warningsHeight = configWarnings.length * 4;
...
1927| const paletteHeight = showCommandPalette ? 16 : 0;
1929| const chatViewportHeight = Math.max(3,
1930|   terminalHeight - headerHeight - inputHeight - 4 - warningsHeight - suggestionsCount - paletteHeight
```

So `chatViewportHeight = terminalHeight - 3 - 3 - 4 - warnings*4 - 0 - (palette?16:0)`.

#### 1.4.3 `totalMessageLines` Computation (Lines 1943–1952)

```
1943| const totalMessageLines = useMemo(() => {
1944|   let lines = 0;
1945|   for (const msg of messages) {
1946|     lines += computeMessageLines(msg, contentMaxWidth);
1948|   if (showWelcome) lines += messages.length > 0 ? 3 : 12;
1951|   return lines;
```

Uses `computeMessageLines` from `terminal/output.ts` — applies a `WeakMap` cache per message object (line 326).

#### 1.4.4 `visibleMessages` — The Hybrid Slice + Estimate Approach (Lines 2080–2160)

```
2083| const visibleMessages = useMemo(() => {
2084|   const linesNeeded = chatViewportHeight + scrollOffset + 20;  // +20 buffer
2085|   const avgCharsPerLine = Math.max(20, contentMaxWidth - 4);
2086|   const estimateMsgLines = (msg: any) => {
2087|     let l = 1;
2088-2150| // ... for each block type (text/reasoning/tool), estimates line count using char count ÷ avgCharsPerLine + newline count
2151|   };
2152|   let accumulatedLines = 0;
2153|   let sliceIndex = messages.length;
2154|   for (let i = messages.length - 1; i >= 0; i--) {
2155|     accumulatedLines += estimateMsgLines(messages[i]);
2156|     sliceIndex = i;
2157|     if (accumulatedLines >= linesNeeded) break;
2159|   return messages.slice(Math.max(0, sliceIndex - 10));  // -10 for safety buffer
```

Key design:
- Walks messages **backward** (bottom-up) accumulating estimated line counts
- Stops when accumulated lines ≥ `chatViewportHeight + scrollOffset + 20`
- Returns `messages.slice(Math.max(0, sliceIndex - 10))` — includes 10 extra messages above the slice point
- Uses a **cheap character-length-based estimate** rather than full `computeMessageLines` to avoid expensive markdown rendering during streaming
- `useDeferredValue(visibleMessages)` at line 3004 wraps for concurrent-mode prioritization

#### 1.4.5 Scroll Functions (Lines 2162–2198)

```
2162| const scrollToBottom = useCallback(() => {
2163|   messagesEndRef.current = true;
2164|   setScrollOffset(0);
2167| const scrollToTop = useCallback(() => {
2168|   messagesEndRef.current = false;
2169|   setScrollOffset(Math.max(0, totalMessageLines - chatViewportHeight));
2172| const scrollPageUp = useCallback(() => { ... off + chatViewportHeight });
2178| const scrollPageDown = useCallback(() => { ... off - chatViewportHeight });
2186| const scrollLineUp = useCallback(() => { ... off + 3 });  // Scrolls by 3 lines
2192| const scrollLineDown = useCallback(() => { ... off - 3 });
```

Key: `scrollOffset` represents pixels **above** the viewport, NOT below. Scroll-offset 0 = at bottom. Scroll up increases offset.

#### 1.4.6 THE NEGATIVE MARGIN PATTERN — Exact Rendering (Lines 3639–3687)

```
3639| React.createElement(Box, {
3642|   ref: scrollContainerRef,
3643|   flexDirection: "column",
3644|   flexGrow: 1,
3645|   overflow: "hidden",
3646|   justifyContent: "flex-end",           // ← CRITICAL: flex-end fills upward
3648|   React.createElement(Box, {
3649|     flexDirection: "column",
3650|     marginBottom: -scrollOffset           // ← NEGATIVE MARGIN TRICK
3651|   },
3652|     showWelcome && <TehutiHeader compact />,
3685|     ...messageElements,                   // ← sliced messages go here
```

**How the scroll works:**
- The outer container uses `justifyContent: "flex-end"` to push children to the bottom
- The inner content Box has `marginBottom: -scrollOffset`
- Negative `marginBottom` pulls the content **upward** by `scrollOffset` pixels
- `overflow: "hidden"` on the outer container clips the content
- Combined with `visibleMessages` slice, only messages that intersect the viewport are rendered
- The `+20` buffer in `linesNeeded` and `sliceIndex - 10` ensures offscreen rendering to avoid visual gaps

This is a **hybrid approach**: the visibleMessages slice determines WHICH messages render, while the negative margin determines WHERE they render within the viewport.

#### 1.4.7 Scroll-on-new-message (Lines 2200–2204)

```
2200| useEffect(() => {
2201|   if (messagesEndRef.current) scrollToBottom();
```

If the user is at the bottom (`messagesEndRef.current === true`), auto-scroll to bottom on every render.

### 1.5 Slash Command System (Lines 2260–2596)

The `send` function (line 2255) intercepts `text.startsWith("/")` and dispatches:

| Command | Lines | Handler |
|---------|-------|---------|
| `/exit`, `/quit`, `/q` | 2263 | Prints cost summary, exits |
| `/clear` | 2271 | `resetConversation()` |
| `/mouse` | 2276 | Toggle mouse via `onToggleMouse()` |
| `/copy` | 2300 | Copies last assistant message to clipboard via `clipboardy` |
| `/cost` | 2340 | Shows session stats |
| `/stats` | 2353 | Shows telemetry summary |
| `/help` | 2367 | `formatHelpOutput()` |
| `/providers` | 2379 | `handleProviderSwitch()` (alias for `/provider`) |
| `/provider <id>` | 2384 | `handleProviderSwitch(requestedProvider)` |
| `/sessions` | 2395 | Loads sessions → `setShowSessionList(true)` |
| `/search <q>` | 2416 | `handleSearchSessions(query)` |
| `/auth gemini` | 2422 | Dynamic import of `authenticateGoogleOAuth` |
| `/reset-key` | 2458 | Deletes `~/.tehuti.json` |
| `/config` | 2471 | `setShowConfigEditor(true)` |
| `/save [name]` | 2476 | Saves session with optional name |
| `/export [format]` | 2492 | Exports to JSON or Markdown |
| `/load <id>` | 2546 | `loadSessionById(id)` |
| `/model` | 2552 | Shows model switch help |
| `/models` | 2565 | `handleShowModels()` |
| `/model <name>` | 2570 | Switches model + persists |
| Unknown | 2588 | "Unknown command" message |

### 1.6 Agent Callbacks (Lines 2656–2803)

The `loopOptions` object defines streaming callbacks:

```
2656| const loopOptions = {
2657|   onToken: (t) => { response += t; batchToken(t); },
2667|   onToolCall: (id, name, args) => { flushBatchedTokens(); toolCallsInfo.push({...}); setMessages(...); },
2702|   onToolResult: (id, name, result) => { flushBatchedTokens(); update tool result in messages; },
2738|   onThinking: (content) => { push reasoning block to messages; },
2778|   onProgress: (progress, label) => { setProgress(progress); setOperationLabel(label); },
2788|   onCheckpoint: (event, checkpointCtx) => { save session on checkpoint; },
2802|   signal: globalAbortController.signal,
```

Token batching: `batchToken` (line 1165) accumulates into `batchedTokensRef`, flushing on newline, >20 chars, or 50ms timer. `flushBatchedTokens` (line 1115) writes accumulated tokens to `streamingContentRef` and updates messages.

### 1.7 Session Loading (Lines 1533–1776)

`loadSessionById`:
1. Calls `sessionManager.loadSession(id)` (line 1537)
2. Runs `checkSessionHealth` — blocks on `"blocked"` status (line 1542)
3. Rebuilds `UiMessage[]` from historical messages (lines 1573–1640), mapping tool_calls to blocks
4. Creates a fresh `AgentContext` with the loaded model/provider (line 1649)
5. Seeds `ctxRef.current.messages` and `appendOnlyLog` (lines 1693–1698)

### 1.8 Message Rendering (Lines 3006–3355)

Three role branches (lines 3011–3071):
- **User**: `𓆄 You` header in CORAL, plain text wrap
- **System**: `𓏛 System` header in SAND dim, renders markdown or plain text
- **Assistant** (Tehuti): `𓆣 Tehuti` header in GREEN, renders blocks

For assistant messages:
- `text` blocks: Parsed via `parseContentBlocks` for `<think>...</think>` sub-blocks, then rendered via `renderMarkdown`
- `reasoning` blocks: Border box with `┌─[ 𓁹 Reasoning ]──...` header (lines 3110–3204)
- `tool` blocks: Wrapped in `ExpandableToolOutput` component (line 3206)
- `toolCalls` fallback: For 2+ tools, rendered side-by-side with `flexDirection: "row"` and `flexWrap: "wrap"` (lines 3291–3321)

Message container Box uses `borderLeft: true` with role-colored border (GOLD for assistant, CORAL for user, gray for system) — line 3338.

### 1.9 Input Rendering (Lines 3360–3432)

Custom cursor rendering with `\u2588` (block character) — line 3420. Supports text selection display with `backgroundColor: "gray", color: "black"` (line 3395).

### 1.10 Assistant Message Finalization (Lines 2847–2918)

After `runAgentLoop` returns, builds the final message with `compactBlockForUi` compaction, preserves tool call results from blocks to `toolCalls` array for backward compatibility (lines 2901–2909).

---

## (2) Every Ink Component

### 2.1 `TehutiHeader` (`src/cli/ui/components/TehutiHeader.tsx`, 171 lines)

**Props**: `compact?`, `model?`, `provider?`, `onModelClick?`, `onConfigClick?`, `onCommandClick?`

**Two modes**:
- **Full** (lines 101–170): Gradient BigText "TEHUTI" (ink-gradient + ink-big-text), "THOTH, TONGUE OF RA", Model/API clickable badges, `/help` `/clear` `/exit` shortcuts
- **Compact** (lines 59–98): Single row: `𓆣 TEHUTI │ Model: X │ API: Y │ 𓁹 Write • Edit`

**Internal component** `ClickableBadge` (lines 21–47): `useOnClick`, `useOnMouseEnter`, `useOnMouseLeave` from `@ink-tools/ink-mouse`.

**Colors**: `BRANDING.colors.secondary` (GOLD), `sand` (SAND), `coral` (CORAL).

### 2.2 `CommandPalette` (`src/cli/ui/components/CommandPalette.tsx`, 859 lines)

**Props**: `commands: CommandItem[]`, `onSelect`, `onClose`, `visible`, `initialQuery?`

**Features**:
- **Fuzzy search**: Custom `fuzzyMatch` function (line 55) that scores matches character-by-character with bonuses for first-char + case-sensitivity
- **Multi-field matching** (lines 244–300): Tests against `label`, `description`, `id`, and `aliases`, picks best match
- **Submenu stack** (lines 225–227): `menuStack: {title, commands}[]` for nested navigation (e.g., `/model` → submenu of models)
- **Virtual scrolling**: Uses `useVirtualScroll` with `MAX_DISPLAY = 9` (lines 330–342)
- **Vim navigation**: `useVimInput` with j/k when query is empty (lines 376–380)
- **Keyboard handling** (lines 382–462): Escape to pop stack/close, backspace to pop stack when query empty, character input with mouse sequence filtering
- **Highlighted matches** (line 81–130): `highlightMatch` renders matched characters in GOLD with underline (when not selected) or black-bold (when selected)
- **Grouped display** (lines 470–476): Commands grouped by category (submenu/recent/session/model/help)
- **Recent command tracking** (lines 608–623): `addRecentCommand` persists to `globalConfig.recentCommands`
- **`CommandItemRow`** component (lines 132–212): Clickable row with mouse hover, selected state changes `backgroundColor: GOLD`, text to `black`

### 2.3 `HieroglyphSpinner` (`src/cli/ui/components/HieroglyphSpinner.tsx`, 18 lines)

Cycles through `HIEROGLYPHS.thinking` array: `["𓂝", "𓃀", "𓆣", "𓁹", "𓊖"]` every 150ms (line 10). Renders in `BRANDING.colors.gold`.

### 2.4 `ExpandableToolOutput` (`src/cli/ui/components/ExpandableToolOutput.tsx`, 360 lines)

**Props**: `toolName`, `result`, `maxWidth`, `status` ("pending"|"success"|"error"), `defaultExpanded?`, `isParallel?`

**Features**:
- `React.memo` wrapped (line 150)
- Click to expand/collapse (line 164)
- **Mouse hover tracking** with `GlobalInputState.hoveredComponentCount` (lines 168–188)
- **Pending state spinner**: Uses `HIEROGLYPHS.loading` array on 150ms interval (line 199–208)
- **Duration tracking** (line 158): `Date.now() - startTimeRef.current`
- **Virtual scrolling** when expanded: Uses `useVirtualScroll` with 40-line visible window (lines 221–224), arrow keys navigate when hovered
- **Syntax highlighting**: `highlightToAnsi(formatted, language)` on expanded view (line 304)
- **Language detection** (lines 276–290): "markdown" for `write_plan` or objects with `uiOutput`, "json" for JSON-parsable output, "text" otherwise
- **ANSI-aware truncation**: `sliceAnsi` (lines 50–76) truncates by visual width while preserving ANSI escape sequences
- **Three status modes** (lines 238–250): pending=gold spinner, success=green ankh, failed=red eye
- **Border**: single left border in `borderTextColor` (coral when hovered, gray otherwise)

### 2.5 `TodoList` (`src/cli/ui/components/TodoList.tsx`, 87 lines)

Polls `getTodos()` every 1 second (line 11), but **skips updates when `GlobalInputState.hoveredComponentCount > 0`** (line 12). Renders status icons: ⏳ pending, ✅ completed, 🔄 in_progress, ❌ cancelled, with priority marks (🔴/🟡/🟢). Shows age (minutes/hours ago).

### 2.6 `SessionList` (`src/cli/ui/components/SessionList.tsx`, 220 lines)

**Props**: `sessions: SessionMetadata[]`, `onLoadSession`, `onClose`

Uses `useVirtualScroll` with `PAGE_SIZE = 15` (line 97). ASCII table with `SessionRow` sub-component showing ID, Name, Msgs, Tokens, Model, Date. Vim navigation with `useVimInput` (j/k, Enter to select, d to delete stub). Mouse hover via `@ink-tools/ink-mouse`.

### 2.7 `MemoryIndicator` (`src/cli/ui/components/MemoryIndicator.tsx`, 54 lines)

Listens to `agentEventBus` "memoryEvent" events. Shows spinner for "start"/"learning", ✓ for "success", ℹ for "idle". Auto-hides after 3 seconds for idle/success events.

### 2.8 `SwarmVisualizer` (`src/cli/ui/components/SwarmVisualizer.tsx`, 142 lines)

Listens to `swarmManager` "update" events. Renders a table: AGENT ID, ROLE, STATUS, CURRENT TASK, TOKENS. Color-coded status (green=working, coral=error, gray=idle).

### 2.9 `MediaViewer` (`src/cli/ui/components/MediaViewer.tsx`, 97 lines)

**Props**: `src: string`, `alt?: string`

Checks if `src` is a local file path (line 42). Calls `renderMediaToTerminal(resolvedSrc, { width: "50%" })` (line 48). Shows spinner while rendering, error box on failure. Roughly 1-second rendering time.

### 2.10 `StatusIndicator` (`src/cli/ui/components/StatusIndicator.tsx`, 26 lines)

Simple ternary: ✅ for success, ❌ for error, `<Spinner type="dots">` for loading.

### 2.11 `PermissionPrompt` (`src/cli/ui/components/PermissionPrompt.tsx`, 59 lines)

**Props**: `request: PermissionRequest`, `isDangerous: boolean`, `onAnswer: (allowed) => void`

Uses `useInput`: Enter=default (deny if dangerous), y=yes, n=no. Displays prompt message lines from `buildPromptMessage`.

### 2.12 `QuestionPrompt` (`src/cli/ui/components/QuestionPrompt.tsx`, 183 lines)

**Props**: `question: QuestionData`, `onAnswer`, `onCancel`

Supports: single-select (arrow keys + Enter), **multiple-select** (Space to toggle, Enter to submit), **custom text input** (select "Type custom answer" to enter edit mode). Up/down wrap around (modulo on options.length + 1). Vim-style keyboard handling: escape cancels, backspace in custom mode.

### 2.13 `ProgressBar` (`src/cli/ui/components/ProgressBar.tsx`, 42 lines)

**Props**: `value: number`, `label?`, `width?`

Renders filled "━" and empty "─" characters. Shows percentage and optional label.

### 2.14 `ConfigEditor` (`src/cli/ui/components/ConfigEditor.tsx`, 462 lines)

**Props**: `config` (apiKey/model/provider/baseUrl/temperature/maxTokens), `onSave`, `onCancel`, `width?`

**Features**:
- **Tabbed interface** (lines 154–156): "API & Provider" vs "Model Options"
- **`ConfigTab`** sub-component (lines 48–73): Clickable tabs with GOLD/GRAY coloring
- **`ConfigFieldRow`** sub-component (lines 75–143): Clickable field with edit mode
- **6 configurable fields** (lines 164–250): provider, apiKey, baseUrl, model, temperature, maxTokens
- **Inline editing**: Click field → bounds keyboard input → Enter to commit
- **Validation error** display (line 158)
- Uses `useVimInput` for navigation, `useVirtualScroll` for scrolling

---

## (3) All Hooks

### 3.1 `useChatState` (`src/cli/ui/hooks/useChatState.ts`, 154 lines)

A single function returning 26 state variables + 2 refs:

```
messages, setMessages          — Array of {id, role, content, status?, toolCalls?, blocks?}
input, setInput                — Current input string
cursorPos, setCursorPos        — Cursor position in input
selectionStart/End             — Text selection range
loading, setLoading            — Whether agent is running
error, setError                — Error message
ctxModel, setCtxModel          — Current model name
runtimeProvider, setRuntimeProvider — Current provider ID
runtimeBaseUrl, setRuntimeBaseUrl   — Current base URL
runtimeApiKey, setRuntimeApiKey     — Current API key
runtimeCustomProvider, setRuntimeCustomProvider — Custom provider config
scrollOffset, setScrollOffset  — Scroll position
history, setHistory            — Command history
historyIndex, setHistoryIndex  — Current position in history
sessionId, setSessionId        — Active session UUID
showWelcome, setShowWelcome    — Show welcome header
sessionCost, setSessionCost    — Session cost in dollars
thinking, setThinking          — Thinking indicator text
showThinking, setShowThinking  — Show thinking indicator
showCommandPalette, setShowCommandPalette
showDashboard, setShowDashboard
showSessionList, setShowSessionList
savedSessions, setSavedSessions
pendingQuestion, setPendingQuestion — {questions, resolve, reject}
progress, setProgress (0-100)
operationLabel, setOperationLabel
showConfigEditor, setShowConfigEditor
pendingPermission, setPendingPermission — {request, isDangerous, resolve, reject}
queuedMessages, setQueuedMessages
questionResolverRef            — Ref to question resolver function
permissionResolverRef          — Ref to permission resolver function
```

### 3.2 `useChatInput` (`src/cli/ui/hooks/useChatInput.ts`, 769 lines)

**Props**: 35+ props including all input/scroll/history state setters, plus `send`, `resetConversation`, `saveHistory`, etc.

**Ref layer** (lines 100–111): Maintains `inputRef`, `cursorPosRef`, `selectionStartRef`, `selectionEndRef`, `historyRef`, `historyIndexRef`, `loadingRef` to avoid stale closures in `useInput` callback.

**Mouse buffer** (lines 219–253): `absorbMouseFragment` collects split mouse escape sequences, flushes after 50ms timeout or on tail character.

**Stable setters** (lines 113–173): Each setter wraps the original in a callback that writes to both the ref and React state.

**useInput handler** (lines 255–769): Massive single callback handling:
- Mouse scroll sequences (`\x1b[<64;` and `\x1b[<65;`) — lines 264–271
- Ctrl+P → command palette toggle — lines 281–286
- Modal guard (pauses input when palette/config/question open) — lines 288–295
- Selection deletion — lines 299–309
- Shift+arrow → extend selection — lines 312–328
- Bracketed paste (`\x1b[200~...\x1b[201~`) — lines 331–348
- Backspace/delete — lines 350–379
- Ctrl+C handling: copy selected text (OSC 52), interrupt agent, or exit — lines 381–424
- Modified Enter (shift/meta/ctrl, various CSI escapes) → insert newline — lines 429–447
- Regular Enter → send message or queue — lines 449–472
- History up/down — lines 474–503
- PageUp/PageDown → scroll — lines 505–513
- Ctrl+arrows → scroll — lines 515–523
- Home/End → scroll — lines 525–533
- Ctrl+L → clear — line 535
- Ctrl+U → delete to start — line 540
- Ctrl+A/E → start/end of line — lines 547–555
- Ctrl+W/option+BS → delete word — lines 558–574
- Ctrl+K → delete to end — line 576
- Ctrl+D → exit or forward delete — lines 582–605
- Left/right arrows → move cursor — lines 615–650
- Character input — lines 710–769
- Tab → command completion (line 743–762)

### 3.3 `useVimInput` (`src/cli/ui/hooks/useVimInput.ts`, 60 lines)

Triggers callbacks on j/k/Enter/backspace/d/r// keys (when `isActive`). Skips if ctrl/meta held. Used by CommandPalette and SessionList.

### 3.4 `useVirtualScroll` (`src/cli/ui/hooks/useVirtualScroll.ts`, 109 lines)

**Props**: `totalItems`, `maxVisibleWindow` (default 15), `initialSelectedIndex` (default 0)

**Returns**: `{ selectedIndex, windowStart, windowEnd, visibleSelectedIndex, moveUp, moveDown, getVisibleItems, setSelectedIndex }`

**State**: `selectedIndex`, `windowStart`

**Scrolling**: Moves window when selection exits visible range. `moveUp` sets `windowStart = newIndex` when above. `moveDown` sets `windowStart = newIndex - maxVisibleWindow + 1` when below.

**Safeguard**: `useEffect` (line 39) clamps selection and window when `totalItems` changes.

---

## (4) `markdown-mapper.tsx` — TUI Markdown Rendering (479 lines)

### 4.1 Text Wrapping (Lines 14–49)

`wrapText(text, width)`: Splits by newlines, then by words. Hard-breaks words longer than `width`. Uses `string-width` for accurate visual width.

### 4.2 Marked Setup (Line 56)

```
marked.use(markedKatex({ throwOnError: false }));
```

### 4.3 `renderMarkdown` (Lines 71–93)

Entry point: lexes markdown into tokens via `marked.lexer`, iterates calling `renderToken`.

### 4.4 `renderToken` Block Types (Lines 100–348)

| Token Type | Rendering | Colors |
|-----------|-----------|--------|
| `code` | Border box with language label `◆ lang`, Shiki-syntax-highlighted, line numbers | GOLD border, CORAL label |
| `heading` (h1) | Bold text + underline of "=" | GOLD |
| `heading` (h2) | Bold text + underline of "=" | CORAL |
| `heading` (h3+) | Bold text | GREEN |
| `paragraph` | Wrap text | — |
| `list` | Bullet `•` in CORAL | CORAL bullets |
| `blockquote` | Left border + dim/italic | GRAY border |
| `hr` | "─".repeat(lineLen) | GRAY dim |
| `table` | Full Unicode box-drawing: ╭┬╮ ├┼┤ ╰┴╯, column-width auto-sizing (2-pass), cell text wrapping | GOLD text |
| `space` | Newline | — |

### 4.5 `renderInlineToken` Inline Elements (Lines 350–479)

| Token | Rendering | Colors |
|-------|-----------|--------|
| `image` | `<MediaViewer src={href} alt={text}>` | — |
| `text` | Plain text | — |
| `codespan` | Inline code with background | CYAN text, `#1e293b` bg |
| `strong` | Bold | — |
| `em` | Italic | — |
| `link` | Underlined | CYAN |
| `br` | Newline | — |
| `del` | Strikethrough | — |
| `inlineKatex` | Italic | CYAN |
| `blockKatex` | Box with italic | CYAN |
| `html` | Wrap text | — |
| Unknown with `tokens` | Recurse into child tokens | — |

### 4.6 Reasoning Blocks

Reasoning blocks are NOT handled in markdown-mapper itself — they are parsed at the `ChatUI` level via `parseContentBlocks` (chat.ts:491) which extracts `<think>...</think>` tags and renders them as bordered `┌─[ 𓁹 Reasoning ]...└─` boxes.

---

## (5) `chat-memory.ts` and `input-state.ts`

### 5.1 `chat-memory.ts` (200 lines)

**Constants** (lines 1–8):
- `UI_MAX_MESSAGES = 120` — max messages in UI
- `UI_KEEP_FULL_RECENT_MESSAGES = 24` — last 24 kept uncompacted
- `UI_MAX_TEXT_CHARS = 24000` — text block char limit
- `UI_MAX_REASONING_CHARS = 8000` — reasoning block char limit
- `UI_MAX_TOOL_OUTPUT_CHARS = 6000` — tool output char limit
- `UI_MAX_TOOL_ARRAY_ITEMS = 40` — array items in compacted output
- `UI_MAX_TOOL_OBJECT_KEYS = 80` — object keys in compacted output
- `TOOL_RESULT_PREVIEW_CHARS = 12000` — preview char cap

**Types** (lines 10–34): `UiBlock` (text|reasoning|tool), `UiMessage` (with id, role, content, status, toolCalls, blocks).

**`truncateMiddle`** (lines 36–46): If small (≤64 chars), head-only. Otherwise 65% head + 35% tail with label.

**`safeStringify`** (lines 48–58): Stringifies with JSON, truncating via `truncateMiddle`.

**`compactToolResultForUi`** (lines 60–110): Recursive compaction. Handles strings (truncate), arrays (slice to 40 items), objects (limit to 80 keys, depth limit 4). Special handling for `uiOutput` key (500K char limit).

**`compactBlockForUi`** (lines 112–127): Compacts reasoning blocks to 8000 chars, text blocks to 24000 chars.

**`compactMessageForUi`** (lines 129–167): Compacts each message. If has blocks, truncates content to 1200 chars. Compacts tool results via `compactToolResultForUi`.

**`compactMessagesForUi`** (lines 169–175): Keeps last 120 messages, last 24 kept uncompacted.

**`estimateUiMessageChars`** (lines 177–190): Sums content + block content + tool result stringified length.

**`needsUiCompaction`** (lines 192–200): Returns true if >120 messages, or if any older message >1500 chars, or newer message >48000 chars.

### 5.2 `input-state.ts` (3 lines)

```
export const GlobalInputState = {
  hoveredComponentCount: 0,
};
```

A global mutable object tracking how many components are currently hovered, used by `ExpandableToolOutput` (increments on mouse enter, decrements on leave) and `TodoList` (pauses polling when hovered).

---

## (6) `terminal/output.ts` — `computeMessageLines` (560 lines)

### 6.1 `computeMessageLines` Algorithm (Lines 325–406)

```
325| export function computeMessageLines(msg: any, contentMaxWidth: number): number {
326|   if (lineCache.has(msg)) return lineCache.get(msg)!;  // WeakMap cache
330|   let lines = 0;
331|   lines += 1;  // Role header
```

**Block extraction** (lines 333–340): Tries `msg.blocks` first, then `Array.isArray(msg.content)`, then falls back to `parseContentBlocks(msg.content)`.

**Per-block handling** (lines 342–389):
- `text` blocks: Extracts text content from `block.content` (string), `block.text` (string), or array. Calls `computeMarkdownLines(textContent, contentMaxWidth - 1)`.
- `reasoning` blocks: +2 for borders, then `wrap(reasoningContent, Math.max(10, contentMaxWidth - 5)).split("\n").length`.
- `tool` blocks: `computeToolHeight(block.result, contentMaxWidth, block.isExpanded)`.

**`computeMarkdownLines`** (lines 270–273): Calls `renderMarkdownToAnsi(text)` then `wrap(rendered, width).split("\n").length`.

**`computeToolHeight`** (lines 275–315): Extracts output string from result (string, object.output, object.full/preview, JSON.stringify). Caps at 8000 chars. Wraps each line. Returns `2 + 1 + 2 + previewLines + 1 + 1` (borders + header + marginY + content + footer + marginBottom).

**Fallback** (lines 390–392): If no blocks but `msg.content` is a string, calls `computeMarkdownLines`.

**Tool calls** (lines 394–401): If `toolCalls` exist and no tool block already, adds `computeToolHeight` for each.

```
403|   lines += 1;  // Margin bottom between messages
404|   lineCache.set(msg, lines);
```

**Cache** (lines 317–323): `let lineCache = new WeakMap<any, number>()`. Cleared on stdout resize.

### 6.2 Known Gap with Array Content (Lines 346–358)

When `block.content` is an array (line 346), the code maps each element extracting `c.text` or converting to string (lines 347–352). However, if the array contains objects without a `.text` property (e.g., `{ type: "text", content: "..." }` from the marked lexer), the fallback (`String(block.content || ...)`) at line 358 would produce `[object Object]` concatenation — a potential rendering bug for deeply-nested array content.

---

## (7) `terminal/markdown.ts` — ANSI Markdown for One-Shot Mode (422 lines)

### 7.1 Architecture

Uses the same `marked` + `marked-katex-extension` setup (line 8). Two entry points:
- `renderMarkdownToAnsi(markdown)` — full document (line 346)
- `renderInlineMarkdownToAnsi(markdown)` — inline only (line 361)

### 7.2 How It Differs from TUI Markdown

| Feature | TUI (`markdown-mapper.tsx`) | Terminal (`terminal/markdown.ts`) |
|---------|---------------------------|----------------------------------|
| Output | React `Box`/`Text` elements | ANSI escape code strings |
| Code blocks | Border box + Shiki | `┌─ lang`/`└─` borders + Shiki |
| Tables | Unicode ╭┬╮├┼┤╰┴╯ | ┌┬┐├┼┤└┴┘ (simpler characters) |
| Images | `<MediaViewer>` component | `[Image: alt]` dim text |
| Headings | Color + underline | Color + `dim(===...)` underline |
| Blockquote | Left-border Box | `dim("│")` + italic |
| Color system | Branding colors via React props | ANSI escape codes via `bold`, `dim`, `italic`, `cyan`, `green`, `gold`, `coral` functions |
| High contrast | N/A (uses branding) | `shouldUseHighContrast()` → different ANSI codes |

### 7.3 `formatDiff` (Lines 378–406)

Syntax highlights diff output: green for `+` lines, red for `-` lines, cyan for `@@` hunks, dim for `diff --git`/`index` headers, bold for `+++`/`---` file headers.

---

## (8) `terminal/buffered-writer.ts` — One-Shot Output Buffering (449 lines)

### 8.1 `BufferedStreamWriter` (Lines 101–292)

A buffered writer wrapping `process.stdout.write`:
- **Buffering**: Accumulates chunks in `this.buffer` (line 125)
- **Flush timing**: 30ms flush interval (line 106). Immediate flush if buffer age ≥ interval (line 141), otherwise setTimeout to flush (line 144)
- **Line wrapping**: `processAndWrite` (line 168) splits text by `\n`, wraps lines exceeding terminal width using `splitAtVisualWidth` (handles ANSI escapes and Unicode width)
- **Visual width**: `getVisualWidth` accounts for Egyptian hieroglyphs (U+13000-U+1342f, width=1), supplementary planes (width=2), and ANSI escapes
- **Terminal control**: `clearLine`, `clearScreen`, `moveUp`, `moveDown`, `moveToColumn`, `hideCursor`, `showCursor`, `saveCursor`, `restoreCursor`
- **Resize handler**: Listens on `SIGWINCH` (line 120), refreshes capabilities and width

### 8.2 `StreamingOutputManager` (Lines 294–439)

Higher-level layer used in one-shot mode:
- **`append(token)`**: Detects code block boundaries via ````...``` detection (line 339–341), batches tokens by paragraph (not mid-code-block), flushes on `\n\n` or 50ms timeout
- **Batch flush**: Renders accumulated tokens through `renderMarkdownToAnsi` (line 377), writes through `BufferedStreamWriter`
- **`writeToolCall`**: `𓅞 toolName args`
- **`writeToolResult`**: `𓁹` (success) or `𓂀` (failure) + output preview
- **`finish()`**: Flushes batch, writes trailing newline, shows cursor

---

## (9) `terminal/highlighter.ts` — Shiki Integration (95 lines)

### 9.1 Initialization (Lines 24–37)

```
24| export async function initHighlighter(): Promise<Highlighter> {
25|   if (highlighterInstance) return highlighterInstance;
28|   highlighterPromise = createHighlighter({
29|     themes: ["github-dark"],
30|     langs: Object.keys(bundledLanguages),  // ALL bundled languages
```

Singleton pattern with promise deduplication. Called early at chat.ts:487.

### 9.2 `highlightToAnsi` (Lines 47–95)

Converts Shiki tokens to ANSI:
- Converts hex colors to `\x1b[38;2;r;g;b;m` via `hexToAnsi` (lines 10–17)
- Maps `token.fontStyle` bit flags: 1=bold, 2=italic, 4=underline
- Falls back to raw code on error or if colors disabled

### 9.3 Guard Functions

- `isHighlighterReady()` (line 43): `highlighterInstance !== null`
- `getHighlighter()` (line 39): returns instance or null

---

## (10) `terminal/capabilities.ts` — Terminal Feature Detection (208 lines)

### 10.1 Detection Stack

Uses packages: `is-ci`, `is-interactive`, `is-unicode-supported`, `supports-color`, `supports-hyperlinks`, `terminal-size`.

### 10.2 `detectGraphicsProtocols()` (Lines 13–52)

Detects:
- **iTerm2**: `TERM_PROGRAM === "iterm.app"`, `ITERM_SESSION_ID`, `ITERM_PROFILE`
- **Kitty**: `TERM === "xterm-kitty"`, `KITTY_WINDOW_ID`, `KITTY_PID`
- **Sixel**: Terminal name includes "sixel", or known emulators (Ghostty, WezTerm, mlterm, foot, Alacritty)

### 10.3 `TerminalCapabilities` Interface (Lines 71–99)

Comprehensive: colors (supported/level/hasBasic/has256/has16m), unicode, hyperlinks, graphics (sixel/kitty/iterm/anySupported), emulator, interactive, ci, size, tty, windows, shell, lang, colorterm.

### 10.4 Key Functions

- `shouldUseColors()` (line 158): `caps.colors.supported && !caps.ci`
- `shouldUseUnicode()` (line 163)
- `shouldUseHyperlinks()` (line 167)
- `shouldUseHighContrast()` (line 191): Checks `FORCE_HIGH_CONTRAST`, `HIGH_CONTRAST`, `COLORTERM=highcontrast`, `TERM=linux`, or `!has256 && !has16m`
- `detectBestGraphicsProtocol()` (line 175): Kitty > iTerm2 > Sixel > null
- `getTerminalWidth()` (line 202) / `getTerminalHeight()` (line 206)

### 10.5 Caching

`cachedCapabilities` (line 145): detected once, refreshed on SIGWINCH via `refreshCapabilities()`.

---

## (11) Branding System — Egyptian Theme

### 11.1 `src/branding/index.ts` (106 lines)

```
1| export const BRANDING = {
2|   name: "Tehuti",
3|   tagline: "Scribe of Code Transformations",
5|   colors: {
7|     primary: "#F5C518",   // Bright gold (WCAG AA)
8|     secondary: "#D4AF37",  // Classic gold
9|     accent: "#FF6B35",     // Vibrant coral
```

Full palette: primary, secondary, accent, orange, coral, gold, papyrus, obsidian, nile, sand, green, gray, red, cyan, blue, purple, + `highContrast` sub-object.

**Symbols** (lines 72–97): `DECORATIVE` object with Unicode Egyptian hieroglyph glyphs — ibis (𓆣), eye (𓁹), eyeOfHorus (𓂀), feather (𓆄), scroll (𓏛), ankh (𓋹), was (𓌀), djed (𓊽), lotus (𓆸), star (𓇼), sun (𓇳), ibisBird (𓅞).

**Animations** (lines 99–106): `HIEROGLYPHS.thinking`: ["𓂝", "𓃀", "𓆣", "𓁹", "𓊖"]. `HIEROGLYPHS.loading`: ["𓆗", "𓆘", "𓆙", "𓆚", "𓆛"].

### 11.2 `src/branding/ascii.ts` (14 lines)

```
1| export * from "./index.js";
```

Simple re-export. The `ASCII_ART` constant is in `index.ts` (lines 35–52) — a FIGlet-style block art of "TEHUTI" with top/bottom block bars.

### 11.3 Color Usage Across TUI

- **GOLD** (`#F5C518`): Primary highlights — borders, Tehuti headers, assistant role border, code block borders, table text, progress bar filled
- **CORAL** (`#FF6B35`): Accent — user role border, heading level 2, bullet markers, delete/edit operations, command palette prompt
- **SAND** (`#8B7355`): Secondary text — system messages, dim labels, secondary status
- **GREEN** (`#22C55E`): Assistant role header, success status
- **GRAY** (`#9CA3AF`): Dim/disabled text
- **RED** (`#EF4444`): Error markers
- **CYAN** (`#06B6D4`): Code spans, links, KaTeX
- **PURPLE** (`#A855F7`): Memory indicator

---

## (12) `daemon.ts` and `companion.ts` CLI Commands

### 12.1 `daemonCommand()` (`src/cli/commands/daemon.ts`, 229 lines)

Exposes 5 subcommands:

| Command | Description |
|---------|-------------|
| `tehuti daemon start` | Starts daemon in background (`spawn(..., detached: true, stdio: "ignore")`). Checks for existing socket/process first. |
| `tehuti daemon stop` | Sends `{ type: "stop" }` to daemon over Unix socket |
| `tehuti daemon status` | Sends `{ type: "ping" }`, displays PID, uptime, active clients |
| `tehuti daemon install` | Installs launchd plist via `installLaunchAgent()` |
| `tehuti daemon _run_server` | Hidden — starts `TehutiDaemonServer` + `DaemonStateEngine`. Handles `agent_message` messages by running `runAgentLoop` and writing results back over socket |

The daemon uses a **Unix domain socket** (`SOCKET_PATH` from `daemon/client.js`). Communication is NDJSON (newline-delimited JSON).

**`startDaemonProcess`** (lines 207–214): Spawns `process.execPath [cliScript, "daemon", "_run_server"]` detached.

### 12.2 `companionCommand()` (`src/cli/commands/companion.ts`, 17 lines)

```
5| const companion = new Command("companion")
6|   .description("Connect a client socket to the running daemon for interactive sessions")
9|   .action(async () => {
11|     const prog = createProgram();
13|     await prog.parseAsync(["node", "tehuti", "--companion"]);
```

Simply proxies to `createProgram()` with `--companion` flag. The `ChatUI` then connects to the daemon in its companion mode `useEffect` (chat.ts:976–1026).

---

## (13) Slash Command System — All Registered Commands

### 13.1 In-Chat Slash Commands (chat.ts Lines 2260–2596)

Handled in the `send` function. See Section 1.5 above for the full list.

Additionally, the `BootstrapCLI` at line 53 handles initial command-line flags:
- `--debug`: Enables debug logging
- `--json`: One-shot JSON output
- `--quiet`: Suppresses streaming output
- `--diff` / `--diff-auto`: Diff preview before file edits
- `--no-mcp`: Disables MCP
- `--reset-key`: Deletes config
- `--companion`: Companion mode

### 13.2 Command Palette Commands (CommandPalette.tsx Lines 625–823)

`createCommands(options)` returns 15 base commands (see Section 14 below).

---

## (14) `CommandPalette.tsx` — Fuzzy Search & Actions

### 14.1 `createCommands` Output (Lines 652–823)

15 base commands in this order:

| ID | Category | Description |
|----|----------|-------------|
| `/config` | session | Open interactive configuration editor |
| `/clear` | session | Clear conversation (shortcut: Ctrl+L, alias: /cls, /c) |
| `/cost` | session | Show session cost |
| `/stats` | session | Show performance metrics |
| `/compact` | session | Compact context |
| `/save` | session | Save current session |
| `/export` | session | Export to MD/JSON |
| `/load` | session | Load saved session (submenu) |
| `/sessions` | session | List saved sessions |
| `/model` | model | Switch model (submenu of live models) |
| `/provider` | model | Switch provider (submenu of all providers) |
| `/thinking` | model | Toggle extended thinking |
| `/plan` | session | Enter plan mode |
| `/skills` | session | List available skills |
| `/help` | help | Show all commands (alias: /h) |
| `/dashboard` | session | Toggle Swarm Dashboard |
| `/exit` | session | Exit (alias: /quit, /q) |

Recent commands are prepended with `category: "recent"` (lines 806–822).

### 14.2 Fuzzy Search Algorithm (Lines 55–79)

Custom `fuzzyMatch(text, query)`:
- Sequential character matching (not substring)
- Scoring: first match = 3 points, case-match = 2 points, case-mismatch = 1 point
- Returns `{ score, indices }` (score = -1 if no complete match)
- Used across 4 fields: label, description, id, aliases
- Best match wins (line 285)

### 14.3 Actions Dispatched

Each command's `action` property maps to callbacks provided via the `options` parameter in `createCommands`. These are wired in chat.ts lines 1839–1921, connecting to handlers like `handleShowCost`, `handleModelSwitch`, `handleClear`, `handleLoad`, `handleConfig`, `handleShowModels`, etc.

---

## (15) Known TUI Gaps and Bugs

### 15.1 Array Content in `computeMessageLines` (output.ts Lines 346–358)

When `block.content` is an array but elements don't have `.text` property, the fallback `String(block.content || block.text || "")` at line 358 would produce `"[object Object]"` for object elements — not a proper text representation.

**Lines**: 346–358 in `output.ts`.

### 15.2 `parseContentBlocks` Regex — Unclosed Tags (chat.ts:495)

The regex `/<(think|thinking|reasoning)>([\s\S]*?)(?:<\/\1>|$)/g` at line 495 matches unclosed `<think>` tags (via `|$` alternative). During streaming, a partial `<think>` tag would match as reasoning even before the closing tag arrives, potentially capturing subsequent non-reasoning text into a reasoning block.

### 15.3 WeakMap Cache Invalidated on Resize Only (output.ts Lines 317–323)

`lineCache` is only cleared on `stdout.on("resize")`. If a message's content changes (e.g., during streaming when blocks are updated), the stale cache value will be returned, causing incorrect line height calculations. The cache key is the message object reference, but mutation of the same object creates stale cache entries.

### 15.4 `visibleMessages` Estimate Inaccuracy (chat.ts Lines 2083–2160)

The `visibleMessages` calculation uses a character-length-based estimate (`textContent.length / avgCharsPerLine`) instead of actual wrapped line count. For messages with many short lines (like code), this can significantly underestimate, causing the slice to miss messages that are actually visible. The `+20` and `-10` safety buffers mitigate but don't eliminate this.

### 15.5 Negative Margin Renders All MessageElements (chat.ts:3650)

`marginBottom: -scrollOffset` applies to the inner Box containing ALL `messageElements` (line 3650). While `visibleMessages` limits which messages are in the array, all rendered messages still get negative-margined as a block. Ink's layout engine must compute positions for all rendered elements — this is correct but means the `flexGrow: 1` parent must handle the overflow properly.

### 15.6 `GlobalInputState` Is Mutable Global (input-state.ts:1–3)

A plain mutable object with no React state tracking. Changes to `hoveredComponentCount` don't trigger re-renders. The `TodoList` component reads it via polling (every 1 second), which is an architectural workaround.

### 15.7 ANSI Sequence Injection in `process.stdout.write` Wrapper (chat.ts Lines 4014–4025)

The monkey-patch wraps EVERY write in `\x1b[?2026h`/`\x1b[?2026l` (synchronized output). If third-party libraries or Node internals write binary data that happens to contain escape sequences, this could cause terminal corruption. Additionally, the wrapper applies to ALL writes including Ink's internal rendering, which may interfere with Ink's own terminal control sequences.

### 15.8 Tool Result Block Mismatch (chat.ts Lines 2901–2909)

Tool call results are stored in both `toolCalls` array and `blocks` array. The finalization code at lines 2901–2909 reconciles them by finding matching blocks. This dual-storage pattern creates potential drift if blocks and toolCalls get out of sync during streaming updates.

### 15.9 Session Save Race Condition (chat.ts Line 2995)

After `runAgentLoop` completes, an auto-save is triggered (line 2995). If the user immediately sends another message (triggering a new request), the `ctxRef.current.messages` may be mutated mid-save by the new request, causing an inconsistent save state.

### 15.10 `useChatInput` Ref Synchronization (useChatInput.ts Lines 175–199)

The `useEffect` at line 175 syncs React state to refs, but state updates are batched in React 18. During rapid typing, the ref may briefly reference stale state before the effect runs. This could cause `useInput` handler to operate on slightly outdated values for cursor position or input content.

### 15.11 Duplicated Code: `parseContentBlocks` (in both chat.ts:491 and output.ts:242)

The identical regex-based content block parser exists in both files. Any bug fix would need to be applied in two places.

### 15.12 Shiki Init Race (chat.ts Lines 487–489)

`initHighlighter()` is called at module top level but is async and not awaited before the first render. The `isHighlighterReady()` guard prevents crashes, but code blocks rendered before initialization will appear unhighlighted until Shiki loads.

---

## Summary of Architecture

| Layer | Files | Purpose |
|-------|-------|---------|
| CLI Entry | `cli/index.ts`, `cli/commands/chat.ts` | Commander.js program, action routing |
| Bootstrap | `cli/bootstrap.ts` | Config loading, API key resolution, setup wizard |
| TUI Core | `chat.ts` (ChatUI+App) | 3200-line monolith: state, rendering, agent loop, scroll |
| Hooks | `useChatState`, `useChatInput`, `useVimInput`, `useVirtualScroll` | State management, input handling, navigation, virtual scrolling |
| Components | 14 components in `cli/ui/components/` | Header, spinner, tool output, config editor, palette, lists, prompts |
| Markdown | `markdown-mapper.tsx` | TUI React markdown renderer |
| Terminal | `output.ts`, `markdown.ts`, `buffered-writer.ts`, `highlighter.ts`, `capabilities.ts` | One-shot output, ANSI rendering, Shiki, terminal detection |
| Branding | `branding/index.ts`, `branding/ascii.ts` | Egyptian theme, colors, hieroglyphs |
| Daemon | `daemon.ts`, `companion.ts` | Background IPC server, companion mode client |
