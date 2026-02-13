"""Comprehensive agent display system leveraging Rich library.

This module provides modern, user-friendly display patterns inspired by:
- Claude Desktop (Anthropic)
- Cursor IDE
- Aider
- Rich library best practices

Features:
- Live status spinners during operations
- Tool-specific icons and colors
- Thinking/reasoning display
- Progress tracking for multi-step tasks
- Syntax-highlighted output
- Real-time updates
"""

from __future__ import annotations

import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Generator, Literal

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


class AgentDisplayManager:
    """Manages all agent display output with Rich."""
    
    # Tool icons mapping
    ICONS = {
        # File operations
        "read": "📖",
        "write": "✍️",
        "edit": "✏️",
        "glob": "🔍",
        "grep": "🔎",
        "find": "🗂️",
        "ls": "📁",
        "cat": "📄",
        "head": "📄",
        "tail": "📄",
        
        # Shell & System
        "shell": "⚡",
        "host_discovery": "🔍",
        "docker_ps": "🐳",
        "docker_run": "🐳",
        "docker_build": "🐳",
        "docker_exec": "🐳",
        "kubectl": "☸️",
        "terraform": "🏗️",
        "ansible_playbook": "📋",
        "systemctl": "⚙️",
        "service": "⚙️",
        
        # Web & Search
        "fetch": "🌐",
        "web_search": "🔍",
        "web_fetch": "🌐",
        "api_get": "📡",
        "api_post": "📤",
        "extract_text": "📄",
        "search_ddg": "🔍",
        
        # Version Control
        "git_status": "📊",
        "git_log": "📜",
        "git_diff": "📝",
        "git_branch": "🌿",
        "git_push": "🚀",
        "git_pull": "📥",
        "git_clone": "📥",
        "gh": "🐙",
        "glab": "🦊",
        
        # Testing & Build
        "pytest": "🧪",
        "jest": "🧪",
        "unittest": "🧪",
        "cargo_test": "🧪",
        "go_test": "🧪",
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
        "image_describe": "🖼️",
        "qrcode_read": "📱",
        "qrcode_generate": "📱",
        "barcode_detect": "📊",
        
        # Browser
        "browser_navigate": "🌐",
        "browser_click": "🖱️",
        "browser_fill": "📝",
        "browser_type": "⌨️",
        "browser_screenshot": "📸",
        "browser_evaluate": "🔍",
        
        # Special
        "thinking": "🧠",
        "planning": "📋",
        "reasoning": "💭",
        "waiting": "⏳",
        "completed": "✅",
        "error": "❌",
        "default": "🔧",
    }
    
    # Color schemes
    COLORS = {
        "thinking": "bright_magenta",
        "reading": "bright_blue",
        "writing": "bright_green",
        "executing": "bright_yellow",
        "searching": "bright_cyan",
        "web": "bright_cyan",
        "docker": "bright_blue",
        "git": "bright_orange",
        "testing": "bright_green",
        "error": "bright_red",
        "success": "bright_green",
        "info": "bright_white",
    }
    
    def __init__(self, console: Console | None = None):
        self.console = console or Console()
        self.state = SessionState()
        self._live_display: Live | None = None
        self._status: Status | None = None
    
    def get_icon(self, tool: str) -> str:
        """Get icon for a tool."""
        return self.ICONS.get(tool, self.ICONS["default"])
    
    def get_color(self, category: str) -> str:
        """Get color for a category."""
        return self.COLORS.get(category, self.COLORS["info"])
    
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
    def show_thinking(self, thought: str = "Processing request") -> Generator[None, None, None]:
        """Display thinking/reasoning with a spinner."""
        icon = self.ICONS["thinking"]
        color = self.COLORS["thinking"]
        
        text = Text()
        text.append(f"{icon} ", style=color)
        text.append(thought, style=f"italic {color}")
        
        with self.console.status(text, spinner="dots", spinner_style=color) as status:
            self.state.thinking = thought
            self.state.is_processing = True
            yield
            self.state.is_processing = False
            self.state.thinking = ""
    
    def display_thinking(self, thought: str) -> None:
        """Display agent's thinking process."""
        icon = self.ICONS["thinking"]
        color = self.COLORS["thinking"]
        
        panel = Panel(
            Text(thought, style=f"italic {color}"),
            title=f"{icon} Thinking",
            border_style=color,
            expand=False,
        )
        self.console.print(panel)
    
    def display_plan(self, steps: list[str]) -> None:
        """Display a plan with numbered steps."""
        icon = self.ICONS["planning"]
        
        tree = Tree(f"{icon} Plan")
        for i, step in enumerate(steps, 1):
            tree.add(f"[dim]{i}.[/dim] {step}")
        
        panel = Panel(
            tree,
            border_style="blue",
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
        """Display tool execution with live status."""
        icon = self.get_icon(tool)
        category = self._categorize_tool(tool)
        color = self.get_color(category)
        
        # Format the action description
        description = self._format_tool_description(tool, args)
        if purpose:
            description = f"{purpose}: {description}"
        
        text = Text()
        text.append(f"{icon} ", style=color)
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
            return f"Reading {args.get('path', 'file')}"
        elif tool == "write":
            return f"Writing to {args.get('path', 'file')}"
        elif tool == "edit":
            path = args.get('path', 'file')
            old_str = args.get('old_string', '')[:30]
            if len(old_str) >= 30:
                old_str += "..."
            return f"Editing {path}"
        elif tool == "shell":
            cmd = args.get('command', '')
            if len(cmd) > 50:
                cmd = cmd[:47] + "..."
            return f"Running: {cmd}"
        elif tool == "glob":
            return f"Finding files: {args.get('pattern', '*')}"
        elif tool == "grep":
            return f"Searching for: {args.get('pattern', '')}"
        elif tool == "web_search":
            return f"Searching web: {args.get('query', args.get('q', ''))}"
        elif tool == "fetch":
            url = args.get('url', '')
            if len(url) > 50:
                url = url[:47] + "..."
            return f"Fetching: {url}"
        elif tool == "image_analyze":
            return f"Analyzing image: {args.get('image_path', '')}"
        elif tool == "git_status":
            return "Checking git status"
        elif tool.startswith("git_"):
            return f"Git {tool.replace('git_', '')}"
        elif tool.startswith("docker_"):
            return f"Docker {tool.replace('docker_', '')}"
        elif tool == "pytest":
            return "Running tests"
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
        icon = "✓" if success else "✗"
        color = self.COLORS["success"] if success else self.COLORS["error"]
        duration_str = f" ({duration_ms}ms)" if duration_ms > 0 else ""
        
        self.console.print(f"  [{color}]{icon} Done{duration_str}[/{color}]")
        
        # Show output preview for certain tools
        if output and success:
            self._display_output_preview(tool, output)
    
    def _display_output_preview(self, tool: str, output: str) -> None:
        """Display a preview of tool output."""
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
            # Show file content with line numbers
            content = "\n".join(preview_lines[:5])
            if truncated:
                content += f"\n... ({len(lines) - 5} more lines)"
            
            try:
                # Try to detect language
                lang = self._detect_language(output)
                syntax = Syntax(content, lang, theme="monokai", line_numbers=False)
                self.console.print(Padding(syntax, (0, 2)))
            except Exception:
                # Fallback to plain text
                for line in preview_lines[:5]:
                    self.console.print(Text(f"  │ {line}", style="dim"))
        
        elif tool in ("glob", "find"):
            # Show file list as tree
            if len(preview_lines) <= 20:
                self._display_file_list(preview_lines)
            else:
                self.console.print(f"  📁 Found {len(lines)} files")
        
        elif tool == "shell":
            # Show command output
            for line in preview_lines[:5]:
                self.console.print(Text(f"  │ {line}", style="dim"))
            if truncated:
                self.console.print(Text(f"  │ ... ({len(lines) - 5} more lines)", style="dim"))
        
        elif tool in ("git_status", "git_log"):
            # Show git output
            for line in preview_lines[:10]:
                self.console.print(Text(f"  │ {line}", style="dim"))
        
        elif tool == "web_search":
            # Show result count
            result_count = len([l for l in lines if l.strip() and not l.startswith("-")])
            self.console.print(f"  🔍 Found {result_count} results")
        
        else:
            # Generic preview
            for line in preview_lines[:3]:
                self.console.print(Text(f"  │ {line}", style="dim"))
            if truncated:
                self.console.print(Text(f"  │ ... ({len(lines) - 3} more lines)", style="dim"))
    
    def _detect_language(self, content: str) -> str:
        """Detect programming language from content."""
        # Simple heuristic
        if "def " in content or "import " in content or "class " in content:
            return "python"
        elif "function" in content or "const " in content or "let " in content:
            return "javascript"
        elif "<?php" in content:
            return "php"
        elif "<html" in content or "<!DOCTYPE" in content:
            return "html"
        elif "{" in content and "}" in content and ";" in content:
            return "json"
        else:
            return "text"
    
    def _display_file_list(self, files: list[str]) -> None:
        """Display a list of files as a tree."""
        tree = Tree("📁 Files")
        for f in files[:20]:
            tree.add(f"📄 {f}")
        self.console.print(Padding(tree, (0, 2)))
    
    def display_progress(
        self,
        description: str,
        total: int | None = None,
    ) -> Progress:
        """Create and return a progress bar."""
        progress = Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            TimeElapsedColumn(),
            console=self.console,
        )
        return progress
    
    def display_error(self, error: str, context: str = "") -> None:
        """Display an error message."""
        icon = self.ICONS["error"]
        text = Text()
        text.append(f"{icon} ", style="bold red")
        if context:
            text.append(f"{context}: ", style="red")
        text.append(error, style="red")
        self.console.print(text)
    
    def display_success(self, message: str) -> None:
        """Display a success message."""
        icon = self.ICONS["completed"]
        self.console.print(f"{icon} {message}", style="green")
    
    def display_session_summary(self) -> None:
        """Display summary of completed actions in session."""
        if not self.state.completed_tools:
            return
        
        total = len(self.state.completed_tools)
        total_duration = sum(t.duration_ms for t in self.state.completed_tools)
        
        self.console.print(f"\n[dim]Completed {total} action{'s' if total != 1 else ''} in {total_duration}ms[/dim]")
    
    def clear_screen(self) -> None:
        """Clear the console."""
        self.console.clear()


# Convenience functions for quick access
def get_display(console: Console | None = None) -> AgentDisplayManager:
    """Get or create the global display manager."""
    return AgentDisplayManager(console)


# Example usage patterns
if __name__ == "__main__":
    # Demo
    console = Console()
    display = AgentDisplayManager(console)
    
    # Show thinking
    with display.show_thinking("Analyzing project structure..."):
        time.sleep(1)
    
    # Show plan
    display.display_plan([
        "Read configuration files",
        "Analyze dependencies",
        "Generate report",
    ])
    
    # Execute tool with status
    with display.show_tool_execution("read", {"path": "README.md"}) as info:
        time.sleep(0.5)
        info.success = True
        info.output = "# Project\n\nThis is a test project."
    
    display.display_tool_result("read", True, info.output, info.duration_ms)
    
    # Show session summary
    display.display_session_summary()
