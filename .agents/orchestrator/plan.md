# Project Plan: Tehuti CLI Architectural and Visual Overhaul

## Architecture & Code Layout
- Core entry: `src/index.ts`
- Agent Loop: `src/agent/index.ts`
- TUI / Chat command: `src/cli/commands/chat.ts`
- Tools: `src/agent/tools/`
- API client: `src/api/openrouter.ts`

## Milestones

### 1. E2E Testing Track (E2E Testing Orchestrator)
- **Objective**: Design and build a comprehensive, opaque-box, requirement-driven E2E test suite covering Tiers 1-4.
- **Dependencies**: None.
- **Output**: `TEST_INFRA.md`, E2E test cases, and `TEST_READY.md`.
- **Status**: PLANNED.

### 2. Agent Core Hardening (Implementation Track)
- **Objective**: Harden the agent execution engine, parallel executor, context compressor, prefetcher, and autonomous memory management.
- **Dependencies**: None.
- **Output**: Hardened core implementation files, verified unit tests.
- **Status**: PLANNED.

### 3. Advanced Tooling Ecosystem (Implementation Track)
- **Objective**: Expand the native tool suite with AST parsing and semantic search, registering them cleanly via the dynamic tools registry.
- **Dependencies**: None (can run in parallel or sequentially after Milestone 2).
- **Output**: Advanced tooling implementation, dynamic registry registration, unit tests.
- **Status**: PLANNED.

### 4. Visual Excellence & TUI Polish (Implementation Track)
- **Objective**: Upgrade the React/Ink TUI in `src/cli/commands/chat.ts` with polished Virtual Sliding Viewport, smooth micro-animations, improved gold/obsidian color palette, and input clash prevention.
- **Dependencies**: None.
- **Output**: Polished TUI implementation, UI unit/integration tests.
- **Status**: PLANNED.

### 5. Final Integration & E2E/Adversarial Hardening (Implementation Track)
- **Objective**: Pass 100% of the E2E test suite (Tiers 1-4), then generate adversarial test cases (Tier 5) to verify correctness and find coverage gaps.
- **Dependencies**: Milestone 1 (needs `TEST_READY.md`), Milestones 2, 3, and 4.
- **Output**: 100% E2E test pass, completed adversarial hardening, clean Forensic Auditor verdict.
- **Status**: PLANNED.

## Directory Strategy (under .agents/)
- E2E Testing Orchestrator: `.agents/teamwork_preview_e2e_orch`
- Implementation Orchestrator (sub-orchestrator): `.agents/teamwork_preview_impl_orch`
- Working subagent directories will be spawned under these orchestrators according to the subagent naming convention.
