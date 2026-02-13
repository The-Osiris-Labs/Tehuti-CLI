"""Enhanced Tool Execution Manager with hardened logic and comprehensive error handling.

This module provides:
- Consistent error handling and recovery
- Tool execution timeouts
- Progress tracking for long-running operations
- Tool output sanitization and formatting
- Retry logic for transient failures
- Execution metrics and monitoring
- Tool chain coordination
- Automatic schema generation from ToolRegistry
"""

from __future__ import annotations

import time
import json
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum, auto
from typing import Any, Optional, Callable
from pathlib import Path

from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TextColumn, TimeElapsedColumn
from rich.panel import Panel
from rich.text import Text


class ToolStatus(Enum):
    """Status of tool execution."""

    PENDING = auto()
    RUNNING = auto()
    SUCCESS = auto()
    FAILED = auto()
    TIMEOUT = auto()
    DENIED = auto()
    RETRYING = auto()
    CANCELLED = auto()


class ToolExecutionError(Exception):
    """Base exception for tool execution errors."""

    pass


class ValidationError(ToolExecutionError):
    """Raised when tool arguments fail validation."""

    pass


class TimeoutError(ToolExecutionError):
    """Raised when tool execution times out."""

    pass


class PermissionError(ToolExecutionError):
    """Raised when tool execution is denied."""

    pass


@dataclass
class ToolExecution:
    """Represents a single tool execution with full metadata."""

    tool: str
    args: dict[str, Any]
    status: ToolStatus = ToolStatus.PENDING
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    output: str = ""
    error: str = ""
    exit_code: int = 0
    retry_count: int = 0
    max_retries: int = 2
    timeout_seconds: float = 30.0
    execution_id: str = field(default_factory=lambda: f"exec_{int(time.time() * 1000)}")

    @property
    def duration_ms(self) -> int:
        """Calculate execution duration in milliseconds."""
        if self.start_time and self.end_time:
            return int((self.end_time - self.start_time).total_seconds() * 1000)
        return 0

    @property
    def success(self) -> bool:
        """Check if execution succeeded."""
        return self.status == ToolStatus.SUCCESS

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for logging/debugging."""
        return {
            "execution_id": self.execution_id,
            "tool": self.tool,
            "args": self.args,
            "status": self.status.name,
            "start_time": self.start_time.isoformat() if self.start_time else None,
            "end_time": self.end_time.isoformat() if self.end_time else None,
            "duration_ms": self.duration_ms,
            "output_length": len(self.output),
            "error": self.error if self.error else None,
            "retry_count": self.retry_count,
        }


class ToolOutputFormatter:
    """Formats tool output consistently."""

    # Maximum output lines before truncation
    DEFAULT_MAX_LINES = 100
    DEFAULT_HEAD_LINES = 50
    DEFAULT_TAIL_LINES = 30

    # Maximum output characters
    DEFAULT_MAX_CHARS = 10000

    @classmethod
    def format_output(
        cls,
        output: str,
        tool: str,
        max_lines: int = DEFAULT_MAX_LINES,
        head: int = DEFAULT_HEAD_LINES,
        tail: int = DEFAULT_TAIL_LINES,
        max_chars: int = DEFAULT_MAX_CHARS,
    ) -> str:
        """Format tool output with consistent truncation and sanitization."""
        if not output:
            return "(no output)"

        # Character truncation first
        if len(output) > max_chars:
            output = output[:max_chars] + f"\n... [truncated at {max_chars} chars]"

        # Line truncation
        lines = output.splitlines()
        total_lines = len(lines)

        if total_lines <= max_lines:
            return output

        # Smart truncation - keep head and tail
        head_lines = lines[:head]
        tail_lines = lines[-tail:] if tail > 0 else []
        omitted = total_lines - len(head_lines) - len(tail_lines)

        result = []
        result.extend(head_lines)
        result.append(f"\n... [{omitted} lines omitted] ...\n")
        result.extend(tail_lines)

        return "\n".join(result)

    @classmethod
    def format_error(cls, error: str, tool: str) -> str:
        """Format error message consistently."""
        if not error:
            return "Unknown error"

        # Truncate very long errors
        if len(error) > 1000:
            error = error[:997] + "..."

        return f"Error in {tool}: {error}"


class ToolValidator:
    """Validates tool calls before execution."""

    # Tools that require specific arguments
    REQUIRED_ARGS = {
        "read": ["path"],
        "write": ["path"],
        "edit": ["path"],
        "shell": ["command"],
        "fetch": ["url"],
        "glob": ["pattern"],
        "grep": ["pattern"],
        "docker_run": ["image"],
        "docker_exec": ["container", "command"],
        "psql": ["database", "query"],
        "mysql": ["database", "query"],
    }

    # Tools with dangerous operations that need extra confirmation
    HIGH_RISK_TOOLS = {
        "shell": ["rm -rf", "> /dev", "dd if", "mkfs", "shutdown", "reboot"],
        "write": [],  # Any write is risky
        "edit": [],
        "docker_run": [],
        "docker_exec": [],
        "kubectl": ["delete", "apply"],
        "terraform": ["destroy"],
        "systemctl": ["stop", "restart"],
    }

    @classmethod
    def validate_args(cls, tool: str, args: dict[str, Any]) -> tuple[bool, str]:
        """Validate tool arguments. Returns (is_valid, error_message)."""
        if not isinstance(args, dict):
            return False, f"Args must be a dictionary, got {type(args).__name__}"

        # Check required arguments
        required = cls.REQUIRED_ARGS.get(tool, [])
        missing = [arg for arg in required if arg not in args or args[arg] is None]
        if missing:
            return False, f"Missing required arguments: {', '.join(missing)}"

        # Type validation for common args
        if "path" in args and not isinstance(args["path"], (str, Path)):
            return False, f"'path' must be string, got {type(args['path']).__name__}"

        if "command" in args and not isinstance(args["command"], str):
            return False, f"'command' must be string, got {type(args['command']).__name__}"

        return True, ""

    @classmethod
    def is_high_risk(cls, tool: str, args: dict[str, Any]) -> tuple[bool, str]:
        """Check if tool operation is high risk. Returns (is_risky, reason)."""
        risky_patterns = cls.HIGH_RISK_TOOLS.get(tool, [])

        if tool in ["write", "edit"]:
            return True, f"{tool} operations modify files"

        command = args.get("command", "")
        if isinstance(command, str):
            cmd_lower = command.lower()
            for pattern in risky_patterns:
                if pattern.lower() in cmd_lower:
                    return True, f"Command contains risky pattern: {pattern}"

        return False, ""


class ToolRetryPolicy:
    """Determines whether a tool should be retried."""

    # Errors that indicate transient failures worth retrying
    RETRYABLE_ERRORS = [
        "timeout",
        "connection",
        "temporarily unavailable",
        "rate limit",
        "too many requests",
        "network",
        "socket",
        "try again",
    ]

    # Tools that should never be retried (non-idempotent)
    NO_RETRY_TOOLS = {
        "write",
        "edit",
        "docker_run",
        "docker_exec",
        "git_push",
        "git_pull",
        "ssh",
        "kubectl",
    }

    @classmethod
    def is_transient_error(cls, error: str) -> bool:
        error_lower = error.lower()
        return any(pattern in error_lower for pattern in cls.RETRYABLE_ERRORS)

    @classmethod
    def should_retry(
        cls,
        tool: str,
        error: str,
        retry_count: int,
        max_retries: int,
        tool_spec: Any | None = None,
    ) -> bool:
        """Determine if tool should be retried."""
        if retry_count >= max_retries:
            return False

        policy = getattr(tool_spec, "retry_policy", None)
        if policy == "never":
            return False
        if policy == "always":
            return True

        if tool in cls.NO_RETRY_TOOLS and policy is None:
            return False

        return cls.is_transient_error(error)


class ToolExecutionManager:
    """Manages tool execution with comprehensive error handling and monitoring."""

    def __init__(
        self,
        runtime: Any,
        console: Optional[Console] = None,
        enable_progress: bool = True,
    ):
        self.runtime = runtime
        self.console = console or Console()
        self.enable_progress = enable_progress
        self.execution_history: list[ToolExecution] = []
        self._current_execution: Optional[ToolExecution] = None

    def execute(
        self,
        tool: str,
        args: dict[str, Any],
        timeout: Optional[float] = None,
        max_retries: int = 2,
        show_progress: bool = True,
    ) -> ToolExecution:
        """Execute a tool with full error handling, retries, and progress tracking.

        Args:
            tool: Tool name
            args: Tool arguments
            timeout: Timeout in seconds (default: tool-specific or 30s)
            max_retries: Maximum retry attempts for transient failures
            show_progress: Whether to show progress indicators

        Returns:
            ToolExecution with full execution details
        """
        execution = ToolExecution(
            tool=tool,
            args=args,
            max_retries=max_retries,
            timeout_seconds=timeout or self._get_tool_timeout(tool),
        )

        self._current_execution = execution
        self.execution_history.append(execution)

        try:
            # Step 1: Validate arguments
            is_valid, error_msg = ToolValidator.validate_args(tool, args)
            if not is_valid:
                execution.status = ToolStatus.FAILED
                execution.error = error_msg
                execution.end_time = datetime.now()
                return execution

            # Step 2: Check approval
            if not self.runtime.approve(tool, args):
                execution.status = ToolStatus.DENIED
                execution.error = "Tool execution denied by approval policy"
                execution.end_time = datetime.now()
                return execution

            # Step 3: Execute with retry logic
            while execution.retry_count <= execution.max_retries:
                execution.status = ToolStatus.RUNNING
                execution.start_time = execution.start_time or datetime.now()

                try:
                    result = self._execute_with_timeout(tool, args, execution.timeout_seconds, show_progress)

                    # Check result
                    if result.ok:
                        execution.status = ToolStatus.SUCCESS
                        execution.output = result.output or ""
                        execution.end_time = datetime.now()
                        return execution
                    else:
                        # Tool returned failure
                        execution.error = result.output or "Tool failed without error message"

                        # Check if we should retry
                        if ToolRetryPolicy.should_retry(
                            tool, execution.error, execution.retry_count, execution.max_retries
                        ):
                            execution.retry_count += 1
                            execution.status = ToolStatus.RETRYING
                            time.sleep(1)  # Brief delay before retry
                            continue
                        else:
                            execution.status = ToolStatus.FAILED
                            execution.end_time = datetime.now()
                            return execution

                except TimeoutError:
                    execution.status = ToolStatus.TIMEOUT
                    execution.error = f"Tool timed out after {execution.timeout_seconds}s"
                    execution.end_time = datetime.now()
                    return execution

                except Exception as exc:
                    execution.error = str(exc)

                    # Check if we should retry
                    if ToolRetryPolicy.should_retry(
                        tool, execution.error, execution.retry_count, execution.max_retries
                    ):
                        execution.retry_count += 1
                        execution.status = ToolStatus.RETRYING
                        time.sleep(1)
                        continue
                    else:
                        execution.status = ToolStatus.FAILED
                        execution.end_time = datetime.now()
                        return execution

            # Exhausted retries
            execution.status = ToolStatus.FAILED
            execution.end_time = datetime.now()
            return execution

        except Exception as exc:
            # Catch-all for unexpected errors
            execution.status = ToolStatus.FAILED
            execution.error = f"Unexpected error: {str(exc)}"
            execution.end_time = datetime.now()
            return execution
        finally:
            self._current_execution = None

    def _execute_with_timeout(
        self,
        tool: str,
        args: dict[str, Any],
        timeout: float,
        show_progress: bool,
    ) -> Any:
        """Execute tool with timeout support."""
        import concurrent.futures

        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(self.runtime.execute, tool, args)
            try:
                return future.result(timeout=timeout)
            except concurrent.futures.TimeoutError:
                raise TimeoutError(f"Tool execution exceeded {timeout} seconds")

    def _get_tool_timeout(self, tool: str) -> float:
        """Get default timeout for a tool."""
        timeouts = {
            "shell": 30.0,
            "fetch": 30.0,
            "web_search": 30.0,
            "docker_run": 60.0,
            "docker_build": 120.0,
            "pytest": 60.0,
            "host_discovery": 30.0,
        }
        return timeouts.get(tool, 30.0)

    def format_execution_result(self, execution: ToolExecution) -> str:
        """Format execution result for display."""
        symbol = self._get_status_symbol(execution.status)
        duration = f" ({execution.duration_ms}ms)" if execution.duration_ms > 0 else ""

        if execution.status == ToolStatus.SUCCESS:
            output = ToolOutputFormatter.format_output(execution.output, execution.tool)
            return f"{symbol} {execution.tool}{duration}\n{output}"
        else:
            error = ToolOutputFormatter.format_error(execution.error, execution.tool)
            retry_info = f" (retried {execution.retry_count}x)" if execution.retry_count > 0 else ""
            return f"{symbol} {execution.tool}{duration}{retry_info}\n{error}"

    def _get_status_symbol(self, status: ToolStatus) -> str:
        """Get Egyptian symbol for status."""
        symbols = {
            ToolStatus.PENDING: "⏳",
            ToolStatus.RUNNING: "▶️",
            ToolStatus.SUCCESS: "✅",
            ToolStatus.FAILED: "❌",
            ToolStatus.TIMEOUT: "⏱️",
            ToolStatus.DENIED: "🚫",
            ToolStatus.RETRYING: "🔄",
            ToolStatus.CANCELLED: "🛑",
        }
        return symbols.get(status, "❓")

    def get_metrics(self) -> dict[str, Any]:
        """Get execution metrics."""
        total = len(self.execution_history)
        successful = sum(1 for e in self.execution_history if e.success)
        failed = total - successful
        avg_duration = sum(e.duration_ms for e in self.execution_history) / total if total > 0 else 0

        return {
            "total_executions": total,
            "successful": successful,
            "failed": failed,
            "success_rate": f"{(successful / total * 100):.1f}%" if total > 0 else "N/A",
            "average_duration_ms": int(avg_duration),
            "retries": sum(e.retry_count for e in self.execution_history),
        }


# Convenience function
def execute_tool(
    runtime: Any,
    tool: str,
    args: dict[str, Any],
    **kwargs,
) -> ToolExecution:
    """Execute a tool with enhanced error handling."""
    manager = ToolExecutionManager(runtime)
    return manager.execute(tool, args, **kwargs)


def generate_tool_schemas_from_registry(registry: Any) -> list[dict[str, Any]]:
    """Generate OpenAI-style tool schemas from ToolRegistry.

    Args:
        registry: ToolRegistry instance with _tools dict

    Returns:
        List of tool schemas in OpenAI function calling format
    """
    schemas = []

    # Common tool schemas for built-in tools
    builtin_schemas = {
        "read": {
            "type": "function",
            "function": {
                "name": "read",
                "description": "Read the contents of a file from disk",
                "parameters": {
                    "type": "object",
                    "properties": {"path": {"type": "string", "description": "Path to the file to read"}},
                    "required": ["path"],
                },
            },
        },
        "write": {
            "type": "function",
            "function": {
                "name": "write",
                "description": "Write content to a file, creating if needed",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string", "description": "Path to the file"},
                        "content": {"type": "string", "description": "Content to write to the file"},
                    },
                    "required": ["path", "content"],
                },
            },
        },
        "edit": {
            "type": "function",
            "function": {
                "name": "edit",
                "description": "Edit a file by replacing old_string with new_string",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string", "description": "Path to the file"},
                        "old_string": {"type": "string", "description": "The exact string to replace"},
                        "new_string": {"type": "string", "description": "The replacement string"},
                    },
                    "required": ["path", "old_string", "new_string"],
                },
            },
        },
        "shell": {
            "type": "function",
            "function": {
                "name": "shell",
                "description": "Execute a shell command and return the output",
                "parameters": {
                    "type": "object",
                    "properties": {"command": {"type": "string", "description": "Shell command to execute"}},
                    "required": ["command"],
                },
            },
        },
        "glob": {
            "type": "function",
            "function": {
                "name": "glob",
                "description": "Find files matching a glob pattern",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "pattern": {"type": "string", "description": "Glob pattern (e.g., '**/*.py')"},
                        "path": {"type": "string", "description": "Base path (default: '.')"},
                    },
                    "required": ["pattern"],
                },
            },
        },
        "grep": {
            "type": "function",
            "function": {
                "name": "grep",
                "description": "Search for a pattern in files",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "pattern": {"type": "string", "description": "Search pattern"},
                        "path": {"type": "string", "description": "Search path (default: '.')"},
                        "recursive": {"type": "boolean", "description": "Search recursively (default: true)"},
                    },
                    "required": ["pattern"],
                },
            },
        },
        "fetch": {
            "type": "function",
            "function": {
                "name": "fetch",
                "description": "Fetch a URL and return the content",
                "parameters": {
                    "type": "object",
                    "properties": {"url": {"type": "string", "description": "URL to fetch"}},
                    "required": ["url"],
                },
            },
        },
        "web_search": {
            "type": "function",
            "function": {
                "name": "web_search",
                "description": "Search the web using DuckDuckGo",
                "parameters": {
                    "type": "object",
                    "properties": {"query": {"type": "string", "description": "Search query"}},
                    "required": ["query"],
                },
            },
        },
        "ls": {
            "type": "function",
            "function": {
                "name": "ls",
                "description": "List directory contents",
                "parameters": {
                    "type": "object",
                    "properties": {"path": {"type": "string", "description": "Directory path (default: '.')"}},
                },
            },
        },
        "pytest": {
            "type": "function",
            "function": {
                "name": "pytest",
                "description": "Run pytest tests",
                "parameters": {
                    "type": "object",
                    "properties": {"path": {"type": "string", "description": "Path to test file or directory"}},
                },
            },
        },
        "git_status": {
            "type": "function",
            "function": {
                "name": "git_status",
                "description": "Show working tree status",
                "parameters": {"type": "object", "properties": {}},
            },
        },
        "git_log": {
            "type": "function",
            "function": {
                "name": "git_log",
                "description": "Show commit history",
                "parameters": {
                    "type": "object",
                    "properties": {"num": {"type": "integer", "description": "Number of commits to show"}},
                },
            },
        },
        "docker_ps": {
            "type": "function",
            "function": {
                "name": "docker_ps",
                "description": "List Docker containers",
                "parameters": {
                    "type": "object",
                    "properties": {"all": {"type": "boolean", "description": "Show all containers"}},
                },
            },
        },
    }

    # Add schemas for registered tools
    for tool_name, tool_spec in registry._tools.items():
        if tool_name in builtin_schemas:
            schemas.append(builtin_schemas[tool_name])
        else:
            # Generate generic schema for unknown tools
            schemas.append(
                {
                    "type": "function",
                    "function": {
                        "name": tool_name,
                        "description": tool_spec.description or f"Execute {tool_name}",
                        "parameters": {"type": "object", "properties": {}, "additionalProperties": True},
                    },
                }
            )

    return schemas


def get_tool_descriptions_for_prompt(registry: Any) -> str:
    """Generate tool descriptions for injection into system prompts.

    Args:
        registry: ToolRegistry instance

    Returns:
        Formatted string with tool names and descriptions
    """
    lines = ["Available tools:", ""]

    for tool_name, tool_spec in registry._tools.items():
        lines.append(f"- **{tool_name}**: {tool_spec.description}")

    lines.extend(
        [
            "",
            "To use a tool, respond with JSON:",
            '{"type": "tool", "name": "TOOL_NAME", "args": {"arg1": "value1"}}',
            "",
            "Available tool names: " + ", ".join(sorted(registry._tools.keys())),
        ]
    )

    return "\n".join(lines)
