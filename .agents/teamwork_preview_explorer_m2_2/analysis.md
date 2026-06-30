# Context Compression Analysis Report — Milestone 2: Agent Core Hardening

## Overview
This report evaluates the context compression mechanisms in the Tehuti CLI codebase, specifically focusing on `src/agent/context-compressor.ts`, `src/agent/loop/compression.ts`, and `src/agent/context-compressor.test.ts`. Five major hardening issues have been identified, including a severe index-shift logic bug, defeated fallback logic in LLM-based summarization, token estimation gaps, system prompt erasure, and architectural inconsistencies.

---

## Part 1: Exploration & Identified Issues

### 1. Index-Shift Logic Bug in `progressiveCompress`
* **File Location**: `src/agent/context-compressor.ts` (Lines 228–264)
* **Direct Observation**:
  ```typescript
  let compressed = [...messages];
  const criticalIndices = new Set(identifyCriticalMessages(messages, options));

  while (currentTokens > targetTokens && compressed.length > 4) {
      const nonCritical = compressed
          .map((m, i) => ({
              msg: m,
              originalIndex: i, // i is the index in the *current* compressed array, NOT messages!
              importance: calculateMessageImportance(m, options),
          }))
          .filter((_, i) => !criticalIndices.has(i)) // i is the current index of compressed
  ```
* **Analysis**:
  - `criticalIndices` stores the indices of critical messages relative to the *original* `messages` array.
  - Inside the `while` loop, as low-importance messages are removed in each iteration, the indices of the remaining messages in the `compressed` array shift.
  - The filter checks `!criticalIndices.has(i)` using the *current* index of `compressed`. Consequently, after the first iteration, the indices no longer align. 
  - **Impact**: Critical messages (like user queries or system prompts) shift to lower indices and are deleted, while non-critical messages shift into index positions that match the original critical set and are incorrectly pinned.

---

### 2. Defeated Fallback Logic in LLM Chunk Summarization
* **File Location**: `src/agent/context-compressor.ts` (Lines 168–176, 266–283)
* **Direct Observation**:
  In `compressContext`:
  ```typescript
  for (const chunkMessages of chunks) {
      try {
          const summary = await summarizeChunk(chunkMessages, summarizer);
          summaries.push(summary);
      } catch {
          const chunkSummaries = summarizeWithoutLLM(chunkMessages, opts);
          summaries.push(...chunkSummaries);
      }
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
* **Analysis**:
  - `compressContext` is designed to fall back gracefully to local text-truncation (`summarizeWithoutLLM`) if the LLM summarizer throws an error (e.g., due to API rate limits, server errors, or timeouts).
  - However, the `summarizer` returned by `createContextSummarizer` intercepts all errors internally. Instead of throwing/propagating, it returns the static string: `"Context was summarized but details are no longer available."`.
  - Because the promise resolves successfully, `summarizeChunk` never throws. The `catch` block in `compressContext` is never reached.
  - **Impact**: Any LLM call failure silently wipes out the entire history of the affected chunk, replacing it with a useless generic placeholder instead of using the structured fallback.

---

### 3. Ignored Tool Calls & Content-Type Safety Gaps in Token Estimation
* **File Location**: `src/agent/context-compressor.ts` (Lines 39–49, 79–81)
* **Direct Observation**:
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
* **Analysis**:
  - **Ignored Tool Calls**: The estimator completely ignores `msg.tool_calls` in assistant messages. Tool calls (containing function names and JSON-stringified arguments) can be very large. Ignoring them leads to significant under-estimation.
  - **Runtime Crashes on Undefined Content**: If `msg.content` is undefined (common in assistant messages containing only `tool_calls`), `JSON.stringify(undefined)` returns `undefined` (value, not string). Calling `content.length` or passing it to `tokenizer.encode` will throw a runtime `TypeError` (`Cannot read properties of undefined (reading 'length')`), crashing the agent loop.

---

### 4. Erasure of Mid-Conversation System Message Roles
* **File Location**: `src/agent/context-compressor.ts` (Lines 90–108, 157–165)
* **Direct Observation**:
  ```typescript
  const keepFirst = messages.slice(0, opts.keepFirstN);
  const keepLast = messages.slice(-opts.keepLastN);
  const toCompress = messages.slice(opts.keepFirstN, -opts.keepLastN);
  ```
* **Analysis**:
  - Any system prompts that are dynamically appended in the middle of a long conversation (such as skill-injected guidelines) fall into the `toCompress` region.
  - All messages in `toCompress` are chunked and summarized. During this process, system messages are concatenated into the chunk text and summarized.
  - The summarized chunk is always returned with `role: "assistant"` (`[Previous Context Summary] ...`).
  - **Impact**: Crucial dynamic system directives are converted into assistant summaries, losing their structural `system` role authority, which may lead to the model ignoring them.

---

### 5. Inconsistent Token Estimators & Conflicting Compression Triggers
* **File Location**: `src/agent/context.ts` (Lines 25–40) vs `src/agent/context-compressor.ts` (Lines 39–49); `src/agent/loop/runner.ts` (Lines 125, 204)
* **Direct Observation**:
  - `context.ts` implements a character-based estimator: `estimateTokens = content.length / 4` (which includes `tool_calls`).
  - `context-compressor.ts` implements a tiktoken-based estimator: `estimateTokens = tokenizer.encode(content)` (which ignores `tool_calls`).
  - `runner.ts` calls `manageContextWindow` (LLM-based context compression at 85% of configured limit) and then calls `warnOnContextLimit` (destructive slicing at 95% of `MAX_CONTEXT_TOKENS = 100000`).
* **Analysis**:
  - Having two different implementations of `estimateTokens` results in inconsistent token counts during the same session.
  - Hardcoding `MAX_CONTEXT_TOKENS = 100000` in `context.ts` makes `warnOnContextLimit` ineffective for smaller context windows (e.g. 32,000 tokens), as the LLM will crash with a 400 Bad Request error long before the 95,000 token limit is reached.

---

## Part 2: Concrete Hardening Strategies

### Strategy 1: Pre-computed Message Mapping for `progressiveCompress`
To fix the index-shift bug and speed up execution, message metadata should be pre-computed before the compression loop:
```typescript
export function progressiveCompress(
	messages: OpenRouterMessage[],
	targetTokens: number,
	options: CompressionOptions = DEFAULT_OPTIONS
): OpenRouterMessage[] {
	let currentTokens = estimateTokens(messages);

	if (currentTokens <= targetTokens) {
		return messages;
	}

	// Pre-map static metadata once to avoid index shifts & redundant computations
	let annotated = messages.map((msg) => {
		const importance = calculateMessageImportance(msg, options);
		const isCritical = msg.role === "system" || msg.role === "user" || importance >= 100;
		return { msg, importance, isCritical };
	});

	while (currentTokens > targetTokens && annotated.length > 4) {
		const nonCritical = annotated
			.map((item, index) => ({ item, index }))
			.filter(({ item }) => !item.isCritical)
			.sort((a, b) => a.item.importance - b.item.importance);

		if (nonCritical.length === 0) break;

		const toRemove = Math.max(1, Math.floor(nonCritical.length / 4));
		const indicesToRemove = new Set(
			nonCritical.slice(0, toRemove).map((x) => x.index),
		);

		annotated = annotated.filter((_, index) => !indicesToRemove.has(index));
		currentTokens = estimateTokens(annotated.map((x) => x.msg));
	}

	return annotated.map((x) => x.msg);
}
```

### Strategy 2: Propagate Summarizer Errors to Enable Safe Fallbacks
Modify `createContextSummarizer` (and `createSmartSummarizer`) to let errors bubble up, ensuring that `compressContext` triggers `summarizeWithoutLLM`:
```typescript
export function createContextSummarizer(
	simpleModelCall: (prompt: string) => Promise<string>,
): (text: string) => Promise<string> {
	return async (text: string): Promise<string> => {
		const prompt = `Summarize the following conversation context in 2-3 sentences, preserving key decisions, outcomes, and any errors encountered:\n\n${text.slice(0, 3000)}\n\nSummary:`;
		// Let the error propagate so the caller (compressContext) can catch it and fall back to local truncation
		const summary = await simpleModelCall(prompt);
		return summary.trim();
	};
}
```

### Strategy 3: Hardened `estimateTokens` and Content Check
Rewrite the token estimator in `context-compressor.ts` to accurately handle tool calls and prevent crashes on undefined/null content:
```typescript
export function estimateTokens(messages: OpenRouterMessage[]): number {
	let total = 0;
	for (const msg of messages) {
		let content = "";
		if (typeof msg.content === "string") {
			content = msg.content;
		} else if (Array.isArray(msg.content)) {
			content = msg.content
				.map((c) => (typeof c === "string" ? c : JSON.stringify(c)))
				.join("");
		}
		
		// Unify tool call token estimation
		if (msg.tool_calls) {
			content += JSON.stringify(msg.tool_calls);
		}
		
		if (msg.name) {
			content += msg.name;
		}

		total += tokenizer.encode(content).length + 10;
	}
	return total;
}
```

### Strategy 4: System Prompt Role Preservation
Preserve all `system` role messages in the `toCompress` window by keeping them intact as separate system messages:
```typescript
	const keepFirst = messages.slice(0, opts.keepFirstN);
	const keepLast = messages.slice(-opts.keepLastN);
	const toCompress = messages.slice(opts.keepFirstN, -opts.keepLastN);

	// Separate system messages from items that will be chunk-summarized
	const systemMessages = toCompress.filter(m => m.role === "system");
	const compressableMessages = toCompress.filter(m => m.role !== "system");

	const chunks = chunk(compressableMessages, opts.chunkSize);
	const summaries: OpenRouterMessage[] = [];
	...
	// Reassemble by keeping system messages at their relative boundaries or grouped
	const compressed = [...keepFirst, ...systemMessages, ...summaries, ...keepLast];
```

### Strategy 5: Unifying Configuration Thresholds
- Consolidate token estimation to use the tiktoken-based `estimateTokens`.
- Update `warnOnContextLimit` in `src/agent/context.ts` to dynamically use the configured `maxContextLength` from the active agent configuration rather than the hardcoded `100000` limit.
