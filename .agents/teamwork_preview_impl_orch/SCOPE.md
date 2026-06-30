# Scope: Implementation Track

## Architecture
- **Agent Core**: Includes the main chat loop (`runner.ts`), `parallel-executor.ts`, `context-compressor.ts`, `prefetcher.ts`, and `memory/graph.ts`.
- **Ecosystem of Tools**: Includes AST parsing (`src/agent/tools/ast.ts`), semantic search (`src/agent/tools/semantic.ts`), and registry updates.
- **TUI (Terminal User Interface)**: Ink React UI (`src/cli/commands/chat.ts`) featuring the virtual sliding viewport, CommandPalette, and input handling.

## Milestones
| # | Name | Scope | Dependencies | Status | Conversation ID |
|---|------|-------|-------------|--------|-----------------|
| 2 | Agent Core Hardening | execution engine, parallel executor, context compressor, prefetcher, memory management | none | DONE | e5f4fb29-4024-450a-81f5-f19e5a860e49, 4b6a4b72-a89a-4c40-9e65-a0ea8fdb650c, 2feb817c-7131-4db4-aee6-68af4f627a43, 525003a5-9581-428d-900e-b3d284c3a449, 87daf85e-8542-4d95-b853-96b9cd0048f3, 7558fd17-4572-4db4-9933-7affbe26d38e, 076a9ffd-173d-46e3-b173-19d126fa488e, bdc4e426-7ff5-4e88-8b35-4538230cf426, 77d5220f-26ae-4b4f-9a6b-8d2d6fd574c0, 430e760e-ac6e-44a5-9876-bfb18f82078a |
| 3 | Advanced Tooling Ecosystem | AST parsing, semantic search, dynamic tools registry | M2 | DONE | 4f2f3397-f8e3-4c31-bef5-e160c9d5807d, 2b754bbc-17fe-4688-9430-1291dc6a517c, ccf9e590-9db9-4cef-9258-d7a254badb26, b87a99ae-b28c-4ac3-b666-189d01b7643e, b3d9be27-bd3e-41a3-b478-e1a79f52ed70, 60670909-ee55-4bb8-b81e-031b719ad071 |
| 4 | Visual Excellence & TUI Polish | sliding viewport, micro-animations, color palette, input clash prevention | M2 | IN_PROGRESS | 11d0e8fa-42ca-4c42-ab02-d3447cd16cf2, 127c5b98-41c0-45a2-8737-58ea653a91d0, 343fa9ff-dae9-45e1-b132-6aac7cf11b91, 077b9e56-6f29-4bcb-be69-11e34f8fdad9, 76bdb740-cc19-4595-8fba-99611a8fdb16, 5eeeeb5e-4bf0-466b-b003-06e28e4cd3e1, 3613d3fd-598e-4559-8374-b6de16f21b3f, 165d6a2c-0fe0-49ef-88e2-dc6e74e7becc |
| 5 | Final Integration & Adversarial Hardening | E2E test suite integration (Tier 1-4) & adversarial hardening (Tier 5) | M2, M3, M4 | PLANNED | TBD |

## Interface Contracts
- **Parallel Executor**: Returns `Promise<ToolResult[]>` for batch execution, with type safety for read-only vs write actions.
- **Context Compressor**: Compresses context at 85k capacity, returns token counts and compressed context messages.
- **AST Parsing Tool**: Interface for file symbol analysis, returning structures (classes, interfaces, functions, methods).
- **Semantic Search Tool**: Interface for indexing and querying codebase semantics.
- **TUI Viewport**: Rendering margins computed based on message sizes to avoid viewport overflows.
