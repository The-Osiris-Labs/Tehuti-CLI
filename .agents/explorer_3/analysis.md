# Dynamic Tools Registry Analysis & Design Proposal

This report explores the design and architecture of a **Dynamic Tools Registry** for Tehuti CLI, allowing registering, listing, validating, and loading tools dynamically (such as MCP-based servers, user-defined plugins, and runtime-loaded tools).

---

## 1. Analysis of Current Implementation

### 1.1 Core Registry Architecture
The current tool registry is defined in `src/agent/tools/registry.ts`.
- **Registry Storage**: Stored in a module-scoped private map:
  ```typescript
  const toolRegistry = new Map<string, ToolDefinition>();
  ```
- **Registration**: Done at startup inside `src/agent/index.ts` by compiling all built-in tool categories (file system, search, bash, web, system, etc.) and calling:
  ```typescript
  registerTools([...allFsTools, ...searchTools, ...]);
  ```
- **Execution Flow**: Inside `executeTool(name, args, ctx)`, the registry looks up the tool, validates parameters using the Zod schema (`tool.parameters.safeParse(args)`), and runs the `execute` method under a Try-Catch block.

### 1.2 Integration with the Agent Loop
The agent loop (`src/agent/loop/runner.ts` and `src/agent/loop/tool-processing.ts`) interacts with the registry as follows:
- **Registry Synchronization**: Before starting the LLM completion request, `syncMCPToolRegistry()` is called. It retrieves all tools from the `mcpManager` (which interfaces connected MCP servers), maps them to `ToolDefinition` objects, and updates the registry by deleting existing MCP tools and inserting the refreshed ones.
- **Model Exposure**: All active tools are retrieved via `getToolDefinitions()` (mapped to OpenRouter compatible schemas) and sent to the LLM client.
- **Execution & Security**: The runner parses the LLM's requested tool calls, evaluates them against the **Firewall Policy** (`checkFirewallPolicy` for malicious patterns), checks interactive permissions (`checkPermission`), triggers **Lifecycle Hooks** (`PreToolUse` and `PostToolUse` via `hookExecutor`), checks cache hits, and executes the tools.

### 1.3 Gaps & Limitations Identified
1. **Module-Scoped Private State**:
   The registry is bound to a single global module scope. This makes it impossible to spawn multiple independent agents or sub-agents with different tool configurations, and presents test-isolation challenges.
2. **Schema-Level Validation Gap for Dynamic Tools**:
   Zod is the primary schema provider. Dynamic tools (such as MCP tools or JSON-defined user plugins) are defined at runtime and cannot easily compile to TypeScript Zod schemas. Currently, Tehuti works around this by using a Zod passthrough `z.object({}).passthrough()` combined with a custom `jsonSchema` property. This means parameter validation is bypassed at the CLI layer for dynamic tools, delegating error detection entirely to execution runtime.
3. **Lack of Lifecycle Hooks**:
   There are no standard registry lifecycle hooks (such as `onRegister`/`init` and `onUnregister`/`cleanup`) for individual tools. Dynamic tools might allocate persistent resources (like opening child process streams, DB pools, or socket connections) that need graceful cleanup.
4. **Rigid Categories**:
   `ToolDefinition["category"]` uses a hardcoded union type (`"fs" | "bash" | "web" | "mcp" | "system" | "git" | "search" | "development"`). Dynamic/user-defined tools are forced to fit into these static categories.
5. **No Sandbox Isolation for Dynamic Plugins**:
   Dynamic or user-defined tools execute directly inside the main Node.js process without any sandboxing or isolate protection, exposing the host system to potential vulnerabilities if a loaded tool executes dangerous code.
6. **No Namespace/Conflict Resolution**:
   If a newly loaded tool shares the same name as an existing tool, the registry simply overwrites it with a warning. There is no namespacing structure (e.g. `user::my_tool` vs `mcp::my_tool`).

---

## 2. Design Proposal: Dynamic Tools Registry

To address the limitations, we propose refactoring the tool registry into a modular, lifecycle-aware, and schema-agnostic registry system.

### 2.1 The Dynamic Tool Registry Architecture

```
┌───────────────────────────────────────────────────────────────────────────┐
│                          ToolRegistryManager                              │
│                                                                           │
│  ┌────────────────────────┐  ┌────────────────────┐  ┌─────────────────┐  │
│  │     Global Registry    │  │  Session Registry  │  │  Agent Registry │  │
│  └────────────────────────┘  └────────────────────┘  └─────────────────┘  │
└─────────────────────────────────────┬─────────────────────────────────────┘
                                      │
                                      ▼
                        ┌───────────────────────────┐
                        │   Unified Validation      │
                        │ (Zod & JSON Schema/AJV)   │
                        └─────────────┬─────────────┘
                                      │
                                      ▼
      ┌───────────────────────────────┼───────────────────────────────┐
      │                               │                               │
      ▼                               ▼                               ▼
┌──────────────┐              ┌───────────────┐              ┌────────────────┐
│ Native Tools │              │   MCP Tools   │              │ Dynamic Plugins│
│ (Zod Schemas)│              │ (JSON Schemas)│              │  (Sandboxed)   │
└──────────────┘              └───────────────┘              └────────────────┘
```

### 2.2 Proposed Interface Extensions

We will expand `ToolDefinition` and introduce `DynamicToolDefinition` to support unified validation and lifecycle hooks:

```typescript
import { z } from "zod";

export interface LifecycleHooks {
  /** Called when the tool is added to the registry */
  onRegister?: (ctx: ToolContext) => Promise<void> | void;
  /** Called when the tool is removed or during agent shutdown */
  onUnregister?: (ctx: ToolContext) => Promise<void> | void;
}

export interface DynamicToolDefinition extends LifecycleHooks {
  name: string;
  description: string;
  category: string; // Dynamic categories allowed
  
  // Support both validation schemas
  parameters?: z.ZodType<unknown>;
  jsonSchema?: Record<string, unknown>;
  
  requiresPermission?: boolean;
  isReadonly?: boolean;
  
  execute: (args: unknown, ctx: ToolContext) => Promise<ToolResult>;
  
  // Execution constraints
  sandbox?: {
    enabled: boolean;
    allowedModules?: string[];
  };
}
```

### 2.3 Proposed Registry Manager (`ToolRegistryManager`)

A class-based registry manager enables scoped registration (e.g. for sub-agents) and proper cleanup:

```typescript
export class ToolRegistryManager {
  private tools = new Map<string, DynamicToolDefinition>();
  private context: ToolContext;

  constructor(context: ToolContext) {
    this.context = context;
  }

  public async register(tool: DynamicToolDefinition): Promise<void> {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool collision: A tool named "${tool.name}" is already registered.`);
    }

    this.tools.set(tool.name, tool);
    if (tool.onRegister) {
      await tool.onRegister(this.context);
    }
  }

  public async unregister(name: string): Promise<boolean> {
    const tool = this.tools.get(name);
    if (!tool) return false;

    if (tool.onUnregister) {
      await tool.onUnregister(this.context);
    }
    return this.tools.delete(name);
  }

  public get(name: string): DynamicToolDefinition | undefined {
    return this.tools.get(name);
  }

  public list(): DynamicToolDefinition[] {
    return Array.from(this.tools.values());
  }

  public async clear(): Promise<void> {
    for (const name of this.tools.keys()) {
      await this.unregister(name);
    }
  }
}
```

### 2.4 Unified Schema-Agnostic Parameter Validation

To validate arguments without requiring Zod wrappers for dynamic tools, the registry will inspect both Zod and JSON Schema definitions:

```typescript
import Ajv from "ajv"; // For JSON Schema validation

const ajv = new Ajv({ allErrors: true });

export function validateToolArgs(
  tool: DynamicToolDefinition,
  args: unknown
): { success: boolean; data: any; errors?: string[] } {
  // 1. Zod Validation (Preffered if parameters is defined)
  if (tool.parameters) {
    const parsed = tool.parameters.safeParse(args);
    if (!parsed.success) {
      const errors = parsed.error.issues.map(
        (issue) => `${issue.path.join(".") || "value"}: ${issue.message}`
      );
      return { success: false, data: args, errors };
    }
    return { success: true, data: parsed.data };
  }

  // 2. JSON Schema Validation
  if (tool.jsonSchema) {
    const validate = ajv.compile(tool.jsonSchema);
    const valid = validate(args);
    if (!valid) {
      const errors = validate.errors?.map(
        (err) => `${err.instancePath || "value"}: ${err.message}`
      ) ?? ["Invalid JSON Schema parameters"];
      return { success: false, data: args, errors };
    }
    return { success: true, data: args };
  }

  // 3. Fallback: No validation schema defined
  return { success: true, data: args };
}
```

### 2.5 Dynamic Plugin Loader

A plugin loader system will locate, validate, and load external JavaScript/TypeScript files as tools.

- **Dynamic Loading Convention**:
  Tehuti will scan configured plugin directories (e.g. `~/.tehuti/tools/` and `./.tehuti/tools/`) for files matching `*.tool.js` or `*.tool.ts`.
- **Dynamic Imports**:
  ```typescript
  import path from "path";
  import fs from "fs/promises";

  export class DirectoryToolLoader {
    public static async loadFromDirectory(
      dirPath: string,
      registry: ToolRegistryManager
    ): Promise<void> {
      try {
        const files = await fs.readdir(dirPath);
        for (const file of files) {
          if (file.endsWith(".tool.js") || file.endsWith(".tool.ts")) {
            const fullPath = path.join(dirPath, file);
            const module = await import(fullPath);
            
            if (module.default && typeof module.default === "object") {
              const tool = module.default as DynamicToolDefinition;
              await registry.register(tool);
            }
          }
        }
      } catch (err) {
        console.error(`Failed to load tools from directory: ${dirPath}`, err);
      }
    }
  }
  ```

### 2.6 Sandboxed Code Execution (Execution Constraints)

For untrusted user-defined tools, we propose wrapping their execution block in a V8 isolate (e.g. using `isolated-vm` or Node's `vm` module) to restrict access to system resources.

```typescript
import vm from "vm";

export async function executeSandboxed(
  tool: DynamicToolDefinition,
  args: unknown,
  ctx: ToolContext
): Promise<ToolResult> {
  const code = `
    const execute = ${tool.execute.toString()};
    execute(args, ctx);
  `;

  // Create isolated context with limited globals (no fs, child_process, process)
  const sandboxContext = vm.createContext({
    args,
    ctx: {
      cwd: ctx.cwd,
      workingDir: ctx.workingDir,
      timeout: ctx.timeout,
    },
    console: {
      log: (...args: any[]) => console.log("[Sandbox Log]", ...args),
    },
  });

  const script = new vm.Script(code);
  
  // Run with time-limit to prevent infinite loops
  return script.runInContext(sandboxContext, { timeout: ctx.timeout });
}
```

---

## 3. Summary of Benefits

1. **Scoped Execution**: Spawning multiple instances of `ToolRegistryManager` allows isolating sub-agents or parallel chats with different sets of active tools.
2. **Robust Validation**: Guarantees parameters for MCP and user plugins are validated on-client *before* sending payload over stdio/HTTP transports.
3. **Clean Resource Control**: Auto-cleanup of background tasks, tunnels, and child processes via standard lifecycle hooks on process shutdown or unregistration.
4. **Enhanced Security**: Isolation bounds (sandboxing) ensure that third-party shared plugins cannot execute arbitrary shell utilities or modify files outside authorized project boundaries.
