# Handoff Report — context-compressor Exploration

## 1. Observation
I directly observed the following code sections in `/Users/youssefsala7/Projects/Tehuti-CLI-Revival/src/agent/context-compressor.ts`:

- **Observation A (Index-Shift Bug in `progressiveCompress`)**:
  ```typescript
  let compressed = [...messages];
  const criticalIndices = new Set(identifyCriticalMessages(messages, options));

  while (currentTokens > targetTokens && compressed.length > 4) {
      const nonCritical = compressed
          .map((m, i) => ({
              msg: m,
              originalIndex: i,
              importance: calculateMessageImportance(m, options),
          }))
          .filter((_, i) => !criticalIndices.has(i))
  ```

- **Observation B (Bypassed Fallback in `compressContext` and `createContextSummarizer`)**:
  In `compressContext`:
  ```typescript
  try {
      const summary = await summarizeChunk(chunkMessages, summarizer);
      summaries.push(summary);
  } catch {
      const chunkSummaries = summarizeWithoutLLM(chunkMessages, opts);
      summaries.push(...chunkSummaries);
  }
  ```
  In `createContextSummarizer`:
  ```typescript
  try {
      const summary = await simpleModelCall(prompt);
      return summary.trim();
  } catch {
      return "Context was summarized but details are no longer available.";
  }
  ```

- **Observation C (Ignored Tool Calls and Content Crash in `estimateTokens`)**:
  ```typescript
  function estimateTokens(messages: OpenRouterMessage[]): number {
      let total = 0;
      for (const msg of messages) {
          const content =
              typeof msg.content === "string"
                  ? msg.content
                  : JSON.stringify(msg.content);
          total += tokenizer.encode(content).length + 10;
      }
      return total;
  }
  ```

- **Observation D (System Prompt Erasure in `compressContext`)**:
  ```typescript
  const keepFirst = messages.slice(0, opts.keepFirstN);
  const keepLast = messages.slice(-opts.keepLastN);
  const toCompress = messages.slice(opts.keepFirstN, -opts.keepLastN);
  ```

- **Observation E (estimator Inconsistency & Hardcoded Limits)**:
  In `src/agent/context.ts`:
  ```typescript
  const MAX_CONTEXT_TOKENS = 100000;
  ```
  And `estimateTokens` uses `Math.ceil(content.length / 4)`.

---

## 2. Logic Chain
- **Step 1**: In `progressiveCompress` (Observation A), `criticalIndices` represents the indices of critical messages in the *original* `messages` array. As elements are removed from `compressed`, the elements shift to lower indices. In subsequent loop iterations, checking `criticalIndices.has(i)` using `compressed`'s current index `i` checks the shifted index against the original index set. This causes critical messages to be deleted and non-critical messages to be pinned.
- **Step 2**: In `createContextSummarizer` (Observation B), any model failure (network error, rate limits) triggers the internal `catch` block, which returns the string `"Context was summarized but details are no longer available."`. The outer try-catch in `compressContext` is bypassed because the promise resolves successfully. The local truncation fallback (`summarizeWithoutLLM`) is therefore never executed.
- **Step 3**: In `estimateTokens` (Observation C), `msg.tool_calls` is not serialized or measured, meaning large arguments are ignored. If `msg.content` is undefined (e.g. tool-only calls), `JSON.stringify(undefined)` returns `undefined`, leading to `TypeError` crashes during `.length` read or `.encode(content)`.
- **Step 4**: In `compressContext` (Observation D), any dynamic system instructions present in `toCompress` are processed along with user and assistant messages, resulting in a single merged chunk summary with `role: "assistant"`. This strips the `system` role classification, causing a loss of active instruction-following authority.
- **Step 5**: Because `warnOnContextLimit` in `context.ts` uses the hardcoded `MAX_CONTEXT_TOKENS` limit of `100000` (Observation E) while `manageContextWindow` is bound to the actual model limit (typically 32,000), the secondary cleanup trigger is completely ineffective for smaller model context windows.

---

## 3. Caveats
- I did not test the API connection or run simulated LLM rate limits dynamically due to read-only constraints and CODE_ONLY network mode.
- I assume that system prompt injection can occur dynamically in the middle of a message trace (as seen in skills managers and context operations).

---

## 4. Conclusion
The context compression implementation has several severe logic bugs and security/stability vulnerabilities:
1. Index shifts in progressive compression cause arbitrary deletion of user/system messages.
2. Defeated exception handling causes silent, complete loss of conversation history if the LLM summarizer fails.
3. Token estimation fails to count tool calls, risking API-side overflows, and crashes on undefined content.
4. Dynamic system instructions are downgraded to assistant summaries, losing authoritative behavior constraints.
Implementing the strategies detailed in `analysis.md` (pre-computed annotated array, error propagation, safe type assertions, dynamic limit bounds, system prompt exclusion) will fully harden the context manager.

---

## 5. Verification Method
- **Inspect codebase paths**: 
  - `src/agent/context-compressor.ts`
  - `src/agent/context.ts`
  - `src/agent/loop/compression.ts`
- **Run project tests**:
  - Command: `npm test`
  - Verify that existing context-compressor tests pass, and confirm that adding tests matching the index shift and fallback scenarios validates the fix.
