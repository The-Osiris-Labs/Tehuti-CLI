# Handoff Report: Adversarial Verification of Milestone 4 (Visual Polish & TUI)

This report details the adversarial verification, stress testing, and findings for Milestone 4 (Visual Polish & TUI) in Tehuti CLI.

---

## 1. Observation

We directly inspected the source files and verified the TUI behavior using unit/stress tests. The following issues and exact lines were identified:

### Observation 1: Viewport Height Calculations Omissions
In `src/cli/commands/chat.ts` (lines 1877-1880), the chat viewport height is calculated as follows:
```typescript
	const chatViewportHeight = Math.max(
		3,
		terminalHeight - headerHeight - inputHeight - 4 - headerScrollHeight - warningsHeight - suggestionsCount - paletteHeight,
	);
```
- **Loading & Thinking Height Omissions**: The layout renders a 5-line loading progress bar and a 2-line thinking indicator area (lines 3210-3229 and 3242-3269). However, neither of these dynamic heights is subtracted from the calculated `chatViewportHeight` when active.
- **Input Height subtraction when Palette is open**: When the command palette is shown (`showCommandPalette` is true), the input box is hidden (`renderInput` is not rendered). However, `inputHeight` (3) is still subtracted from `chatViewportHeight`.
- **Command Palette Dynamic Height**: When the palette is open, it has `paletteHeight = 16`. However, the actual height of the command palette is dynamic and can be up to 29 rows depending on categories and matches (border: 2, title: 2, query: 4, category headers: 3, items: up to 9 rows * 2 lines each = 18).

### Observation 2: Scroll Lock / Snapping Bug
In `src/cli/commands/chat.ts` (lines 1320-1321), the header scrolling condition is:
```typescript
	const shouldShowHeader = showWelcome && scrollOffset === 0 && messages.length > 0;
	const headerScrollHeight = shouldShowHeader ? 14 : 0;
```
When `scrollOffset` is `0`, `shouldShowHeader` is true, so `headerScrollHeight = 14`. This reduces the viewport height. However, the moment a user scrolls up (`scrollOffset > 0`), `shouldShowHeader` becomes false, setting `headerScrollHeight` to 0. This immediately increases `chatViewportHeight` by 14, lowering the max scroll offset bound (`maxOff`), which snaps the scroll offset back to `0`, locking the viewport scrolling at the bottom.

### Observation 3: Selection Overrides by Navigation Hooks
In `src/cli/ui/hooks/useChatInput.ts`, standard keys like `Home`, `End`, `UpArrow`, and `DownArrow` are intercepted without checking if `Shift` is active:
- Shift+Home/End triggers scrolling:
```typescript
		if (key.home) {
			scrollToTop();
			return;
		}
		if (key.end) {
			scrollToBottom();
			return;
		}
```
- Shift+Up/DownArrow triggers prompt history navigation:
```typescript
		if (key.upArrow && !loading) {
			if (history.length > 0) { ... }
		}
```

### Observation 4: OSC 52 Direct Write to Stdout
In `src/cli/ui/hooks/useChatInput.ts` (line 189), Ctrl+C selection copy is handled by:
```typescript
console.log("\x1B]52;;" + Buffer.from(selectedText).toString("base64") + "\x07");
```
`console.log` appends a newline `\n` to stdout, which corrupts Ink's virtual layout alignment and causes immediate terminal layout shifts / line duplications.

### Observation 5: Command Palette Selection Index Lag
In `src/cli/ui/components/CommandPalette.tsx` (lines 245-248), when `filteredCommands` updates on query change, the selection index is reset via an asynchronous `useEffect`:
```typescript
	useEffect(() => {
		setSelectedIndex(0);
	}, [filteredCommands]);
```
This introduces a race condition. If a user types a query character and presses `Enter` before the `useEffect` runs, the old `selectedIndex` is used, causing an out-of-bounds selection or executing the wrong command.

---

## 2. Logic Chain

1. **Calculated Viewport Size vs. Actual Space**: Because dynamic heights (loading area, thinking area, dynamic command palette size) are omitted or statically budgeted, `chatViewportHeight` is overestimated when these elements are active. This causes the Ink virtual tree to output more lines than the terminal has height for, resulting in terminal scroll-up and visual layout shifts.
2. **Scroll Lock Loop**:
   - Initial state: `scrollOffset = 0` -> `shouldShowHeader = true` -> `chatViewportHeight = X` -> `maxOff = Y`.
   - Scroll action: User presses UpArrow -> `scrollOffset` becomes `1`.
   - Next render: `scrollOffset = 1 > 0` -> `shouldShowHeader = false` -> `headerScrollHeight = 0` -> `chatViewportHeight` increases by 14 -> `maxOff` drops by 14 to `0`.
   - Adjustment: `boundScrollOffset = Math.min(scrollOffset, maxOff) = Math.min(1, 0) = 0`.
   - Result: Scroll offset snaps back to 0 immediately, locking the user out of scrolling.
3. **Key Capture Precedence**: Because `key.home`, `key.end`, `key.upArrow`, and `key.downArrow` capture key events regardless of `key.shift` status, they override the text selection keys (`Shift+Home`, `Shift+End`, `Shift+Up`, etc.), making text selection impossible using these combinations.
4. **Stdout Pollution**: Printing the OSC 52 sequence using `console.log` forces a newline outside Ink's render cycle, breaking Ink's line budgeting and causing screen corruption.
5. **Selection Lag**: Since React state updates in `useEffect` run after the paint phase, typing a filter updates `filteredCommands` instantly but leaves `selectedIndex` at its previous stale value for one render frame, leading to selection mismatch on immediate `Enter` press.

---

## 3. Caveats

- We assumed a standard terminal height of 24 lines for boundary verification, although the dynamic height calculation scales with `terminalHeight`. Smaller terminal heights (e.g. < 20 lines) exacerbate these issues.
- The OSC 52 sequence copy behavior depends on terminal emulator support (e.g., Alacritty, iTerm2, Kitty). In unsupported terminals, the raw sequence is ignored but the printed newline still corrupts the Ink layout.

---

## 4. Conclusion & Challenge Report

**Overall risk assessment**: HIGH

## Challenges

### [High] Challenge 1: Viewport Calculation Mismatch
- **Assumption challenged**: That chat viewport height is static with respect to active loading and thinking states, and that Command Palette has a static height of 16 lines.
- **Attack scenario**: Triggering loading (running a command) or thinking under a constrained terminal height makes the scrollable viewport too large, causing the terminal to overflow.
- **Blast radius**: The TUI layout shifts permanently, pushing headers off-screen.
- **Mitigation**: Dynamically subtract `loading ? 5 : 0` and `showThinking ? 2 : 0` from `chatViewportHeight` in `chat.ts`. Update the palette height calculation to reflect its actual rendered height, and do not subtract `inputHeight` when the input box is hidden.

### [High] Challenge 2: Scrolling Bounds Lock
- **Assumption challenged**: That the compact header can be rendered dynamically in the scrollable viewport based on `scrollOffset === 0` without affecting the scrolling bounds.
- **Attack scenario**: User scrolls up; the header disappears, growing the viewport and snapping the offset back to 0.
- **Blast radius**: User is unable to scroll up to read history.
- **Mitigation**: The header should be statically sized or the viewport height should remain constant regardless of whether the header is within view.

### [Medium] Challenge 3: Selection Overrides
- **Assumption challenged**: That selection and navigation hooks do not conflict.
- **Attack scenario**: User holds Shift and presses Home/End or Up/Down arrows to select text.
- **Blast radius**: Text selection is hijacked, triggering page scrolls and history swaps.
- **Mitigation**: Add checks for `!key.shift` to the `home`, `end`, `upArrow`, and `downArrow` event handlers in `useChatInput.ts`.

### [Medium] Challenge 4: Screen Corruption on Copy
- **Assumption challenged**: That `console.log` is safe for writing OSC 52 copy sequences during active Ink renders.
- **Attack scenario**: User copies text using Ctrl+C.
- **Blast radius**: Ink screen gets shifted by 1 line, leaving duplicate prompts.
- **Mitigation**: Write the OSC 52 sequence to stdout using `process.stdout.write` directly without appending a newline (and verify that Ink handles it safely).

### [Medium] Challenge 5: Command Palette Selection Lag
- **Assumption challenged**: That `useEffect` is the correct place to synchronize `selectedIndex` on list updates.
- **Attack scenario**: User types a query and immediately presses Enter.
- **Blast radius**: The wrong command is executed.
- **Mitigation**: Reset `selectedIndex` during the render phase when `filteredCommands` changes, or key the list component by the query string.

---

## Stress Test Results

- **Dynamic Viewport Height Verification** -> Viewport height calculates 14 instead of 7 when loading/thinking are active -> **FAIL** (Layout shift occurs)
- **Scroll Lock Verification** -> Offset 1 snaps back to 0 -> **FAIL** (Scroll lock occurred)
- **Key Overrides Verification** -> Shift+Home triggers scrollToTop -> **FAIL** (Selection overridden)
- **Vim Navigation / Search Reset Index Lag** -> selectedIndex remains stale on query update in the render frame -> **FAIL** (Race condition confirmed)

---

## Unchallenged Areas

- **Config Editor Layout**: We did not stress-test layout changes when resizing the terminal while the Config Editor is open.

---

## 5. Verification Method

To verify these observations and results independently:
1. Run the project tests using:
   ```bash
   npx vitest run src/cli/commands/tui-viewport.test.ts
   npx vitest run src/cli/ui/hooks/useChatInput.test.ts
   npx vitest run src/cli/ui/components/CommandPalette.test.ts
   ```
2. Inspect the test logs showing:
   - Layout shift sizes due to header toggle (11 lines).
   - Mismatch between calculated viewport and actual space during loading/thinking (7 lines).
   - Overriding selection keys (`Shift+Home`, `Shift+End`, `Shift+UpArrow` calling scroll and history hooks).
   - Selection index lag on query change.
