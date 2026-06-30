# Handoff Report: Keyboard Input & TUI Usability Polish Analysis

This document details the analysis of keyboard input handling, shortcuts, cursor navigation, command palette transitions, and input clash prevention in the Tehuti CLI TUI codebase, along with actionable recommendations.

---

## 1. Observation

A detailed inspection of the source code files `src/cli/commands/chat.ts`, `src/cli/ui/hooks/useChatInput.ts`, and `src/cli/ui/components/CommandPalette.tsx` has revealed several key issues:

### A. Vim Navigation Pollution in Command Palette
* **Location**: `src/cli/ui/components/CommandPalette.tsx` (Lines 293–301)
* **Code**:
  ```typescript
  // Vim navigation (j/k) when query is empty, or standard arrows
  if (key.upArrow || (char === 'k' && query.length === 0)) {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
      return;
  }

  if (key.downArrow || (char === 'j' && query.length === 0)) {
      setSelectedIndex((prev) => Math.min(filteredCommands.length - 1, prev + 1));
      return;
  }
  ```
* **Description**: Although pressing `j` or `k` when the query is empty updates `selectedIndex`, the focused `InkTextInput` (Lines 355–360) also captures `j` or `k` synchronously and triggers `onChange("j")` or `onChange("k")`. This inserts the character into the query, filtering the command palette and disrupting Vim navigation.

### B. Text Selection Lifecycle Issues
* **Location**: `src/cli/ui/hooks/useChatInput.ts` (Lines 317–335)
* **Code**:
  ```typescript
  if (!key.shift && selectionStart !== null) {
      setSelectionStart(null);
      setSelectionEnd(null);
  }

  // Cursor navigation
  if (key.leftArrow && !key.shift) {
      if (key.ctrl || key.meta) {
          // ...
      } else {
          setCursorPos((p: number) => Math.max(0, p - 1));
      }
      return;
  }
  ```
* **Description**: Pressing `leftArrow` or `rightArrow` (without shift) executes their handlers and returns early (`return;`), meaning execution never reaches the selection cleanup block. Consequently, cursor movement without shift does not clear text selection.
* Additionally, typing characters, deleting (backspace/delete), and pasting (Lines 88-111, 368-381) do not handle the active selection range, leading to visual bugs and incorrect input mutations when text is highlighted.

### C. Exit Flow Discrepancy (Ctrl+D vs Ctrl+C)
* **Location**: `src/cli/ui/hooks/useChatInput.ts` (Lines 118–138 vs Lines 259–266)
* **Code**:
  ```typescript
  if (key.ctrl && k === "d") {
      if (input.length === 0) {
          onExit();
      } else {
          setInput(input.slice(0, cursorPos) + input.slice(cursorPos + 1));
      }
      return;
  }
  ```
* **Description**: When input is empty, `ctrl+d` only executes `onExit()` (disconnecting MCP). It does not save the session, print session cost tracking stats, or invoke Ink's `exit()`, unlike `ctrl+c` (Lines 118–126), resulting in a hung terminal process in interactive sessions.

### D. Command Palette Toggle Lock (Ctrl+P)
* **Location**: `src/cli/ui/hooks/useChatInput.ts` (Lines 83–85) and `src/cli/ui/components/CommandPalette.tsx` (Lines 273–282)
* **Code**:
  ```typescript
  if (showCommandPalette) {
      return;
  }
  ```
* **Description**: When the command palette is visible, `useChatInput` immediately ignores all input. Because `CommandPalette`'s `useInput` hook does not intercept `ctrl+p` to close itself, pressing `ctrl+p` a second time has no effect, forcing the user to press `Escape`.

### E. Auto-Opening Race Condition on `/`
* **Location**: `src/cli/ui/hooks/useChatInput.ts` (Lines 370–373)
* **Code**:
  ```typescript
  // Trigger Command Palette automatically when typing '/' as the first character
  if (k === "/" && input.trim() === "" && cursorPos === 0) {
      setShowCommandPalette(true);
      return;
  }
  ```
* **Description**: Typing `/` triggers `setShowCommandPalette(true)`. In rapid typing or standard paste operations, subsequent characters (e.g. `c`, `o`, `s`, `t` for `/cost`) are processed in the same stdin buffer batch. Because the state update `showCommandPalette` resolves asynchronously on the next React render tick, these subsequent characters are processed by the main chat input instead of the palette search field.

### F. Asynchronous resetConversation Race Condition
* **Location**: `src/cli/commands/chat.ts` (Lines 1407–1409) and `src/cli/ui/hooks/useChatInput.ts` (Lines 215–218)
* **Code**:
  ```typescript
  const handleClear = useCallback(() => {
      void resetConversation();
  }, [resetConversation]);
  ```
* **Description**: `resetConversation()` is an asynchronous function that creates a new session in the background via `sessionManager.createSession(...)` (involving file I/O). Because `handleClear` and `ctrl+l` do not await it and do not block input while resetting, a user can type and submit a message concurrently. This starts a parallel context/session creation sequence, corrupting state and generating duplicate/mismatched session IDs.

---

## 2. Logic Chain

1. **Vim Navigation**: `CommandPalette` mounts `InkTextInput` alongside a custom `useInput` listener. Because printable character keystrokes are received by all active input listeners in Ink, pressing `j` or `k` triggers index movement in `CommandPalette` but simultaneously propagates the character insertion to `InkTextInput`. Thus, Vim navigation is unusable because it pollutes the search query.
2. **Text Selection**: In `useChatInput.ts`, cursor navigation (arrow keys without shift) returns early from the hook execution. This prevents the cleanup logic at the bottom of the input loop from resetting the selection start/end state. Since standard write/delete actions also lack checks for selection ranges, selection remains visually and functionally disjointed from text edits.
3. **Exit Discrepancy**: Standard exit command `/exit` and shortcut `ctrl+c` run the full lifecycle exit procedure (session save, cost telemetry printing, Ink exit handler). `ctrl+d` omits everything except MCP disconnect, violating standard shell lifecycle expectations and causing hangs.
4. **Command Palette Toggle**: When the palette is open, the main chat input hook is disabled. Without a duplicate listener for `ctrl+p` in the palette, the toggle state is broken in one direction.
5. **Auto-Open & Reset Race Conditions**: React state updates are batched and scheduled asynchronously. Incoming Node.js stream chunks (key sequences) are processed sequentially within the current tick's input loop. This mismatch between state evaluation latency and stream reading speeds causes inputs to leak to the wrong components during transition states (palette opening, session resetting).

---

## 3. Caveats

- **Terminal Emulator Capabilities**: Clipboard copying via OSC 52 (`\x1B]52;;...`) is highly dependent on terminal emulator configuration and permissions. Some terminals may block clipboard writes.
- **Ink Focus Internals**: We assume the default behavior of `ink-text-input` where it consumes key events when its `focus` prop is true.
- **No Code Modifications**: As instructed, no modifications to source files were executed.

---

## 4. Conclusion

The Tehuti TUI input loop is highly responsive and feature-rich, but suffers from several critical race conditions and usability regressions under fast input:
1. **Command Palette**: Vim navigation (`j`/`k`) is broken because focus is not fully isolated from the text input field.
2. **State Transitions**: Auto-opening and resetting sessions have async race conditions that leak characters or spawn concurrent processes.
3. **Editor Capabilities**: Text selection has missing boundary checks on edit/delete actions, and cursor navigation fails to reset selection.
4. **Exit Lifecycles**: `ctrl+d` does not complete a clean shutdown.

---

## 5. Verification Method

To verify these findings manually or programmatically, execute the following procedures:

1. **Verify Test Suite**:
   Run the project test suite to confirm baseline environment stability:
   ```bash
   npm test
   ```
2. **Vim Navigation Verification**:
   - Start the chat TUI: `node dist/index.js`
   - Open the command palette by typing `/` on an empty line.
   - Press `j` or `k`. Observe if the selected command changes AND if `j` or `k` appears inside the search input box.
3. **Exit Flow Verification**:
   - Start the TUI: `node dist/index.js`
   - Press `ctrl+d` immediately on the empty input line. Observe if the program prints the cost summary and exits, or if it hangs.
4. **Text Selection Escape Sequence Verification**:
   - In the chat input, type some text.
   - Hold `shift` and select characters using the arrows.
   - Release `shift` and press `leftArrow` or `rightArrow`. Check if the selection highlight remains active.
   - Press `backspace`. Verify if the single character before the cursor is deleted instead of the selected block.
