# Handoff Report: E2E Test Infrastructure Review

## 1. Observation
- **TypeScript Typecheck Error (Branding Colors)**: Running `npm run typecheck` outputted:
  ```
  src/cli/commands/chat.ts(136,32): error TS2339: Property 'green' does not exist on type '{ readonly primary: "#F5C518"; ... }'.
  ```
- **TypeScript Typecheck Error (Import Path)**: Running `npm run typecheck` outputted:
  ```
  src/cli/ui/hooks/useChatState.ts(2,35): error TS2307: Cannot find module '../../../../agent/tools/system.js' or its corresponding type declarations.
  ```
- **Unit & E2E Test Runs**: Running `npm test` and `npm run test:e2e` succeeded:
  - `npm test`: `503 passed | 2 skipped (505)`
  - `npm run test:e2e`: `2 passed (2)`
- **Production Build**: Running `npm run build` succeeded (DTS & ESM builds completed).
- **Tool Call Streaming Mock**: In `tests/e2e/helpers/e2e-helper.ts` (lines 88-103):
  ```typescript
  if (nextResponse.toolCalls) {
      yield {
          id: "mock-chunk",
          choices: [{
              index: 0,
              delta: {
                  tool_calls: nextResponse.toolCalls.map((tc, idx) => ({
                      id: `call_${idx}`,
                      type: "function",
                      function: {
                          name: tc.name,
                          arguments: tc.arguments
                      }
                  }))
              },
              finish_reason: "tool_calls"
          }]
      };
  }
  ```
- **Tool Call Parsing Logic**: In `src/api/streaming.ts` (lines 109-118):
  ```typescript
  if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
          const index = tc.index;
          const existing = state.toolCalls.get(index);
          if (tc.id) {
              state.toolCalls.set(index, { ... });
          }
      }
  }
  ```
- **Home Directory Isolation**: Checking modified times in `/Users/youssefsala7/.tehuti/` after test runs returned no changes in the last 15 minutes.
- **Ignored Files**: Inspecting `.gitignore` showed no entry for `.tmp-home`.

---

## 2. Logic Chain
1. The compilation command (`npm run typecheck`) fails because the import path in `useChatState.ts` has one too many `../` segments, and `chat.ts` references non-existent color properties on `BRANDING.colors`. Therefore, the production codebase does not compile cleanly under strict TypeScript.
2. In the `e2e-helper.ts` stream mock, the map function transforms the queue response `toolCalls` to `delta.tool_calls` objects but omits the `index` property.
3. In `streaming.ts`, the streaming state processes incoming `tool_calls` by looking up the `tc.index` property.
4. Because `tc.index` is undefined in the mock payload, all mocked tool calls are written to the streaming state map under the key `undefined`.
5. Multiple tool calls will overwrite each other, meaning only one tool call survives and parallel tool call execution cannot be tested.
6. The test environment successfully isolates filesystem effects to `tests/e2e/.tmp-home` during execution, which prevents leaks to the real `~/.tehuti` folder. However, this hardcoded directory is not parallel-safe, and is not ignored in `.gitignore`, presenting a minor cleanup leakage.

---

## 3. Caveats
- Did not verify interactive prompt flow because no tests in `baseline.test.ts` execute interactive commands or write to `stdin`.
- Assumed standard Vitest single-thread/sequential execution configuration for the single test file currently in place.

---

## 4. Conclusion
The E2E test infrastructure has been successfully bootstrapped and passes the baseline tests, but it contains a critical logic error in how tool calls are streamed (missing `index`), causing concurrent tool call testing to break. The project also fails strict TypeScript compilation due to pre-existing/recent UI type errors.
Changes are requested (`REQUEST_CHANGES`) to:
1. Fix the tool call mock by adding `index` to the payload.
2. Resolve the compilation errors in `chat.ts` and `useChatState.ts`.
3. Add `.tmp-home` to `.gitignore`.
4. Make `TEST_HOME` use a unique path or safely clean up environment variables.

---

## 5. Verification Method
1. Run `npm run typecheck` to confirm compiler errors.
2. Run `npm test` and `npm run test:e2e` to verify test behavior.
3. Add a test case with multiple tool calls in `baseline.test.ts` to reproduce the overwriting bug.
