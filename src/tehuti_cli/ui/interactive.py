"""
Interactive Chat Shell for Project Tehuti

This module implements the interactive conversational interface for Project Tehuti.
It provides a rich, interactive chat experience with:
- Natural language input
- Real-time streaming responses
- Tool execution visualization
- Context management
- Approval system for high-risk operations
- Session persistence
- History management

The UI follows Tehuti's gold-on-obsidian theme for consistency.
"""

from __future__ import annotations

import asyncio
import json
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, List, Dict, Optional, Union

from prompt_toolkit.completion import Completer, Completion
from prompt_toolkit.document import Document
from prompt_toolkit.formatted_text import FormattedText
from prompt_toolkit.history import FileHistory
from prompt_toolkit.key_binding import KeyBindings
from prompt_toolkit.layout import Layout
from prompt_toolkit.shortcuts import PromptSession
from rich.console import Console
from rich.live import Live
from rich.panel import Panel
from rich.progress import Progress, SpinnerColumn, TextColumn
from rich.table import Table

from tehuti_cli.storage.config import Config
from tehuti_cli.providers.llm import TehutiLLM
from tehuti_cli.core.runtime import ToolRuntime, ToolResult
from tehuti_cli.core.tools import ToolRegistry
from tehuti_cli.ui.theme import (
    THEME,
    PROMPT_AGENT,
    PROMPT_SHELL,
    PROMPT_THINKING,
    PROMPT_STREAMING,
    PROMPT_SUCCESS,
    PROMPT_ERROR,
)
from tehuti_cli.storage.session import (
    create_session,
    load_last_session,
    load_session,
    set_last_session as save_session,
)


@dataclass
class ChatMessage:
    """Represents a single chat message."""

    role: str
    content: str
    timestamp: float = field(default_factory=time.monotonic)
    tool_calls: List[Dict[str, Any]] = field(default_factory=list)
    tool_results: List[Dict[str, Any]] = field(default_factory=list)


@dataclass
class ChatState:
    """Maintains the state of the chat session."""

    messages: List[ChatMessage] = field(default_factory=list)
    context: str = ""
    session_id: str = ""
    working_dir: Path = Path.cwd()
    history_file: Path = Path.home() / ".tehuti" / "chat_history.txt"


class ChatShell:
    """
    Interactive chat shell for Project Tehuti.

    Handles the conversational interface, tool execution, and state management.
    """

    def __init__(
        self, config: Config, work_dir: Path, show_banner: bool = False, resume: bool = False, session_id: str = None
    ):
        self.config = config
        self.work_dir = work_dir
        self.show_banner = show_banner
        self.console = Console(theme=THEME)
        self.llm = TehutiLLM(config)
        self.runtime = ToolRuntime(config, work_dir)
        self.registry = ToolRegistry(config)
        self.state = ChatState(working_dir=work_dir)
        self.session = PromptSession(history=FileHistory(str(self.state.history_file)))

        self._init_session(resume, session_id)

        # Keyboard bindings
        self.bindings = KeyBindings()

        @self.bindings.add("c-c")
        def _(event):
            """Handle Ctrl+C to exit or interrupt."""
            self.console.print("\n[warning]Session interrupted. Type '/exit' to quit.[/warning]")

        @self.bindings.add("c-d")
        def _(event):
            """Handle Ctrl+D to exit."""
            self._exit()

    def _create_completer(self):
        """Create a completer for command autocompletion."""
        commands = [
            "/exit",
            "/help",
            "/models",
            "/provider",
            "/permissions",
            "/summary",
            "/status",
            "/yolo",
            "/thoth:status",
            "/clear",
        ]

        class CommandCompleter(Completer):
            def get_completions(self, document: Document, complete_event):
                text_before_cursor = document.text_before_cursor

                # Command completion
                if text_before_cursor.startswith("/"):
                    for cmd in commands:
                        if cmd.startswith(text_before_cursor):
                            yield Completion(cmd, start_position=-len(text_before_cursor))

                # Tool name completion (for tool calls)
                if text_before_cursor.endswith('"name": "'):
                    for tool in self.registry.list_tools():
                        yield Completion(f'"{tool.name}"', start_position=0)

        return CommandCompleter()

    def _init_session(self, resume: bool, session_id: str):
        """Initialize session state."""
        if resume or session_id:
            if session_id:
                # Load specific session
                self._load_session(session_id)
            else:
                # Load last session for this directory
                last_session = load_last_session(self.work_dir)
                if last_session:
                    self.console.print(f"[info]Resuming session: {last_session.id}[/info]")
                    self._load_session(last_session.id)
        else:
            # Create new session
            self._create_new_session()

    def _create_new_session(self):
        """Create a new session with unique ID."""
        import uuid

        self.state.session_id = str(uuid.uuid4())
        self.console.print(f"[info]New session: {self.state.session_id}[/info]")
        # Save session information
        save_session(self.work_dir, self.state.session_id)

    def _load_session(self, session_id: str):
        """Load a specific session from storage."""
        session = load_session(session_id, self.work_dir)
        if session is None:
            self.console.print(f"[warning]Session {session_id} not found; creating new session.[/warning]")
            self._create_new_session()
            return
        self.state.session_id = session_id
        self.state.messages = []
        self.state.context = ""
        for item in session.iter_context():
            role = str(item.get("role", "user"))
            content = str(item.get("content", ""))
            if role not in {"user", "assistant", "system"}:
                role = "user"
            self.state.messages.append(ChatMessage(role=role, content=content))
        self.console.print(f"[info]Session {session_id} loaded[/info]")

    def _save_session_state(self):
        """Save the current session state to storage."""
        if not self.state.session_id:
            self._create_new_session()
        session = load_session(self.state.session_id, self.work_dir)
        if session is None:
            session = create_session(self.work_dir, session_id=self.state.session_id)
        # Rebuild persistent context from in-memory state for deterministic restore.
        session.context_file.write_text("", encoding="utf-8")
        for msg in self.state.messages:
            session.append_context(msg.role, msg.content)

    def _manage_memory(self):
        """Manage conversation memory to prevent excessive token usage."""
        max_messages = 20
        if len(self.state.messages) > max_messages:
            # Keep the most recent messages
            self.state.messages = self.state.messages[-max_messages:]
            # Summarize older messages to keep context
            self._summarize_context()

    def _summarize_context(self):
        """Summarize the conversation context to reduce token usage."""
        if len(self.state.messages) > 10:
            # Create a summary of the conversation
            try:
                summary_prompt = "Summarize the following conversation in 3-5 sentences:\n\n"
                for msg in self.state.messages[:-5]:  # Keep last 5 messages as full context
                    summary_prompt += f"{msg.role}: {msg.content}\n"

                summary = self.llm.chat(summary_prompt)
                self.state.context = summary
                # Replace older messages with summary
                self.state.messages = [
                    ChatMessage(role="system", content=f"Conversation Summary: {summary}")
                ] + self.state.messages[-5:]
            except Exception as e:
                self.console.print(f"[warning]Error summarizing context: {e}[/warning]")

    def _show_banner(self):
        """Show the Tehuti banner."""
        banner = """
[title]𓅞  Project Tehuti - Thoth, Architect of Truth  𓅞[/title]

Welcome to Project Tehuti, your AI development partner. I understand natural language
and can help with coding, DevOps, system administration, and much more.

Type your request or use /commands for help.
        """.strip()
        self.console.print(Panel(banner, border_style="gold"))
        self.console.print()

    def _show_help(self):
        """Show available commands."""
        table = Table(show_header=True, header_style="gold")
        table.add_column("Command", style="cyan")
        table.add_column("Description")

        commands = [
            ("/exit", "Exit the interactive shell"),
            ("/help", "Show this help message"),
            ("/models", "List available models"),
            ("/provider", "Switch LLM provider"),
            ("/permissions", "Control what Tehuti can do"),
            ("/summary", "See what we've done this session"),
            ("/status", "Current configuration and context"),
            ("/yolo", "Toggle auto-approve mode"),
            ("/thoth:status", "Project progress tracking"),
            ("/clear", "Clear the screen"),
        ]

        for cmd, desc in commands:
            table.add_row(cmd, desc)

        self.console.print(table)

    def _parse_command(self, input_text: str) -> Optional[Dict[str, Any]]:
        """Parse user input for commands starting with /."""
        if not input_text.startswith("/"):
            return None

        parts = input_text.split()
        command = parts[0].lower()

        command_map = {
            "/exit": {"type": "exit"},
            "/help": {"type": "help"},
            "/models": {"type": "list_models"},
            "/provider": {"type": "list_providers"},
            "/permissions": {"type": "permissions"},
            "/summary": {"type": "summary"},
            "/status": {"type": "status"},
            "/yolo": {"type": "toggle_yolo"},
            "/thoth:status": {"type": "thoth_status"},
            "/clear": {"type": "clear"},
        }

        return command_map.get(command, {"type": "unknown", "command": command})

    def _execute_command(self, command: Dict[str, Any]) -> bool:
        """Execute a parsed command."""
        match command["type"]:
            case "exit":
                self._exit()
                return False
            case "help":
                self._show_help()
            case "list_models":
                self._list_models()
            case "list_providers":
                self._list_providers()
            case "permissions":
                self._show_permissions()
            case "summary":
                self._show_summary()
            case "status":
                self._show_status()
            case "toggle_yolo":
                self._toggle_yolo()
            case "thoth_status":
                self._thoth_status()
            case "clear":
                self.console.clear()
                if self.show_banner:
                    self._show_banner()
            case "unknown":
                self.console.print(f"[warning]Unknown command: {command['command']}[/warning]")

        return True

    def _list_models(self):
        """List available models."""
        try:
            models = self.llm.list_models()
            table = Table(show_header=True, header_style="gold")
            table.add_column("Model ID")
            table.add_column("Name")
            table.add_column("Description")

            for model in models:
                table.add_row(
                    model.get("id", ""),
                    model.get("name", ""),
                    model.get("description", "")[:80] + "..."
                    if len(model.get("description", "")) > 80
                    else model.get("description", ""),
                )

            self.console.print(table)
        except Exception as e:
            self.console.print(f"[warning]Failed to list models: {e}[/warning]")

    def _list_providers(self):
        """List available providers."""
        providers = ["openrouter", "openai", "gemini"]
        current = self.config.provider.type

        table = Table(show_header=True, header_style="gold")
        table.add_column("Provider")
        table.add_column("Status")
        table.add_column("Model")

        for provider in providers:
            status = "✓ Current" if provider == current else "Available"
            model = self.config.providers.__dict__[provider].model
            table.add_row(provider, status, model if model else "Not configured")

        self.console.print(table)

    def _show_permissions(self):
        """Show current permission settings."""
        table = Table(show_header=True, header_style="gold")
        table.add_column("Permission")
        table.add_column("Value")

        permissions = [
            ("YOLO mode", "Enabled" if self.config.default_yolo else "Disabled"),
            ("Allow shell", "Yes" if self.config.allow_shell else "No"),
            ("Allow write", "Yes" if self.config.allow_write else "No"),
            ("Allow external", "Yes" if self.config.allow_external else "No"),
            ("Approval mode", self.config.approval_mode),
            ("Execution mode", self.config.execution_mode),
            ("Interaction mode", self.config.interaction_mode),
        ]

        for name, value in permissions:
            table.add_row(name, value)

        self.console.print(table)

    def _show_summary(self):
        """Show session summary."""
        if not self.state.messages:
            self.console.print("No messages in this session.")
            return

        user_messages = [msg for msg in self.state.messages if msg.role == "user"]
        assistant_messages = [msg for msg in self.state.messages if msg.role == "assistant"]

        self.console.print(f"[info]Session Summary:[/info]")
        self.console.print(f"  User messages: {len(user_messages)}")
        self.console.print(f"  Assistant responses: {len(assistant_messages)}")

        tool_calls = sum(len(msg.tool_calls) for msg in self.state.messages if msg.role == "assistant")
        self.console.print(f"  Tool calls: {tool_calls}")

    def _show_status(self):
        """Show system status."""
        self.console.print(f"[info]System Status:[/info]")
        self.console.print(f"  Provider: {self.config.provider.type}")
        self.console.print(f"  Model: {self.config.provider.model}")
        self.console.print(f"  Working directory: {self.work_dir}")
        self.console.print(f"  Session ID: {self.state.session_id}")

        # Check tool availability
        from tehuti_cli.tool_availability import ToolAvailability

        self.console.print()
        self.console.print(ToolAvailability.format_status())

    def _toggle_yolo(self):
        """Toggle YOLO mode."""
        self.config.default_yolo = not self.config.default_yolo
        from tehuti_cli.storage.config import save_config

        save_config(self.config)
        self.console.print(f"[success]YOLO mode {'enabled' if self.config.default_yolo else 'disabled'}[/success]")

    def _thoth_status(self):
        """Show project progress tracking."""
        self.console.print("[info]Runtime Status[/info]")
        table = Table(border_style="gold")
        table.add_column("Metric", style="gold")
        table.add_column("Value", style="sand")
        table.add_row("Messages", str(len(self.state.messages)))
        table.add_row("Session", self.state.session_id or "n/a")
        table.add_row("Working Directory", str(self.work_dir))
        table.add_row("Provider", self.config.provider.type)
        table.add_row("Model", self.config.provider.model or "not set")
        table.add_row("YOLO", "enabled" if self.config.default_yolo else "disabled")
        self.console.print(table)

    def _exit(self):
        """Exit the interactive shell."""
        self.console.print()
        self.console.print("[success]Session closed.[/success]")
        sys.exit(0)

    async def _run_agent_loop(self, user_input: str):
        """Run the agent reasoning loop for a single user input."""
        # Add user message to state
        user_msg = ChatMessage(role="user", content=user_input)
        self.state.messages.append(user_msg)

        # Manage memory to prevent excessive token usage
        self._manage_memory()

        # Show dynamic thinking indicator
        token_hint = max(1, len(user_input.strip()) // 4)
        self.console.print(f"[gold]{PROMPT_THINKING}[/gold] Processing request (~{token_hint} token estimate)")

        try:
            # Convert messages to LLM format
            llm_messages = []

            # Add context if available
            if self.state.context:
                llm_messages.append({"role": "system", "content": self.state.context})

            # Add conversation history
            for msg in self.state.messages:
                llm_messages.append({"role": msg.role, "content": msg.content})

            # Get LLM response with streaming
            self.console.print(f"[cyan]{PROMPT_STREAMING}[/cyan] ", end="")
            response, _ = self.llm.chat_stream(llm_messages)

            # Process LLM response
            assistant_msg = ChatMessage(role="assistant", content=response)
            self.state.messages.append(assistant_msg)
            self._save_session_state()

            # Print response with formatting
            self.console.print(f"[gold]{PROMPT_AGENT}[/gold] {response}")

            # Check for tool calls
            tool_calls = self._parse_tool_calls(response)
            if tool_calls:
                assistant_msg.tool_calls = tool_calls
                await self._execute_tool_calls(tool_calls)

        except Exception as e:
            self.console.print(f"\n[error]{PROMPT_ERROR} Error: {e}[/error]")
            import traceback

            self.console.print(f"[dim]{traceback.format_exc()}[/dim]")

    def _parse_tool_calls(self, response: str) -> List[Dict[str, Any]]:
        """Parse tool calls from LLM response."""
        # Parse tool calls in JSON format like:
        # { "type": "tool", "name": "tool_name", "args": {"param": "value"} }
        tool_calls = []

        # Find all possible JSON objects in the response
        import re

        # Match JSON objects with possible nested structures
        stack = []
        json_start = -1

        for i, char in enumerate(response):
            if char == "{":
                if json_start == -1:
                    json_start = i
                stack.append(char)
            elif char == "}":
                if stack:
                    stack.pop()
                    if not stack and json_start != -1:
                        # Extract and parse JSON
                        json_str = response[json_start : i + 1]
                        try:
                            data = json.loads(json_str)
                            if data.get("type") == "tool" and data.get("name") and data.get("args"):
                                tool_calls.append(data)
                        except Exception:
                            pass
                        json_start = -1

        return tool_calls

    async def _execute_tool_calls(self, tool_calls: List[Dict[str, Any]]):
        """Execute tool calls with proper validation and safety checks."""
        for tool_call in tool_calls:
            tool_name = tool_call["name"]
            tool_args = tool_call["args"]

            # Check tool availability
            if not self.registry.get(tool_name):
                self.console.print(f"[warning]Unknown tool: {tool_name}[/warning]")
                continue

            # Check approval
            if not self.runtime.approve(tool_name, tool_args):
                self.console.print(f"[warning]Tool call denied: {tool_name}[/warning]")
                continue

            # Request approval for high-risk operations
            if self._is_high_risk(tool_name, tool_args):
                if not await self._request_approval(tool_name, tool_args):
                    continue

            # Execute tool
            self.console.print(f"[info]{PROMPT_SHELL} Executing: {tool_name}[/info]")

            try:
                result, _trace_event = self.runtime.execute_with_tracing(
                    tool_name,
                    tool_args,
                    timeout=30.0,
                )
                self._handle_tool_result(tool_name, result)
            except Exception as e:
                self.console.print(f"[error]{PROMPT_ERROR} Error executing {tool_name}: {e}[/error]")

    def _is_high_risk(self, tool_name: str, tool_args: Dict[str, Any]) -> bool:
        """Check if a tool call is high-risk and requires explicit approval."""
        high_risk_tools = {
            "write",
            "edit",
            "rm",
            "mv",
            "chmod",
            "chown",
            "ln",
            "docker_run",
            "docker_build",
            "docker_exec",
            "docker_compose",
            "apt_install",
            "pip_install",
            "npm_install",
            "git_push",
            "git_pull",
            "git_clone",
            "terraform",
            "ansible_playbook",
            "systemctl",
            "service",
            "kill",
            "crontab",
            "python_file",
            "node_file",
            "bash_script",
            "tool_create_shell",
            "tool_create_python",
            "tool_create_api",
            "tool_edit",
            "tool_delete",
            "tool_import",
            "stream_chat",
            "stream_append",
            "stream_lines",
            "stream_json",
            "stream_jsonl",
            "stream_csv",
            "stream_xml",
            "stream_yaml",
            "stream_markdown",
            "stream_table",
            "stream_diff",
            "stream_log",
        }

        if tool_name in high_risk_tools:
            return True

        if tool_name == "shell":
            cmd = str(tool_args.get("command", "")).lower()
            risky_tokens = (" rm ", " mv ", " chmod ", " chown ", " git push", " docker run", " pip install")
            normalized = f" {cmd} "
            return any(token in normalized for token in risky_tokens)

        if tool_name.startswith("automation_") or tool_name.startswith("delegate_"):
            return True

        return False

    async def _request_approval(self, tool_name: str, tool_args: Dict[str, Any]) -> bool:
        """Request user approval for high-risk operations."""
        self.console.print()
        self.console.print(f"[warning]High-risk operation: {tool_name}[/warning]")

        # Show tool arguments
        if tool_args:
            args_str = json.dumps(tool_args, indent=2)
            self.console.print(f"[dim]Arguments:\n{args_str}[/dim]")

        # Get user input
        try:
            response = await self.session.prompt_async(
                FormattedText(
                    [
                        ("gold", "Allow this operation? "),
                        ("cyan", "(y/n) "),
                    ]
                )
            )

            response = response.strip().lower()
            return response in {"y", "yes"}

        except Exception as e:
            self.console.print(f"\n[error]Error getting approval: {e}[/error]")
            return False

    def _handle_tool_result(self, tool_name: str, result: ToolResult):
        """Handle tool execution results with rich visualization."""
        output = str(result.output or "").strip()
        if result.ok:
            summary = output if output else f"{tool_name} returned no output."
            if len(summary) > 180:
                summary = summary[:177] + "..."
            self.console.print(f"[success]{PROMPT_SUCCESS} {tool_name}: {summary}[/success]")
            if output:
                self.console.print()
                # Truncate long outputs
                truncated = self._truncate_output(output)
                self.console.print(Panel(truncated, border_style="green"))
        else:
            detail = output if output else "no error output"
            self.console.print(f"[error]{PROMPT_ERROR} {tool_name} failed: {detail}[/error]")

    def _truncate_output(self, output: str, max_length: int = 1000) -> str:
        """Truncate long tool outputs for better readability."""
        if len(output) <= max_length:
            return output

        half = max_length // 2
        return output[:half] + "\n...\n" + output[-half:]

    async def run(self):
        """Main interactive loop."""
        # Show banner if requested
        if self.show_banner:
            self._show_banner()

        # Welcome message
        self.console.print("[gold]Tehuti is ready to help. Type your request or /help for commands.[/gold]")
        self.console.print()

        # Main loop
        while True:
            try:
                # Get user input with autocompletion
                user_input = await self.session.prompt_async(
                    FormattedText(
                        [
                            ("gold", f"{PROMPT_AGENT} "),
                            ("", "Type your request: "),
                        ]
                    ),
                    key_bindings=self.bindings,
                    completer=self._create_completer(),
                    complete_while_typing=True,
                )

                user_input = user_input.strip()
                if not user_input:
                    continue

                # Check if it's a command
                command = self._parse_command(user_input)
                if command:
                    if not self._execute_command(command):
                        break
                    continue

                # Run agent loop
                await self._run_agent_loop(user_input)

            except KeyboardInterrupt:
                self.console.print("\n[warning]Session interrupted. Type '/exit' to quit.[/warning]")
            except EOFError:
                self.console.print()
                self._exit()
            except Exception as e:
                self.console.print(f"[error]{PROMPT_ERROR} Error: {e}[/error]")


def create_interactive_shell(
    config: Config, work_dir: Path, show_banner: bool = False, resume: bool = False, session_id: str = None
) -> ChatShell:
    """Create and initialize the interactive chat shell."""
    return ChatShell(config=config, work_dir=work_dir, show_banner=show_banner, resume=resume, session_id=session_id)
