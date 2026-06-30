# Handoff Report: Milestone 4 (Visual Polish & TUI) Verification Analysis & Fix Proposals

This report provides a detailed, read-only analysis and concrete fix strategies to resolve all primary and secondary defects in the Milestone 4 (Visual Polish & TUI) implementation.

---

## 1. Observations

Direct code observations from `/Users/youssefsala7/Projects/Tehuti-CLI-Revival`:

### A. High Contrast Color Formatting Bug (`src/terminal/output.ts`)
Lines 39-40:
```typescript
39: 	green: (text: string) => (shouldUseColors() ? `${shouldUseHighContrast() ? HIGH_CONTRAST_GREEN : pc.green(text)}` : text),
40: 	red: (text: string) => (shouldUseColors() ? `${shouldUseHighContrast() ? HIGH_CONTRAST_RED : pc.red(text)}` : text),
```
* **Observation**: When `shouldUseColors()` and `shouldUseHighContrast()` are both true, the return string is only the color escape sequence `HIGH_CONTRAST_GREEN` (`\x1b[38;5;34m`) or `HIGH_CONTRAST_RED` (`\x1b[38;5;196m`). The passed `text` parameter is discarded, and no terminal reset sequence `\x1b[0m` is appended, causing terminal color bleeding.

### B. Facade Question Resolver & Missing UI (`src/cli/commands/chat.ts`)
Lines 1983-1990:
```typescript
1983: 		questionResolverRef.current = async (
1984: 			questions: QuestionData[],
1985: 		): Promise<string[]> => {
1986: 			return new Promise((resolve, reject) => {
1987: 				setPendingQuestion({ questions, resolve, reject });
1988: 			});
1989: 		};
1990: 		setQuestionResolver(questionResolverRef.current);
```
Lines 1999-2020:
```typescript
1999: 	const _handleQuestionAnswer = useCallback(
2000: 		async (questionIdx: number, answer: string | string[]) => {
2001: 			if (!pendingQuestion) return;
2002: 
2003: 			const { questions, resolve } = pendingQuestion;
2004: 			const answers: string[] = [];
2005: 
2006: 			for (let i = 0; i < questions.length; i++) {
2007: 				if (i === questionIdx) {
2008: 					if (Array.isArray(answer)) {
2009: 						answers.push(...answer);
2010: 					} else {
2011: 						answers.push(answer);
2012: 					}
2013: 				}
2014: 			}
2015: 
2016: 			setPendingQuestion(null);
2017: 			resolve(answers);
2018: 		},
2019: 		[pendingQuestion],
2020: 	);
```
* **Observation**: `pendingQuestion` is never mapped, referenced, or rendered in the JSX return layout of `chat.ts`. Additionally, the indexing logic inside `_handleQuestionAnswer` is incorrect for multi-question payloads, and the keyboard input hook (`useChatInput`) continues to intercept keyboard events because it has no awareness of `pendingQuestion`.

### C. Command Palette Selection Index Lag (`src/cli/ui/components/CommandPalette.tsx`)
Lines 245-248:
```typescript
245: 	useEffect(() => {
246: 		setSelectedIndex(0);
247: 	}, [filteredCommands]);
```
* **Observation**: Resetting `selectedIndex` in `useEffect` is asynchronous and occurs after paint. During fast typing immediately followed by `Enter`, the stale index is used on the new `filteredCommands` array, which leads to executing incorrect commands or accessing out-of-bounds items.

### D. Command Palette Submenu Rejection Crash (`src/cli/ui/components/CommandPalette.tsx`)
Lines 249-258:
```typescript
249: 	const handleExecute = async (selected: CommandItem) => {
250: 		if (selected.submenu) {
251: 			setIsLoading(true);
252: 			try {
253: 				const children = await selected.submenu();
254: 				setMenuStack((prev) => [...prev, { title: selected.label, commands: children }]);
255: 				setQuery("");
256: 			} finally {
257: 				setIsLoading(false);
258: 			}
```
* **Observation**: `selected.submenu()` is an asynchronous function that may reject (e.g. if network or filesystem reads fail). Since there is no `catch` block inside the submenu execution, rejections bubble up as unhandled promise rejections, which crashes Node.js processes.

### E. Direct Write of OSC 52 to Stdout (`src/cli/ui/hooks/useChatInput.ts`)
Lines 189 & 347:
```typescript
189: 				console.log("\x1B]52;;" + Buffer.from(selectedText).toString("base64") + "\x07");
...
347: 				console.log("\x1B]52;;" + Buffer.from(selectedText).toString("base64") + "\x07");
```
* **Observation**: Printing the OSC 52 sequence using `console.log` appends a newline character `\n` to standard output. This pollutes the terminal stream outside of Ink's layout budget, pushing the entire screen up and corrupting the visual grid.

---

## 2. Logic Chain

1. **High Contrast Color Discarding Text**:
   * The green and red formatters return only `HIGH_CONTRAST_GREEN` / `HIGH_CONTRAST_RED` instead of wrapping the text parameter: `${HIGH_CONTRAST_GREEN}${text}\x1b[0m`.
   * This leaves the output string empty (just escape sequences) and causes subsequent text to retain that color because the terminal color mode is never reset (`\x1b[0m`).

2. **Indefinite Hangs on Questions**:
   * The `question` tool yields a Promise handled by `questionResolverRef.current`.
   * Because `pendingQuestion` is not rendered, the user cannot see the questions.
   * Because `useChatInput` captures input globally, typing goes into the hidden chat buffer.
   * As a result, the promise is never resolved or rejected, leaving the agent loop permanently hung.

3. **Command Palette Selection Lag**:
   * typing character `x` -> updates `query` state -> recomputes `filteredCommands` on render -> user presses `Enter` -> `useInput` triggers key handler.
   * Because `useEffect` runs *after* the render is committed, `selectedIndex` remains at its stale value during key handler execution, resulting in execution of the wrong or out-of-bound index.

4. **Unhandled Rejection Crash**:
   * Submenu resolution is invoked within `handleExecute` but called as `void handleExecute(selected)` in `useInput`.
   * If `selected.submenu()` rejects, the error escapes without a catch handler, resulting in an unhandled promise rejection that terminates the CLI tool.

5. **Stdout Corruption on Copy**:
   * `console.log` writes to stdout and adds `\n`.
   * The extra newline forces the terminal viewport to scroll up by one line.
   * Ink's internal layout tracking remains unchanged, causing visual offsets, duplicated prompts, and flickering.

---

## 3. Caveats

* Testing is limited to macOS terminal emulators. The behavior of OSC 52 sequence copy operations depends on terminal-specific capabilities (e.g. Alacritty, iTerm2, Kitty). If a terminal doesn't support OSC 52, it will ignore the copy sequence, but the layout corruption due to `console.log`'s newline still occurs.

---

## 4. Conclusion & Actionable Fix Proposals

The current implementation requires fixes across several visual, input handling, and terminal output files. Below are the precise, robust fix strategies.

### Propose Fix 1: High Contrast Formatting (`src/terminal/output.ts`)
Modify the `green` and `red` properties of `colors` (lines 39-40) to correctly interpolate the text and reset code:
```typescript
	green: (text: string) =>
		shouldUseColors()
			? `${shouldUseHighContrast() ? `${HIGH_CONTRAST_GREEN}${text}\x1b[0m` : pc.green(text)}`
			: text,
	red: (text: string) =>
		shouldUseColors()
			? `${shouldUseHighContrast() ? `${HIGH_CONTRAST_RED}${text}\x1b[0m` : pc.red(text)}`
			: text,
```

### Propose Fix 2: Question Resolver UI (`src/cli/commands/chat.ts` and `src/cli/ui/hooks/useChatInput.ts`)
1. **Bypass standard input hooks**:
   Update `UseChatInputProps` and the `useChatInput` call in `chat.ts` to pass `hasPendingQuestion: !!pendingQuestion` and `showConfigEditor: showConfigEditor`.
   In `src/cli/ui/hooks/useChatInput.ts`, adjust `useInput` to return early at the very top:
   ```typescript
   useInput((k, key) => {
       // Allow Command Palette toggle but block all other inputs if palette, config editor, or question is active
       const isPaletteToggle = key.ctrl && k === "p";
       if (showCommandPaletteRef.current || showConfigEditor || hasPendingQuestion) {
           if (isPaletteToggle) {
               const newVal = !showCommandPaletteRef.current;
               showCommandPaletteRef.current = newVal;
               setShowCommandPalette(newVal);
           }
           return;
       }
       // ... continue with scroll wheel and standard key inputs
   ```

2. **Render Question UI**:
   In `src/cli/commands/chat.ts`, implement a `QuestionResolverUI` component to handle rendering of single or multiple questions, text inputs, and list choices:
   ```typescript
   function QuestionResolverUI({
       pendingQuestion,
       onAnswer,
       onCancel,
   }: {
       pendingQuestion: {
           questions: QuestionData[];
           resolve: (answers: string[]) => void;
           reject: (error: Error) => void;
       };
       onAnswer: (answers: string[]) => void;
       onCancel: () => void;
   }) {
       const { questions } = pendingQuestion;
       const [currentIdx, setCurrentIdx] = useState(0);
       const [answers, setAnswers] = useState<string[]>([]);
       const [textInput, setTextInput] = useState("");
       const [selectedOptIdx, setSelectedOptIdx] = useState(0);
       const [selectedOpts, setSelectedOpts] = useState<Record<number, boolean>>({});

       const currentQ = questions[currentIdx];

       useInput((char, key) => {
           if (key.escape) {
               onCancel();
               return;
           }
           if (!currentQ) return;
           const options = currentQ.options || [];

           if (options.length > 0) {
               if (key.upArrow) {
                   setSelectedOptIdx(prev => Math.max(0, prev - 1));
                   return;
               }
               if (key.downArrow) {
                   setSelectedOptIdx(prev => Math.min(options.length - 1, prev + 1));
                   return;
               }
               if (char === " " && currentQ.multiple) {
                   setSelectedOpts(prev => ({ ...prev, [selectedOptIdx]: !prev[selectedOptIdx] }));
                   return;
               }
               if (key.return) {
                   let ansVal = "";
                   if (currentQ.multiple) {
                       const selected = options.filter((_, idx) => selectedOpts[idx]).map(o => o.label);
                       if (selected.length === 0) selected.push(options[selectedOptIdx].label);
                       ansVal = selected.join(",");
                   } else {
                       ansVal = options[selectedOptIdx].label;
                   }
                   const nextAnswers = [...answers, ansVal];
                   if (currentIdx + 1 < questions.length) {
                       setAnswers(nextAnswers);
                       setCurrentIdx(prev => prev + 1);
                       setSelectedOptIdx(0);
                       setSelectedOpts({});
                   } else {
                       onAnswer(nextAnswers);
                   }
               }
           }
       }, { isActive: true });

       if (!currentQ) return null;
       const options = currentQ.options || [];

       return React.createElement(
           Box,
           { flexDirection: "column", borderStyle: "round", borderColor: GOLD, padding: 1 },
           React.createElement(Text, { bold: true, color: GOLD }, `𓏛 QUESTION [${currentIdx + 1}/${questions.length}]`),
           currentQ.header && React.createElement(Text, { color: SAND, bold: true }, currentQ.header),
           React.createElement(Text, { color: CORAL }, currentQ.question),
           options.length > 0 ? (
               React.createElement(
                   Box,
                   { flexDirection: "column", marginTop: 1 },
                   ...options.map((opt, idx) => {
                       const isHovered = idx === selectedOptIdx;
                       const isChecked = !!selectedOpts[idx];
                       const prefix = currentQ.multiple ? `[${isChecked ? "x" : " "}] ` : isHovered ? "> " : "  ";
                       return React.createElement(
                           Text,
                           { key: idx, color: isHovered ? GOLD : undefined },
                           `${prefix}${opt.label}${opt.description ? ` - ${opt.description}` : ""}`
                       );
                   })
               )
           ) : (
               React.createElement(
                   Box,
                   { borderStyle: "single", borderColor: CORAL, paddingX: 1, marginTop: 1 },
                   React.createElement(Text, { color: CORAL }, "> "),
                   React.createElement(InkTextInput, {
                       value: textInput,
                       onChange: setTextInput,
                       onSubmit: (val) => {
                           const nextAnswers = [...answers, val];
                           if (currentIdx + 1 < questions.length) {
                               setAnswers(nextAnswers);
                               setCurrentIdx(prev => prev + 1);
                               setTextInput("");
                           } else {
                               onAnswer(nextAnswers);
                           }
                       },
                       focus: true
                   })
               )
           )
       );
   }
   ```

3. **Simplify Answer Resolution**:
   Modify `_handleQuestionAnswer` in `chat.ts` to directly resolve the answers array:
   ```typescript
   const _handleQuestionAnswer = useCallback(
       (answers: string[]) => {
           if (!pendingQuestion) return;
           const { resolve } = pendingQuestion;
           setPendingQuestion(null);
           resolve(answers);
       },
       [pendingQuestion]
   );
   ```

4. **Mount Question UI in Chat Render Loop**:
   Substitute the input render line in `chat.ts` (around line 3278) to show the `QuestionResolverUI` when a question is active:
   ```typescript
   showCommandPalette || showConfigEditor
       ? null
       : pendingQuestion
       ? React.createElement(QuestionResolverUI, {
               pendingQuestion,
               onAnswer: _handleQuestionAnswer,
               onCancel: _handleQuestionCancel,
           })
       : loading
       ? React.createElement(
               Text,
               { color: SAND, dimColor: true },
               `  ${HIEROGLYPHS.loading[0]} channeling wisdom...`,
           )
       : renderInput,
   ```

### Propose Fix 3: Sync Reset Selection Index (`src/cli/ui/components/CommandPalette.tsx`)
Avoid asynchronous `useEffect` updates for list sync. Reset index directly during render:
```typescript
	// Remove this:
	// useEffect(() => {
	// 	setSelectedIndex(0);
	// }, [filteredCommands]);

	// Add this in the render body:
	const [prevFilteredCommands, setPrevFilteredCommands] = useState(filteredCommands);
	if (filteredCommands !== prevFilteredCommands) {
		setSelectedIndex(0);
		setPrevFilteredCommands(filteredCommands);
	}
```

### Propose Fix 4: Catch Submenu Rejections (`src/cli/ui/components/CommandPalette.tsx`)
Introduce an error state and wrap the submenu call in `try-catch`:
```typescript
	const [error, setError] = useState<string | null>(null);

	const handleExecute = async (selected: CommandItem) => {
		if (selected.submenu) {
			setIsLoading(true);
			setError(null);
			try {
				const children = await selected.submenu();
				setMenuStack((prev) => [...prev, { title: selected.label, commands: children }]);
				setQuery("");
			} catch (err: any) {
				setError(err.message || String(err));
			} finally {
				setIsLoading(false);
			}
		} else {
            // ...
```
Render the error safely below the query input box in JSX:
```typescript
		error ? React.createElement(
			Box,
			{ paddingX: 1, marginBottom: 1 },
			React.createElement(Text, { color: "red" }, `Error: ${error}`)
		) : null
```

### Propose Fix 5: Direct Write for OSC 52 (`src/cli/ui/hooks/useChatInput.ts`)
Replace `console.log` on lines 189 and 347 with `process.stdout.write`:
```typescript
process.stdout.write("\x1B]52;;" + Buffer.from(selectedText).toString("base64") + "\x07");
```

---

## 5. Verification Method

To verify these proposed changes once implemented:
1. **Build and Type Checking**:
   Ensure code compiles clean of TypeScript errors:
   ```bash
   npm run build
   npx tsc --noEmit
   ```
2. **Execute Project Test Suites**:
   Run tests for hook, viewport and palette inputs:
   ```bash
   npx vitest run src/cli/commands/tui-viewport.test.ts
   npx vitest run src/cli/ui/hooks/useChatInput.test.ts
   npx vitest run src/cli/ui/components/CommandPalette.test.ts
   ```
3. **High Contrast and Copy Test**:
   Export `HIGH_CONTRAST=true` in shell and verify that terminal output prints correctly without color bleeding. Use copy action and inspect that the prompt layout is not pushed by an extra newline.
