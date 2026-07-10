# 𓆣 Contributing to Tehuti CLI

Thank you for your interest in contributing to Tehuti CLI! We welcome all contributions, from bug reports to feature additions.

## 📜 Code of Conduct

Please note that this project is released with a [Contributor Code of Conduct](CODE_OF_CONDUCT.md). By participating in this project you agree to abide by its terms.

## 🐛 Reporting Issues

### Bug Reports

When reporting bugs, please include:
- A clear, descriptive title
- A detailed description of the issue
- Steps to reproduce the bug
- Expected behavior
- Actual behavior
- Screenshots (if applicable)
- Environment information (Node.js version, OS, etc.)

### Feature Requests

For feature requests, please include:
- A clear, descriptive title
- A detailed description of the feature
- Use case examples
- Any relevant screenshots or mockups
- Why this feature would benefit the project

## 🔧 Development Setup

### Prerequisites

- Node.js 20+
- npm 8+
- Git

### Fork and Clone

1. Fork the repository on GitHub
2. Clone your fork locally:
   ```bash
   git clone https://github.com/your-username/tehuti-cli.git
   cd tehuti-cli
   ```

3. Add the upstream repository:
   ```bash
   git remote add upstream https://github.com/The-Osiris-Labs/Tehuti-CLI.git
   ```

### Installation

```bash
npm install
```

### Development Scripts

```bash
npm start          # Run via tsx (no build)
npm run build      # tsup → dist/index.js (~652 KB)
npm test           # Unit tests (src/**/*.test.ts) — 570 pass, 2 skip
npm run test:e2e   # E2E tests (tests/e2e/) — 105 pass, 1 known fail
npm run typecheck  # tsc --noEmit
npm run lint       # biome check src/
```

### Running Tests

```bash
# Unit tests
npm test

# E2E tests (isolated temp homes, mocked API)
npm run test:e2e

# Full gate (recommended before PR)
npm run typecheck && npm test && npm run test:e2e && npm run build

# Specific test file
npx vitest run src/agent/index.test.ts

# Watch mode
npx vitest watch
```

See [TEST_INFRA.md](./TEST_INFRA.md) and [TEST_READY.md](./TEST_READY.md) for tier architecture and known failures.

## 🎯 Pull Request Process

1. Create a new branch from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make your changes
3. Ensure your code passes all tests and linting:
   ```bash
   npm run lint
   npm test
   ```

4. Commit your changes with a meaningful commit message:
   ```bash
   git add .
   git commit -m "feat: add amazing feature" -m "Description of what the feature does"
   ```

5. Push your branch to your fork:
   ```bash
   git push origin feature/your-feature-name
   ```

6. Create a pull request on GitHub

### Pull Request Guidelines

- PRs should be focused on a single feature or bug fix
- Include tests for new functionality
- Follow the existing code style
- Update documentation if necessary
- Keep PR descriptions clear and concise
- Link related issues in the PR description

## 📝 Code Style Guidelines

### General

- Use TypeScript with strict type checking
- Follow ESM module syntax
- Keep functions small and focused
- Write clear, descriptive variable and function names

### Formatting

- Use Biome for linting and formatting
- Run `npm run lint` before committing
- Biome configuration is in `biome.json`

### Testing

- Write tests for all new functionality
- Use Vitest for testing
- Tests should be in `*.test.ts` files alongside source files
- Aim for high test coverage

## 🏗️ Architecture Overview

Tehuti is a TypeScript-only Node.js agent CLI. Default API target is OpenCode Go (`opencode` provider). The HTTP layer is OpenAI-compatible (`/chat/completions` + SSE) via custom clients in `src/api/` — not the Vercel AI SDK.

**Important:** `src/cli/commands/chat.ts` is a monolith (~3,700 lines) containing CLI routing, the Ink TUI, and much agent integration. Read [HANDOFF.md](./HANDOFF.md) before editing it.

### Core Modules

| Module | Role |
|--------|------|
| `agent/` | Agent loop, self-healing loop, swarm manager, memory graph, skills |
| `api/` | Provider clients (`standard-client.ts` is the generic OpenAI-compatible client) |
| `cli/` | Commander entry + Ink TUI (`commands/chat.ts`) |
| `config/` | Schema, loader, wizard, provider metadata |
| `daemon/` | Background server (`server.ts`), IPC socket, and client |
| `messaging/` | Webhook/socket connectors for Slack, Discord, Telegram, WhatsApp |
| `mcp/` | MCP client (4 transports) + dynamic tool adapter |
| `permissions/` | Interactive/trust/readonly tool gates |
| `hooks/` | Pre/Post tool bash hooks (executor works; config wiring incomplete) |
| `session/` | Atomic session save/load to `~/.tehuti/sessions/` |
| `terminal/` | ANSI output, markdown tables, `computeMessageLines` |
| `branding/` | Egyptian theme constants (visual only) |

### Agent Loop

Orchestrated in `src/agent/loop/runner.ts` (exported via `src/agent/index.ts`):

- Stream LLM response, accumulate tool calls
- Deterministic context compression near ~85% window (array truncation)
- Permission checks, hooks, tool cache
- Parallel safe read-only tools when the model returns multiple calls in one turn
- Speculative worktree testing (`loop/self-healing.ts`)
- Prefetch on first tool call in each batch

### Tool System

Tools are registered at module load in `src/agent/index.ts` via `registerTools([...])`. MCP tools sync each loop iteration.

```typescript
import { z } from "zod";
import type { ToolDefinition } from "./registry.js";

export const myTool: ToolDefinition = {
	name: "my_tool",
	description: "What the tool does",
	parameters: z.object({
		param1: z.string().describe("Parameter description"),
	}),
	category: "fs",
	isReadonly: true,
	execute: async (args, ctx) => ({
		success: true,
		output: "Result",
	}),
};
```

New tools: add to `src/agent/tools/`, export, register in `src/agent/index.ts`, add tests alongside the module.

## 🎨 Visual Theme Guidelines

Tehuti uses an Egyptian-inspired visual theme:

### Color Palette

| Color | Hex | Usage |
|-------|-----|-------|
| Gold | `#D4AF37` | Primary accent (Tehuti brand) |
| Sand | `#C2B280` | Secondary text, subtle elements |
| Coral | `#D97757` | User messages, prompts |
| Green | `#10B981` | Assistant responses |
| Nile | `#2E5A6B` | Subtle accents |
| Obsidian | `#1A1A2E` | Backgrounds |

### Hieroglyphic Symbols

| Symbol | Unicode | Usage |
|--------|---------|-------|
| 𓆣 | U+131A3 | Ibis (Tehuti symbol) |
| 𓁹 | U+13075 | Eye of Ra (visibility) |
| 𓂀 | U+13080 | Eye of Horus (errors) |
| 𓋹 | U+13269 | Ankh (success) |
| 𓏛 | U+1331B | Scroll (input/docs) |
| 𓆄 | U+13184 | Feather (user messages) |
| 𓂝 | U+13009 | Arm (navigation) |
| 𓊖 | U+13296 | Basket (lists) |

## 📚 Documentation

- Update README.md for user-facing changes
- Update AGENTS.md for agent behavior changes
- Add JSDoc comments for new public APIs
- Keep documentation clear and concise

## 🔄 Release Process

1. Update version in package.json
2. Create a release commit
3. Create a GitHub release
4. Publish to npm

## 💬 Communication

- For questions: Open an issue
- For discussions: Use GitHub Discussions
- For urgent issues: Contact maintainers directly

## 📄 License

By contributing to Tehuti CLI, you agree that your contributions will be licensed under the MIT License.

---

Thank you for your contributions! May Tehuti's wisdom guide your coding journey. 📜✨