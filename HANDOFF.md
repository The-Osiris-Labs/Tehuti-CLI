# 𓆣 Tehuti CLI - Handoff Document

Welcome, new Scribe. This document serves as the absolute source of truth for the architecture, quirks, and current state of the **Tehuti CLI**, an advanced AI coding assistant powered by the OpenCode Go API.

## 🏛️ Project Purpose & Architecture
Tehuti is a terminal-based UI (TUI) constructed with **React** via **Ink**. It operates a highly sophisticated local agent loop equipped with native terminal tool integrations (file editing, bashing, web fetching, MCP). 

### Key Modules:
- `src/index.ts`: Application entry point. Handles arguments and configuration.
- `src/cli/commands/chat.ts`: The Core TUI. All interactive rendering, history, and message virtualization lives here.
- `src/agent/index.ts`: The Agent Loop. Orchestrates parallel tool execution, predictive prefetching, and tool caching.
- `src/api/openrouter.ts`: The unified API singleton (currently dialed heavily for OpenCode Go capabilities) utilizing `undici` connection pooling.

## ⚠️ CRITICAL: The Virtual Sliding Viewport
If you modify `src/cli/commands/chat.ts`, you **must** understand how scrolling is implemented. We do **not** slice the message array to scroll. If you slice the array, React will completely unmount and remount components, instantly destroying scroll performance and state.

Instead, we use a **Bespoke Virtual Sliding Viewport**:
```tsx
// Inside the main <Box> in chat.ts
<Box flexDirection="column" marginBottom={-scrollOffset}>
```
By combining `overflow="hidden"` on the parent wrapper and dynamically applying a negative margin (`marginBottom: -scrollOffset`) to the inner container, we physically slide the entire rendered DOM up or down. 
- **DO NOT** attempt to filter or slice the `renderedMessages` array to achieve scrolling.
- **DO NOT** wrap the messages in a standard `ink` scroll view if it breaks this paradigm.

## 🌟 Recent Achievements (Phase 11 Polish)
The codebase has recently undergone a massive visual and UX overhaul. Here is the current state of the art:

1. **Native Terminal Mouse Support (`@ink-tools/ink-mouse`)**:
   - The `/` Command Palette and `/config` Config Editor are fully interactive via mouse.
   - We abstracted `<CommandItemRow>`, `<ConfigTab>`, and `<ConfigFieldRow>` and bound them with `useOnMouseEnter` and `useOnClick`. 
   - Hovering dynamically applies our Egyptian Gold (`#D4AF37`) inverted highlight, and clicking executes the action instantly. (Arrow keys remain fully supported).

2. **Terminal Image Rendering**:
   - `terminal-image` is deeply integrated into `markdown.ts` and `chat.ts`.
   - When the LLM outputs a markdown image (`![alt](/path/to/img)`), we intercept the token and render the actual pixels inline within the terminal using `<ImageRenderer>`.

3. **Reasoning Block UI ("Channeling Wisdom")**:
   - When using reasoning models (like `deepseek-v4-flash`), the UI no longer uses clunky ASCII borders.
   - It features an animated `ink-spinner` next to "Tehuti is thinking..." to indicate active streaming of reasoning chunks without freezing.

4. **UI Clash Prevention**:
   - The chat input text bar is dynamically hidden when the Command Palette or Config Editor is visible to prevent input-stealing and visual overlap.
   - The massive `TEHUTI` brand header instantly collapses the moment the user sends their first message.

## 🧪 Testing & Execution
The project maintains a perfect test record (>500 passing tests). 
- **Run tests**: `npm test`
- **Build**: `npm run build`
- **Start**: `node dist/index.js` (or `npm start`)

You are now ready to continue building the ultimate Scribe. Good luck!
