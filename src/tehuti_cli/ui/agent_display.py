"""Enhanced display system for Tehuti agent actions and reasoning.

This module provides rich, informative displays for:
- Agent reasoning/thought process
- Tool execution with context
- File operations with visual indicators
- Command execution with progress
- Web searches with results preview
- Sequences of operations
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from rich.console import Console
from rich.panel import Panel
from rich.text import Text
from rich.live import Live
from rich.table import Table
from rich.progress import Progress, SpinnerColumn, TextColumn
from rich.syntax import Syntax
from rich.tree import Tree


@dataclass
class ActionContext:
    """Context for an action being performed."""

    tool: str
    args: dict[str, Any]
    purpose: str = ""  # Why is this action being taken?
    sequence_num: int = 0
    total_in_sequence: int = 0
    start_time: datetime = field(default_factory=datetime.now)


class AgentDisplay:
    """Enhanced display system for agent operations."""

    # Icons for different tool types
    ICONS = {
        # File operations
        "read": "📖",
        "write": "✍️",
        "edit": "✏️",
        "glob": "🔍",
        "grep": "🔎",
        "find": "🗂️",
        "ls": "📁",
        # Shell & System
        "shell": "⚡",
        "host_discovery": "🔍",
        "docker_ps": "🐳",
        "docker_run": "🐳",
        "docker_build": "🐳",
        "kubectl": "☸️",
        "terraform": "🏗️",
        "ansible_playbook": "📋",
        "systemctl": "⚙️",
        # Web & Search
        "fetch": "🌐",
        "web_search": "🔍",
        "web_fetch": "🌐",
        "api_get": "📡",
        "api_post": "📤",
        "extract_text": "📄",
        # Version Control
        "git_status": "📊",
        "git_log": "📜",
        "git_diff": "📝",
        "git_branch": "🌿",
        "git_push": "🚀",
        "git_pull": "📥",
        "gh": "🐙",
        # Testing & Build
        "pytest": "🧪",
        "jest": "🧪",
        "cargo_test": "🧪",
        "make": "🔨",
        "cmake": "🔨",
        "gradle": "🔨",
        "maven": "🔨",
        # Database
        "psql": "🐘",
        "mysql": "🐬",
        "redis_cli": "🔴",
        # Vision
        "image_analyze": "🖼️",
        "image_ocr": "👁️",
        "image_screenshot": "📸",
        "qrcode_read": "📱",
        # Browser
        "browser_navigate": "🌐",
        "browser_click": "🖱️",
        "browser_screenshot": "📸",
        # Thinking/Reasoning
        "thinking": "🧠",
        "planning": "📋",
        "reasoning": "💭",
        # Default
        "default": "🔧",
    }

    # Colors for different categories
    COLORS = {
        "read": "blue",
        "write": "green",
        "edit": "yellow",
        "shell": "red",
        "web": "cyan",
        "search": "magenta",
        "docker": "blue",
        "git": "orange",
        "test": "green",
        "thinking": "purple",
        "default": "white",
    }

    def __init__(self, console: Console | None = None):
        self.console = console or Console()
        self.current_sequence: list[ActionContext] = []
        self.completed_actions: list[ActionContext] = []

    def get_icon(self, tool: str) -> str:
        """Get the appropriate icon for a tool."""
        return self.ICONS.get(tool, self.ICONS["default"])

    def get_color(self, tool: str) -> str:
        """Get the appropriate color for a tool."""
        # Map tools to categories
        if tool in ("read", "glob", "grep", "find", "ls", "cat"):
            return self.COLORS["read"]
        elif tool in ("write", "edit"):
            return self.COLORS["write"]
        elif tool in ("shell", "host_discovery", "systemctl"):
            return self.COLORS["shell"]
        elif tool in ("fetch", "web_search", "web_fetch", "api_get", "api_post"):
            return self.COLORS["web"]
        elif tool.startswith(("docker_", "kubectl", "terraform", "ansible")):
            return self.COLORS["docker"]
        elif tool.startswith(("git_", "gh", "glab")):
            return self.COLORS["git"]
        elif tool in ("pytest", "jest", "unittest", "cargo_test", "go_test"):
            return self.COLORS["test"]
        else:
            return self.COLORS["default"]

    def format_action_title(self, context: ActionContext) -> str:
        """Format a descriptive title for an action."""
        tool = context.tool
        args = context.args

        if tool == "read":
            path = args.get("path", "unknown")
            return f"Reading file: {path}"

        elif tool == "write":
            path = args.get("path", "unknown")
            content_preview = args.get("content", "")[:50]
            if len(content_preview) >= 50:
                content_preview += "..."
            return f"Writing to {path}"

        elif tool == "edit":
            path = args.get("path", "unknown")
            old_str = args.get("old_string", "")[:30]
            if len(old_str) >= 30:
                old_str += "..."
            return f"Editing {path}: replacing '{old_str}'"

        elif tool == "shell":
            cmd = args.get("command", "")
            cmd_display = cmd if len(cmd) <= 60 else cmd[:57] + "..."
            return f"Executing: {cmd_display}"

        elif tool == "glob":
            pattern = args.get("pattern", "*")
            path = args.get("path", ".")
            return f"Finding files matching '{pattern}' in {path}"

        elif tool == "grep":
            pattern = args.get("pattern", "")
            path = args.get("path", ".")
            return f"Searching for '{pattern}' in {path}"

        elif tool == "web_search":
            query = args.get("query", args.get("q", ""))
            return f"Searching web: '{query}'"

        elif tool == "fetch":
            url = args.get("url", "")
            return f"Fetching: {url}"

        elif tool.startswith("docker_"):
            docker_tool = tool.replace("docker_", "")
            if docker_tool == "ps":
                return "Listing Docker containers"
            elif docker_tool == "run":
                image = args.get("image", "unknown")
                return f"Running Docker container: {image}"
            else:
                return f"Docker {docker_tool}"

        elif tool.startswith("git_"):
            git_cmd = tool.replace("git_", "")
            return f"Git {git_cmd}"

        elif tool == "image_analyze":
            path = args.get("image_path", "unknown")
            return f"Analyzing image: {path}"

        elif tool == "image_ocr":
            path = args.get("image_path", "unknown")
            return f"Reading text from image: {path}"

        elif tool == "browser_navigate":
            url = args.get("url", "")
            return f"Navigating to: {url}"

        else:
            # Generic formatting
            args_str = ", ".join(f"{k}={v}" for k, v in list(args.items())[:2])
            if len(args) > 2:
                args_str += "..."
            return f"{tool}({args_str})"

    def print_thinking(self, thought: str, step: int | None = None) -> None:
        """Display agent's thinking/reasoning process."""
        icon = self.ICONS["thinking"]
        prefix = f"Step {step}: " if step else ""

        panel = Panel(
            Text(thought, style="italic purple"),
            title=f"{icon} {prefix}Thinking",
            border_style="purple",
            expand=False,
        )
        self.console.print(panel)

    def print_plan(self, steps: list[str]) -> None:
        """Display a plan of action."""
        icon = self.ICONS["planning"]

        tree = Tree(f"{icon} Plan")
        for i, step in enumerate(steps, 1):
            tree.add(f"{i}. {step}")

        panel = Panel(
            tree,
            title="Plan",
            border_style="blue",
            expand=False,
        )
        self.console.print(panel)

    def print_action_start(self, context: ActionContext) -> None:
        """Print when an action starts."""
        icon = self.get_icon(context.tool)
        color = self.get_color(context.tool)
        title = self.format_action_title(context)

        # Show sequence info if applicable
        sequence_info = ""
        if context.total_in_sequence > 1:
            sequence_info = f" [{context.sequence_num}/{context.total_in_sequence}]"

        # Show purpose if available
        purpose_text = ""
        if context.purpose:
            purpose_text = f"\n   💭 {context.purpose}"

        text = Text()
        text.append(f"{icon} ", style=color)
        text.append(f"{title}{sequence_info}", style=f"bold {color}")
        if purpose_text:
            text.append(purpose_text, style="dim")

        self.console.print(text)
        self.current_sequence.append(context)

    def print_action_complete(
        self,
        context: ActionContext,
        success: bool,
        output: str | None = None,
        elapsed_ms: int = 0,
    ) -> None:
        """Print when an action completes."""
        icon = "✓" if success else "✗"
        color = "green" if success else "red"

        elapsed_str = f" ({elapsed_ms}ms)" if elapsed_ms > 0 else ""

        self.console.print(f"  [{color}]{icon} Done{elapsed_str}[/{color}]")

        # Show output preview if available and relevant
        if output and success:
            self._print_output_preview(context.tool, output)

        self.completed_actions.append(context)

    def _print_output_preview(self, tool: str, output: str) -> None:
        """Print a preview of tool output."""
        max_preview_lines = 10
        lines = output.splitlines()

        if len(lines) > max_preview_lines:
            preview_lines = lines[:max_preview_lines]
            truncated = True
        else:
            preview_lines = lines
            truncated = False

        if not preview_lines:
            return

        # Format based on tool type
        if tool == "read":
            # Try to detect language and syntax highlight
            content = "\n".join(preview_lines)
            if truncated:
                content += f"\n... ({len(lines) - max_preview_lines} more lines)"

            # Simple preview in a panel
            preview = "\n".join(f"  │ {line}" for line in preview_lines[:5])
            if truncated:
                preview += f"\n  │ ... ({len(lines) - 5} more lines)"

            self.console.print(Text(preview, style="dim"))

        elif tool == "glob":
            # Show file count
            file_count = len(lines)
            self.console.print(f"  📁 Found {file_count} files")

        elif tool == "shell":
            # Show command output (limited)
            preview = "\n".join(f"  │ {line}" for line in preview_lines[:3])
            if truncated:
                preview += f"\n  │ ... ({len(lines) - 3} more lines)"
            self.console.print(Text(preview, style="dim"))

        elif tool == "web_search":
            # Show result count
            result_count = len([l for l in lines if l.strip()])
            self.console.print(f"  🔍 Found {result_count} results")

        elif tool in ("git_status", "git_log"):
            # Git output - show first few lines
            preview = "\n".join(f"  │ {line}" for line in preview_lines[:5])
            self.console.print(Text(preview, style="dim"))

        else:
            # Generic preview
            preview = "\n".join(f"  │ {line}" for line in preview_lines[:3])
            if truncated:
                preview += f"\n  │ ... ({len(lines) - 3} more lines)"
            self.console.print(Text(preview, style="dim"))

    def print_sequence_summary(self) -> None:
        """Print summary of completed sequence."""
        if not self.completed_actions:
            return

        total = len(self.completed_actions)
        self.console.print(f"\n[dim]Completed {total} action{'s' if total != 1 else ''}[/dim]")

    def print_error(self, error: str, context: str = "") -> None:
        """Print an error with context."""
        text = Text()
        text.append("✗ ", style="bold red")
        if context:
            text.append(f"{context}: ", style="red")
        text.append(error, style="red")
        self.console.print(text)

    def print_final_response(self, response: str) -> None:
        """Print the final agent response."""
        if not response:
            return

        # Clean up the response
        response = response.strip()

        # Print with a subtle separator
        self.console.print()
        panel = Panel(
            Text(response, style="white"),
            title="Response",
            border_style="gold",
            expand=False,
        )
        self.console.print(panel)

    def clear_sequence(self) -> None:
        """Clear the current sequence."""
        self.current_sequence = []
        self.completed_actions = []


# Singleton instance for easy access
_display_instance: AgentDisplay | None = None


def get_display(console: Console | None = None) -> AgentDisplay:
    """Get or create the global display instance."""
    global _display_instance
    if _display_instance is None:
        _display_instance = AgentDisplay(console)
    return _display_instance
