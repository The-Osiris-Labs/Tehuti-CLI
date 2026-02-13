from __future__ import annotations

from io import StringIO

from rich.console import Console

from tehuti_cli.advanced_tools import ToolResult
from tehuti_cli.ui.interactive import ChatShell


def _shell_stub() -> tuple[ChatShell, StringIO]:
    shell = ChatShell.__new__(ChatShell)
    stream = StringIO()
    shell.console = Console(file=stream, force_terminal=False, color_system=None)
    return shell, stream


def test_interactive_tool_success_message_uses_real_output() -> None:
    shell, stream = _shell_stub()
    shell._handle_tool_result("write", ToolResult(True, "Wrote 12 bytes to file.txt"))
    output = stream.getvalue()
    assert "completed successfully" not in output
    assert "Wrote 12 bytes to file.txt" in output


def test_interactive_tool_failure_message_uses_real_error() -> None:
    shell, stream = _shell_stub()
    shell._handle_tool_result("shell", ToolResult(False, "permission denied"))
    output = stream.getvalue()
    assert "permission denied" in output
