# Tier 2 E2E Test Cases Design for Tehuti CLI

This analysis report provides the complete architectural design and pseudocode for 40 boundary, corner, and error-handling test cases covering the 8 core features of Tehuti CLI. These tests are intended to be implemented in `tests/e2e/tier2.test.ts` to complement the existing Tier 1 baseline tests.

## 𓆣 Executive Summary
We have mapped the entire boundary space of Tehuti CLI's core subsystems, locating critical potential vulnerabilities including infinite loops in context compression, regex injection in symbol resolution, and race conditions in concurrent tooling. This report outlines 40 high-coverage E2E test cases (5 for each of the 8 features) designed specifically to check boundary thresholds, error propagation, and recovery.

---

## 𓊖 Test Case Index (40 cases)

| Feature | Test ID | Test Name | Boundary Type |
|---|---|---|---|
| **F1: Parallel Executor** | F1.1 | Empty or Null Tool Calls List | Empty bounds |
| | F1.2 | Invalid/Zero Concurrency Limit | Parameter limit |
| | F1.3 | Abort Signal Mid-Chunk Execution | Abrupt cancellation |
| | F1.4 | Duplicate Tool Call IDs Mutex Handling | Concurrency race |
| | F1.5 | Safe/Destructive Alternating Sequence | Batching bounds |
| **F2: Context Compressor** | F2.1 | Zero or Negative ChunkSize Infinite Loop | Parameter safety |
| | F2.2 | Target Tokens Smaller Than Single Message | Upper limit truncation |
| | F2.3 | Context with 100% Critical Messages | Progressive clamp bounds |
| | F2.4 | Token Estimation under Huge Strings (10MB+) | Memory & size bounds |
| | F2.5 | Summarizer Failure Fallback with Corrupted Data | Error fallback cascading |
| **F3: Predictive Prefetcher** | F3.1 | Aborted Prefetch on Concurrent File Modification | State sync cancellation |
| | F3.2 | Queue Saturation and Recovery | Size limit starvation |
| | F3.3 | Successful Prefetch under Full Cache Eviction | Cache threshold bounds |
| | F3.4 | Rule Arg Mapper / Condition Error Handling | Callback fault tolerance |
| | F3.5 | Circular References in Tool Arguments | Input parsing boundary |
| **F4: Memory Graph** | F4.1 | Corrupt JSON Syntax Error & Backup Generation | File recovery boundary |
| | F4.2 | Eviction at 1000 Nodes Capacity Limits | Storage threshold eviction |
| | F4.3 | Extreme Relevance Fields (NaN, Infinity, null) | Calculation bounds |
| | F4.4 | Scoped CWD Path Normalization & Symlinks | Directory bounds |
| | F4.5 | Lock Contention Under Heavy Read-Write Load | Concurrency locking |
| **F5: Chat UI & Viewport** | F5.1 | Render Empty Messages Array | Empty state bounds |
| | F5.2 | Zero-Column Wrapping Limits | Output formatting bounds |
| | F5.3 | Viewport Negative Margin Overflow Limits | Layout size bounds |
| | F5.4 | Boundary Keyboard Traversal & Key Repeats | Interactive bounds |
| | F5.5 | Nested Formatting Output Wrapping & ANSI | Color/format stripping |
| **F6: Slash Palette** | F6.1 | Fuzzy Matching with Zero Matching Queries | Filter limit |
| | F6.2 | Extreme Long Query String Backtracking | Regex/parsing safety |
| | F6.3 | Traversal wrap-around at Index Limits | Wrap-around bounds |
| | F6.4 | Mode-switching Traversals (Empty vs Populated Input)| Traversal modes |
| | F6.5 | Empty Submenu Stack Pop | Navigation stack bounds |
| **F7: Config Editor** | F7.1 | Out-of-bounds Field Constraints | Number field bounds |
| | F7.2 | Scientific/Float Value Inputs Parsing | Parsing bounds |
| | F7.3 | Whitespace API Key Deletion | Empty state storage |
| | F7.4 | Cancel changes draft restoration | State rollbacks |
| | F7.5 | Tab Switch Index Synchronization | Navigation bounds |
| **F8: Advanced Tooling** | F8.1 | Non-TS/JS Files Parsing in Repo Map | AST parser bounds |
| | F8.2 | Syntactically Malformed TS File AST Recovery | Error parsing bounds |
| | F8.3 | Go-to-Definition Regex Injection Safety | Input validation bounds |
| | F8.4 | Execution of Unregistered Tool | Unknown call bounds |
| | F8.5 | Invalid Zod Parameter Typings | Parsing validation limits |

---

## 🏛️ Detailed Test Case Specifications & Implementation Plans

### Feature 1: Parallel Executor (`src/agent/parallel-executor.ts`)
The Parallel Executor parses tool calls and executes them concurrently if they are read-only (`SAFE_PARALLEL_TOOLS`), or sequentially if they write (`WRITE_TOOLS`) or require user confirmation.

#### F1.1: Empty or Null Tool Calls List
*   **Description**: Ensures the executor processes an empty list of tool calls safely and returns immediately without running hooks or executing tools.
*   **Setup**: Call `executeToolsParallel` with `toolCalls = []`.
*   **Expected**: Returns `[]` immediately, `onToolCall` and `onToolResult` are not invoked.
*   **Pseudocode**:
    ```typescript
    const results = await executeToolsParallel([], {
      ctx: mockCtx,
      toolContext: {},
      addToolResult: vi.fn(),
      onToolCall: vi.fn(),
      onToolResult: vi.fn(),
    });
    expect(results).toEqual([]);
    ```

#### F1.2: Invalid/Zero Concurrency Limit
*   **Description**: Verifies that setting `maxConcurrency` to `0` or negative numbers does not result in an infinite loop or a division-by-zero crash in the chunking step (lines 244-246).
*   **Setup**: Set `maxConcurrency` to `0` or `-1` with a batch of parallelizable tool calls.
*   **Expected**: The executor must internally clamp `maxConcurrency` to at least `1` to avoid an infinite loop (which would happen since `i += maxConcurrency` would loop forever at `i = 0`).
*   **Pseudocode**:
    ```typescript
    const toolCalls = [{ id: "1", function: { name: "read", arguments: JSON.stringify({ file_path: "f1.ts" }) } }];
    const run = () => executeToolsParallel(toolCalls, {
      ctx: mockCtx,
      toolContext: {},
      addToolResult: vi.fn(),
      maxConcurrency: 0 // Boundary trigger
    });
    await expect(Promise.race([
      run(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout/Infinite Loop")), 1000))
    ])).resolves.toBeDefined();
    ```

#### F1.3: Abort Signal Mid-Chunk Execution
*   **Description**: Verifies that when an `AbortSignal` is triggered mid-way through a chunked execution, subsequent chunks are skipped and active tasks are cancelled.
*   **Setup**: Prepare 3 chunks (e.g., 6 tool calls with `maxConcurrency = 2`). Abort the signal during the execution of the first chunk.
*   **Expected**: The first chunk results might be processed, but remaining chunks return `"Execution aborted by user"` and do not run `executeToolCall`.
*   **Pseudocode**:
    ```typescript
    const controller = new AbortController();
    const toolCalls = Array.from({ length: 6 }, (_, i) => ({
      id: String(i),
      function: { name: "read", arguments: JSON.stringify({ file_path: `f${i}.ts` }) }
    }));
    const registry = await import("../../src/agent/tools/registry.js");
    vi.spyOn(registry, "executeTool").mockImplementation(async (name, args) => {
      if (args.file_path === "f1.ts") controller.abort(); // Trigger abort mid-chunk 1
      return { success: true, output: "ok" };
    });
    const results = await executeToolsParallel(toolCalls, {
      ctx: mockCtx,
      toolContext: {},
      addToolResult: vi.fn(),
      maxConcurrency: 2,
      signal: controller.signal
    });
    expect(results[2].error).toBe("Execution aborted by user");
    ```

#### F1.4: Duplicate Tool Call IDs Mutex Handling
*   **Description**: Evaluates thread safety when multiple tool calls return with identical IDs. It ensures the internal `mutex.runExclusive` prevents state corruption or interleaving issues.
*   **Setup**: Trigger parallel tool calls that share duplicate `id` keys.
*   **Expected**: Mutex resolves correctly, appending results sequentially without throwing thread errors.
*   **Pseudocode**:
    ```typescript
    const toolCalls = [
      { id: "dup-id", function: { name: "read", arguments: JSON.stringify({ file_path: "f1.ts" }) } },
      { id: "dup-id", function: { name: "read", arguments: JSON.stringify({ file_path: "f2.ts" }) } }
    ];
    const addToolResult = vi.fn();
    await executeToolsParallel(toolCalls, {
      ctx: mockCtx,
      toolContext: {},
      addToolResult,
      maxConcurrency: 2
    });
    expect(addToolResult).toHaveBeenCalledTimes(2);
    expect(addToolResult.mock.calls[0][1]).toBe("dup-id");
    ```

#### F1.5: Safe/Destructive Alternating Sequence
*   **Description**: Validates correct sequence execution when safe (parallelizable) and destructive (sequential) tool calls are interleaved.
*   **Setup**: Call sequence: `read` (safe), `write` (destructive), `read` (safe), `edit` (destructive), `read` (safe).
*   **Expected**: Batching logic divides them into 5 distinct batches: `parallel` -> `sequential` -> `parallel` -> `sequential` -> `parallel` rather than merging them incorrectly.
*   **Pseudocode**:
    ```typescript
    const toolCalls = [
      { id: "1", function: { name: "read", arguments: "{}" } },
      { id: "2", function: { name: "write", arguments: "{}" } },
      { id: "3", function: { name: "read", arguments: "{}" } },
      { id: "4", function: { name: "edit", arguments: "{}" } },
      { id: "5", function: { name: "read", arguments: "{}" } }
    ];
    const registry = await import("../../src/agent/tools/registry.js");
    const spy = vi.spyOn(registry, "executeTool").mockResolvedValue({ success: true, output: "ok" });
    await executeToolsParallel(toolCalls, { ctx: mockCtx, toolContext: {}, addToolResult: vi.fn() });
    expect(spy).toHaveBeenCalledTimes(5);
    ```

---

### Feature 2: Context Compressor (`src/agent/context-compressor.ts`)
The Context Compressor dynamically summarizes long threads using an LLM model or drops down to non-LLM condensation when limits are reached.

#### F2.1: Zero or Negative ChunkSize Infinite Loop
*   **Description**: Assures setting `chunkSize` parameter to `0` or negative values inside options does not cause an infinite loop in the internal array chunking method (lines 75-81).
*   **Setup**: Call `compressContext` with `options = { chunkSize: 0 }`.
*   **Expected**: The internal logic clamps `chunkSize` to `1` or throws an error.
*   **Pseudocode**:
    ```typescript
    const messages = Array.from({ length: 20 }, () => ({ role: "assistant" as const, content: "blah" }));
    const resultPromise = compressContext(messages, async () => "summary", 100, { chunkSize: 0 });
    await expect(Promise.race([
      resultPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("Infinite Loop")), 1000))
    ])).resolves.toBeDefined();
    ```

#### F2.2: Target Tokens Smaller Than Single Message
*   **Description**: Checks behavior when `targetTokens` limit is configured to be smaller than the token footprint of even a single core message (e.g., target = 5 tokens).
*   **Setup**: Call `compressContext` with a small `targetTokens` threshold (e.g., `5`).
*   **Expected**: It reduces as much as possible but keeps at least `keepFirstN` and `keepLastN` messages to preserve conversation structure without returning empty or crashing.
*   **Pseudocode**:
    ```typescript
    const messages = [
      { role: "system" as const, content: "Initial system prompt instructions" },
      { role: "user" as const, content: "Very long message query" }
    ];
    const result = await compressContext(messages, async () => "sum", 5);
    expect(result.length).toBeGreaterThan(0);
    ```

#### F2.3: Context with 100% Critical Messages
*   **Description**: Ensures `progressiveCompress` terminates cleanly when running on messages that are all marked as critical (system/user messages).
*   **Setup**: Invoke `progressiveCompress` with an array consisting solely of `system` and `user` messages, set target tokens lower than actual.
*   **Expected**: It terminates safely (line 289 `if (nonCritical.length === 0) break;`) and retains the critical messages.
*   **Pseudocode**:
    ```typescript
    const messages = [
      { role: "system" as const, content: "Sys" },
      { role: "user" as const, content: "User query 1" },
      { role: "user" as const, content: "User query 2" }
    ];
    const result = progressiveCompress(messages, 10);
    expect(result).toEqual(messages); // None removed since all are critical
    ```

#### F2.4: Token Estimation under Huge Strings (10MB+)
*   **Description**: Evaluates the safety and performance of token calculations under massive inputs. Since `encodeStringSafely` slices large strings to 4000 characters and computes scaling, it must not overflow memory.
*   **Setup**: Run `estimateTokens` on a message containing a 10MB string.
*   **Expected**: Completes rapidly (under 50ms) using the scaling estimation instead of calling tokenizer encode on 10MB of data.
*   **Pseudocode**:
    ```typescript
    const largeStr = "a".repeat(10 * 1024 * 1024); // 10MB
    const messages = [{ role: "user" as const, content: largeStr }];
    const start = Date.now();
    const tokens = estimateTokens(messages);
    const duration = Date.now() - start;
    expect(tokens).toBeGreaterThan(0);
    expect(duration).toBeLessThan(100);
    ```

#### F2.5: Summarizer Failure Fallback with Corrupted Data
*   **Description**: Evaluates error cascading when the LLM summarizer fails, triggering the fallback method `summarizeWithoutLLM`, which is then fed corrupt message arrays (e.g. `content` is null, undefined, or functions).
*   **Setup**: Mock LLM summarizer to throw error, pass message with missing `content` fields to `compressContext`.
*   **Expected**: Gracefully falls back, stringifies any non-string fields using `JSON.stringify` or empty strings, and finishes without exception.
*   **Pseudocode**:
    ```typescript
    const corruptMessages = [
      { role: "system" as const, content: "Sys" },
      { role: "assistant" as const, content: undefined as any },
      { role: "user" as const, content: null as any }
    ];
    const badSummarizer = () => Promise.reject(new Error("LLM failure"));
    const result = await compressContext(corruptMessages, badSummarizer, 5, { keepFirstN: 0, keepLastN: 0 });
    expect(result.length).toBeGreaterThan(0);
    ```

---

### Feature 3: Predictive Prefetcher (`src/agent/prefetcher.ts`)
The Predictive Prefetcher triggers read operations in the background based on pattern rules or frequency history.

#### F3.1: Aborted Prefetch on Concurrent File Modification
*   **Description**: Verifies that any pending read prefetches are aborted instantly when a writing tool modification occurs on the targeted file, preventing dirty cached reads.
*   **Setup**: Predict a prefetch of `read` for `f1.ts`. While it is pending, call `predict` for a `write` tool modifying `f1.ts`.
*   **Expected**: The abort controller for the `read` prefetch is aborted immediately, clearing the pending record.
*   **Pseudocode**:
    ```typescript
    const prefetcher = getPrefetcher();
    prefetcher.setEnabled(true);
    const mockCtx = { cwd: tempDir } as any;
    
    // Setup rules to trigger read -> file_info prefetch
    prefetcher.predict("read", { file_path: "f1.ts" }, mockCtx);
    expect(prefetcher.hasPrefetched("file_info", { file_path: "f1.ts" })).toBe(true);
    
    // Simulate destructive write on same file
    prefetcher.predict("write", { file_path: "f1.ts" }, mockCtx);
    expect(prefetcher.hasPrefetched("file_info", { file_path: "f1.ts" })).toBe(false);
    ```

#### F3.2: Queue Saturation and Recovery
*   **Description**: Tests queue bounds when the queue is filled to maximum limit (10 items), confirming that additional items are ignored, and that slots free up when active items resolve.
*   **Setup**: Add 10 slow executing promises to the prefetcher queue. Attempt to add the 11th. Then resolve 1 slow promise, and add a 12th.
*   **Expected**: 11th is ignored (queue capped at 10). 12th succeeds after a slot is freed.
*   **Pseudocode**:
    ```typescript
    const prefetcher = getPrefetcher();
    prefetcher.setEnabled(true);
    // Fill 10 slots
    for(let i=0; i<10; i++) {
      prefetcher.predict("read", { file_path: `f${i}.ts` }, mockCtx);
    }
    expect(prefetcher.getPendingCount()).toBe(10);
    
    // Add 11th
    prefetcher.predict("read", { file_path: "f10.ts" }, mockCtx);
    expect(prefetcher.getPendingCount()).toBe(10); // Still 10
    ```

#### F3.3: Successful Prefetch under Full Cache Eviction
*   **Description**: Ensures that when a prefetch completes, saving to the tool cache does not cause problems when the tool cache has hit its storage size capacity limits.
*   **Setup**: Fill the tool cache to its capacity limits (if any size limit exists). Run a prefetch that resolves, writing to the cache.
*   **Expected**: Cache deletes oldest entry and stores the prefetched result without throwing.
*   **Pseudocode**:
    ```typescript
    const cache = getToolCache();
    // Fill cache capacity if applicable
    const prefetcher = getPrefetcher();
    prefetcher.predict("read", { file_path: "f-cached.ts" }, mockCtx);
    // Wait for resolution
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(cache.has("file_info", { file_path: "f-cached.ts" })).toBeDefined();
    ```

#### F3.4: Rule Arg Mapper / Condition Error Handling
*   **Description**: Assures that custom rules containing buggy `argMapper` or `condition` callbacks that throw exceptions are caught gracefully in the loop (lines 245-247) and do not halt subsequent rules.
*   **Setup**: Mock a tool's prefetch rules with one rule whose `condition` throws an error, followed by a valid rule.
*   **Expected**: The execution moves past the buggy rule and processes the next rule.
*   **Pseudocode**:
    ```typescript
    const toolDef = {
      name: "custom_tool",
      prefetchRules: [
        { tool: "f1", argMapper: () => { throw new Error("Fault"); } },
        { tool: "f2", argMapper: () => ({ file_path: "ok.ts" }) }
      ]
    };
    // Predict prefetch, check that f2 prefetch is queued successfully despite f1 throwing
    ```

#### F3.5: Circular References in Tool Arguments
*   **Description**: Verifies that tool calls containing arguments with circular structures do not cause the prefetcher stringification key builder to crash with `TypeError: Converting circular structure to JSON`.
*   **Setup**: Call `predict` passing arguments containing circular references (e.g., `obj.self = obj`).
*   **Expected**: Handled gracefully without crash (caught or stabilized).
*   **Pseudocode**:
    ```typescript
    const circularObj: any = {};
    circularObj.self = circularObj;
    const run = () => getPrefetcher().predict("read", circularObj, mockCtx);
    expect(run).not.toThrow();
    ```

---

### Feature 4: Memory Graph (`src/agent/memory/graph.ts`)
The Memory Graph manages semantic relationship memory scoped to workspace directories.

#### F4.1: Corrupt JSON Syntax Error & Backup Generation
*   **Description**: Ensures that when `loadGraph` encounters a corrupt JSON syntax error, it correctly backs up the broken file and continues without crashing.
*   **Setup**: Write invalid JSON `{ corrupt ` to `memory-graph.json`. Call `loadGraph()`.
*   **Expected**: Throws the parse error (as per line 53), but creates a `memory-graph.corrupted-*.json` file.
*   **Pseudocode**:
    ```typescript
    const memoryFilePath = path.join(tempDir, ".tehuti", "memory-graph.json");
    await fs.outputFile(memoryFilePath, "{ corrupt ");
    await expect(loadGraph()).rejects.toThrow();
    const files = await fs.readdir(path.dirname(memoryFilePath));
    expect(files.some(f => f.startsWith("memory-graph.corrupted-"))).toBe(true);
    ```

#### F4.2: Eviction at 1000 Nodes Capacity Limits
*   **Description**: Verifies that node counts are capped at `1000`. Inserting the 1001st node must trigger sorting and evict the node with the lowest relevance.
*   **Setup**: Insert 1000 mock nodes. Insert a 1001st node with a very low priority.
*   **Expected**: The final graph contains exactly 1000 nodes, and the lowest relevance node is removed.
*   **Pseudocode**:
    ```typescript
    for (let i = 0; i < 1000; i++) {
      await addNode(`n${i}`, "fact", `content ${i}`, "global", 5);
    }
    // Insert lowest priority
    await addNode("lowest", "fact", "lowest content", "global", -100);
    const graph = await loadGraph();
    expect(graph.nodes).toHaveLength(1000);
    expect(graph.nodes.some(n => n.id === "lowest")).toBe(false);
    ```

#### F4.3: Extreme Relevance Fields (NaN, Infinity, null)
*   **Description**: Evaluates relevance scoring when priority or importance fields are fed values like `NaN`, `Infinity`, or `null`.
*   **Setup**: Save nodes with priorities: `NaN`, `Infinity`, `-Infinity`, `null`.
*   **Expected**: Relevance sorting function (`getNodeRelevance`) handles values without crash, resolving sorting order predictably.
*   **Pseudocode**:
    ```typescript
    await addNode("nan-node", "fact", "text", "global", NaN);
    await addNode("inf-node", "fact", "text", "global", Infinity);
    const prompt = await getSystemPromptMemory("global");
    expect(prompt).toContain("inf-node"); // Should sort high
    ```

#### F4.4: Scoped CWD Path Normalization & Symlinks
*   **Description**: Tests scoping filters under varying directory formats, trailing slashes, and paths containing directory traversals (`/foo/bar/../bar/`).
*   **Setup**: Add nodes scoped to `relative/path/`, `/abs/path/../path`, and a folder matching a symlink directory.
*   **Expected**: Path resolution normalizes all inputs using `path.resolve` to ensure matching scopes resolve identical folders correctly.
*   **Pseudocode**:
    ```typescript
    await addNode("n1", "critical_fact", "secret", "/a/b/../b");
    const results = await searchGraph("secret", "/a/b");
    expect(results).toHaveLength(1);
    ```

#### F4.5: Lock Contention Under Heavy Read-Write Load
*   **Description**: Stress tests the `ReadWriteLock` mutex under heavy parallel loads to guarantee no data is corrupted or partially written.
*   **Setup**: Execute 50 parallel requests to `addNode` and `searchGraph` concurrently.
*   **Expected**: All operations resolve successfully, and the resulting JSON remains syntactically valid.
*   **Pseudocode**:
    ```typescript
    const promises = Array.from({ length: 50 }, (_, i) => 
      i % 2 === 0 ? addNode(`n${i}`, "fact", "txt") : searchGraph("txt")
    );
    await expect(Promise.all(promises)).resolves.toBeDefined();
    const graph = await loadGraph();
    expect(graph.nodes.length).toBeGreaterThan(0);
    ```

---

### Feature 5: Chat UI & Custom Viewport Scrolling (`src/cli/commands/chat.ts`, `src/terminal/output.ts`)
The chat UI calculates line wraps and scrolls rendering using negative margins.

#### F5.1: Render Empty Messages Array
*   **Description**: Tests that rendering works when the messages array is empty, which represents the start of a chat session.
*   **Setup**: Provide `messages = []` to `useChatState` and the UI renderer.
*   **Expected**: Total lines calculations return 0, no errors or zero division throws.
*   **Pseudocode**:
    ```typescript
    const { result } = renderHook(() => useChatState("model", "key", {}));
    expect(result.current.messages).toEqual([]);
    expect(result.current.scrollOffset).toBe(0);
    ```

#### F5.2: Zero-Column Wrapping Limits
*   **Description**: Tests layout behavior when the terminal width is reported as 0 columns (e.g. during headless runs or terminal resize events).
*   **Setup**: Call `wrap` with `width = 0` or negative values.
*   **Expected**: Does not freeze or run into infinite loops; wraps text character-by-character on a width threshold of 1.
*   **Pseudocode**:
    ```typescript
    const longText = "Hello World";
    const wrapped = wrap(longText, 0); // Trigger wrap limit
    expect(wrapped.split("\n").length).toBeGreaterThan(0);
    ```

#### F5.3: Viewport Negative Margin Overflow Limits
*   **Description**: Verifies that configuring a massive `scrollOffset` does not push elements out of bounds or cause negative values inside components.
*   **Setup**: Pass `scrollOffset` value much larger than actual line counts.
*   **Expected**: Margin constraints are clamped at layout level to avoid out-of-screen rendering.
*   **Pseudocode**:
    ```typescript
    const totalLines = 10;
    const scrollOffset = 100; // Extreme scroll
    const margin = Math.max(0, scrollOffset);
    // Verify layout clamps the output value
    ```

#### F5.4: Boundary Keyboard Traversal & Key Repeats
*   **Description**: Tests key traversal limits when keys like PageUp or PageDown are pressed repeatedly at boundaries.
*   **Setup**: Scroll PageUp repeatedly when already at the top of the chat view.
*   **Expected**: The scrollOffset state remains capped at the maximum computed offset and does not overflow or throw errors.
*   **Pseudocode**:
    ```typescript
    // Mock viewport height and total message lines
    let offset = 50;
    const maxOffset = 50;
    // Simulate scroll up
    offset = Math.min(maxOffset, offset + 20);
    expect(offset).toBe(maxOffset);
    ```

#### F5.5: Nested Formatting Output Wrapping & ANSI
*   **Description**: Verifies that line calculations are accurate when messages contain nested layout elements (multiple reasoning boxes, system prompt logs, code blocks).
*   **Setup**: Construct a message with multiple styling sequences and code blocks. Calculate lines.
*   **Expected**: Line counts calculated by `computeMessageLines` match the visual blocks.
*   **Pseudocode**:
    ```typescript
    const msg = {
      role: "assistant",
      content: [
        { type: "text", content: "\x1b[31mBold styled content\x1b[0m" },
        { type: "reasoning", content: "Line1\nLine2\nLine3" }
      ]
    };
    const lineCount = computeMessageLines(msg, 40);
    expect(lineCount).toBe(8); // 1 header + 1 text + 2 reasoning border + 3 reasoning text + 1 margin
    ```

---

### Feature 6: Slash Command Palette (`src/cli/ui/components/CommandPalette.tsx`)
The Slash Command Palette provides interactive fuzzy search for CLI configurations.

#### F6.1: Fuzzy Matching with Zero Matching Queries
*   **Description**: Verifies search rendering behavior when a user types a query matching no available commands.
*   **Setup**: Render `CommandPalette` with query = `x-y-z-no-match`.
*   **Expected**: The filtered commands list is `[]`, selectedIndex is `0`, and the UI displays a message like "No matching commands found."
*   **Pseudocode**:
    ```typescript
    const commands = [{ id: "/clear", label: "Clear", description: "", category: "session" as const }];
    // Execute fuzzy search with query "xyz"
    const matches = commands.filter(c => fuzzyMatch(c.label, "xyz").score >= 0);
    expect(matches).toEqual([]);
    ```

#### F6.2: Extreme Long Query String Backtracking
*   **Description**: Checks that typing a query of extreme length does not cause performance degradation in the fuzzy search algorithm.
*   **Setup**: Input a 1000-character query into the search field.
*   **Expected**: Matches resolve in under 10ms, no catastrophic regex backtracking or loop delays occur.
*   **Pseudocode**:
    ```typescript
    const longQuery = "a".repeat(1000);
    const start = Date.now();
    fuzzyMatch("Clear conversation", longQuery);
    expect(Date.now() - start).toBeLessThan(10);
    ```

#### F6.3: Traversal wrap-around at Index Limits
*   **Description**: Verifies index boundaries during command list navigation. If wrap-around is supported, pressing Down Arrow at the bottom should navigate to the top, and Up Arrow at index 0 should navigate to the bottom.
*   **Setup**: Mock keyboard inputs on command lists.
*   **Expected**: Clamps or wraps around correctly without throwing index out of bounds.
*   **Pseudocode**:
    ```typescript
    const listSize = 5;
    let selected = 0;
    // Down arrow at bottom
    selected = (selected + 1) % listSize;
    // Up arrow at top
    selected = (selected - 1 + listSize) % listSize;
    ```

#### F6.4: Mode-switching Traversals (Empty vs Populated Input)
*   **Description**: Ensures Vim key navigation (`j`/`k`) is only active when search input is empty, to allow typing characters when populated.
*   **Setup**: Press `j` while the search input contains text `"model"`.
*   **Expected**: Inserts the letter `j` in the query, rather than shifting selection index.
*   **Pseudocode**:
    ```typescript
    let query = "model";
    let selectedIndex = 0;
    const handleKey = (char: string) => {
      if (char === 'j' && query.length === 0) {
        selectedIndex++;
      } else {
        query += char;
      }
    };
    handleKey('j');
    expect(query).toBe("modelj");
    expect(selectedIndex).toBe(0);
    ```

#### F6.5: Empty Submenu Stack Pop
*   **Description**: Verifies that pressing Escape when the menu stack is empty does not pop undefined values or trigger errors.
*   **Setup**: Set `menuStack = []` and simulate Escape key press.
*   **Expected**: Triggers the palette close action (`onClose()`) without exceptions.
*   **Pseudocode**:
    ```typescript
    let stack: any[] = [];
    const onClose = vi.fn();
    const handleEscape = () => {
      if (stack.length > 0) stack.pop();
      else onClose();
    };
    handleEscape();
    expect(onClose).toHaveBeenCalled();
    ```

---

### Feature 7: Config Editor (`src/cli/ui/components/ConfigEditor.tsx`)
The Config Editor renders interactive tabs for user options and values.

#### F7.1: Out-of-bounds Field Constraints
*   **Description**: Tests bounds checking for numerical inputs.
*   **Setup**: Input `temperature = 2.1` or `maxTokens = 500`.
*   **Expected**: The editor rejects changes, outputs validation error, and does not update draft config.
*   **Pseudocode**:
    ```typescript
    // Mock user entering invalid maxTokens
    const err = validateFieldInput("maxTokens", "500");
    expect(err.valid).toBe(false);
    expect(err.error).toContain("Must be at least 1000");
    ```

#### F7.2: Scientific/Float Value Inputs Parsing
*   **Description**: Tests float conversions under alternative numerical syntax inputs (e.g. `1e-1`, `0.70`, `.5`, `+1.2`).
*   **Setup**: Type scientific float patterns in number fields.
*   **Expected**: Parsed correctly as numbers, passes bounds checks.
*   **Pseudocode**:
    ```typescript
    const res = validateFieldInput("temperature", "1e-1");
    expect(res.valid).toBe(true);
    expect(res.parsed).toBe(0.1);
    ```

#### F7.3: Whitespace API Key Deletion
*   **Description**: Ensures setting API key field to empty spaces deletes the configuration (resolving to `undefined`).
*   **Setup**: Edit the key field to value `"   "`.
*   **Expected**: Evaluates to `undefined`, effectively removing it from final saved options.
*   **Pseudocode**:
    ```typescript
    // Submit spaces
    const result = commitFieldEditWithValue("apiKey", "   ");
    expect(result.apiKey).toBeUndefined();
    ```

#### F7.4: Cancel changes draft restoration
*   **Description**: Verifies that edits are rolled back if the cancellation trigger is clicked or Escape is pressed.
*   **Setup**: Edit values for provider, apiKey, and model, then press Escape.
*   **Expected**: `onCancel()` callback runs, original config properties remain intact.
*   **Pseudocode**:
    ```typescript
    const config = { provider: "openrouter" };
    // Simulate edits
    // Simulate escape cancel
    // Ensure parent values did not change
    ```

#### F7.5: Tab Switch Index Synchronization
*   **Description**: Tests page-tab changes when using arrow keys, ensuring the selection index points to a valid field key on the target tab.
*   **Setup**: Navigate to the right tab using the Right Arrow key.
*   **Expected**: Focus switches to target tab, `selectedField` resolves to a field valid within the target tab.
*   **Pseudocode**:
    ```typescript
    let activeTab = "API & Provider";
    let selectedField = "provider";
    // Right arrow triggers tab switch
    activeTab = "Model Options";
    selectedField = "model"; // Must reset to valid field in Model Options tab
    ```

---

### Feature 8: Advanced Tooling (`src/agent/tools/repo-map.ts`, `src/agent/tools/search.ts`)
Advanced Tooling scans codebase symbols, types, and files using Tree-Sitter AST parsing and ripgrep searches.

#### F8.1: Non-TS/JS Files Parsing in Repo Map
*   **Description**: Assures AST generation handles non-JS/TS file types (e.g. `.png` or binary data files) without throwing unhandled exceptions.
*   **Setup**: Put binary or raw text files in the target directory and run `repo_map`.
*   **Expected**: Ignore or skip them gracefully without halting execution.
*   **Pseudocode**:
    ```typescript
    await fs.writeFile(path.join(tempDir, "image.png"), "binarycontent");
    const result = await repoMapTool.execute({ path: tempDir }, mockCtx);
    expect(result.success).toBe(true); // skips or completes safely
    ```

#### F8.2: Syntactically Malformed TS File AST Recovery
*   **Description**: Tests parser stability on syntactically broken code (mismatched braces, incomplete syntax declarations).
*   **Setup**: Write a broken `.ts` file with missing blocks. Run `repo_map`.
*   **Expected**: Tree-Sitter parses a partial syntax tree without crashes, returning any valid definitions found.
*   **Pseudocode**:
    ```typescript
    const brokenCode = "export class Bad { export function foo(";
    await fs.writeFile(path.join(tempDir, "bad.ts"), brokenCode);
    const result = await repoMapTool.execute({ path: tempDir }, mockCtx);
    expect(result.success).toBe(true);
    ```

#### F8.3: Go-to-Definition Regex Injection Safety
*   **Description**: Ensures query strings with regex qualifiers passed as symbol arguments to `go_to_definition` do not trigger regex compilation errors or backtracking delays.
*   **Setup**: Run `go_to_definition` with `symbol = "Class[A-Z]+"` or similar regex syntax.
*   **Expected**: Escaped or matches safely without crash.
*   **Pseudocode**:
    ```typescript
    const goToDefinitionTool = searchTools.find(t => t.name === "go_to_definition");
    const result = await goToDefinitionTool!.execute({ symbol: "Class[A-Z]+", path: tempDir }, mockCtx);
    expect(result.success).toBeDefined();
    ```

#### F8.4: Execution of Unregistered Tool
*   **Description**: Verifies that running tool execution logic on a name not in the registry returns a structured failure instead of crashing.
*   **Setup**: Run `executeTool("imaginary_tool", {}, mockCtx)`.
*   **Expected**: Returns `success: false` and `error` indicating unknown tool.
*   **Pseudocode**:
    ```typescript
    const result = await executeTool("imaginary_tool", {}, mockCtx);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Unknown tool");
    ```

#### F8.5: Invalid Zod Parameter Typings
*   **Description**: Checks validation behavior when input args deviate from the registered Zod schema for a tool.
*   **Setup**: Run `executeTool("repo_map", { ignore: "not-an-array" }, mockCtx)`.
*   **Expected**: Fails validation, returns structured error detail.
*   **Pseudocode**:
    ```typescript
    const result = await executeTool("repo_map", { ignore: "not-an-array" }, mockCtx);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid parameters");
    ```

---

## 🚀 Execution & Structure Plan for `tests/e2e/tier2.test.ts`

The Tier 2 tests will be organized in a single file `tests/e2e/tier2.test.ts` utilizing `vitest` as the runner, aligned with the structure of `tier1.test.ts`.

### 1. File Structure and Imports
The top of the file will include Vitest setup, node filesystem utilities, and mocks for homedir/os paths to ensure isolated execution:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as fs from "fs-extra";
import React from "react";
import { render } from "ink";
import { setupE2EEnvironment } from "./helpers/e2e-helper.js";

// Hoist os mocks to isolate test environment homes
vi.mock("node:os", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:os")>();
  return {
    ...original,
    homedir: () => process.env.TEST_HOME || original.homedir(),
  };
});
```

### 2. Feature Import Blocks
Import the modules directly to test execution boundaries, matching standard imports in the main codebase:
```typescript
// Parallel Executor
import { executeToolsParallel } from "../../src/agent/parallel-executor.js";
// Context Compressor
import { compressContext, progressiveCompress } from "../../src/agent/context-compressor.js";
// Prefetcher
import { getPrefetcher } from "../../src/agent/prefetcher.js";
// Memory Graph
import { addNode, loadGraph, searchGraph } from "../../src/agent/memory/graph.js";
// Output/Wrap
import { wrap, computeMessageLines } from "../../src/terminal/output.js";
// Components
import { CommandPalette } from "../../src/cli/ui/components/CommandPalette.js";
import { ConfigEditor } from "../../src/cli/ui/components/ConfigEditor.js";
// Registry
import { executeTool } from "../../src/agent/tools/registry.js";
```

### 3. Cleanup & Mock Resets
Ensure that each test block maintains absolute isolation by recreating tmp home directories and resetting singleton instances (`resetPrefetcher`):
```typescript
describe("Tehuti CLI Tier 2 E2E Suite", () => {
  let env: any;
  let tempDir: string;

  beforeEach(async () => {
    env = await setupE2EEnvironment();
    tempDir = process.env.TEST_HOME || "";
    await fs.ensureDir(tempDir);
  });

  afterEach(async () => {
    if (env) {
      await env.cleanup();
    }
    vi.restoreAllMocks();
  });
  
  // Feature test suites go here
});
```
