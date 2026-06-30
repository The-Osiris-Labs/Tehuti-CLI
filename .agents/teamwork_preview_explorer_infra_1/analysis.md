# Tehuti CLI — E2E Testing Architecture Design

This document details the comprehensive End-to-End (E2E) testing architecture for the 8 core features of the Tehuti CLI assistant.

---

## 🏛️ 1. Architectural Entry Points & Control Flow

To test Tehuti CLI end-to-end, we must understand the core execution flow:

```
[src/index.ts] 
   └── Initialize HttpAgent & Syntax Highlighter
   └── Invoke createProgram() (src/cli/commands/chat.ts)
         └── Run in One-Shot Mode (runOneShot) OR Render Interactive Chat UI (<Chat />)
               └── Interactive Chat UI mounts React/Ink tree
                     └── Main loop triggers runAgentLoop() (src/agent/index.ts)
                           └── Delegate to runAgentLoop() (src/agent/loop/runner.ts)
                                 └── manageContextWindow() (Context Compression)
                                 └── streamChat() (LLM execution loop)
                                 └── executeToolsParallel() (Parallel Executor)
```

1. **CLI Entry Point (`src/index.ts`)**: Initializes global utilities (HTTP agent, Shiki highlighter, update notifier) and invokes the Commander program parser.
2. **Interactive UI (`src/cli/commands/chat.ts`)**: Renders the React-Ink layout. It captures raw terminal inputs via the `useInput` hook to handle cursor movement, history, slash command palettes, configuration forms, and custom scroll offsets.
3. **Agent Loop (`src/agent/loop/runner.ts` / `src/agent/index.ts`)**: Orchestrates the LLM API stream, token processing, model tier classification, context compaction, and execution of tools.

---

## 🛠️ 2. Testing Infrastructure Foundations

To run tests without a real terminal, we rely on **headless rendering**, **deterministic API mocking**, and **filesystem/home directory isolation**.

### A. Headless Terminal & Input Simulation
Ink provides capabilities to mount components with mock input/output streams. In Vitest, we can instantiate a mock runtime:

```typescript
import { render } from "ink";
import Stream from "node:stream";
import { vi } from "vitest";

function createMockTerminal() {
  const stdin = new Stream.PassThrough() as any;
  stdin.isTTY = true;
  stdin.setRawMode = vi.fn();

  const stdout = new Stream.PassThrough() as any;
  stdout.columns = 80;
  stdout.rows = 24;

  const renderInstance = render(<Chat />, { stdin, stdout, debug: true });

  return {
    stdin,
    stdout,
    renderInstance,
    // Send string or control sequence
    sendKey: (key: string | { name: string; ctrl?: boolean; meta?: boolean }) => {
      if (typeof key === "string") {
        stdin.write(key);
      } else {
        // Send typical ANSI sequences for arrow keys
        const sequences: Record<string, string> = {
          up: "\u001b[A",
          down: "\u001b[B",
          right: "\u001b[C",
          left: "\u001b[D",
          return: "\r",
          escape: "\u001b",
          backspace: "\x7f",
        };
        stdin.write(sequences[key.name] || "");
      }
    },
    getFrame: () => renderInstance.lastFrame(),
  };
}
```

### B. Mocking OpenRouter/OpenCode Go API Calls
We mock the OpenRouter client globally using Vitest to simulate model streams and tool call generation:

```typescript
import { vi } from "vitest";
import { OpenRouterClient } from "../api/openrouter.js";

vi.mock("../api/openrouter.js", () => {
  return {
    OpenRouterClient: {
      getInstance: () => ({
        streamChat: async function* (messages: any[], tools: any[]) {
          // Return mock LLM stream yielding text or tool calls
          yield {
            choices: [{ delta: { content: "Thinking..." }, finish_reason: null }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
          };
          yield {
            choices: [{
              delta: {
                tool_calls: [{
                  id: "call_abc123",
                  type: "function",
                  function: { name: "read", arguments: '{"file_path":"src/index.ts"}' }
                }]
              },
              finish_reason: "tool_calls"
            }]
          };
        },
        completeChat: vi.fn().mockResolvedValue({
          choices: [{ message: { role: "assistant", content: "LLM Summary text" } }]
        }),
        abort: vi.fn(),
      }),
      resetInstance: vi.fn(),
    }
  };
});
```

### C. Config & Storage Isolation (No Home Pollution)
Tehuti CLI reads configurations and writes logs/sessions/memory graphs inside the user's home folder (`~/.tehuti/` and `~/.tehuti.json`). We isolate this during tests using standard Vitest spies:

```typescript
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";

const TEST_DIR = path.join(process.cwd(), ".tmp-test-env");

beforeEach(async () => {
  await fs.ensureDir(TEST_DIR);
  vi.spyOn(os, "homedir").mockReturnValue(TEST_DIR);
});

afterEach(async () => {
  await fs.remove(TEST_DIR);
  vi.restoreAllMocks();
});
```

---

## 🎯 3. E2E Verification Plan for the 8 Core Features

### 🟢 F1: Parallel Executor
* **Target Behavior**: Verify that safe read-only tools run concurrently under `maxConcurrency` limits, while write and interactive tools run sequentially.
* **Mocking Strategy**: Mock `executeTool` in `src/agent/tools/registry.ts`. Introduce a custom delay (e.g. `setTimeout`) in the mocked executions.
* **Input Simulation**: Pass a tool calls array containing a mix of parallelizable and sequential tools to `executeToolsParallel`.
* **Assertions**: 
  1. Record timestamps: verify parallel tools start overlapping in time.
  2. Verify write tools execute after parallel chunks are resolved.
  3. Verify sequential output order in telemetry logs.

### 🟢 F2: Context Compressor
* **Target Behavior**: When context exceeds 85% of capacity, messages in the middle are compressed using LLM summaries, with a robust fallback to non-LLM local truncation.
* **Mocking Strategy**: Stub `estimateTokens` to return large numbers to trigger compaction conditions. Spy on `OpenRouterClient.prototype.completeChat` to simulate standard execution and server-side errors (timeouts/rate limits).
* **Input Simulation**: Run `manageContextWindow()` with a message list length of 50.
* **Assertions**:
  1. **LLM Path**: Assert that `client.completeChat` was invoked, and messages in the middle were replaced by a single assistant message containing `"[Previous Context Summary] LLM Summary text"`.
  2. **Fallback Path**: Throw an error in `completeChat`. Assert that the loop catches it and uses `summarizeWithoutLLM` (which replaces messages with `"[Condensed] ...[truncated]"`).
  3. Verify system prompt (message `0`) and recent messages (last `N`) are preserved.

### 🟢 F3: Predictive Prefetcher
* **Target Behavior**: Speculatively prefetch files and directory listings on safe commands. Evict/abort pending prefetch promises if a write tool touches the same files.
* **Mocking Strategy**: Spy on `executeTool` inside `Prefetcher` queueing logic.
* **Input Simulation**: 
  1. Call `prefetcher.predict("read", { file_path: "src/main.ts" }, toolCtx)`.
  2. Call `prefetcher.predict("write", { file_path: "src/main.ts" }, toolCtx)`.
* **Assertions**:
  1. Verify the `file_info` or other mappings are added to `prefetcher.pending` Map.
  2. Verify the prefetch `AbortSignal` is triggered immediately upon calling the write tool.
  3. Assert `prefetcher.getPrefetched("file_info", { file_path: "src/main.ts" })` is cancelled/aborted.

### 🟢 F4: Autonomous Memory Management
* **Target Behavior**: Storing rule-insights inside the JSON memory graph, loading them into memory, and injecting them into the system prompt.
* **Mocking Strategy**: Spy on `os.homedir` to write memory graph JSON to a test folder.
* **Input Simulation**:
  1. Execute `store_insight` tool with args `{ id: "strict-rules", type: "project_rule", content: "Always use tabs" }`.
  2. Run `buildSystemPrompt()`.
* **Assertions**:
  1. Verify that `memory-graph.json` contains the stored node.
  2. Assert that the constructed system prompt contains:
     ```markdown
     ## Long-Term Memory (Critical Insights)
     - [strict-rules] Always use tabs
     ```

### 🟢 F5: Chat UI & Custom Viewport Scrolling
* **Target Behavior**: Compute message heights, wrap text correctly, and apply negative margins dynamically to slice the visible terminal window.
* **Mocking Strategy**: Mock `stdout.rows = 15` and `stdout.columns = 60`.
* **Input Simulation**: Feed 20 wrapped text messages into the React chat history state. Send PageUp / PageDown arrow events to `stdin`.
* **Assertions**:
  1. Verify `computeMessageLines` computes the line count accurately matching the wrap width.
  2. Verify the negative margin state (`-scrollOffset`) shifts when PageUp / PageDown keys are written to `stdin`.
  3. Assert that only the subset of messages intersecting the viewport are rendered in the final `lastFrame()` output.

### 🟢 F6: Slash Command Palette
* **Target Behavior**: Open palette on `/`, filter commands using fuzzy-matching with highlighted characters, traverse using arrows/Vim-keys (`j`/`k`), and execute commands without inputs leaking to the main chat box.
* **Mocking Strategy**: Setup the chat component with the command palette overlay active.
* **Input Simulation**:
  1. Write `/` to open.
  2. Write `"conf"` to trigger filtering.
  3. Send `downArrow` or `"j"`.
  4. Send `return`.
* **Assertions**:
  1. Verify palette visibility state toggles to `true`.
  2. Assert fuzzy matching results prioritize higher score (e.g. `/config` is selected over `/cost`).
  3. Verify the layout renders matching indices using bold/underlined yellow highlight.
  4. Verify that writing characters inside the palette does not append text to the main chat query input.

### 🟢 F7: Config Editor
* **Target Behavior**: Interactive tabbed form editor (API Key, Model, Provider, limits). Validates numeric ranges and saves configuration without command input clashes.
* **Mocking Strategy**: Provide mock save callback `onSave = vi.fn()`.
* **Input Simulation**:
  1. Switch tabs using `rightArrow` or `tab`.
  2. Navigate to `temperature` field.
  3. Trigger editing mode (`return`).
  4. Type an invalid value (`"-1"`), press `return`.
  5. Type a valid value (`"0.8"`), press `return`, then press `Ctrl+S`.
* **Assertions**:
  1. Verify validation error text is displayed on `-1`.
  2. Verify that inputting characters inside the text box updates the draft state and doesn't trigger parent commands.
  3. Assert `onSave` was called with the updated configuration `{ temperature: 0.8 }`.

### 🟢 F8: Advanced Tooling
* **Target Behavior**: Run AST parsing (`repo_map`), simulate semantic search (`grepai`), and dynamically register/unregister tools.
* **Mocking Strategy**: Mock `child_process.spawn` for `grepai` process simulation.
* **Input Simulation**:
  1. Call `executeTool("repo_map", { path: "src" }, ctx)`.
  2. Register a mock tool, execute it, then unregister it.
* **Assertions**:
  1. Verify `repo_map` output prints AST representations (e.g. `export class OpenRouterClient`, `export function runAgentLoop`).
  2. Verify that dynamically registered tools are validated, added to definitions, executable, and safely unregistered without leftovers in the map.

---

## 📈 4. Proposed Implementation Roadmap

We recommend setting up a dedicated Vitest suite:

1. **Test Configuration**: Add a separate E2E test file pattern `*.e2e.test.ts` to `vitest.config.ts`.
2. **Helper Module (`test/e2e-helper.ts`)**: Package the mock stdin/stdout streams, config isolator, and OpenRouterClient mock builder into shared helpers.
3. **Execution**:
   ```bash
   # Run all unit and E2E tests
   npm test
   ```
