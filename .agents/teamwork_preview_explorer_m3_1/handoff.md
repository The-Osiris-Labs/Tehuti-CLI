# Handoff Report — Tier 2 E2E Test Cases Design

## 1. Observation

Direct observations and file paths examined from the Tehuti CLI codebase:

1. **F1: Parallel Executor** in `src/agent/parallel-executor.ts`:
   * Lines 244-246: `for (let i = 0; i < batch.toolCalls.length; i += maxConcurrency)` indicates loops increment by `maxConcurrency` directly. If `maxConcurrency` is `0`, this causes an infinite loop.
   * Lines 281-287: `addToolResult` executes inside a mutex wrapper `mutex.runExclusive` ensuring concurrent tool call outputs are buffered without race conditions.

2. **F2: Context Compressor** in `src/agent/context-compressor.ts`:
   * Lines 75-81: `for (let i = 0; i < array.length; i += size)` in `chunk` will loop infinitely if size/chunkSize is `0` or negative.
   * Lines 283-298: `progressiveCompress` relies on `nonCritical.length` filter: `if (nonCritical.length === 0) break;`.

3. **F3: Predictive Prefetcher** in `src/agent/prefetcher.ts`:
   * Line 18: `const MAX_PREFETCH_QUEUE = 10;`.
   * Lines 204-206: `if (this.pending.size >= MAX_PREFETCH_QUEUE) { return; }` checks queue capacity limits during prediction.

4. **F4: Memory Graph** in `src/agent/memory/graph.ts`:
   * Lines 42-55: Parse/corrupt file errors are caught, copied to a backup path `memory-graph.corrupted-${timestamp}.json`, and then re-thrown: `throw error;`.
   * Line 116: `const MAX_NODES = 1000;`.
   * Lines 117-120: Eviction logic filters and slices nodes at the `MAX_NODES` boundary.

5. **F5: Chat UI & Viewport Scrolling** in `src/terminal/output.ts` and `src/cli/commands/chat.ts`:
   * Lines 236-286 of `output.ts`: `wrap` wraps long lines with width `w = width ?? getTerminalWidth() - 4`. If width is `0`, character wrapping occurs but must be checked for overflow loops.
   * Line 3215 of `chat.ts`: Layout virtualization uses `{ flexDirection: "column", marginBottom: -scrollOffset }`.

6. **F6: Slash Command Palette** in `src/cli/ui/components/CommandPalette.tsx`:
   * Lines 49-73: `fuzzyMatch` matches text character by character.
   * Lines 293-301: Arrow key traversal limits: `Math.max(0, prev - 1)` and `Math.min(filteredCommands.length - 1, prev + 1)`.

7. **F7: Config Editor** in `src/cli/ui/components/ConfigEditor.tsx`:
   * Lines 174-190: validation parameters `min: 0`, `max: 2` (temperature) and `min: 1000`, `max: 128000` (maxTokens).
   * Lines 216-218: `} else if (editValue.trim() === "") { parsedValue = undefined; }` translates empty text inputs to undefined.

8. **F8: Advanced Tooling** in `src/agent/tools/repo-map.ts`, `search.ts`, and `registry.ts`:
   * Lines 85-87 of `repo-map.ts`: `catch (e) { // ignore parse errors }` in AST parsing loop.
   * Line 517 of `search.ts`: `const pattern = \`(export\\s+)?(default\\s+)?(class|interface|type|function|const|let|var)\\s+${args.symbol}\\b\`;` uses the symbol name directly in regex template without escaping.

---

## 2. Logic Chain

The step-by-step reasoning linking observations to findings:

1. **Infinite Loop Risks**:
   * *Observation*: F1 loops increment index by `maxConcurrency`; F2 chunk loops increment index by `chunkSize`.
   * *Inference*: If parameter values of `0` or negative numbers are passed, the loop index never advances, causing an infinite loop. We designed tests F1.2 and F2.1 to test this condition.

2. **Regex Injection Vulnerability**:
   * *Observation*: `go_to_definition` directly drops `args.symbol` into raw regex string creation.
   * *Inference*: If a symbol has special characters (e.g. `.*`), it compiles as regex qualifiers instead of searching literals, which might result in failure or search performance backtracking. We designed test F8.3 to cover regex safety.

3. **Limits & Eviction Constraints**:
   * *Observation*: Memory graph has `MAX_NODES = 1000`, prefetcher has `MAX_PREFETCH_QUEUE = 10`.
   * *Inference*: Test cases must exceed these capacity limits to guarantee that eviction sorting works, and that additional prefetch queues behave correctly under queue starvation. We designed tests F3.2 and F4.2 to verify these.

4. **UI Viewport Layout Safety**:
   * *Observation*: Chat scrolling uses negative margins `{ marginBottom: -scrollOffset }`.
   * *Inference*: Extremely large `scrollOffset` values could result in rendering glitches or out-of-screen shifts. Clamping checks are required at the layout boundary level. We designed tests F5.3 and F5.4 to cover this.

---

## 3. Caveats

*   **No Code Modifications**: We have not edited or modified any functional code files. All designed test cases are specified as pseudocode/concrete plans to be implemented by a subsequent implementer.
*   **Vitest Environment**: We assume Vitest is setup and configured as the test runner, which is verified by the presence of `tests/e2e/tier1.test.ts`.

---

## 4. Conclusion

We have designed a suite of 40 specific E2E test cases covering boundary, corner, and error conditions for the 8 core features of Tehuti CLI. The implementation plan and pseudocode are fully structured and documented in `analysis.md` inside our working folder.

---

## 5. Verification Method

To verify the test design and plan:
1. Inspect the detailed test specs in `/Users/youssefsala7/Projects/Tehuti-CLI-Revival/.agents/teamwork_preview_explorer_m3_1/analysis.md`.
2. Inspect the handoff report in `/Users/youssefsala7/Projects/Tehuti-CLI-Revival/.agents/teamwork_preview_explorer_m3_1/handoff.md`.
3. Verify that the test runner execution path on tier 2 works after tests are implemented:
   ```bash
   npx vitest run tests/e2e/tier2.test.ts
   ```
