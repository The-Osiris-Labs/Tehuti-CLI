# 𓆣 Viewport, Overflow, and Scrolling Mechanics Analysis

Detailed read-only analysis of the custom virtual sliding viewport, overflow handling, layout constraints, and scrolling mechanics in `src/cli/commands/chat.ts` and related files.

---

## 1. Observation

Direct observations from the codebase files:

### A. Compact Header Scroll Height Calculation Bug
In `src/cli/commands/chat.ts`, lines 1317-1318 and 1874-1877:
```typescript
1317: 	const shouldShowHeader = showWelcome && scrollOffset === 0 && messages.length > 0;
1318: 	const headerScrollHeight = shouldShowHeader ? 14 : 0;
...
1874: 	const chatViewportHeight = Math.max(
1875: 		3,
1876: 		terminalHeight - headerHeight - inputHeight - 4 - headerScrollHeight - warningsHeight - suggestionsCount - paletteHeight,
1877: 	);
```
However, in the main JSX rendering section (lines 3216-3220), when messages exist (`messages.length > 0`), the compact header is rendered inside the scroll viewport:
```typescript
3216: 									showWelcome && React.createElement(
3217: 										Box,
3218: 										{ flexDirection: "column", alignItems: "center", marginBottom: 1 },
3219: 										React.createElement(TehutiHeader, { compact: true })
3220: 									),
```
Inside `src/cli/ui/components/TehutiHeader.tsx`, line 12-20:
```typescript
12: 	if (compact) {
13: 		return (
14: 			<Box flexDirection="row" alignItems="center" marginBottom={1} borderStyle="round" borderColor="#D4AF37" paddingX={2}>
15: 				<Text color="#D4AF37" bold>𓆣 TEHUTI </Text>
16: 				<Text color="#8B7355" dimColor> │ Scribe of Code Transformations │ </Text>
17: 				<Text color="#D97757">𓁹 Write • Edit • Transform</Text>
18: 			</Box>
19: 		);
20: 	}
```

### B. Dynamic Elements and Multiline Input Clipping
`chatViewportHeight` (lines 1874-1877) relies on a static `inputHeight = 3` and a hardcoded spacer `- 4`. It ignores the height of several active dynamic elements rendered inside the main output Box:
1. **Warnings block** (lines 3195-3201): Renders using 4 lines per warning, but text wrapping isn't calculated.
2. **Dashboard** (line 3202): `SwarmVisualizer` renders dynamically.
3. **Thinking block** (lines 3224-3243): Takes ~2 lines.
4. **Scroll indicator** (lines 3244-3245): Takes 1 line.
5. **Error block** (lines 3246-3255): Takes ~4 lines.
6. **Loading block** (lines 3256-3283): Takes ~3.5 lines (spinner + progress bar).
7. **Wrapped Input Text**: Renders in `renderInput` (lines 3010-3034) inside a Box with `paddingTop: 1`. If input wraps, its height exceeds 1 line (total container height > 2 lines).

### C. Inaccurate Line Height Approximations in `computeMessageLines`
In `src/terminal/output.ts`, lines 211-234:
```typescript
211: export function computeMessageLines(msg: any, contentMaxWidth: number): number {
212: 	let lines = 0;
213: 	lines += 1; // Role header
214: 
215: 	if (typeof msg.content === 'string') {
216: 		lines += wrap(msg.content, contentMaxWidth).split('\n').length;
217: 	} else if (Array.isArray(msg.content)) {
218: 		msg.content.forEach((sub: any) => {
219: 			if (sub.type === 'text') {
220: 				lines += wrap(sub.content, contentMaxWidth).split('\n').length;
221: 			} else if (sub.type === 'reasoning') {
222: 				lines += 2; // Borders
223: 				lines += wrap(sub.content, Math.max(10, contentMaxWidth - 4)).split('\n').length;
224: 			}
225: 		});
226: 	}
227: 
228: 	if (msg.toolCalls && msg.toolCalls.length > 0) {
229: 		lines += msg.toolCalls.length; // Assume 1 line per tool call when collapsed
230: 	}
231: 
232: 	lines += 1; // Margin bottom between messages
233: 	return lines;
234: }
```
- In the active application, `msg.content` is always a string. Structured blocks are stored in `msg.blocks`. Line 217 checking `Array.isArray(msg.content)` is dead code.
- A collapsed `ExpandableToolOutput` takes **10-11 terminal lines** (2 border lines + 1 header + 1 footer + 2 margin lines + up to 4 lines of preview text + 1 line outer margin), but line 229 only adds **1 line** to the count.
- Markdown features (code blocks with borders/margins/line numbers, headers with underlines/newlines, and tables with borders) are treated as plain text wrappers, causing wide height discrepancies.

### D. Lack of Mouse Scroll Support
In `src/cli/ui/hooks/useChatInput.ts`, lines 79-81:
```typescript
79: 		if (isMouseSequence(k)) {
80: 			return;
81: 		}
```
And in `src/utils/mouse.ts`, lines 6-25, any mouse sequence is filtered out. Consequently, mouse wheel scrolling triggers are discarded, despite mouse click/hover operations being supported in command lists.

### E. Command Palette Submenu Selection Overflow
In `src/cli/ui/components/CommandPalette.tsx`, lines 317-319 and 378-382:
```typescript
317: 	const MAX_DISPLAY = 9; 
318: 	const displayCommands = filteredCommands.slice(0, MAX_DISPLAY);
...
378: 						...cmds.slice(0, MAX_DISPLAY).map((cmd) => {
379: 							const cmdIndex = filteredCommands.findIndex((c) => c.id === cmd.id);
380: 							const isSelected = cmdIndex === selectedIndex;
```
If a submenu (e.g. `/model`) contains 100 items, and the user scrolls past index 8 using arrow keys, the cursor `selectedIndex` updates successfully, but the selected item is not rendered since the slice is locked to `(0, 9)`. The cursor highlight disappears completely.

---

## 2. Logic Chain

1. **Header Layout Glitch**: 
   - Handoff.md rules require keeping the DOM elements intact and using `marginBottom: -scrollOffset` to slide.
   - The compact header is rendered *inside* the scrolling container (line 3216). Its height is 4 lines.
   - However, `headerScrollHeight` shrinks `chatViewportHeight` by 14 lines when `scrollOffset === 0` (Observation A).
   - This subtracts 10 excess lines from the viewport, leaving a blank vertical gap.
   - When scrolling up (`scrollOffset > 0`), `shouldShowHeader` becomes `false` and `headerScrollHeight` drops to `0`. The viewport suddenly snaps back by 14 lines, causing the chat view to jitter.

2. **Clipped Bottom Inputs**:
   - Ink calculates the layout using flexbox. The message Box uses `flexGrow: 1` and `overflow: "hidden"`.
   - Since `chatViewportHeight` fails to deduct active dynamic elements (errors, thinking, progress, wrapped input lines) from its height budget (Observation B), the message box takes too much space.
   - Under flexbox, this pushes the bottom items (the text input box, scroll bar, progress indicators) below the physical bounds of the terminal screen, where they are clipped by `overflow: "hidden"`.

3. **Capped scrolling and Blank screens**:
   - `totalMessageLines` determines `maxOff` (scrolling ceiling).
   - `computeMessageLines` underestimates collapsed tool outputs by 9-10 lines per tool call and ignores markdown borders (Observation C).
   - As a result, `totalMessageLines` is severely underestimated.
   - When a user tries to scroll up to read history, `scrollOffset` is capped prematurely at a low `maxOff`. The top messages remain hidden and cannot be reached.
   - Conversely, if plain text wraps wider than expected, `totalMessageLines` might be overestimated, allowing `scrollOffset` to scroll past the top of the history, showing a completely blank terminal screen.

4. **Keyboard shortcuts clash**:
   - Default scrolling keys in `useChatInput.ts` are `PageUp`, `PageDown`, `Ctrl+UpArrow`, and `Ctrl+DownArrow` (Observation D).
   - On macOS systems, `Ctrl+Up` and `Ctrl+Down` are intercepted by default for Mission Control / App Exposé. Terminal emulators intercept `PageUp`/`PageDown` to scroll terminal buffer history.
   - Consequently, the user cannot scroll the virtual viewport on standard macOS terminal configurations without modifying system settings.

5. **Command Palette Visual Mismatch**:
   - Limiting the mapped elements to the first 9 of each group (Observation E) while letting keyboard selection go up to the size of the whole list creates a visual disconnect. 
   - A user scrolling down to model 15 sees no highlight indicator, preventing them from knowing which model is active before pressing Enter.

---

## 3. Caveats

- Mouse coordinate mapping: Terminal mouse coordinates (SGR format) depend on terminal emulator configurations and might vary slightly.
- Ink layout boundaries: The exact rendering of margins and paddings in character grids relies on Yoga layouts, which round values. Small 1-character deviations can happen depending on font sizes and rendering widths.

---

## 4. Conclusion & Recommendations

The virtual sliding viewport paradigm is structurally sound but suffers from mathematical layout calculation errors, dead code branches, and static height assumptions.

### Actionable Recommendations (Proposals):

#### Recommendation 1: Fix Compact Header Layout Snap
Since the compact header scrolls with the messages inside the scroll container, it should not be subtracted from `chatViewportHeight`. 
- **Proposed change** in `src/cli/commands/chat.ts` (line 1318):
```typescript
const headerScrollHeight = 0; // The compact header scrolls inline; do not shrink the viewport.
```

#### Recommendation 2: Dynamic Viewport Height Budgeting
Compute `chatViewportHeight` dynamically by subtracting the actual heights of all active bottom elements.
- **Proposed change** in `src/cli/commands/chat.ts`:
```typescript
const activeWarningsHeight = configWarnings.length * 4;
const activeThinkingHeight = showThinking ? 2 : 0;
const activeScrollHeight = scrollIndicator ? 1 : 0;
const activeErrorHeight = error ? 4 : 0;
const activeLoadingHeight = loading ? 3 : 0;
const activeInputHeight = Math.max(3, wrap(input, terminalWidth - 6).split('\n').length + 2);

const chatViewportHeight = Math.max(
	3,
	terminalHeight - headerHeight - activeInputHeight - activeThinkingHeight - activeScrollHeight - activeErrorHeight - activeLoadingHeight - activeWarningsHeight - paletteHeight
);
```

#### Recommendation 3: Re-align `computeMessageLines` with Actual Render Output
- Read `msg.blocks` instead of the dead `Array.isArray(msg.content)` branch.
- Return accurate line counts for collapsed tool calls (~10 lines).
- Parse markdown code blocks, tables, and headers to count borders, margins, and line wraps.
- **Proposed change** in `src/terminal/output.ts` (`computeMessageLines`):
```typescript
export function computeMessageLines(msg: any, contentMaxWidth: number): number {
	let lines = 0;
	lines += 1; // Role header

	const blocks = msg.blocks || (typeof msg.content === 'string' ? parseContentBlocks(msg.content) : []);

	if (blocks && blocks.length > 0) {
		blocks.forEach((block: any) => {
			if (block.type === 'text') {
				lines += computeMarkdownLines(block.content, contentMaxWidth - 1); // Subtract 1 for paddingLeft
			} else if (block.type === 'reasoning') {
				lines += 2; // Borders
				lines += wrap(block.content, Math.max(10, contentMaxWidth - 5)).split('\n').length;
			} else if (block.type === 'tool') {
				// 2 lines borders + 1 line header + 1 line footer + 2 lines marginY + display content
				const summary = summarizeToolOutput(block.result, contentMaxWidth - 5, 4);
				lines += 6 + Math.min(4, summary.lineCount);
				lines += 1; // Margin top/bottom spacer
			}
		});
	} else if (typeof msg.content === 'string') {
		lines += wrap(msg.content, contentMaxWidth - 1).split('\n').length;
	}

	lines += 1; // Margin bottom between messages
	return lines;
}
```

#### Recommendation 4: Support Mouse Wheel and Alternative Keys
- Modify `useChatInput` to intercept Option/Alt + Up/Down key bindings.
- Parse SGR mouse reporting wheel sequences (`\x1b[<64;` and `\x1b[<65;`) in `isMouseSequence` to trigger `scrollLineUp` and `scrollLineDown`.

#### Recommendation 5: Sliding Viewport for Command Palette
- **Proposed change** in `CommandPalette.tsx`: Slice `filteredCommands` relative to `selectedIndex` to create a sliding window of size 9 centered around the user selection.
```typescript
const windowStart = Math.max(0, Math.min(filteredCommands.length - MAX_DISPLAY, selectedIndex - Math.floor(MAX_DISPLAY / 2)));
const displayCommands = filteredCommands.slice(windowStart, windowStart + MAX_DISPLAY);
```

---

## 5. Verification Method

### A. Manual Layout Verification
1. Run `npm run build` followed by `npm start`.
2. Generate an assistant message that outputs multiple tool calls.
3. Attempt to scroll up to verify if the scrollbar caps and prevents reading the first user message.
4. Input a very long multi-line prompt into the text input area and verify if the input bar or status progress indicators clip/vanish from the screen.
5. In the `/model` palette submenu, scroll down past 9 items and confirm the yellow select cursor is lost.

### B. Unit Test Suite
Run the test command:
```bash
npm test
```
Confirm the existing 400+ unit/integration tests still pass (checks that core wrapping math isn't broken). Add a new test in `tests/e2e/tier2.test.ts` focusing on block-based message heights.
