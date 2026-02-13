"""Diagnostic tool to test if Tehuti can execute shell commands and tools.

This script tests the core tool execution functionality.
"""

import sys
from pathlib import Path

# Add src to path
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from tehuti_cli.core.runtime import ToolRuntime
from tehuti_cli.storage.config import load_config


def test_tool_execution():
    """Test that tools can be executed."""
    print("Testing Tehuti Tool Execution...")
    print("=" * 60)

    # Load config
    config = load_config()
    print(f"✓ Config loaded")
    print(f"  - Provider: {config.provider.type}")
    print(f"  - Model: {config.provider.model}")
    print(f"  - Shell allowed: {config.allow_shell}")
    print(f"  - Write allowed: {config.allow_write}")
    print()

    # Create runtime
    work_dir = Path.cwd()
    runtime = ToolRuntime(config, work_dir)
    print(f"✓ Runtime created for: {work_dir}")
    print()

    # Test 1: Shell command
    print("Test 1: Shell command 'ls -la'")
    print("-" * 40)
    result = runtime.execute("shell", {"command": "ls -la | head -10"})
    print(f"Result.ok: {result.ok}")
    print(f"Result.output:")
    print(result.output[:500] if result.output else "(no output)")
    print()

    # Test 2: Glob
    print("Test 2: Glob files '*.py'")
    print("-" * 40)
    result = runtime.execute("glob", {"pattern": "*.py"})
    print(f"Result.ok: {result.ok}")
    print(f"Result.output:")
    print(result.output[:500] if result.output else "(no output)")
    print()

    # Test 3: Read file
    print("Test 3: Read 'pyproject.toml'")
    print("-" * 40)
    result = runtime.execute("read", {"path": "pyproject.toml"})
    print(f"Result.ok: {result.ok}")
    print(f"Result.output (first 300 chars):")
    print(result.output[:300] if result.output else "(no output)")
    print()

    # Test 4: Git status
    print("Test 4: Git status")
    print("-" * 40)
    result = runtime.execute("git_status", {})
    print(f"Result.ok: {result.ok}")
    print(f"Result.output:")
    print(result.output[:500] if result.output else "(no output)")
    print()

    print("=" * 60)
    print("Tool execution test complete!")
    print()
    print("NOTE: If all tests passed but Tehuti doesn't use tools,")
    print("it's because the AI model (qwen/qwen3-coder:free)")
    print("doesn't support function calling properly.")
    print()
    print("Recommend using models that support tool calling:")
    print("  - anthropic/claude-3.5-sonnet")
    print("  - openai/gpt-4o")
    print("  - google/gemini-1.5-pro")


if __name__ == "__main__":
    test_tool_execution()
