## Challenge Summary

**Overall risk assessment**: LOW

The E2E test suite for Tehuti CLI is exceptionally stable. It passed 5 consecutive runs with a 105/105 pass rate without any race conditions or test failures. Config isolation was verified to be fully functional; no files or directories under the user's real home folders (`~/.tehuti` and `~/.config/tehuti-cli`) were modified during the E2E test runs. 

However, two structural vulnerabilities in the E2E test harness and one console warning were discovered that could pose risks under future modifications or concurrency.

---

## Challenges

### [Medium] Challenge 1: Shared Module-Scoped Temp Directory Vulnerable to Test Concurrency

- **Assumption challenged**: Individual test blocks in a test suite file run completely sequentially, ensuring that the module-level temporary folder `TEST_HOME` is created and deleted without overlaps.
- **Attack scenario**: If any developer converts test blocks to concurrent execution (using `it.concurrent` or `describe.concurrent` in Vitest) or leaves an asynchronous process running beyond the test's lifetime, one test's `cleanup()` call will delete the shared `TEST_HOME` folder while another concurrent test in the same file is actively relying on it.
- **Blast radius**: Severe flakiness and race conditions within the same test file, causing tools and config loaders to crash due to missing folders/configs.
- **Mitigation**: Instead of defining `TEST_HOME` as a module-scoped constant in `e2e-helper.ts`, `setupE2EEnvironment` should generate a unique home folder for each invocation, returning the specific path to be cleaned up individually, rather than using a single shared directory per file.

### [Medium] Challenge 2: Escaping OS Mocks via Child Process Spawning

- **Assumption challenged**: The CLI will only be tested in-process using `program.parseAsync()`, so mocking `node:os`'s `homedir()` via Vitest's `vi.mock` is sufficient to isolate the home folder.
- **Attack scenario**: If a new E2E test is added that spawns the CLI in a separate process (e.g. `execSync("node dist/index.js")` to test CLI entry points or installer scripts), the child process will bypass the Vitest `vi.mock` environment. It will resolve the real `os.homedir()` and read/write directly to the developer's actual `~/.tehuti.json` and `~/.tehuti` directory.
- **Blast radius**: Complete breakdown of config isolation during child-process tests, polluting or deleting the user's real configuration and session database.
- **Mitigation**: Standardise that any shell-based E2E commands must be wrapped with environment variables (e.g. `TEHUTI_HOME` and `TEHUTI_CONFIG_DIR`) explicitly passed to the spawn environment. Add a check in `src/index.ts` to throw an error if running in test mode without these env vars.

### [Low] Challenge 3: React Key Duplication warning in Command Palette UI

- **Assumption challenged**: The Command Palette TUI components manage React element keys uniquely.
- **Attack scenario**: During normal Command Palette rendering/filtering in tests, the React developer builds output a warning: `Encountered two children with the same key...`.
- **Blast radius**: Possible duplicate renderings, misplaced list navigation highlights, or unexpected cursor behaviors in the TUI when users scroll through items.
- **Mitigation**: Ensure all mapped components in `CommandPalette.tsx` and related components use a unique, deterministic combination of item name and index as their React `key`.

---

## Stress Test Results

- **Consecutive E2E Run 1** → All 105 tests pass successfully (Duration: 6.48s) → PASS
- **Consecutive E2E Run 2** → All 105 tests pass successfully (Duration: 7.28s) → PASS
- **Consecutive E2E Run 3** → All 105 tests pass successfully (Duration: 5.68s) → PASS
- **Consecutive E2E Run 4** → All 105 tests pass successfully (Duration: 5.78s) → PASS
- **Consecutive E2E Run 5** → All 105 tests pass successfully (Duration: 5.70s) → PASS
- **Config Isolation Check** → Checked modification times of `~/.tehuti` and `~/.config/tehuti-cli` files; none were modified since the test suite started (last modification remains at `07:37:29Z`) → PASS

---

## Unchallenged Areas

- **Real API/Network integration** — Out of scope. The E2E tests correctly mock out all network requests to the OpenRouter/OpenCode API via `enqueueMockResponse`. Real network latency, timeouts, and rate limits are not stress-tested in this suite.
- **MCP Server process management** — Not challenged. Testing interaction with external MCP servers relies on mock configurations and is not fully executed end-to-end with real running MCP processes in the test suite.
