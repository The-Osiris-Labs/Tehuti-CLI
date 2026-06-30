# Milestone 4 Visual Polish & TUI Handoff Report

## 1. Observation
We examined the visual polish and terminal user interface (TUI) scroll, layout, and text selection handlers. Below are the key direct observations:

### Observation A: Dynamic Viewport Height Jump and Scroll Lock
In `src/cli/commands/chat.ts`, the viewport height is calculated dynamically as follows:
```typescript
1877: 	const chatViewportHeight = Math.max(
1878: 		3,
1879: 		terminalHeight - headerHeight - inputHeight - 4 - headerScrollHeight - warningsHeight - suggestionsCount - paletteHeight,
1880: 	);
```
Where `headerScrollHeight` is computed as:
```typescript
1320: 	const shouldShowHeader = showWelcome && scrollOffset === 0 && messages.length > 0;
1321: 	const headerScrollHeight = shouldShowHeader ? 14 : 0;
```
However, the header component rendered inside the message list is the compact header:
```typescript
3202: 									showWelcome && React.createElement(
3203: 										Box,
3204: 										{ flexDirection: "column", alignItems: "center", marginBottom: 1 },
3205: 										React.createElement(TehutiHeader, { compact: true })
3206: 									),
```
The scroll clamp is defined as:
```typescript
1892: 	useEffect(() => {
1893: 		if (messagesEndRef.current) {
1894: 			setScrollOffset(0);
1895: 		} else {
1896: 			setScrollOffset((prev) => {
1897: 				const maxOff = Math.max(0, totalMessageLines - chatViewportHeight);
1898: 				return Math.min(prev, maxOff);
1899: 			});
1900: 		}
1901: 	}, [totalMessageLines, chatViewportHeight]);
```

### Observation B: Unhandled Keys Clear Selection
In `src/cli/ui/hooks/useChatInput.ts`, active text selection start/end is cleared on line 393:
```typescript
372: 		// Text selection
...
393: 		if (!key.shift && selectionStart !== null) {
394: 			setSelectionStart(null);
395: 			setSelectionEnd(null);
396: 		}
```
This check is situated before any of the key handlers or validation checks for unhandled keys (which are located on lines 399-461).

### Observation C: Command Palette Transition Race Conditions
In `src/cli/ui/hooks/useChatInput.ts`:
```typescript
78: 	const showCommandPaletteRef = React.useRef(showCommandPalette);
79: 	React.useEffect(() => {
80: 		showCommandPaletteRef.current = showCommandPalette;
81: 	}, [showCommandPalette]);
```
The input listener uses the asynchronous ref `showCommandPaletteRef.current` to decide whether to process input:
```typescript
103: 		if (showCommandPaletteRef.current) {
104: 			return;
105: 		}
```

### Observation D: Loading and Thinking Indicator Exclusions
In `src/cli/commands/chat.ts` lines 3210-3269, when `loading` or `showThinking` is true, Ink renders a progress bar (height ~5 lines) and thinking indicator (height ~2 lines). These are placed outside the message container scroll box but inside the main flex box. They are not subtracted from `chatViewportHeight`.

---

## 2. Logic Chain
1. **Observation A & Verification Test** show that when the user scrolls (`scrollOffset` changes from `0` to `1`), `shouldShowHeader` evaluates to `false`.
2. This resets `headerScrollHeight` from `14` to `0`, causing `chatViewportHeight` to jump from `3` to `14` lines.
3. This jump of 11 lines alters the scroll limit (`maxOff`).
4. If the message length is smaller than `14` lines, `maxOff` becomes `0`, and the `useEffect` clamps `scrollOffset` back to `0`, locking the scrollbar and causing immediate snapping/jittering.
5. **Observation B & Verification Test** confirm that pressing any key combination not modifying the text (e.g. `ctrl + g`) will reach line 393, trigger the `!key.shift` block, and clear the active selection even though the key is ultimately ignored.
6. **Observation C** shows that the ref `showCommandPaletteRef.current` is only updated *after* render paint in a `useEffect`. In high-throughput typing or multi-tick input buffers, events firing during the state transition run against the stale ref value, leading to race conditions where character input overflows or gets swallowed.
7. **Observation D & Verification Test** confirm that loading area and thinking indicators decrease actual vertical layout space for messages by ~7 lines, but this space reduction is not reflected in `chatViewportHeight`, causing incorrect bounds calculations when the agent is executing.

---

## 3. Caveats
- Tested on standard macOS terminal emulator configuration. Custom terminal dimensions, fonts, or window resizing during rendering might alter the exact visual line numbers but will not change the layout logic faults verified above.
- Did not modify the implementation code to resolve these issues, adhering strictly to the critic/review role constraints.

---

## 4. Conclusion
The Visual Polish (Milestone 4) implementation contains critical layout shifts and scrolling defects. The dynamic inclusion of `headerScrollHeight` based on scroll offset causes severe viewport jumping and scroll-locking behavior. Text selection is too fragile, resetting on ignored inputs. Finally, hardcoded height metrics for variable height elements (like the command palette, input area, loading/thinking bars) result in mismatched boundaries and truncated scrolls.

---

## 5. Verification Method
To independently verify the bugs, run the dedicated Vitest test suite containing the simulated layout shifts and selection clear checks:
```bash
npx vitest run src/cli/commands/tui-viewport.test.ts
```
Expected output:
- All 3 verification tests pass, printing:
  - `- Viewport Height (offset=0): 3`
  - `- Viewport Height (offset=1): 14`
  - `- Layout shift size: 11 lines`
  - `- Scrolling snapped back to 0? YES (Scroll Locked)`
  - `- Selection cleared on unhandled key? YES`
  - `- Mismatch size: 7 lines`

---

# Adversarial Review Challenge Report

**Overall risk assessment**: HIGH

## Challenges

### [High] Challenge 1: Scroll-Locking and Layout Jump
- **Assumption challenged**: That the compact header's height should be subtracted from `chatViewportHeight` only when `scrollOffset === 0`.
- **Attack scenario**: User scrolls up to view history while the welcome header is displayed.
- **Blast radius**: The viewport suddenly expands by 11 lines, changing the scroll boundary `maxOff` and snapping `scrollOffset` back to `0`, making it impossible to scroll.
- **Mitigation**: Define a constant `compactHeaderHeight = 4` that scrolls with the content without dynamically changing the viewport size. Only subtract elements that are *outside* the scrolling viewport from `chatViewportHeight`.

### [Medium] Challenge 2: Selection Reset on Ignored Inputs
- **Assumption challenged**: That any key press without Shift should reset the text selection.
- **Attack scenario**: A user has an active text selection and presses an unhandled shortcut like `Ctrl+G` or scrolls.
- **Blast radius**: The selection is silently cleared, harming UX.
- **Mitigation**: Move the selection clearing logic inside the explicit navigation key handlers (e.g. `leftArrow`, `rightArrow` when Shift is not pressed) rather than running it globally.

### [Medium] Challenge 3: Async Ref Update Race Condition
- **Assumption challenged**: That `showCommandPaletteRef.current` is always updated in sync with the palette visibility state.
- **Attack scenario**: High-speed input event triggered during the commit phase of a state transition.
- **Blast radius**: User inputs are either swallowed or leak to the main text area.
- **Mitigation**: Synchronously update `showCommandPaletteRef.current` inside the toggle functions (`handleCommandPaletteClose`, `setShowCommandPalette`) instead of relying solely on `useEffect`.

## Stress Test Results
- **Welcome Header Scroll** → User scrolls up by 1 line → `scrollOffset` snaps back to `0` → **FAIL** (verified in `tui-viewport.test.ts`)
- **Unhandled Key Selection** → Selection active, user presses `Ctrl+G` → Selection is cleared → **FAIL** (verified in `tui-viewport.test.ts`)
- **Loading Progress Bar Display** → Loading progress bar takes up 5 lines but is not subtracted from viewport height → Viewport bounds mismatch → **FAIL** (verified in `tui-viewport.test.ts`)
