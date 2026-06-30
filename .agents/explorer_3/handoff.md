# Handoff Report — Explorer 3 (Milestone 3)

## 1. Observation

- **Tool Registry State**: In `src/agent/tools/registry.ts`, the registry is declared as:
  ```typescript
  const toolRegistry = new Map<string, ToolDefinition>();
  ```
- **Execution & Validation**: In `src/agent/tools/registry.ts` (lines 146-163):
  ```typescript
  const parsed = tool.parameters.safeParse(args);
  if (!parsed.success) { ... }
  const result = await tool.execute(parsed.data, ctx);
  ```
- **Dynamic Tool Registration**: In `src/agent/index.ts` (lines 154-169) inside `syncMCPToolRegistry()`:
  ```typescript
  const dynamicTools = mcpManager.getAllTools().map(({ serverName, tool }) =>
      createMCPToolDefinition(serverName, tool, async (args) =>
          mcpManager.executeTool(serverName, tool.name, ...)
      )
  );
  if (dynamicTools.length > 0) {
      registerTools(dynamicTools);
  }
  ```
- **MCP Tool Definition Parameter Configuration**: In `src/mcp/tool-adapter.ts` (lines 84-85) within `createMCPToolDefinition()`:
  ```typescript
  parameters: z.object({}).passthrough(),
  jsonSchema: normalizeMCPInputSchema(tool.inputSchema),
  ```
- **Model Parameters Mapping**: In `src/agent/tools/registry.ts` (lines 115-124) inside `getToolDefinitions()`:
  ```typescript
  const schema = tool.jsonSchema ?? zodToJsonSchema(tool.parameters);
  ```
- **Default Permissions Rules**: In `src/permissions/rules.ts` (lines 3-31), `PERMISSION_RULES` are structured around fixed categories:
  ```typescript
  export const PERMISSION_RULES = {
      fs: { ... },
      bash: { ... },
      web: { ... },
      mcp: { ... },
      git: { ... },
  } as const;
  ```

---

## 2. Logic Chain

1. **Registry Scope**: From the observation that `toolRegistry` is a module-level `Map`, it is global. Spawning multiple agent instances or sub-agents concurrently with isolated/different toolsets is not supported, as they will all read and mutate the same shared global map.
2. **Schema Validation**: In `executeTool`, argument validation relies strictly on `tool.parameters.safeParse(args)`. For dynamic tools like MCP tools, `parameters` is defined as a passthrough Zod object (`z.object({}).passthrough()`). Therefore, the schema-level validation is skipped on the client-side for dynamic tools, and schema mismatch errors are only raised at the remote server runtime.
3. **Lifecycle Management**: The `ToolDefinition` lacks standard hook methods (such as `onRegister`/`init` and `onUnregister`/`cleanup`). Dynamic tools that acquire persistent system resources (tunnels, socket connections, stdio file streams) do not have a standard mechanism to clean up after themselves.
4. **Tool Loading & Custom Category Boundaries**: Standard categories are hardcoded. Also, there is no generic directory scanner or configuration parser that dynamically loads external ESM files/packages as tools into the system.

---

## 3. Caveats

- We assumed that AJV is acceptable as a dependency for parsing standard JSON Schema schemas if introduced. A lightweight fallback validator could also be written manually to avoid adding extra npm dependencies.
- We did not deep dive into the network communication of external MCP servers since it is managed by `@modelcontextprotocol/sdk`.

---

## 4. Conclusion

We conclude that refactoring the registry into a class-based `ToolRegistryManager` which handles both Zod and JSON Schema validation natively, executes standard lifecycle hooks on registration/unregistration, scans configured local directories for custom JS/TS tool modules, and isolates tool execution in VM contexts is highly feasible and will fully satisfy the dynamic requirements of Milestone 3.

---

## 5. Verification Method

To verify the state of the project:
1. Run the test suite:
   ```bash
   npm test
   ```
2. Verify that all 527 tests successfully pass.
3. Inspect `analysis.md` and `handoff.md` inside `.agents/explorer_3/` directory.
