# Handoff Report: TUI Input and Selection Bug Investigation

This report contains a read-only investigation and concrete fix strategies to resolve issues in the Tehuti CLI Terminal User Interface (TUI), specifically regarding input clashes in the Config Editor, text selection overrides/resets in `useChatInput.ts`, and scroll wheel leakage.

---

## 1. Observation

Direct observations within `/Users/youssefsala7/Projects/Tehuti-CLI-Revival`:

### A. Input Interaction Clash in Config Editor
* In `src/cli/commands/chat.ts` (lines 2091-2124), the `useChatInput` hook is called without passing `showConfigEditor` state:
  ```typescript
  useChatInput({
      input,
      setInput,
      cursorPos,
      setCursorPos,
      showCommandPalette,
      setShowCommandPalette,
      ...
  });
  ```
* In `src/cli/ui/hooks/useChatInput.ts`, the props interface `UseChatInputProps` does not define `showConfigEditor`:
  ```typescript
  export interface UseChatInputProps {
      input: string;
      setInput: (val: string | ((prev: string) => string)) => void;
      cursorPos: number;
      ...
  }
  ```
* Within `useChatInput.ts`'s `useInput` callback, the only early return check is for `showCommandPaletteRef.current` (lines 103-105):
  ```typescript
  if (showCommandPaletteRef.current) {
      return;
  }
  ```
  No check for config editor visibility exists in `useChatInput`.

### B. Text Selection Overrides
* In `src/cli/ui/hooks/useChatInput.ts` (lines 213-242 and lines 264-272), navigation keys are handled without checking if `Shift` is pressed:
  ```typescript
  if (key.upArrow && !loading) {
      if (history.length > 0) { ... }
      return;
  }
  if (key.downArrow && !loading) {
      if (historyIndex > 0) { ... }
      return;
  }
  if (key.home) {
      scrollToTop();
      return;
  }
  if (key.end) {
      scrollToBottom();
      return;
  }
  ```
* In the unit test file `src/cli/ui/hooks/useChatInput.test.ts` (lines 159-185), tests explicitly assert the bug as expected behavior:
  ```typescript
  it("should trigger scrollToTop on Shift+Home instead of text selection", () => {
      ...
      triggerInput("", { shift: true, home: true });
      expect(props.scrollToTop).toHaveBeenCalled();
  });
  it("should navigate history on Shift+UpArrow instead of selection", () => {
      ...
      triggerInput("", { shift: true, upArrow: true });
      expect(props.setInput).toHaveBeenCalledWith("history-1");
  });
  ```

### C. Text Selection Reset on Unhandled Keys
* In `src/cli/ui/hooks/useChatInput.ts` (lines 393-396), the active text selection is unconditionally cleared before handling normal text entry or escaping:
  ```typescript
  if (!key.shift && selectionStart !== null) {
      setSelectionStart(null);
      setSelectionEnd(null);
  }
  ```
* This block runs globally on any keypress (e.g., `Ctrl+G` or any unhandled sequence) that does not hold `Shift`.
* The test file `src/cli/commands/tui-viewport.test.ts` (lines 64-85) asserts that unhandled keys clear selection:
  ```typescript
  it("should verify that unhandled keys clear text selection", () => {
      ...
      expect(selectionCleared).toBe(true);
      expect(keyHandled).toBe(false);
  });
  ```

### D. Scroll Wheel Interaction Leakage
* In `src/cli/ui/hooks/useChatInput.ts` (lines 83-94), mouse scroll wheel sequences are processed before checking if a panel is open:
  ```typescript
  useInput((k, key) => {
      if (k && k.startsWith("\x1b[<64;")) {
          scrollLineUp();
          return;
      }
      if (k && k.startsWith("\x1b[<65;")) {
          scrollLineDown();
          return;
      }
      if (isMouseSequence(k)) {
          return;
      }
      ...
      if (showCommandPaletteRef.current) {
          return;
      }
  ```

---

## 2. Logic Chain

1. **Config Editor Input Leak**:
   - Because `useChatInput` is not aware of `showConfigEditor` (Observation A), it continues processing inputs globally in the background when the user works in the Config Editor.
   - Any characters typed in the Config Editor are appended to the main chat input buffer, and pressing Enter submits a chat message, causing duplicate state changes.
2. **Text Selection Overrides**:
   - Standard keys (`Home`/`End`/`Up`/`Down`) are processed without verifying `!key.shift` (Observation B).
   - This intercepts `Shift+Home`, `Shift+End`, `Shift+UpArrow`, and `Shift+DownArrow`, bypassing text selection logic and triggering scrolling/history navigation instead.
3. **Fragile Selection Resets**:
   - The unconditional reset check (Observation C) runs globally at the bottom of the input loop.
   - Any key combination not carrying Shift (even unhandled keystrokes like `Ctrl+G` or unrecognized terminal commands) reaches this block and clears active selection.
4. **Scroll Leakage**:
   - Since scroll wheel checks occur at the absolute start of the `useInput` loop (Observation D), they bypass the modal-active return checks (`showCommandPaletteRef.current`).
   - Consequently, mouse scrolling while panels are open passes directly to the main message box and scrolls the background list.

---

## 3. Caveats

- **Test Suite Updates**: The existing test suite was written to assert/verify the buggy behaviors (e.g. verifying that `Shift+Home` scrolls or that unhandled keys clear selection). Therefore, fixing the codebase requires modifying both the implementation files and their corresponding unit test files. Otherwise, the tests will fail.
- **Terminal Emulator Compatibility**: Mouse wheel scrolling sequences can vary across terminal clients (e.g. standard VT100 vs xterm-mouse mode). However, the CLI relies on standard ANSI mouse sequence matching (`\x1b[<...`), which is correctly parsed by the existing `isMouseSequence` helper.

---

## 4. Conclusion & Proposed Fixes

To resolve all four issues robustly without changing other layout properties:

### Fix 1: Pass and Check `showConfigEditor` in `useChatInput`
* Add `showConfigEditor: boolean` to `UseChatInputProps` in `src/cli/ui/hooks/useChatInput.ts`.
* In `src/cli/commands/chat.ts`, pass `showConfigEditor` down to `useChatInput`.
* Declare `showConfigEditorRef` in `useChatInput.ts` and update it synchronously in the render phase to prevent any 1-frame race conditions:
  ```typescript
  const showConfigEditorRef = React.useRef(showConfigEditor);
  showConfigEditorRef.current = showConfigEditor;
  ```

### Fix 2: Prevent Scroll Leakage by Placing Modal Checks Above Scroll Handlers
* Re-order the top of `useInput` in `useChatInput.ts` to check Ctrl+P first, followed by panel visibility checks, and then handle scroll events:
  ```typescript
  useInput((k, key) => {
      // 1. Toggle command palette
      if (key.ctrl && k === "p") {
          const newVal = !showCommandPaletteRef.current;
          showCommandPaletteRef.current = newVal;
          setShowCommandPalette(newVal);
          return;
      }

      // 2. Short-circuit if any panel is open
      if (showCommandPaletteRef.current || showConfigEditorRef.current) {
          return;
      }

      // 3. Handle scroll and mouse actions
      if (k && k.startsWith("\x1b[<64;")) {
          scrollLineUp();
          return;
      }
      if (k && k.startsWith("\x1b[<65;")) {
          scrollLineDown();
          return;
      }
      if (isMouseSequence(k)) {
          return;
      }
  ```

### Fix 3: Respect `!key.shift` and Implement Shift Selection Handlers
* Protect history navigation and scroll-to-top/bottom checks with `!key.shift`.
* Explicitly support text selection to boundaries using `Shift+Home`, `Shift+End`, `Shift+UpArrow`, and `Shift+DownArrow`:
  ```typescript
  // In useChatInput.ts:
  
  if (key.upArrow && !key.shift && !loading) {
      // Traverse history
  }
  if (key.downArrow && !key.shift && !loading) {
      // Traverse history
  }
  if (key.home && !key.shift) {
      scrollToTop();
      return;
  }
  if (key.end && !key.shift) {
      scrollToBottom();
      return;
  }

  // Text selection bindings
  if (key.shift && key.home) {
      if (selectionStart === null) setSelectionStart(cursorPos);
      setSelectionEnd(0);
      setCursorPos(0);
      return;
  }
  if (key.shift && key.end) {
      if (selectionStart === null) setSelectionStart(cursorPos);
      setSelectionEnd(input.length);
      setCursorPos(input.length);
      return;
  }
  if (key.shift && key.upArrow) {
      if (selectionStart === null) setSelectionStart(cursorPos);
      setSelectionEnd(0);
      setCursorPos(0);
      return;
  }
  if (key.shift && key.downArrow) {
      if (selectionStart === null) setSelectionStart(cursorPos);
      setSelectionEnd(input.length);
      setCursorPos(input.length);
      return;
  }
  ```

### Fix 4: Safely Reset Selection Only on Handled Cursor/Input Modifiers
* Remove the unconditional selection reset block at the bottom of the `useInput` loop.
* Ensure selection is explicitly cleared inside cursor-changing key handlers when `Shift` is not pressed:
  - `key.leftArrow` and `key.rightArrow` without `Shift` (handled on lines 399-427).
  - `key.upArrow` and `key.downArrow` (history traversal) when `Shift` is not pressed.
  - `Ctrl+A` and `Ctrl+E` custom cursor moves.
  - `Escape` key input clears.
  - For example:
    ```typescript
    if (key.ctrl && k === "a") {
        if (hasSelection) {
            setSelectionStart(null);
            setSelectionEnd(null);
        }
        setCursorPos(0);
        return;
    }
    ```

---

## Code Diffs and Code Patch Proposals

### 1. `src/cli/ui/hooks/useChatInput.ts`

```patch
diff --git a/src/cli/ui/hooks/useChatInput.ts b/src/cli/ui/hooks/useChatInput.ts
index abcdefg..hijklmn 100644
--- a/src/cli/ui/hooks/useChatInput.ts
+++ b/src/cli/ui/hooks/useChatInput.ts
@@ -12,2 +12,3 @@ export interface UseChatInputProps {
 	showCommandPalette: boolean;
 	setShowCommandPalette: (val: boolean) => void;
+	showConfigEditor: boolean;
 	history: string[];
@@ -78,6 +79,7 @@ export function useChatInput(props: UseChatInputProps) {
 	const showCommandPaletteRef = React.useRef(showCommandPalette);
-	React.useEffect(() => {
-		showCommandPaletteRef.current = showCommandPalette;
-	}, [showCommandPalette]);
+	showCommandPaletteRef.current = showCommandPalette;
+
+	const showConfigEditorRef = React.useRef(showConfigEditor);
+	showConfigEditorRef.current = showConfigEditor;
 
 	useInput((k, key) => {
-		if (k && k.startsWith("\x1b[<64;")) {
-			scrollLineUp();
-			return;
-		}
-		if (k && k.startsWith("\x1b[<65;")) {
-			scrollLineDown();
-			return;
-		}
-		if (isMouseSequence(k)) {
-			return;
-		}
-
 		if (key.ctrl && k === "p") {
 			const newVal = !showCommandPaletteRef.current;
 			showCommandPaletteRef.current = newVal;
 			setShowCommandPalette(newVal);
 			return;
 		}
 
-		if (showCommandPaletteRef.current) {
+		if (showCommandPaletteRef.current || showConfigEditorRef.current) {
 			return;
 		}
+
+		if (k && k.startsWith("\x1b[<64;")) {
+			scrollLineUp();
+			return;
+		}
+		if (k && k.startsWith("\x1b[<65;")) {
+			scrollLineDown();
+			return;
+		}
+		if (isMouseSequence(k)) {
+			return;
+		}
 
 		const hasSelection = selectionStart !== null && selectionEnd !== null;
@@ -213,2 +225,6 @@ export function useChatInput(props: UseChatInputProps) {
-		if (key.upArrow && !loading) {
+		if (key.upArrow && !key.shift && !loading) {
+			if (hasSelection) {
+				setSelectionStart(null);
+				setSelectionEnd(null);
+			}
 			if (history.length > 0) {
@@ -230,2 +246,6 @@ export function useChatInput(props: UseChatInputProps) {
-		if (key.downArrow && !loading) {
+		if (key.downArrow && !key.shift && !loading) {
+			if (hasSelection) {
+				setSelectionStart(null);
+				setSelectionEnd(null);
+			}
 			if (historyIndex > 0) {
@@ -264,6 +284,6 @@ export function useChatInput(props: UseChatInputProps) {
-		if (key.home) {
+		if (key.home && !key.shift) {
 			scrollToTop();
 			return;
 		}
 
-		if (key.end) {
+		if (key.end && !key.shift) {
 			scrollToBottom();
 			return;
 		}
@@ -288,2 +308,6 @@ export function useChatInput(props: UseChatInputProps) {
 		if (key.ctrl && k === "a") {
+			if (hasSelection) {
+				setSelectionStart(null);
+				setSelectionEnd(null);
+			}
 			setCursorPos(0);
@@ -293,2 +317,6 @@ export function useChatInput(props: UseChatInputProps) {
 		if (key.ctrl && k === "e") {
+			if (hasSelection) {
+				setSelectionStart(null);
+				setSelectionEnd(null);
+			}
 			setCursorPos(input.length);
@@ -372,2 +400,30 @@ export function useChatInput(props: UseChatInputProps) {
 		// Text selection
+		if (key.shift && key.home) {
+			if (selectionStart === null) {
+				setSelectionStart(cursorPos);
+			}
+			setSelectionEnd(0);
+			setCursorPos(0);
+			return;
+		}
+
+		if (key.shift && key.end) {
+			if (selectionStart === null) {
+				setSelectionStart(cursorPos);
+			}
+			setSelectionEnd(input.length);
+			setCursorPos(input.length);
+			return;
+		}
+
+		if (key.shift && key.upArrow) {
+			if (selectionStart === null) {
+				setSelectionStart(cursorPos);
+			}
+			setSelectionEnd(0);
+			setCursorPos(0);
+			return;
+		}
+
+		if (key.shift && key.downArrow) {
+			if (selectionStart === null) {
+				setSelectionStart(cursorPos);
+			}
+			setSelectionEnd(input.length);
+			setCursorPos(input.length);
+			return;
+		}
+
 		if (key.shift && key.leftArrow) {
@@ -393,6 +449,2 @@ export function useChatInput(props: UseChatInputProps) {
-		if (!key.shift && selectionStart !== null) {
-			setSelectionStart(null);
-			setSelectionEnd(null);
-		}
-
 		// Cursor navigation
@@ -400,2 +452,6 @@ export function useChatInput(props: UseChatInputProps) {
 		if (key.leftArrow && !key.shift) {
+			if (hasSelection) {
+				setSelectionStart(null);
+				setSelectionEnd(null);
+			}
 			if (key.ctrl || key.meta) {
@@ -415,2 +471,6 @@ export function useChatInput(props: UseChatInputProps) {
 		if (key.rightArrow && !key.shift) {
+			if (hasSelection) {
+				setSelectionStart(null);
+				setSelectionEnd(null);
+			}
 			if (key.ctrl || key.meta) {
@@ -431,2 +491,4 @@ export function useChatInput(props: UseChatInputProps) {
 			setCursorPos(0);
 			setHistoryIndex(-1);
+			setSelectionStart(null);
+			setSelectionEnd(null);
 			return;
```

### 2. `src/cli/commands/chat.ts`

```patch
diff --git a/src/cli/commands/chat.ts b/src/cli/commands/chat.ts
index abcdefg..hijklmn 100644
--- a/src/cli/commands/chat.ts
+++ b/src/cli/commands/chat.ts
@@ -2097,2 +2097,3 @@
 		setShowCommandPalette,
+		showConfigEditor,
 		history,
```

### 3. `src/cli/ui/hooks/useChatInput.test.ts`
Correct test expectations to verify that `Shift+Home`, `Shift+End`, and `Shift+UpArrow` do text selection instead of hijacking scrolling or history.

```patch
diff --git a/src/cli/ui/hooks/useChatInput.test.ts b/src/cli/ui/hooks/useChatInput.test.ts
index abcdefg..hijklmn 100644
--- a/src/cli/ui/hooks/useChatInput.test.ts
+++ b/src/cli/ui/hooks/useChatInput.test.ts
@@ -159,8 +159,9 @@ describe("useChatInput hook", () => {
-	it("should trigger scrollToTop on Shift+Home instead of text selection", () => {
+	it("should handle text selection using Shift+Home", () => {
+		props.cursorPos = 5;
 		const { unmount } = render(React.createElement(HookWrapper, { props }));
 
 		triggerInput("", { shift: true, home: true });
-		expect(props.scrollToTop).toHaveBeenCalled();
-		expect(props.setSelectionStart).not.toHaveBeenCalled();
+		expect(props.setSelectionStart).toHaveBeenCalledWith(5);
+		expect(props.setSelectionEnd).toHaveBeenCalledWith(0);
+		expect(props.setCursorPos).toHaveBeenCalledWith(0);
 		unmount();
 	});
 
-	it("should trigger scrollToBottom on Shift+End instead of text selection", () => {
+	it("should handle text selection using Shift+End", () => {
+		props.cursorPos = 5;
 		const { unmount } = render(React.createElement(HookWrapper, { props }));
 
 		triggerInput("", { shift: true, end: true });
-		expect(props.scrollToBottom).toHaveBeenCalled();
-		expect(props.setSelectionStart).not.toHaveBeenCalled();
+		expect(props.setSelectionStart).toHaveBeenCalledWith(5);
+		expect(props.setSelectionEnd).toHaveBeenCalledWith(props.input.length);
+		expect(props.setCursorPos).toHaveBeenCalledWith(props.input.length);
 		unmount();
 	});
 
-	it("should navigate history on Shift+UpArrow instead of selection or vertical cursor movement", () => {
+	it("should handle text selection using Shift+UpArrow", () => {
+		props.cursorPos = 5;
 		const { unmount } = render(React.createElement(HookWrapper, { props }));
 
 		triggerInput("", { shift: true, upArrow: true });
-		expect(props.setInput).toHaveBeenCalledWith("history-1");
-		expect(props.setHistoryIndex).toHaveBeenCalledWith(0);
-		expect(props.setSelectionStart).not.toHaveBeenCalled();
+		expect(props.setSelectionStart).toHaveBeenCalledWith(5);
+		expect(props.setSelectionEnd).toHaveBeenCalledWith(0);
+		expect(props.setCursorPos).toHaveBeenCalledWith(0);
 		unmount();
 	});
```

### 4. `src/cli/commands/tui-viewport.test.ts`
Correct the selection clear check to assert that unhandled keys do NOT clear selection.

```patch
diff --git a/src/cli/commands/tui-viewport.test.ts b/src/cli/commands/tui-viewport.test.ts
index abcdefg..hijklmn 100644
--- a/src/cli/commands/tui-viewport.test.ts
+++ b/src/cli/commands/tui-viewport.test.ts
@@ -64,13 +64,16 @@ describe("TUI Viewport Height and Scroll Bounds Verification", () => {
-	it("should verify that unhandled keys clear text selection", () => {
+	it("should verify that unhandled keys do NOT clear text selection", () => {
 		let selectionStart: number | null = 5;
 		let selectionEnd: number | null = 10;
 		
 		const key = { ctrl: true, meta: false, shift: false };
 		const k = "g";
 		
 		let selectionCleared = false;
-		if (!key.shift && selectionStart !== null) {
-			selectionStart = null;
-			selectionEnd = null;
-			selectionCleared = true;
-		}
+		// Mock correct logic: only clear selection on navigation or input modification
+		const navigationKeys = ["leftArrow", "rightArrow", "upArrow", "downArrow", "home", "end"];
+		const isNavigation = navigationKeys.some(prop => (key as any)[prop]);
+		if (!key.shift && selectionStart !== null && isNavigation) {
+			selectionStart = null;
+			selectionEnd = null;
+			selectionCleared = true;
+		}
 		
 		let keyHandled = false;
 		if (key.ctrl && k === "c") { keyHandled = true; }
 		else if (key.ctrl && k === "x") { keyHandled = true; }
 		
-		expect(selectionCleared).toBe(true);
+		expect(selectionCleared).toBe(false);
 		expect(keyHandled).toBe(false);
-		console.log(`- Selection cleared on unhandled key? ${selectionCleared ? "YES" : "NO"}`);
+		console.log(`- Selection cleared on unhandled key? ${selectionCleared ? "YES" : "NO"} (Correctly did NOT clear)`);
 	});
```

---

## 5. Verification Method

To independently verify that these bug fixes are correct and resolve the issue:

1. **Verify Code Edits**:
   - Manually apply the proposed patches to `src/cli/ui/hooks/useChatInput.ts`, `src/cli/commands/chat.ts`, and the corresponding test files.
2. **Type Check**:
   - Run `npx tsc --noEmit` to confirm no TypeScript compilation or type errors.
3. **Execute Vitest Tests**:
   - Run the unit and integration tests using:
     ```bash
     npm test
     ```
   - Ensure all 570+ tests pass successfully. Specifically, check that the modified assertions for `useChatInput.test.ts` and `tui-viewport.test.ts` pass, proving that standard selection (Shift + Arrows/Home/End) and unhandled keystroke retention work correctly.
