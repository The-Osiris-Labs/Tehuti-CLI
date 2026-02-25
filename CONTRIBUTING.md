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
npm start          # Run development version
npm run build      # Build for production
npm test           # Run all tests
npm run lint       # Lint code with Biome
npx tsc --noEmit   # Type check
```

### Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npx vitest run src/agent/index.test.ts

# Run tests in watch mode
npx vitest watch

# Generate coverage report
npx vitest run --coverage
```

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

Tehuti CLI follows a modular architecture with clear separation of concerns:

### Core Modules

- **agent/** - AI agent and tools
- **api/** - OpenRouter API client
- **cli/** - CLI commands and UI
- **config/** - Configuration management
- **branding/** - Egyptian visual theme
- **permissions/** - Permission system
- **mcp/** - MCP integration
- **hooks/** - Hook execution system
- **terminal/** - Terminal utilities
- **session/** - Session persistence
- **utils/** - Utility functions

### Agent Loop

The main agent loop is in `src/agent/index.ts` and handles:
- Context management
- Parallel tool execution
- Model routing
- Context compression
- Caching
- Prefetching

### Tool System

Tools are registered in `src/agent/tools/` and follow this pattern:

```typescript
import { z } from "zod";
import type { OpenRouterTool } from "../api/openrouter.js";

export const myTool: OpenRouterTool = {
	name: "my_tool",
	description: "Description of what the tool does",
	parameters: z.object({
		param1: z.string().describe("Description of parameter"),
	}),
	execute: async (args, context) => {
		// Tool implementation
		return {
			success: true,
			output: "Result",
		};
	},
};
```

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