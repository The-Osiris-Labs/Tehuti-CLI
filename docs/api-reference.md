# Tehuti API Reference

> 𓆣 Complete API documentation for Tehuti CLI's public interfaces.

---

## Core Exports

### `createAgentContext(cwd, config, diffPreview?, companionMode?, sessionId?)`

Creates an agent context for running the agent loop.

**Parameters:**
- `cwd: string` — Current working directory
- `config: TehutiConfig` — Configuration object
- `diffPreview?: DiffPreviewOptions` — Optional diff preview settings
- `companionMode?: boolean` — Whether running in companion mode
- `sessionId?: string` — Optional session ID for continuity

**Returns:** `Promise<AgentContext>`

**Example:**
```typescript
import { createAgentContext } from 'tehuti-cli';
import { loadConfig } from 'tehuti-cli/config';

const config = await loadConfig();
const ctx = await createAgentContext(
  process.cwd(),
  config,
  undefined,
  false,
  'session-123'
);
```

---

### `runAgentLoop(ctx, userMessage, options?)`

Executes the main agent loop with streaming response.

**Parameters:**
- `ctx: AgentContext` — Agent context from `createAgentContext`
- `userMessage: string` — User's input message
- `options?: AgentLoopOptions` — Optional callbacks and settings

**AgentLoopOptions:**
```typescript
interface AgentLoopOptions {
  onToken?: (token: string) => void;
  onToolCall?: (id: string, name: string, args: unknown) => void;
  onToolResult?: (id: string, name: string, result: unknown) => void;
  onThinking?: (content: string) => void;
  onProgress?: (progress: number, label: string) => void;
  signal?: AbortSignal;
}
```

**Returns:** `Promise<AgentLoopResult>`

**AgentLoopResult:**
```typescript
interface AgentLoopResult {
  content: string;
  toolCalls: number;
  success: boolean;
  finishReason: string | null;
  thinking?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
  sessionStats?: {
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalCacheReadTokens: number;
    totalCacheWriteTokens: number;
    totalCost: number;
    requestCount: number;
  };
  error?: string;
}
```

**Example:**
```typescript
import { runAgentLoop } from 'tehuti-cli';

const result = await runAgentLoop(ctx, 'Fix the bug in main.ts', {
  onToken: (token) => process.stdout.write(token),
  onToolCall: (id, name, args) => console.log(`Tool: ${name}`, args),
  onToolResult: (id, name, result) => console.log(`Result:`, result),
});

console.log(`Completed with ${result.toolCalls} tool calls`);
```

---

### `runOneShot(ctx, prompt, options?)`

Simplified one-shot execution (no streaming).

**Parameters:**
- `ctx: AgentContext` — Agent context
- `prompt: string` — User prompt
- `options?: AgentLoopOptions` — Optional callbacks

**Returns:** `Promise<string>` — Final response content

**Example:**
```typescript
const response = await runOneShot(ctx, 'Explain this codebase');
console.log(response);
```

---

### `initializeAgent()`

Initializes the agent system (loads cache, bootstraps memory).

**Returns:** `void`

**Example:**
```typescript
import { initializeAgent } from 'tehuti-cli';

initializeAgent();
```

---

### `shutdownAgent()`

Shuts down the agent system (saves cache to disk).

**Returns:** `void`

**Example:**
```typescript
import { shutdownAgent } from 'tehuti-cli';

process.on('SIGINT', () => {
  shutdownAgent();
  process.exit(0);
});
```

---

## Context Management

### `estimateTokens(messages)`

Estimates token count for message array.

**Parameters:**
- `messages: StandardMessage[]` — Array of messages

**Returns:** `number` — Estimated token count

**Example:**
```typescript
import { estimateTokens } from 'tehuti-cli';

const tokens = estimateTokens(ctx.messages);
console.log(`Context size: ${tokens} tokens`);
```

---

### `compactContext(ctx, targetTokens?, maxContext?)`

Manually compacts context to target size.

**Parameters:**
- `ctx: AgentContext` — Agent context
- `targetTokens?: number` — Target token count (default: 85% of max)
- `maxContext?: number` — Maximum context length

**Returns:** `boolean` — Whether compaction occurred

**Example:**
```typescript
import { compactContext } from 'tehuti-cli';

const compacted = compactContext(ctx, 50000);
if (compacted) {
  console.log('Context compacted successfully');
}
```

---

### `warnOnContextLimit(ctx)`

Checks context usage and warns if near limit.

**Parameters:**
- `ctx: AgentContext` — Agent context

**Returns:** `boolean` — Whether context is near limit (>90%)

**Example:**
```typescript
import { warnOnContextLimit } from 'tehuti-cli';

if (warnOnContextLimit(ctx)) {
  console.warn('Context nearing limit, consider /compact');
}
```

---

### `normalizeToolMessageHistory(messages)`

Normalizes tool call history (removes orphaned tool calls).

**Parameters:**
- `messages: StandardMessage[]` — Message history

**Returns:** `StandardMessage[]` — Normalized messages

**Example:**
```typescript
import { normalizeToolMessageHistory } from 'tehuti-cli';

const normalized = normalizeToolMessageHistory(ctx.messages);
ctx.messages = normalized;
```

---

### `buildSystemPrompt(ctx, userQuery?)`

Builds the complete system prompt with memory, personality, and skills.

**Parameters:**
- `ctx: AgentContext` — Agent context
- `userQuery?: string` — Optional user query for skill matching

**Returns:** `Promise<string>` — Complete system prompt

**Example:**
```typescript
import { buildSystemPrompt } from 'tehuti-cli';

const systemPrompt = await buildSystemPrompt(ctx, 'Fix the login bug');
console.log(systemPrompt);
```

---

## Configuration API

### `loadConfig()`

Loads Tehuti configuration from all sources.

**Returns:** `Promise<TehutiConfig>` — Merged configuration

**Example:**
```typescript
import { loadConfig } from 'tehuti-cli/config';

const config = await loadConfig();
console.log(config.provider, config.model);
```

---

### `TEHUTI_CONFIG_SCHEMA`

Zod schema for validating configuration.

**Type:** `z.ZodObject<TehutiConfig>`

**Example:**
```typescript
import { TEHUTI_CONFIG_SCHEMA } from 'tehuti-cli/config';

const result = TEHUTI_CONFIG_SCHEMA.safeParse(rawConfig);
if (!result.success) {
  console.error('Invalid config:', result.error);
}
```

---

### `DEFAULT_CONFIG`

Default configuration values.

**Type:** `TehutiConfig`

**Example:**
```typescript
import { DEFAULT_CONFIG } from 'tehuti-cli/config';

const config = { ...DEFAULT_CONFIG, model: 'gpt-4' };
```

---

## Tool System

### Tool Definition Interface

```typescript
interface ToolDefinition {
  name: string;
  description: string;
  parameters: z.ZodType<any>;
  category: string;
  isReadonly: boolean;
  execute: (args: any, ctx: AgentContext) => Promise<ToolResult>;
}

interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
}
```

**Example:**
```typescript
import { z } from 'zod';
import type { ToolDefinition } from 'tehuti-cli/tools';

export const myTool: ToolDefinition = {
  name: 'my_tool',
  description: 'Does something useful',
  parameters: z.object({
    input: z.string().describe('Input parameter'),
  }),
  category: 'custom',
  isReadonly: true,
  execute: async (args, ctx) => {
    return {
      success: true,
      output: `Processed: ${args.input}`,
    };
  },
};
```

---

### `registerTools(tools)`

Registers tools with the agent system.

**Parameters:**
- `tools: ToolDefinition[]` — Array of tool definitions

**Returns:** `void`

**Example:**
```typescript
import { registerTools } from 'tehuti-cli/tools';
import { myTool } from './my-tool';

registerTools([myTool]);
```

---

### `unregisterToolsWhere(predicate)`

Unregisters tools matching predicate.

**Parameters:**
- `predicate: (tool: ToolDefinition) => boolean` — Filter function

**Returns:** `void`

**Example:**
```typescript
import { unregisterToolsWhere } from 'tehuti-cli/tools';

// Remove all MCP tools
unregisterToolsWhere(tool => tool.category === 'mcp');
```

---

### `getTool(name)`

Retrieves a registered tool by name.

**Parameters:**
- `name: string` — Tool name

**Returns:** `ToolDefinition | undefined`

**Example:**
```typescript
import { getTool } from 'tehuti-cli/tools';

const bashTool = getTool('bash');
if (bashTool) {
  console.log(bashTool.description);
}
```

---

### `getAllTools()`

Returns all registered tools.

**Returns:** `ToolDefinition[]`

**Example:**
```typescript
import { getAllTools } from 'tehuti-cli/tools';

const tools = getAllTools();
console.log(`Registered ${tools.length} tools`);
```

---

## Memory API

### `addNode(id, type, content, cwd?, priority?, importance?, epistemicStatus?, confidenceScore?)`

Adds a node to the memory graph.

**Parameters:**
- `id: string` — Unique node ID
- `type: string` — Node type (file, function, concept, etc.)
- `content: string` — Node content
- `cwd?: string` — Working directory context
- `priority?: number` — Priority score
- `importance?: number` — Importance score
- `epistemicStatus?: 'verified_fact' | 'speculative' | 'user_preference'`
- `confidenceScore?: number` — Confidence (0-1)

**Returns:** `Promise<void>`

**Example:**
```typescript
import { addNode } from 'tehuti-cli/memory';

await addNode(
  'file-main-ts',
  'file',
  'Main entry point for the application',
  process.cwd(),
  10,
  0.9,
  'verified_fact',
  0.95
);
```

---

### `addEdge(source, target, relation, weight?)`

Adds an edge between two nodes.

**Parameters:**
- `source: string` — Source node ID
- `target: string` — Target node ID
- `relation: string` — Relationship type
- `weight?: number` — Edge weight

**Returns:** `Promise<void>`

**Example:**
```typescript
import { addEdge } from 'tehuti-cli/memory';

await addEdge('file-main-ts', 'function-init', 'contains', 1.0);
```

---

### `queryRelated(query, limit?)`

Queries related nodes via vector similarity.

**Parameters:**
- `query: string` — Search query
- `limit?: number` — Max results (default: 10)

**Returns:** `Promise<Node[]>` — Related nodes

**Example:**
```typescript
import { queryRelated } from 'tehuti-cli/memory';

const related = await queryRelated('authentication logic', 5);
console.log(related.map(n => n.content));
```

---

### `getSystemPromptMemory(cwd)`

Retrieves memory context for system prompt.

**Parameters:**
- `cwd: string` — Working directory

**Returns:** `Promise<string>` — Memory context string

**Example:**
```typescript
import { getSystemPromptMemory } from 'tehuti-cli/memory';

const memoryContext = await getSystemPromptMemory(process.cwd());
```

---

### `consolidateMemory()`

Runs memory consolidation (background job).

**Returns:** `Promise<void>`

**Example:**
```typescript
import { consolidateMemory } from 'tehuti-cli/memory';

await consolidateMemory();
```

---

## Cache API

### `LRUCache<T>`

Generic LRU cache implementation.

**Constructor:**
```typescript
new LRUCache<T>(config?: CacheConfig)
```

**CacheConfig:**
```typescript
interface CacheConfig {
  maxSize?: number;      // Max cache size in bytes (default: 50MB)
  defaultTtl?: number;   // Default TTL in ms (default: 5min)
  maxEntries?: number;   // Max entries (default: 1000)
}
```

**Methods:**

#### `get(key: string): T | undefined`
Retrieve cached value.

#### `set(key: string, value: T, ttl?: number): void`
Store value in cache.

#### `has(key: string): boolean`
Check if key exists.

#### `delete(key: string): boolean`
Remove key from cache.

#### `clear(): void`
Clear all cache entries.

#### `getStats(): CacheStats`
Get cache statistics.

**Example:**
```typescript
import { LRUCache } from 'tehuti-cli/cache';

const cache = new LRUCache<string>({ maxSize: 10 * 1024 * 1024 });

cache.set('key1', 'value1', 60000); // 60s TTL
const value = cache.get('key1');

const stats = cache.getStats();
console.log(`Hits: ${stats.hits}, Misses: ${stats.misses}`);
```

---

### `loadCacheFromDisk()`

Loads persistent cache from disk.

**Returns:** `void`

**Example:**
```typescript
import { loadCacheFromDisk } from 'tehuti-cli/cache';

loadCacheFromDisk();
```

---

### `saveCacheToDisk()`

Saves persistent cache to disk.

**Returns:** `void`

**Example:**
```typescript
import { saveCacheToDisk } from 'tehuti-cli/cache';

process.on('SIGINT', () => {
  saveCacheToDisk();
  process.exit(0);
});
```

---

## API Client

### `StandardAPIClient`

OpenAI-compatible API client (singleton).

**Static Methods:**

#### `getInstance(config: TehutiConfig): StandardAPIClient`
Get or create singleton instance.

#### `resetInstance(): void`
Reset singleton (for testing).

**Instance Methods:**

#### `setMaxTokens(tokens: number): void`
Set maximum output tokens.

#### `streamChat(messages, tools, signal?): AsyncIterable<StreamChunk>`
Stream chat completion response.

**StreamChunk:**
```typescript
type StreamChunk = 
  | { type: 'token'; content: string }
  | { type: 'tool_call'; id: string; name: string; args: string }
  | { type: 'thinking'; content: string }
  | { type: 'usage'; promptTokens: number; completionTokens: number }
  | { type: 'finish'; reason: string };
```

**Example:**
```typescript
import { StandardAPIClient } from 'tehuti-cli/api';

const client = StandardAPIClient.getInstance(config);
client.setMaxTokens(4096);

for await (const chunk of client.streamChat(messages, tools)) {
  if (chunk.type === 'token') {
    process.stdout.write(chunk.content);
  }
}
```

---

## Types

### `AgentContext`

```typescript
interface AgentContext {
  cwd: string;
  workingDir: string;
  messages: StandardMessage[];
  appendOnlyLog: StandardMessage[];
  compactionHistory: CompactionDigest[];
  config: TehutiConfig;
  projectInstructions?: string;
  systemMemoryPromise?: Promise<string>;
  diffPreview?: DiffPreviewOptions;
  companionMode?: boolean;
  sessionId?: string;
  personalityBlockPromise?: Promise<string>;
  readFilesThisSession: Set<string>;
  isSleeping?: boolean;
  injectionQueue: InjectionQueue;
  modelContextLength?: number;
  metadata: {
    startTime: Date;
    sessionCost?: number;
    toolCalls: number;
    tokensUsed: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    filesRead: string[];
    filesWritten: string[];
    commandsRun: string[];
  };
}
```

### `StandardMessage`

```typescript
interface StandardMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentBlock[];
  tool_calls?: StandardToolCall[];
  tool_call_id?: string;
}
```

### `TehutiConfig`

See `src/config/schema.ts` for complete schema.

```typescript
interface TehutiConfig {
  provider?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
  customProvider?: CustomProviderConfig;
  permissions?: PermissionsConfig;
  mcpServers?: Record<string, MCPServerConfig>;
  messaging?: MessagingConfig;
  daemon?: DaemonConfig;
  personality?: PersonalityConfig;
  memory?: MemoryConfig;
  http?: HttpConfig;
  kilocode?: KiloCodeConfig;
  collaboration?: CollaborationConfig;
}
```

---

## Error Handling

### `APIError`

Thrown for API-related errors.

```typescript
class APIError extends Error {
  constructor(message: string);
}
```

### `ToolExecutionError`

Thrown when tool execution fails.

```typescript
class ToolExecutionError extends Error {
  toolName: string;
  constructor(toolName: string, message: string);
}
```

---

## Utility Functions

### `stableStringify(val: unknown): string`

Deterministic JSON serialization (sorted keys).

**Example:**
```typescript
import { stableStringify } from 'tehuti-cli/utils';

const str = stableStringify({ b: 2, a: 1 });
// '{"a":1,"b":2}'
```

---

### `debug(module: string, message: string)`

Namespaced debug logger.

**Example:**
```typescript
import { debug } from 'tehuti-cli/utils';

debug.log('agent', 'Starting agent loop');
```

**Enable via environment:**
```bash
TEHUTI_DEBUG=agent tehuti chat
```

---

## Advanced Usage

### Custom Provider Implementation

```typescript
import { BaseAPIClient } from 'tehuti-cli/api';

class MyProviderClient extends BaseAPIClient {
  async *streamChat(messages, tools, signal) {
    // Implement custom streaming logic
    const response = await fetch(this.baseUrl + '/chat', {
      method: 'POST',
      body: JSON.stringify({ messages, tools }),
      signal,
    });
    
    // Parse and yield chunks
    for await (const chunk of response.body) {
      yield { type: 'token', content: chunk.toString() };
    }
  }
}
```

### Custom Tool with Permission Check

```typescript
import { z } from 'zod';
import { checkPermission } from 'tehuti-cli/permissions';

export const dangerousTool: ToolDefinition = {
  name: 'dangerous_operation',
  description: 'Performs dangerous operation',
  parameters: z.object({ path: z.string() }),
  category: 'system',
  isReadonly: false,
  execute: async (args, ctx) => {
    // Check permission before execution
    const allowed = await checkPermission(ctx, 'dangerous_operation', args);
    if (!allowed) {
      return { success: false, output: 'Permission denied' };
    }
    
    // Execute operation
    return { success: true, output: 'Operation completed' };
  },
};
```

---

## See Also

- [Architecture Documentation](./architecture.md)
- [Troubleshooting Guide](./troubleshooting.md)
- [Contributing Guidelines](../CONTRIBUTING.md)
