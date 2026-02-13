"""Egyptian-themed agent display system for Tehuti.

This module provides a display system using Egyptian symbols and hieroglyphic-style
icons that align with Tehuti's theme: "Thoth • Tongue of Ra • Halls of Records • Ma'at"
"""

from __future__ import annotations

import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Generator

from rich.console import Console, Group
from rich.panel import Panel
from rich.text import Text
from rich.live import Live
from rich.tree import Tree
from rich.syntax import Syntax
from rich.table import Table
from rich.progress import Progress, SpinnerColumn, TextColumn, TimeElapsedColumn
from rich.status import Status
from rich.align import Align
from rich.layout import Layout
from rich.padding import Padding


# Egyptian-themed symbols for tool categories
# Using Unicode symbols and ASCII art that evoke ancient Egyptian themes
EGYPTIAN_SYMBOLS = {
    # Core Concepts (Thoth/Ma'at theme)
    "thinking": "𓅞",  # Ibis (Thoth's symbol)
    "planning": "𓏲",  # Scroll/papyrus
    "reasoning": "𓀀",  # Human figure (wisdom)
    "completed": "𓋹",  # Ankh (life/success)
    "error": "𓃻",  # Danger/protective symbol
    "waiting": "⏳",  # Hourglass (time)
    "default": "𓋴",  # General tool symbol
    # File Operations (Writing/Recording - Thoth was scribe)
    "read": "𓏞",  # Papyrus scroll open
    "write": "𓏠",  # Writing tablet
    "edit": "𓏛",  # Scribe's tools
    "glob": "𓃀",  # Basket (gathering)
    "grep": "𓁹",  # Eye (searching/seeking)
    "find": "𓃃",  # Searching
    "ls": "𓃊",  # List/enumerate
    "cat": "𓃉",  # Concatenate/join
    "head": "𓃋",  # Top/beginning
    "tail": "𓃌",  # Bottom/end
    # Shell & System (Power/Authority)
    "shell": "𓃾",  # Scepter (power/command)
    "host_discovery": "𓃋",  # Surveying
    "docker_ps": "𓃍",  # Container/vessel
    "docker_run": "𓃎",  # Running vessel
    "docker_build": "𓃏",  # Building
    "docker_exec": "𓃐",  # Execute within
    "kubectl": "𓃑",  # Orchestration
    "terraform": "𓃒",  # Infrastructure
    "ansible_playbook": "𓃓",  # Automation
    "systemctl": "𓃔",  # System control
    "service": "𓃕",  # Service
    # Web & Search (Horus/Eye theme)
    "fetch": "𓁹",  # Eye of Horus (sight/fetch)
    "web_search": "𓁼",  # Searching
    "web_fetch": "𓁹",  # Fetching
    "api_get": "𓂀",  # Receiving
    "api_post": "𓂁",  # Sending
    "extract_text": "𓂂",  # Extraction
    "search_ddg": "𓂃",  # Duck/searching
    # Version Control (Recording history - Thoth's domain)
    "git_status": "𓂄",  # Current state
    "git_log": "𓂅",  # History/chronicle
    "git_diff": "𓂆",  # Comparison
    "git_branch": "𓂇",  # Diverging paths
    "git_push": "𓂈",  # Sending upward
    "git_pull": "𓂉",  # Receiving downward
    "git_clone": "𓂊",  # Copying
    "gh": "𓂋",  # GitHub
    "glab": "𓂌",  # GitLab
    # Testing & Build (Quality/Ma'at - truth/balance)
    "pytest": "𓏏",  # Testing/scale
    "jest": "𓏐",  # Testing
    "unittest": "𓏑",  # Unit testing
    "cargo_test": "𓏒",  # Rust testing
    "go_test": "𓏓",  # Go testing
    "make": "𓏔",  # Building
    "cmake": "𓏕",  # Configuration
    "gradle": "𓏖",  # Gradual building
    "maven": "𓏗",  # Maven building
    # Database (Storage/Archives - Halls of Records)
    "psql": "𓏘",  # PostgreSQL
    "mysql": "𓏙",  # MySQL
    "redis_cli": "𓏚",  # Redis
    # Vision (Sight/Knowledge)
    "image_analyze": "𓁹",  # Eye/analysis
    "image_ocr": "𓁺",  # Reading sight
    "image_screenshot": "𓁻",  # Capturing sight
    "image_describe": "𓁼",  # Describing
    "image_compare": "𓁽",  # Comparing
    "qrcode_read": "𓁾",  # QR reading
    "qrcode_generate": "𓁿",  # QR creating
    "barcode_detect": "𓂀",  # Bar detection
    # Browser (Travel/Exploration)
    "browser_navigate": "𓂁",  # Navigation
    "browser_click": "𓂂",  # Selecting
    "browser_fill": "𓂃",  # Filling
    "browser_type": "𓂄",  # Typing
    "browser_screenshot": "𓂅",  # Capturing
    "browser_evaluate": "𓂆",  # Evaluating
    # Streaming (Flow/Continuous)
    "stream_chat": "𓂇",  # Chat stream
    "stream_append": "𓂈",  # Appending
    "stream_lines": "𓂉",  # Line stream
    # MCP (External connection)
    "mcp_list_servers": "𓂊",
    "mcp_connect": "𓂋",
    "mcp_call_tool": "𓂌",
    # Task/Project Management
    "task_create": "𓂍",
    "task_update": "𓂎",
    "blueprint_create": "𓂏",
    "blueprint_get": "𓂐",
}


# Alternative: Using ASCII art and symbols if Unicode doesn't render well
ASCII_SYMBOLS = {
    "thinking": "[T]",  # Thoth
    "planning": "[P]",  # Plan
    "reasoning": "[R]",  # Reason
    "completed": "[+]",  # Success
    "error": "[X]",  # Error
    "waiting": "[~]",  # Waiting
    "default": "[*]",  # Default
    "read": "[R]",  # Read
    "write": "[W]",  # Write
    "edit": "[E]",  # Edit
    "shell": "[$]",  # Shell
    "web_search": "[S]",  # Search
    "docker": "[D]",  # Docker
    "git": "[G]",  # Git
    "test": "[T]",  # Test
}


# Color schemes matching Egyptian theme
COLORS = {
    "thinking": "gold",  # Thoth's gold
    "reading": "papyrus",  # Papyrus color
    "writing": "turquoise",  # Egyptian turquoise
    "executing": "lapis",  # Lapis lazuli blue
    "searching": "ochre",  # Desert ochre
    "web": "lapis",
    "docker": "turquoise",
    "git": "gold",
    "testing": "malachite",  # Green
    "error": "red_jasper",  # Red
    "success": "malachite",  # Green
    "info": "limestone",  # White/off-white
}


@dataclass
class ToolCallInfo:
    """Information about a tool call."""

    tool: str
    args: dict[str, Any]
    start_time: datetime = field(default_factory=datetime.now)
    end_time: datetime | None = None
    success: bool | None = None
    output: str = ""

    @property
    def duration_ms(self) -> int:
        """Calculate duration in milliseconds."""
        end = self.end_time or datetime.now()
        return int((end - self.start_time).total_seconds() * 1000)


@dataclass
class SessionState:
    """Tracks the current session state for display."""

    current_action: str = ""
    current_tool: str | None = None
    thinking: str = ""
    plan: list[str] = field(default_factory=list)
    completed_tools: list[ToolCallInfo] = field(default_factory=list)
    is_processing: bool = False


class TehutiDisplayManager:
    """Egyptian-themed display manager for Tehuti agent."""

    def __init__(self, console: Console | None = None, use_ascii: bool = False):
        self.console = console or Console()
        self.state = SessionState()
        self.symbols = ASCII_SYMBOLS if use_ascii else EGYPTIAN_SYMBOLS
        self._live_display: Live | None = None
        self._status: Status | None = None

    def get_symbol(self, tool: str) -> str:
        """Get the Egyptian symbol for a tool."""
        return self.symbols.get(tool, self.symbols["default"])

    def get_color(self, category: str) -> str:
        """Get color for a category."""
        return COLORS.get(category, COLORS["info"])

    def _categorize_tool(self, tool: str) -> str:
        """Categorize a tool for color selection."""
        if tool in ("read", "glob", "grep", "find", "ls", "cat", "head", "tail"):
            return "reading"
        elif tool in ("write", "edit"):
            return "writing"
        elif tool in ("shell", "host_discovery"):
            return "executing"
        elif tool in ("web_search", "fetch", "search_ddg"):
            return "searching"
        elif tool.startswith(("docker_", "kubectl", "terraform")):
            return "docker"
        elif tool.startswith(("git_", "gh", "glab")):
            return "git"
        elif tool in ("pytest", "jest", "unittest", "cargo_test", "go_test"):
            return "testing"
        else:
            return "info"

    @contextmanager
    def show_thinking(self, thought: str = "Invoking Thoth's wisdom...") -> Generator[None, None, None]:
        """Display thinking with Egyptian-themed spinner."""
        symbol = self.symbols["thinking"]
        color = self.get_color("thinking")

        text = Text()
        text.append(f"{symbol} ", style=color)
        text.append(thought, style=f"italic {color}")

        with self.console.status(text, spinner="dots", spinner_style=color) as status:
            self.state.thinking = thought
            self.state.is_processing = True
            yield
            self.state.is_processing = False
            self.state.thinking = ""

    def display_thinking(self, thought: str) -> None:
        """Display agent's thinking in a decorated panel."""
        symbol = self.symbols["thinking"]
        color = self.get_color("thinking")

        # Create decorative border
        panel = Panel(
            Text(thought, style=f"italic {color}"),
            title=f"{symbol} Wisdom of Thoth",
            border_style=color,
            expand=False,
            subtitle="𓋹 Ma'at 𓋹",  # Ankh symbol
        )
        self.console.print(panel)

    def display_plan(self, steps: list[str]) -> None:
        """Display a plan as a sacred scroll."""
        symbol = self.symbols["planning"]

        tree = Tree(f"{symbol} Sacred Scroll of Actions")
        for i, step in enumerate(steps, 1):
            # Use Egyptian numerals concept (regular numbers with styling)
            tree.add(f"[dim]‖[/dim] {step}")

        panel = Panel(
            tree,
            title="𓏲 Plan Inscribed",
            border_style="gold",
            expand=False,
        )
        self.console.print(panel)
        self.state.plan = steps

    @contextmanager
    def show_tool_execution(
        self,
        tool: str,
        args: dict[str, Any],
        purpose: str = "",
    ) -> Generator[ToolCallInfo, None, None]:
        """Display tool execution with Egyptian styling."""
        symbol = self.get_symbol(tool)
        category = self._categorize_tool(tool)
        color = self.get_color(category)

        # Format the action description
        description = self._format_tool_description(tool, args)
        if purpose:
            description = f"{purpose}: {description}"

        text = Text()
        text.append(f"{symbol} ", style=color)
        text.append(description, style=color)

        info = ToolCallInfo(tool=tool, args=args)
        self.state.current_tool = tool

        with self.console.status(text, spinner="dots", spinner_style=color):
            yield info

        info.end_time = datetime.now()
        self.state.completed_tools.append(info)
        self.state.current_tool = None

    def _format_tool_description(self, tool: str, args: dict[str, Any]) -> str:
        """Format a human-readable description of a tool call."""
        if tool == "read":
            return f"Reading from the scrolls: {args.get('path', 'file')}"
        elif tool == "write":
            return f"Inscribing upon: {args.get('path', 'file')}"
        elif tool == "edit":
            path = args.get("path", "file")
            return f"Modifying inscription: {path}"
        elif tool == "shell":
            cmd = args.get("command", "")
            if len(cmd) > 50:
                cmd = cmd[:47] + "..."
            return f"Invoking command: {cmd}"
        elif tool == "glob":
            return f"Gathering scrolls matching: {args.get('pattern', '*')}"
        elif tool == "grep":
            return f"Seeking the mark: {args.get('pattern', '')}"
        elif tool == "web_search":
            return f"Consulting the archives: {args.get('query', args.get('q', ''))}"
        elif tool == "fetch":
            url = args.get("url", "")
            if len(url) > 50:
                url = url[:47] + "..."
            return f"Retrieving from afar: {url}"
        elif tool == "image_analyze":
            return f"Gazing upon the image: {args.get('image_path', '')}"
        elif tool == "git_status":
            return "Consulting the chronicles"
        elif tool.startswith("git_"):
            return f"Recording in chronicles: {tool.replace('git_', '')}"
        elif tool.startswith("docker_"):
            return f"Commanding vessel: {tool.replace('docker_', '')}"
        elif tool == "pytest":
            return "Testing by the scale of Ma'at"
        else:
            # Generic formatting
            args_str = ", ".join(f"{k}={v}" for k, v in list(args.items())[:2])
            return f"{tool}({args_str})"

    def display_tool_result(
        self,
        tool: str,
        success: bool,
        output: str = "",
        duration_ms: int = 0,
    ) -> None:
        """Display the result of a tool execution."""
        symbol = self.symbols["completed"] if success else self.symbols["error"]
        color = self.get_color("success") if success else self.get_color("error")
        duration_str = f" ({duration_ms}ms)" if duration_ms > 0 else ""

        self.console.print(f"  [{color}]{symbol} Complete{duration_str}[/{color}]")

        # Show output preview for certain tools
        if output and success:
            self._display_output_preview(tool, output)

    def _display_output_preview(self, tool: str, output: str) -> None:
        """Display a preview of tool output with Egyptian styling."""
        max_lines = 10
        lines = output.splitlines()

        if len(lines) > max_lines:
            preview_lines = lines[:max_lines]
            truncated = True
        else:
            preview_lines = lines
            truncated = False

        if not preview_lines:
            return

        # Format based on tool type
        if tool == "read":
            content = "\n".join(preview_lines[:5])
            if truncated:
                content += f"\n‖ ... ({len(lines) - 5} more lines) ‖"

            # Decorative border for scroll content
            for line in preview_lines[:5]:
                self.console.print(Text(f"  │ {line}", style="papyrus"))
            if truncated:
                self.console.print(Text(f"  ‖ ... scroll continues ‖", style="dim"))

        elif tool in ("glob", "find"):
            if len(preview_lines) <= 20:
                self._display_scroll_list(preview_lines)
            else:
                self.console.print(f"  𓃊 Found {len(lines)} scrolls")

        elif tool == "shell":
            for line in preview_lines[:5]:
                self.console.print(Text(f"  │ {line}", style="dim"))
            if truncated:
                self.console.print(Text(f"  ‖ ... ({len(lines) - 5} more lines) ‖", style="dim"))

        elif tool in ("git_status", "git_log"):
            for line in preview_lines[:10]:
                self.console.print(Text(f"  │ {line}", style="dim"))

        elif tool == "web_search":
            result_count = len([l for l in lines if l.strip() and not l.startswith("-")])
            self.console.print(f"  𓁹 Found {result_count} records")

        else:
            for line in preview_lines[:3]:
                self.console.print(Text(f"  │ {line}", style="dim"))
            if truncated:
                self.console.print(Text(f"  ‖ ... ({len(lines) - 3} more lines) ‖", style="dim"))

    def _display_scroll_list(self, files: list[str]) -> None:
        """Display a list of files as a collection of scrolls."""
        tree = Tree("𓃊 Scrolls Discovered")
        for f in files[:20]:
            tree.add(f"𓃉 {f}")
        self.console.print(Padding(tree, (0, 2)))

    def display_session_summary(self) -> None:
        """Display summary of completed actions."""
        if not self.state.completed_tools:
            return

        total = len(self.state.completed_tools)
        total_duration = sum(t.duration_ms for t in self.state.completed_tools)

        self.console.print(
            f"\n[dim]𓋹 {total} ritual{'s' if total != 1 else ''} completed in {total_duration}ms 𓋹[/dim]"
        )

    def display_error(self, error: str, context: str = "") -> None:
        """Display an error with Egyptian styling."""
        symbol = self.symbols["error"]
        text = Text()
        text.append(f"{symbol} ", style="bold red_jasper")
        if context:
            text.append(f"{context}: ", style="red_jasper")
        text.append(error, style="red_jasper")
        self.console.print(text)

    def display_success(self, message: str) -> None:
        """Display a success message."""
        symbol = self.symbols["completed"]
        self.console.print(f"{symbol} {message}", style="malachite")

    def clear_screen(self) -> None:
        """Clear the console."""
        self.console.clear()


# Convenience functions
def get_display(console: Console | None = None, use_ascii: bool = False) -> TehutiDisplayManager:
    """Get or create the global display manager."""
    return TehutiDisplayManager(console, use_ascii)
