# Handoff Report - Visual & TUI Polish Exploration

## 1. Observation

During read-only static analysis of the TUI components, the following exact lines and code blocks were identified in the workspace:

### A. Unused State & Background Timer CPU Overhead
In `src/cli/commands/chat.ts` (lines 1032, 1975-1994):
```typescript
1032: 		thinkingDots, setThinkingDots,
...
1975: 	useEffect(() => {
1976: 		let thinkingTimer: NodeJS.Timeout;
1977: 		if (showThinking) {
1978: 			let dotCount = 0;
1979: 			thinkingTimer = setInterval(() => {
1980: 				dotCount = (dotCount + 1) % 4;
1981: 				setThinkingDots(".".repeat(dotCount));
1982: 			}, 400);
1983: 		}
1984: 
1985: 		return () => {
1986: 			if (batchTimerRef.current) {
1987: 				clearTimeout(batchTimerRef.current);
1988: 				batchTimerRef.current = null;
1989: 			}
1990: 			if (thinkingTimer) {
1991: 				clearInterval(thinkingTimer);
1992: 			}
1993: 		};
1994: 	}, [showThinking]);
```

### B. Layout Shifting in Selection UI (Command Palette & Config Editor)
In `src/cli/ui/components/CommandPalette.tsx` (line 135):
```typescript
135: 			paddingY: isSelected ? 1 : 0,
```
In `src/cli/ui/components/ConfigEditor.tsx` (lines 90-93):
```typescript
90: 			padding={isSelected ? 1 : 0}
91: 			borderStyle={isSelected ? "single" : undefined}
92: 			borderColor={GOLD}
93: 			backgroundColor={isSelected && !isEditing ? "#1A1A2E" : undefined}
```

### C. Viewport Scrolling Height Estimation Desync
In `src/terminal/output.ts` (lines 211-233):
```typescript
211: export function computeMessageLines(msg: any, contentMaxWidth: number): number {
212: 	let lines = 0;
213: 	lines += 1; // Role header
214: 
215: 	if (typeof msg.content === 'string') {
216: 		lines += wrap(msg.content, contentMaxWidth).split('\n').length;
217: 	} else if (Array.isArray(msg.content)) {
...
227: 	if (msg.toolCalls && msg.toolCalls.length > 0) {
228: 		lines += msg.toolCalls.length; // Assume 1 line per tool call when collapsed
229: 	}
230: 
231: 	lines += 1; // Margin bottom between messages
232: 	return lines;
233: }
```

### D. Command Palette Height Mismatch
In `src/cli/commands/chat.ts` (lines 1871-1877):
```typescript
1871: 	// Account for command palette height if open
1872: 	const paletteHeight = showCommandPalette ? 16 : 0;
1873: 
1874: 	const chatViewportHeight = Math.max(
1875: 		3,
1876: 		terminalHeight - headerHeight - inputHeight - 4 - headerScrollHeight - warningsHeight - suggestionsCount - paletteHeight,
1877: 	);
```

### E. Unsafe ANSI Slicing in Tool Output Summarizer
In `src/cli/ui/components/ExpandableToolOutput.tsx` (lines 57-64):
```typescript
57: 	const formatLines = (lineArray: string[]): string =>
58: 		lineArray
59: 			.map((line) => {
60: 				const truncated =
61: 					line.length > maxWidth - 4 ? `${line.slice(0, maxWidth - 7)}...` : line;
62: 				return truncated;
63: 			})
64: 			.join("\n");
```

### F. Hardcoded Hex Colors
In `src/cli/ui/components/TehutiHeader.tsx` (lines 14-17):
```typescript
14: 			<Box flexDirection="row" alignItems="center" marginBottom={1} borderStyle="round" borderColor="#D4AF37" paddingX={2}>
15: 				<Text color="#D4AF37" bold>𓆣 TEHUTI </Text>
16: 				<Text color="#8B7355" dimColor> │ Scribe of Code Transformations │ </Text>
17: 				<Text color="#D97757">𓁹 Write • Edit • Transform</Text>
18: 			</Box>
```
In `src/cli/ui/components/CommandPalette.tsx` (lines 11-17):
```typescript
11: const GOLD = "#F5C518";
12: const CORAL = "#FF6B35";
13: const GRAY = "#9CA3AF";
14: const CYAN = "#06B6D4";
15: const GREEN = "#22C55E";
16: const SAND = "#8B7355";
```

### G. Resizing & Input Wrap Details
In `src/cli/ui/components/MediaViewer.tsx` (lines 16-50):
```typescript
16: 	useEffect(() => { ...
50: 	}, [src]);
```
In `src/cli/commands/chat.ts` (lines 2998-3034):
```typescript
2998: 	const renderInput = useMemo(() => { ...
```

---

## 2. Logic Chain

1. **Unused State & CPU overhead**: `thinkingDots` is mapped as a state variable in `useChatState` and updated every 400ms when `showThinking` is true. However, `thinkingDots` is never passed or rendered in `ChatUI`'s render tree (the UI instead uses a raw `Spinner` component). Frequent state updates in React Ink force re-renders of the entire viewport, leading to input latency and UI lag in terminal frames.
2. **Harmful batchTimer Cleanup**: The `showThinking` `useEffect` cleanup incorrectly clears `batchTimerRef.current`. Since `showThinking` changes whenever LLM thinking or tool execution toggles, clearing the batch token timer mid-stream drops/delays the flush of pending tokens in `batchedTokensRef.current`, resulting in text stutters.
3. **Layout Shifting**: `CommandItemRow` and `ConfigFieldRow` dynamically add paddings and borders depending on whether `isSelected` is true. In a terminal environment, adding a border/padding changes the height of the row block, causing the surrounding elements to shift vertically. Moving selection triggers instant vertical jumps in layout.
4. **Scrolling Height Estimation Desync**: `computeMessageLines` computes height for scrolling boundaries. It ignores `msg.blocks` entirely, and assumes 1 line per tool call. A collapsed `ExpandableToolOutput` takes ~7 lines, and an expanded one takes dozens. This underestimation clamps `scrollOffset` too early, rendering previous chat history inaccessible or cutting off bottom messages.
5. **Unsafe ANSI Slicing**: Slicing strings using Javascript's `.slice()` counts escape sequence characters towards the width, and slices raw characters. When cutting through an ANSI code, it breaks the sequence, causing color bleed across the terminal.
6. **Hardcoded Brand Colors**: Hardcoding Hex values in `TehutiHeader.tsx` and `CommandPalette.tsx` bypasses the centralized color theme in `BRANDING.colors`, meaning the headers and palette fail to adapt to user high-contrast configurations.
7. **MediaViewer Resize**: `MediaViewer` rendering only runs when `src` changes. If a user resizes their terminal, the image layout does not adapt and will wrap/clutter.
8. **Chat Input Wrap**: Hitting terminal width boundaries with input commands without `wrap="wrap"` causes character overflow and rendering artifacts.

---

## 3. Caveats

- Interactive manual testing of resizing states was not performed since the investigation is strictly read-only and no active execution was evaluated interactively.
- Visual appearance of Sixel/iTerm graphic fallback in `MediaViewer.tsx` depends on the terminal emulator itself, which was not executed during this study.

---

## 4. Conclusion

The TUI components of Tehuti CLI are highly optimized, but present several visual polish and scrolling-limit defects. Fixing the unused state timer, layout shifts in selection components, scroll viewport height calculations, and ANSI-aware string truncation will significantly improve TUI stability, responsiveness, and aesthetic polish.

### Actionable Polish Recommendations:
1. **Remove Unused State Timer**: Remove the `thinkingDots` state, its `setThinkingDots` loop inside `chat.ts`'s effect, and separate the batch timer cleanup from the thinking state transition logic.
2. **Normalize Selection Layouts**: Update `CommandItemRow` and `ConfigFieldRow` to have static padding and border styles, using colors and background color changes alone to indicate hover/selection.
3. **Refactor computeMessageLines**: Re-write `computeMessageLines` to process `msg.blocks` and correctly estimate the height of collapsed and expanded tool containers.
4. **Constrain Command Palette Height**: Clamp `MAX_DISPLAY` to a smaller subset (e.g., 4) or enforce a strict height constraint with internal list slicing to prevent terminal overflow.
5. **Implement ANSI-Safe String Slicing**: Use `stringWidth` from `string-width` to measure lines and write an ANSI-safe slice utility in `ExpandableToolOutput.tsx` to prevent escape sequence truncation and color bleeding.
6. **Centralize Brand Colors**: Refactor `TehutiHeader.tsx` and `CommandPalette.tsx` to read colors from `BRANDING.colors` so they respect high-contrast settings.
7. **Listen to Terminal Resizes in MediaViewer**: Pass `terminalWidth` to `MediaViewer` as a dependency so it regenerates the terminal-image thumbnail on window resize.
8. **Add wrap prop to chat input**: Add `wrap="wrap"` inside `renderInput`'s main `<Text>` wrapper.

---

## 5. Verification Method

To verify these observations and future implementations:
1. **Type checking & Tests**: Run `npx tsc --noEmit` and `npm test` to ensure there are no compilation errors or broken unit tests.
2. **Visual Inspection**:
   - Open interactive chat session: `npm start`
   - Hover the mouse or use arrow keys over the `/config` editor rows or `/` command palette items to observe the vertical shifting jitter.
   - Run a tool that produces more than 5 lines of output (e.g. `npm run build`), expand the output, and try to scroll up using `PgUp` or `Ctrl+UpArrow` to verify the scroll limit clamping issue.
   - Run a command that prints colored output and verify if any text truncation breaks the ANSI sequence.
