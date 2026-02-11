# Contributing to Project Tehuti

Thank you for your interest in contributing to Tehuti! This document provides guidelines for contributing to the project.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [How to Contribute](#how-to-contribute)
- [Code Style](#code-style)
- [Testing](#testing)
- [Pull Request Process](#pull-request-process)

## Code of Conduct

Be respectful and constructive in all interactions. We welcome contributors from all backgrounds and experience levels.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone <your-fork-url>`
3. Create a branch: `git checkout -b feature/your-feature-name`

## Development Setup

```bash
# Clone the repository
git clone https://github.com/yourusername/project-tehuti.git
cd project-tehuti

# Create virtual environment
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Install in development mode
pip install -e ".[dev]"

# Install test dependencies
pip install pytest pytest-asyncio
```

## How to Contribute

### Reporting Bugs

Before creating a bug report:
1. Check if the issue already exists
2. Try to reproduce with the latest version

When reporting bugs, include:
- Python version
- Operating system
- Steps to reproduce
- Expected vs actual behavior
- Error messages (if any)

### Suggesting Features

Feature requests are welcome! Please:
1. Describe the feature clearly
2. Explain the use case
3. Provide examples if possible

### Adding Tools

To add a new tool:

1. Add tool definition to `src/tehuti_cli/core/tools.py`:
```python
self._tools["my_tool"] = ToolSpec("my_tool", "Description", "builtin")
```

2. Implement tool logic in `src/tehuti_cli/advanced_tools.py`:
```python
def my_tool(self, param: str) -> ToolResult:
    """Tool description."""
    try:
        result = do_something(param)
        return ToolResult(True, result)
    except Exception as exc:
        return ToolResult(False, str(exc))
```

3. Add execution case in `src/tehuti_cli/core/runtime.py`:
```python
case "my_tool":
    return self.advanced.my_tool(args.get("param"))
```

4. Add tests in `tests/test_tehuti.py`

5. Update documentation

## Code Style

We use:
- **Ruff** for linting
- **Black** for formatting (optional)
- **Type hints** for all functions

Run linting:
```bash
ruff check src/
```

## Testing

All contributions should include tests:

```bash
# Run all tests
pytest tests/ -v

# Run specific test
pytest tests/test_tehuti.py::TestTools -v

# Run with coverage
pytest tests/ --cov=tehuti_cli --cov-report=html
```

### Writing Tests

Test file template:
```python
class TestFeature:
    """Test feature description."""
    
    def test_something(self):
        """Test description."""
        from tehuti_cli.module import function
        result = function()
        assert result is True
```

## Pull Request Process

1. **Before submitting:**
   - Run all tests
   - Update documentation
   - Add changelog entry (if applicable)

2. **PR description should include:**
   - What changed
   - Why it changed
   - Testing performed
   - Screenshots (for UI changes)

3. **Review process:**
   - Maintainers will review within 48 hours
   - Address review comments
   - Squash commits if requested

4. **After merge:**
   - Delete your branch
   - Close related issues

## Project Structure

```
tehuti_cli/
├── api/              # API providers (LLM integrations)
├── cli.py            # Entry point
├── core/             # Execution engine
│   ├── tools.py      # Tool registry
│   ├── runtime.py    # Tool execution
│   ├── pty.py        # PTY management
│   ├── executor.py   # Phase execution
│   ├── planner.py    # Project planning
│   ├── verifier.py   # Verification
│   └── app.py        # Core application
├── planning/         # Project planning
├── providers/        # LLM providers
│   ├── llm.py
│   ├── openrouter.py
│   ├── openai.py
│   └── gemini.py
├── storage/          # Data persistence
│   ├── config.py
│   ├── session.py
│   ├── metadata.py
│   ├── planning.py
│   ├── checkpoint.py
│   ├── tool_cache.py
│   └── workdir_config.py
├── ui/               # User interface
│   ├── shell.py
│   ├── print.py
│   └── theme.py
├── utils/            # Utility functions
│   ├── env.py
│   ├── logger.py
│   └── audit.py
├── web/              # Web UI
│   └── app.py
├── advanced_tools.py # Advanced execution tools
├── workflow_tools.py # Workflow management
├── tool_availability.py # Tool checking
└── __init__.py
```

## Commit Messages

Use conventional commits:

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation
- `test:` Tests
- `refactor:` Code refactoring
- `style:` Code style
- `chore:` Maintenance

Example:
```
feat: add terraform tool

- Add terraform init/plan/apply support
- Include tool availability check
- Add tests
```

## Questions?

- Open an issue for questions
- Join discussions
- Check existing documentation

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing to Tehuti! 𓅞
