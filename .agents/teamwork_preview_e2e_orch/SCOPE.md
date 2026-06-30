# Scope: E2E Test Suite Implementation

## Architecture
- Opaque-box, requirement-driven testing. The E2E test suite will reside in `tests/e2e/` and will execute tests using a custom Vitest configuration `vitest.e2e.config.ts`.
- The tests will exercise the Tehuti CLI entry points and CLI command execution, as well as simulated agent loops, verifying correct behavior for all 8 core features.
- A test helper utility will spawn the built CLI executable or import components in a headless/mocked environment to assert correct outputs, cache behaviors, parallel executions, and scrolling margin updates.

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | Test Infra Setup | Choose/configure test runner (`vitest.e2e.config.ts`), implement E2E CLI test runner wrapper, mock API layer (OpenRouter/OpenCode Go) for deterministic responses, and verify a baseline passing test. | None | DONE |
| 2 | Tier 1 Feature Coverage | Implement Tier 1 tests: >=5 tests per feature (F1-F8), verifying happy-paths, output correctness, parallel execution, compression trigger, prefetching, memory prompt insertion, command palette fuzzy search, viewport scrolling, and config editing. Total >= 40 tests. | M1 | DONE |
| 3 | Tier 2 Boundary & Corner Cases | Implement Tier 2 tests: >=5 tests per feature (F1-F8), verifying edge cases, invalid inputs, network timeouts/retries, context window overflows, memory graph corruption, command palette bounds, config editor validation, and AST parsing errors. Total >= 40 tests. | M2 | DONE |
| 4 | Tiers 3-4 Cross-Feature & Real-World Scenarios | Implement Tier 3 tests (>=8 pairwise feature interactions) and Tier 4 tests (>=5 real-world workloads like greenfield project generation, refactoring, and debug runs). Publish `TEST_INFRA.md` and `TEST_READY.md`. Verify total test count >= 93. | M3 | IN_PROGRESS |

## Interface Contracts
### E2E Test Runner ↔ Tehuti CLI
- **Inputs**: CLI arguments, standard input mock streams, environment variables (`OPENROUTER_API_KEY`, etc.), `.tehuti.json` mock files.
- **Outputs**: Exit codes, stdout/stderr streams, cached file changes, state modifications in `.tehuti/` directories.
