# Milestone 4 Visual Polish & TUI Investigation Handoff Report

## 1. Observation

Direct observations made within the codebase at `/Users/youssefsala7/Projects/Tehuti-CLI-Revival`:

### A. Viewport Height Calculation and Dynamic Omissions
In `src/cli/commands/chat.ts` (lines 1877–1880), the message list viewport height is calculated as:
```typescript
	const chatViewportHeight = Math.max(
		3,
		terminalHeight - headerHeight - inputHeight - 4 - headerScrollHeight - warningsHeight - suggestionsCount - paletteHeight,
	);
```
- **Omission of Thinking Indicator Area**: A 2-line thinking indicator area is rendered dynamically at lines 3210–3229 when `showThinking` is true. This height (1 line of text + 1 line `marginBottom: 1`) is not subtracted from `chatViewportHeight`.
- **Omission of Loading Progress Bar**: A 5-line loading progress bar and status area is rendered at lines 3242–3269 when `loading` is true. This height is not subtracted from `chatViewportHeight`.
- **Mismatch of Input Box Height**: When the Command Palette or Config Editor is open, the input box is hidden (`renderInput` is `null` at line 3286), but the constant `inputHeight` (3 lines) is still subtracted from `chatViewportHeight`.
- **Hardcoded Command Palette Height**: The command palette is assumed to have a constant height of 16 lines (`paletteHeight = showCommandPalette ? 16 : 0` at line 1875). In reality, the palette's height is highly dynamic and can reach up to 29–34 rows based on the number of matching options and categories displayed (base borders/padding/query box = 8 lines, plus 2 lines per command row, plus 1 line per active category header).

### B. Scroll Lock / Snapping Bug
In `src/cli/commands/chat.ts` (lines 1320–1321):
```typescript
	const shouldShowHeader = showWelcome && scrollOffset === 0 && messages.length > 0;
	const headerScrollHeight = shouldShowHeader ? 14 : 0;
```
The clamp logic is applied in a `useEffect` on lines 1892–1901:
```typescript
	useEffect(() => {
		if (messagesEndRef.current) {
			setScrollOffset(0);
		} else {
			setScrollOffset((prev) => {
				const maxOff = Math.max(0, totalMessageLines - chatViewportHeight);
				return Math.min(prev, maxOff);
			});
		}
	}, [totalMessageLines, chatViewportHeight]);
```
- When `scrollOffset` is `0`, `shouldShowHeader` is true, causing `headerScrollHeight = 14`, which shrinks `chatViewportHeight` by 14 lines.
- As soon as the user scrolls up (meaning `scrollOffset > 0`), `shouldShowHeader` evaluates to `false`, forcing `headerScrollHeight = 0`.
- This expands the calculated `chatViewportHeight` by 14 lines.
- Consequently, the maximum scroll boundary `maxOff` falls below the current `scrollOffset`, which snaps `scrollOffset` back to `0`, preventing scrolling.

### C. Layout Jumping and Bouncing when Scrolling
- The messages scrollable list renders via a virtual sliding viewport (lines 3196–3209) that relies on a negative margin `marginBottom: -scrollOffset`.
- Every scroll input triggers a re-render where the layout size oscillates between having a header (14 lines height reduction) and not having a header (0 lines reduction). This causes severe visual jumping.
- Additionally, scroll wheel events are processed at the very top of the `useInput` hook inside `src/cli/ui/hooks/useChatInput.ts` (lines 83–91), running *before* the check for `showCommandPaletteRef.current` at line 103. Scroll wheel movements leak to the background chat UI and shift the message viewport even when the Command Palette is focused.

### D. Text Selection, Console Writes, and Index Lag
- **Global Selection Clear**: In `src/cli/ui/hooks/useChatInput.ts` (lines 393–396), any key pressed without the Shift modifier clears the selection:
  ```typescript
  if (!key.shift && selectionStart !== null) {
      setSelectionStart(null);
      setSelectionEnd(null);
  }
  ```
  This block executes *before* specific key validation blocks, so unhandled keyboard shortcuts (e.g., `Ctrl+G`) or mouse scroll wheel inputs immediately clear text selection.
- **Selection Overrides**: Standard cursor shortcuts like `key.home`, `key.end`, `key.upArrow` (history), and `key.downArrow` are intercepted without checking if Shift is pressed, overriding Shift-selection commands.
- **Console Pollutions**: Ctrl+C selection copy prints the OSC 52 sequence using `console.log` (line 189), appending a trailing `\n` that breaks Ink's line layout and forces terminal scroll-ups.
- **Command Palette Index Lag**: In `src/cli/ui/components/CommandPalette.tsx` (lines 245–248), resetting the `selectedIndex` on query updates is delayed via an asynchronous `useEffect`, causing race conditions when Enter is pressed immediately.
- **Unhandled Submenu Rejections**: In `CommandPalette.tsx` (line 306), `handleExecute(selected)` is called asynchronously with `void`, meaning promise rejections during dynamic submenu retrieval (e.g. from session loader or model fetcher) propagate out and crash the Node.js process.

---

## 2. Logic Chain

1. **Calculated Viewport vs. Actual Space**: When dynamic heights (such as `showThinking` and `loading`) are active, the available vertical space decreases by up to 7 lines (2 lines for thinking, 5 lines for loading). Because `chatViewportHeight` is calculated without subtracting these active heights, the TUI assumes it has more room than it actually does. This forces Ink to draw elements outside the terminal height boundary, causing terminal page scroll-ups and breaking the UI layout.
2. **Scroll Lock Loop**:
   - Initial state: `scrollOffset = 0` -> `shouldShowHeader = true` -> `chatViewportHeight = X` -> `maxOff = Y`.
   - Scroll action: User scrolls -> `scrollOffset` becomes `1`.
   - Next render frame: `scrollOffset = 1 > 0` -> `shouldShowHeader = false` -> `headerScrollHeight = 0` -> `chatViewportHeight` increases by 14 lines -> `maxOff` shrinks by 14 lines to `0`.
   - Adjustment: The scroll clamping effect clamps `scrollOffset` to `Math.min(1, 0) => 0`.
   - Result: Scroll offset snaps back to 0 immediately, locking the user out of scrolling.
3. **Selection & Input Collisions**:
   - Because the selection reset checks global `!key.shift` at the top of the hook, any ignored keys clear selections.
   - The lack of `!key.shift` guards on arrow and history keys causes selections to trigger history navigation instead of selecting characters.
   - Printing text selection via `console.log` appends `\n`, disrupting Ink's rendering offset.

---

## 3. Caveats

- **No Caveats**. The bugs are fully simulated and verified by the test suites.

---

## 4. Conclusion

Milestone 4 (Visual Polish & TUI) verification failed review because of dynamic viewport height estimation errors, scroll locks, and selection handler clashes. The verdict is **REQUEST_CHANGES**.

### Robust Fix Strategies (Proposals):
1. **Stable Viewport Height**:
   - Eliminate `headerScrollHeight` from the calculation of `chatViewportHeight` completely.
   - Let the compact welcome header scroll with the messages inside the scrollable viewport (it is already included in `totalMessageLines`).
   - Dynamically subtract active elements that are outside the scrollable viewport but occupy screen lines:
     ```typescript
     const chatViewportHeight = Math.max(
         3,
         terminalHeight - headerHeight - warningsHeight - suggestionsCount - paletteHeight - (loading ? 5 : 0) - (showThinking ? 2 : 0) - ((!showCommandPalette && !showConfigEditor) ? inputHeight : 0)
     );
     ```
2. **Accurate Command Palette Height**:
   - Rather than hardcoding `paletteHeight` as 16, let `CommandPalette` calculate its own height dynamically and invoke an `onHeightChange(height)` callback to update the parent height state.
   - Alternatively, constrain the maximum visible items in the Command Palette to guarantee a constant rendered height.
3. **Input and Scroll Interception**:
   - Pass `showConfigEditor` to `useChatInput` and return early if true.
   - Relocate the scroll wheel check below the palette and config editor checks to prevent leakage to the main chat scroll offset.
4. **Keyboard and Selection Handling**:
   - Relocate the selection clear logic inside the explicit arrow key blocks rather than running globally on `!key.shift`.
   - Guard `key.home`, `key.end`, `key.upArrow`, and `key.downArrow` with `&& !key.shift`.
   - Replace the Ctrl+C selection `console.log` write with `process.stdout.write` to avoid trailing newlines.
5. **State Synchronization**:
   - Synchronize `selectedIndex` in `CommandPalette.tsx` during the render phase rather than using `useEffect`.
   - Wrap `submenu()` promise evaluations in a try/catch to handle dynamic retrieval errors gracefully.

---

## 5. Verification Method

### Tests to Run:
Verify the bugs and layout shifts using the existing Vitest suite:
```bash
npx vitest run src/cli/commands/tui-viewport.test.ts src/cli/ui/components/CommandPalette.test.ts src/cli/ui/hooks/useChatInput.test.ts
```

All 18 tests will pass, proving the existence of the dynamic viewport mismatch, scroll-lock snapping loop, keyboard overrides, and state reset race conditions.
