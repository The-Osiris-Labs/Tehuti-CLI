# Milestone 4 Review & Adversarial Stress-Test Handoff Report

## 1. Observation

Direct observations made within `/Users/youssefsala7/Projects/Tehuti-CLI-Revival`:

### A. High Contrast Color Formatting Bug (`src/terminal/output.ts`)
Lines 39-40:
```typescript
	green: (text: string) => (shouldUseColors() ? `${shouldUseHighContrast() ? HIGH_CONTRAST_GREEN : pc.green(text)}` : text),
	red: (text: string) => (shouldUseColors() ? `${shouldUseHighContrast() ? HIGH_CONTRAST_RED : pc.red(text)}` : text),
```
These lines show that if `shouldUseColors()` is true and `shouldUseHighContrast()` is true, the returned string is just the escape code string (`HIGH_CONTRAST_GREEN` / `HIGH_CONTRAST_RED`), completely losing the `text` parameter. No reset sequence (`\x1b[0m`) is appended at the end of the return values.

### B. Facade Question Resolver / Missing UI (`src/cli/commands/chat.ts`)
- In `src/cli/commands/chat.ts` (lines 1983-1990), a global resolver is set:
  ```typescript
		questionResolverRef.current = async (
			questions: QuestionData[],
		): Promise<string[]> => {
			return new Promise((resolve, reject) => {
				setPendingQuestion({ questions, resolve, reject });
			});
		};
		setQuestionResolver(questionResolverRef.current);
  ```
- Grep search for `pendingQuestion` across the entire JSX/render return of `chat.ts` shows 0 references.
- The handler `_handleQuestionAnswer` (line 1999) is declared but has 0 references or call-sites in `chat.ts`.
- The handler `_handleQuestionCancel` (line 2022) is declared but has 0 references or call-sites in `chat.ts`.

### C. Input Interaction Leakage in Config Editor (`src/cli/commands/chat.ts` and `src/cli/ui/hooks/useChatInput.ts`)
- `useChatInput` is invoked at the root of `ChatUI` unconditionally (line 2091).
- `showConfigEditor` state variable is declared in `useChatState` and used in `chat.ts` to toggle between the ConfigEditor and the main chat UI layout.
- The props interface `UseChatInputProps` in `src/cli/ui/hooks/useChatInput.ts` does not accept `showConfigEditor`.
- Within the `useInput` callback of `useChatInput.ts` (line 83), there are only two early return statements matching palette states:
  ```typescript
		if (showCommandPaletteRef.current) {
			return;
		}
  ```
  No check for `showConfigEditor` exists.

### D. Scroll Wheel Interaction Leakage (`src/cli/ui/hooks/useChatInput.ts`)
- In the `useInput` hook of `useChatInput.ts` (lines 83-91), scroll wheel events are captured:
  ```typescript
		if (k && k.startsWith("\x1b[<64;")) {
			scrollLineUp();
			return;
		}
		if (k && k.startsWith("\x1b[<65;")) {
			scrollLineDown();
			return;
		}
  ```
- These event handlers execute and return *before* the check for `showCommandPaletteRef.current` (line 103) is reached.

### E. Layout Jumping when Scrolling (`src/cli/commands/chat.ts`)
- In `src/cli/commands/chat.ts` (line 1321):
  ```typescript
  const headerScrollHeight = shouldShowHeader ? 14 : 0;
  ```
- In `src/cli/commands/chat.ts` (line 1320):
  ```typescript
  const shouldShowHeader = showWelcome && scrollOffset === 0 && messages.length > 0;
  ```
- In `src/cli/commands/chat.ts` (line 1877):
  ```typescript
  const chatViewportHeight = Math.max(
  	3,
  	terminalHeight - headerHeight - inputHeight - 4 - headerScrollHeight - warningsHeight - suggestionsCount - paletteHeight,
  );
  ```

### F. Unhandled Submenu Rejections (`src/cli/ui/components/CommandPalette.tsx`)
- In `src/cli/ui/components/CommandPalette.tsx` (lines 249-266):
  ```typescript
	const handleExecute = async (selected: CommandItem) => {
		if (selected.submenu) {
			setIsLoading(true);
			try {
				const children = await selected.submenu();
				setMenuStack((prev) => [...prev, { title: selected.label, commands: children }]);
				setQuery("");
			} finally {
				setIsLoading(false);
			}
		} else {
...
  ```
- In `useInput` key handler of `CommandPalette.tsx` (line 303):
  ```typescript
			if (key.return && filteredCommands.length > 0) {
				const selected = filteredCommands[selectedIndex] || filteredCommands[0];
				if (selected) {
					void handleExecute(selected);
				}
				return;
			}
  ```

---

## 2. Logic Chain

1. **High Contrast Color Formatter Defect**:
   - From **A**, the high contrast template literals for `green` and `red` resolve to `${HIGH_CONTRAST_GREEN}` and `${HIGH_CONTRAST_RED}` respectively without interpolating the passed `text` variable.
   - Therefore, calling `colors.green("hello")` when `shouldUseColors()` and `shouldUseHighContrast()` are both true returns `"\x1b[38;5;34m"`.
   - The string content `"hello"` is discarded, and since there is no closing `\x1b[0m` reset code, the high contrast green ANSI code will apply to all subsequent terminal outputs (color bleeding).

2. **Indefinite Hang on Question Resolution**:
   - From **B**, the `question` tool registers the `questionResolverRef` promise hook.
   - If the agent calls the `question` tool, a promise is generated and waits on `setPendingQuestion`.
   - Since `pendingQuestion` is never rendered in JSX, the user never sees any questions.
   - Since `_handleQuestionAnswer` is never called or passed to any active child components, the promise never resolves, resulting in an infinite hang in the agent loop.

3. **UI Input Collision in Config Editor**:
   - From **C**, the hook `useChatInput` remains active and registers its own global `useInput` listener when the Config Editor is rendered.
   - Since the hook contains no logic to ignore keys when `showConfigEditor` is true, keys typed by the user to change configuration values are simultaneously processed by `useChatInput`.
   - This causes characters to be appended to the hidden chat input buffer, history traversal to be triggered when using Up/Down arrow keys, and the chat `send` workflow (unintended LLM requests) to trigger upon pressing `Enter`.

4. **Scroll Wheel leakage**:
   - From **D**, scroll wheel check conditions return before checking `showCommandPaletteRef.current`.
   - Consequently, mouse wheel scrolling while the Command Palette (or Config Editor) is open will leak down to scroll the main chat messages, causing layout shifting in the background.

5. **Layout Jumps**:
   - From **E**, `headerScrollHeight` switches from `14` (when `scrollOffset === 0`) to `0` (the moment the user scrolls up, since `scrollOffset > 0` invalidates `shouldShowHeader`).
   - This dynamically reduces `headerScrollHeight` to `0`, which instantly increases `chatViewportHeight` by 14 lines.
   - This height fluctuation causes the visible messages to shift and bounce abruptly during scrolling.

6. **Unhandled Submenu Promiserejections**:
   - From **F**, `handleExecute` is called as `void handleExecute(selected)`.
   - If `selected.submenu()` rejects (e.g. because fetching models fails due to lack of network, or reading sessions fails due to file access error), the rejection propagates out of the async function as an unhandled promise rejection.
   - In Node.js 15+, unhandled rejections crash the process with a non-zero exit code.

---

## 3. Caveats

- We assumed that `process.env.FORCE_HIGH_CONTRAST` or `process.env.HIGH_CONTRAST` could be set by the user or their terminal agent.
- We did not manually patch the code, in accordance with the review-only constraint.
- No other components or files in the project were found to have visual polish or TUI layout issues.

---

## 4. Conclusion

The implementation of Milestone 4 (Visual Polish & TUI) has several critical and major correctness, robustness, and completeness violations. The verdict is **REQUEST_CHANGES**.

### Suggested Fixes:
1. **High Contrast Color formatters (`src/terminal/output.ts`)**:
   Fix the template literals to include `text` and reset sequence:
   ```typescript
   green: (text: string) => (shouldUseColors() ? `${shouldUseHighContrast() ? HIGH_CONTRAST_GREEN : pc.green(text)}${shouldUseHighContrast() ? "\x1b[0m" : ""}` : text),
   red: (text: string) => (shouldUseColors() ? `${shouldUseHighContrast() ? HIGH_CONTRAST_RED : pc.red(text)}${shouldUseHighContrast() ? "\x1b[0m" : ""}` : text),
   ```
2. **Facade Question Resolver (`src/cli/commands/chat.ts`)**:
   Implement a JSX component inside `chat.ts` to display questions when `pendingQuestion` is active, and use `_handleQuestionAnswer`/`_handleQuestionCancel` to handle submissions.
3. **Input Clash (`src/cli/commands/chat.ts`)**:
   Pass `showConfigEditor` to `useChatInput` and return early in the key handler:
   ```typescript
   if (showConfigEditor) {
       return;
   }
   ```
4. **Scroll Wheel Leakage (`src/cli/ui/hooks/useChatInput.ts`)**:
   Move the checks for scroll wheel *below* the palette and config editor checks.
5. **Stable Viewport Height (`src/cli/commands/chat.ts`)**:
   Avoid dynamically changing `headerScrollHeight` based on `scrollOffset`. Keep it constant (e.g., subtract exactly `3` for the compact header if `showWelcome` is true, regardless of `scrollOffset`).
6. **Command Palette submenu load (`src/cli/ui/components/CommandPalette.tsx`)**:
   Wrap `selected.submenu()` in a `try/catch` and gracefully render an error message on screen instead of crashing the process.

---

## 5. Verification Method

To verify these findings:
1. **Tests & Build**:
   ```bash
   npm run build
   npx tsc --noEmit
   npm test
   ```
2. **Inspect Files**:
   - `src/terminal/output.ts` (Lines 39-40) to verify high contrast formatting.
   - `src/cli/commands/chat.ts` (Lines 1983-2027) to verify the unrendered `pendingQuestion` and undefined usage of `_handleQuestionAnswer`.
   - `src/cli/ui/hooks/useChatInput.ts` (Lines 83-106) to check missing check for `showConfigEditor` and early scroll-wheel processing.
   - `src/cli/ui/components/CommandPalette.tsx` (Lines 249-266) to verify the unhandled submenu promise execution.
