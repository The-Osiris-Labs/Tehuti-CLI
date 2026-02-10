from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import random
import time
import subprocess
import textwrap
from prompt_toolkit import PromptSession
from prompt_toolkit.completion import Completion, Completer, FuzzyCompleter, WordCompleter
from prompt_toolkit.document import Document
from prompt_toolkit.completion import CompleteEvent
from prompt_toolkit.completion import PathCompleter
from prompt_toolkit.shortcuts import radiolist_dialog, CompleteStyle
from rapidfuzz import fuzz, process
from prompt_toolkit.styles import Style as PTStyle
from rich.align import Align
from rich.console import Console, Group
from rich.panel import Panel
from rich.table import Table
from rich.text import Text

import os

from tehuti_cli.storage.config import Config, save_config
from tehuti_cli.core.runtime import ToolRuntime
from tehuti_cli.core.tools import ToolRegistry
from tehuti_cli.providers.llm import TehutiLLM
from tehuti_cli.storage.session import Session
from tehuti_cli.ui.theme import GOLD, OBSIDIAN, PROMPT_AGENT, PROMPT_SHELL, PROMPT_THINKING, THEME
from tehuti_cli.utils.env import load_env_file
from tehuti_cli.utils.logger import get_logger


@dataclass
class WelcomeItem:
    name: str
    value: str


class Shell:
    def __init__(self, config: Config, work_dir: Path, session: Session, show_banner: bool = False):
        self.config = config
        self.work_dir = work_dir
        self.session = session
        self.console = Console(theme=THEME)
        self.llm = TehutiLLM(config)
        self.runtime = ToolRuntime(config, work_dir)
        self.registry = ToolRegistry(config)
        self.logger = get_logger("tehuti.shell", config)
        self.prompt_style = PTStyle.from_dict(
            {
                "prompt": f"{GOLD} bold",
                "placeholder": "#7b6a52",
                "completion-menu.completion": "bg:#1b1710 #cbb485",
                "completion-menu.completion.current": "bg:#2b2418 #ffd27d",
                "completion-menu.meta": "#8b7b5c",
                "": f"{GOLD}",
            }
        )
        self._slash_registry = {
            "/login": "configure API key and model",
            "/model": "choose what model and reasoning effort to use",
            "/m": "quick model picker",
            "/models": "list models (paging/filtering/favorites)",
            "/providers": "choose OpenRouter provider routing",
            "/p": "quick provider picker",
            "/provider": "switch base provider (openrouter/openai/gemini)",
            "/mcp": "list configured MCP tools",
            "/skills": "use skills to improve performance",
            "/permissions": "choose what Tehuti is allowed to do",
            "/experimental": "toggle experimental features",
            "/worklog": "toggle the scribe log",
            "/output": "set tool output mode (full|compact)",
            "/context": "show context window usage",
            "/status": "show current status",
            "/diff": "show git diff summary",
            "/tasks": "list active PTY sessions",
            "/plan": "create or show a session plan",
            "/transcript": "show full session transcript",
            "/diagnostics": "run system diagnostics",
            "/smoke": "run a quick tool smoke test",
            "/just-bash": "drop into a raw bash shell",
            "/allow-tool": "allow a specific tool",
            "/deny-tool": "deny a specific tool",
            "/reset-allowed-tools": "clear tool allow/deny lists",
            "/allow-url": "allow a web domain",
            "/deny-url": "deny a web domain",
            "/list-dirs": "list allowed paths",
            "/add-dir": "allow an additional path",
            "/review": "review current changes and find issues",
            "/rename": "rename the current thread",
            "/new": "start a new chat during a conversation",
            "/resume": "resume a saved chat",
            "/setup": "configure API key and model",
            "/mention": "mention a file",
            "/tools": "show tool sandbox configuration",
            "/session": "show session info",
            "/yolo": "toggle auto-approve tool actions",
            "/exit": "close the session",
        }
        self._custom_commands: dict[str, dict[str, str]] = {}
        self._load_custom_commands()
        for name, meta in self._custom_commands.items():
            self._slash_registry[f"/{name}"] = meta.get("description", "custom command")
        self._slash_completer = FuzzyCompleter(_SlashCompleter(self._slash_registry))
        self._path_completer = PathCompleter(expanduser=True)
        self._completer = _HybridCompleter(self._slash_completer, self._path_completer)
        self.prompt_session = PromptSession(
            completer=self._completer,
            complete_while_typing=True,
            complete_style=CompleteStyle.MULTI_COLUMN,
            reserve_space_for_menu=4,
            bottom_toolbar=self._status_bar,
            complete_in_thread=True,
        )
        self._placeholders = [
            "Find and fix a bug in @filename ",
            "Improve documentation in @filename ",
            "Refactor @filename for clarity ",
            "Explain the purpose of @filename ",
            "Summarize changes in @filename ",
            "Add tests for @filename ",
            "Review the diff in @filename ",
            "Trace the root cause in @filename ",
            "Summarize the intent of @filename ",
        ]
        self._tips = [
            "Tip: / for commands · ? for shortcuts",
        ]
        self._placeholder_index = 0
        self._models_cache: list[dict[str, Any]] = []
        self._models_page: int = 0
        self._providers_cache: list[dict[str, Any]] = []
        self._providers_page: int = 0
        self._show_banner = show_banner
        self._shell_mode = False
        self._busy = False
        self._streamed_actions = False
        self._sequence_started_at: float | None = None
        self._action_counter = 0
        self._last_actions: list[dict[str, Any]] = []
        self._last_outputs: list[str] = []
        self._checkpoint_counter = 0
        self._execution_mode = self._resolve_execution_mode()
        self._context_limit: int | None = None
        self._ensure_full_capability_defaults()

    def _ensure_full_capability_defaults(self) -> None:
        changed = False
        if not self.config.default_yolo:
            self.config.default_yolo = True
            changed = True
        if not self.config.allow_shell:
            self.config.allow_shell = True
            changed = True
        if not self.config.allow_write:
            self.config.allow_write = True
            changed = True
        if not self.config.allow_external:
            self.config.allow_external = True
            changed = True
        if self.config.allow_tools:
            self.config.allow_tools = []
            changed = True
        if self.config.deny_tools:
            self.config.deny_tools = []
            changed = True
        if changed:
            save_config(self.config)

    def _print_welcome(self) -> None:
        self.console.print()
        width = self.console.size.width
        if width >= 90:
            logo_lines = [
                "████████╗███████╗██╗  ██╗██╗   ██╗████████╗██╗",
                "╚══██╔══╝██╔════╝██║  ██║██║   ██║╚══██╔══╝██║",
                "   ██║   █████╗  ███████║██║   ██║   ██║   ██║",
                "   ██║   ██╔══╝  ██╔══██║██║   ██║   ██║   ██║",
                "   ██║   ███████╗██║  ██║╚██████╔╝   ██║   ██║",
                "   ╚═╝   ╚══════╝╚═╝  ╚═╝ ╚═════╝    ╚═╝   ╚═╝",
            ]
            logo = Text("\n".join(logo_lines), style="gold")
            crest = Text("𓅞  Thoth, Tongue of Ra", style="gold.soft")
            tagline = Text(
                "Halls of Records • Balance of Ma’at • Architect of Truth",
                style="gold.soft",
            )
            header = Group(Align.center(logo), Text(""), Align.center(crest), Align.center(tagline))
        else:
            logo = Text("PROJECT TEHUTI", style="gold")
            tagline = Text("Thoth • Tongue of Ra • Halls of Records • Ma’at", style="gold.soft")
            header = Group(Align.center(logo), Align.center(tagline))
        items = [
            WelcomeItem("Directory", str(self.work_dir)),
            WelcomeItem("Provider", self.config.provider.type),
            WelcomeItem("Model", self.config.provider.model or "not set"),
            WelcomeItem("Session", self.session.id),
            WelcomeItem("Decree", "You do not debug; you restore order."),
        ]
        table = Table.grid(padding=(0, 2))
        for item in items:
            table.add_row(Text(item.name, style="gold.soft"), Text(item.value, style="sand"))
        tip = Text(self._tips[0], style="gold.soft")
        body = Group(header, Text(""), table, Text(""), Align.center(tip))
        panel = Panel(body, border_style="gold", expand=True, padding=(1, 2))
        self.console.print(panel)


    def _animate_banner(self) -> None:
        import time
        frames = [
            r"""
            𓅞  TEHUTI
            """,
            r"""
            𓅞  PROJECT TEHUTI
            """,
        ]
        for frame in frames:
            self.console.clear()
            self.console.print(Text(frame.strip("\n"), style="gold"))
            time.sleep(0.08)
        self.console.clear()

    def _prompt(self) -> str:
        # prompt_toolkit expects plain text or its own formatted types, not Rich Text.
        glyph = ">" if os.getenv("TEHUTI_ASCII", "").strip() else PROMPT_AGENT
        if self._shell_mode:
            glyph = PROMPT_SHELL if os.getenv("TEHUTI_ASCII", "").strip() == "" else "!"
        prompt_text = f"{glyph}  "
        placeholder = self._next_placeholder()
        return self.prompt_session.prompt(
            prompt_text,
            style=self.prompt_style,
            placeholder=placeholder,
        )

    def run(self) -> None:
        if self._show_banner:
            self._animate_banner()
        self._print_welcome()
        if self.config.show_history:
            self._replay_history(limit=6)
        while True:
            try:
                user_input = self._prompt().strip()
            except (EOFError, KeyboardInterrupt):
                self.console.print("By decree, the session closes.")
                return

            if not user_input:
                continue
            if user_input in {"/exit", "/quit", "exit", "quit"}:
                self.console.print("By decree, the session closes.")
                return
            if user_input.strip() == "?":
                self._show_shortcuts()
                continue
            if user_input.strip() == "!":
                self._shell_mode = not self._shell_mode
                state = "on" if self._shell_mode else "off"
                self.console.print(f"[gold]Shell mode:[/gold] {state}")
                continue
            if user_input.startswith("!"):
                cmd = user_input[1:].strip()
                if cmd:
                    self._run_tool(f"/run shell {cmd}")
                continue
            if self._shell_mode and not user_input.startswith("/"):
                self._run_tool(f"/run shell {user_input}")
                continue
            if user_input.startswith("/"):
                try:
                    handled = self._handle_slash(user_input)
                except EOFError:
                    self.console.print("By decree, the session closes.")
                    return
                if handled:
                    continue
                self._run_prompt(user_input)
                continue

            self._run_prompt(user_input)

    def _replay_history(self, limit: int = 10) -> None:
        history = list(self.session.iter_context())
        if not history:
            return
        self.console.print("[dim]— recent history —[/dim]")
        for item in history[-limit:]:
            role = item.get("role", "")
            content = item.get("content", "")
            label = "You" if role == "user" else "Thoth"
            self.console.print(f"[gold]{label}:[/gold] {content}")
        self.console.print("")

    def _show_transcript(self) -> None:
        history = list(self.session.iter_context())
        if not history:
            self.console.print("[dim]No transcript yet.[/dim]")
            return
        blocks: list[str] = []
        for item in history:
            role = item.get("role", "user")
            content = item.get("content", "")
            label = "You" if role == "user" else "Thoth"
            blocks.append(f"{label}:\n{content}".strip())
        body = "\n\n".join(blocks).strip()
        try:
            import shutil
            import tempfile

            pager = shutil.which("less")
            if pager:
                with tempfile.NamedTemporaryFile("w", delete=False, encoding="utf-8") as tmp:
                    tmp.write(body + "\n")
                    path = tmp.name
                subprocess.run([pager, "-R", path], check=False)
                return
        except Exception:
            pass
        clipped = self._truncate_output_lines(body, max_lines=200, head=80, tail=40)
        self.console.print(Panel(Text(clipped, style="sand"), border_style="gold", title="Transcript"))

    def _handle_slash(self, command: str) -> bool:
        if command in {"/exit", "/quit"}:
            raise EOFError()
        if command.strip() == "/":
            self._show_slash_menu()
            return True
        if command.strip() == "/m":
            self._pick_model()
            return True
        if command.strip() == "/p":
            self._pick_provider()
            return True
        if command.startswith("/m") and " " not in command and len(command) <= 3:
            self._show_slash_menu(prefix=command)
            return True
        if command.startswith("/models"):
            parts = command.split()
            refresh = "refresh" in parts
            query = ""
            page_cmd = None
            if len(parts) == 1:
                self._pick_model(refresh=refresh)
                return True
            if len(parts) > 1:
                if parts[1] == "pick":
                    self._pick_model(refresh=refresh)
                    return True
                if parts[1] == "list":
                    query = ""
                if parts[1] in {"fav", "favorites"}:
                    query = "fav"
                elif parts[1] in {"add", "rm"} and len(parts) > 2:
                    query = f"{parts[1]} {parts[2]}"
                elif parts[1] in {"next", "prev"}:
                    page_cmd = parts[1]
                elif parts[1].isdigit():
                    page_cmd = f"page:{parts[1]}"
                else:
                    query = parts[1]
            self._select_model(refresh=refresh, query=query, page_cmd=page_cmd)
            return True
        if command.startswith("/providers"):
            parts = command.split()
            refresh = "refresh" in parts
            query = ""
            page_cmd = None
            for token in parts[1:]:
                if token == "pick":
                    self._pick_provider(refresh=refresh)
                    return True
                if token in {"next", "prev"}:
                    page_cmd = token
                elif token.isdigit():
                    page_cmd = f"page:{token}"
                elif token != "refresh":
                    query = token
            self._select_provider(refresh=refresh, query=query, page_cmd=page_cmd)
            return True
        if command.startswith("/mcp"):
            self._show_mcp()
            return True
        if command.startswith("/skills"):
            self._show_skills()
            return True
        if command.startswith("/permissions"):
            self._handle_permissions(command)
            return True
        if command.startswith("/worklog"):
            self._toggle_worklog(command)
            return True
        if command.startswith("/output"):
            self._toggle_output(command)
            return True
        if command.startswith("/experimental"):
            self._handle_experimental(command)
            return True
        if command.startswith("/history"):
            self._toggle_history(command)
            return True
        if command.startswith("/review"):
            self._review_repo()
            return True
        if command.startswith("/grounding"):
            self._grounding()
            return True
        if command.startswith("/rename"):
            name = command.split(" ", 1)[1].strip() if " " in command else ""
            self._rename_session(name)
            return True
        if command.startswith("/new"):
            self._new_session()
            return True
        if command.startswith("/resume"):
            session_id = command.split(" ", 1)[1].strip() if " " in command else ""
            self._resume_session(session_id)
            return True
        if command.startswith("/mention"):
            self._mention_file(command)
            return True
        if command.startswith("/login") or command.startswith("/setup"):
            self._login_wizard()
            return True
        if command.startswith("/model"):
            parts = command.split(maxsplit=1)
            if len(parts) == 1:
                self.console.print("[warning]Usage: /model <model-id>[/warning]")
                return True
            self._set_model(parts[1].strip())
            return True
        if command.startswith("/provider"):
            self._select_base_provider()
            return True
        if command.startswith("/run "):
            self._run_tool(command)
            return True
        if command.startswith("/profile"):
            self._handle_profile(command)
            return True
        if command.startswith("/session"):
            self._show_session()
            return True
        if command.startswith("/tools"):
            self._show_tools()
            return True
        if command.startswith("/context"):
            self._show_context()
            return True
        if command.startswith("/status"):
            self._show_status()
            return True
        if command.startswith("/diff"):
            self._show_diff()
            return True
        if command.startswith("/tasks"):
            self._show_tasks(command)
            return True
        if command.startswith("/plan"):
            self._handle_plan(command)
            return True
        if command.startswith("/transcript"):
            self._show_transcript()
            return True
        if command.startswith("/diagnostics"):
            self._diagnostics()
            return True
        if command.startswith("/smoke"):
            self._smoke()
            return True
        if command.startswith("/just-bash"):
            self._just_bash()
            return True
        if command.startswith("/allow-tool"):
            self._allow_tool(command)
            return True
        if command.startswith("/deny-tool"):
            self._deny_tool(command)
            return True
        if command.startswith("/reset-allowed-tools"):
            self._reset_allowed_tools()
            return True
        if command.startswith("/allow-url"):
            self._allow_url(command)
            return True
        if command.startswith("/deny-url"):
            self._deny_url(command)
            return True
        if command.startswith("/list-dirs"):
            self._list_dirs()
            return True
        if command.startswith("/add-dir"):
            self._add_dir(command)
            return True
        if command.startswith("/yolo"):
            self._toggle_yolo()
            return True
        if command.startswith("/allow-all"):
            self._allow_all()
            return True
        if command.startswith("/lockdown"):
            self._lockdown()
            return True
        if command.startswith("/help"):
            self._show_help()
            return True
        if command.startswith("/") and self._run_custom_command(command):
            return True
        return False

    def _show_slash_menu(self, prefix: str | None = None) -> None:
        items = [(cmd, desc) for cmd, desc in self._slash_registry.items() if not prefix or cmd.startswith(prefix)]
        if not items:
            self.console.print("[dim]No commands match.[/dim]")
            return
        table = Table(title="Slash Commands", border_style="gold")
        table.add_column("Command", style="gold")
        table.add_column("Description", style="sand")
        for cmd, desc in items[:40]:
            table.add_row(cmd, desc)
        self.console.print(table)
        if len(items) > 40:
            self.console.print("[dim]Type /help for the full list.[/dim]")

    def _show_help(self) -> None:
        table = Table(title="Commands", border_style="gold")
        table.add_column("Command", style="gold")
        table.add_column("Meaning", style="sand")
        table.add_row("/model <model-id>", "Set model directly")
        table.add_row("/m", "Quick model picker")
        table.add_row("/login", "Configure API key and model")
        table.add_row("/setup", "Configure API key and model")
        table.add_row("/models", "Open fullscreen model picker")
        table.add_row("/models pick [refresh]", "Fuzzy select model")
        table.add_row("/models list [refresh] [query] [next|prev|<page>]", "List/paginate models")
        table.add_row("/models fav", "List favorite models")
        table.add_row("/models add <id>", "Add favorite model")
        table.add_row("/models rm <id>", "Remove favorite model")
        table.add_row("/providers pick [refresh]", "Fuzzy select provider")
        table.add_row("/p", "Quick provider picker")
        table.add_row("/profile show|save|clear", "Workdir profile controls")
        table.add_row("/providers [refresh] [query] [next|prev|<page>]", "Select provider")
        table.add_row("/provider", "Switch base provider (openrouter/openai/gemini)")
        table.add_row("/mcp", "List configured MCP tools")
        table.add_row("/permissions [shell|write|external] [on|off]", "Set permissions")
        table.add_row("/experimental [list|add|rm] [flag]", "Experimental flags")
        table.add_row("/worklog [on|off]", "Toggle chronicle")
        table.add_row("/output [full|compact|<chars>]", "Tool output size")
        table.add_row("/context", "Show context usage")
        table.add_row("/status", "Show status")
        table.add_row("/diff", "Show git diff summary")
        table.add_row("/tasks", "List active PTY sessions")
        table.add_row("/plan [text]", "Set or show plan")
        table.add_row("/transcript", "Show full session transcript")
        table.add_row("/diagnostics", "Run system diagnostics")
        table.add_row("/smoke", "Run tool smoke test")
        table.add_row("/just-bash", "Drop into raw bash")
        table.add_row("/allow-tool <tool>", "Allow tool without prompt")
        table.add_row("/deny-tool <tool>", "Deny tool")
        table.add_row("/reset-allowed-tools", "Clear tool allow/deny lists")
        table.add_row("/allow-url <domain>", "Allow web domain")
        table.add_row("/deny-url <domain>", "Deny web domain")
        table.add_row("/list-dirs", "List allowed paths")
        table.add_row("/add-dir <path>", "Allow additional path")
        table.add_row("/allow-all", "Enable all permissions immediately")
        table.add_row("/lockdown", "Disable all permissions")
        table.add_row("/skills", "List configured skills")
        table.add_row("/history [on|off]", "Toggle startup history")
        table.add_row("/review", "Review repo changes")
        table.add_row("/grounding", "Run grounding system checks")
        table.add_row("/rename <title>", "Rename current session")
        table.add_row("/new", "Start new session")
        table.add_row("/resume <id>", "Resume session")
        table.add_row("/mention <path>", "Mention a file")
        table.add_row("/tools", "Show tool sandbox configuration")
        table.add_row("/run <tool> ...", "Run a sandboxed tool (builtin or external)")
        table.add_row("/session", "Show session info")
        table.add_row("/yolo", "Toggle auto-approve tool actions")
        table.add_row("/exit", "Close the session")
        if self._custom_commands:
            table.add_row("", "")
            table.add_row("Custom commands", f"{len(self._custom_commands)} loaded")
        self.console.print(table)

    def _run_custom_command(self, command: str) -> bool:
        parts = command.strip().split(maxsplit=1)
        name = parts[0].lstrip("/")
        if not name or name not in self._custom_commands:
            return False
        args = parts[1] if len(parts) > 1 else ""
        body = self._custom_commands[name]["body"]
        prompt = self._apply_custom_args(body, args)
        prompt = self._expand_custom_macros(prompt)
        prompt = self._inline_braced_files(prompt)
        allowed = self._custom_commands[name].get("allowed_tools", "").strip()
        if allowed:
            prompt = f"{prompt}\n\nPreferred tools: {allowed}".strip()
        self._run_prompt(prompt)
        return True

    def _apply_custom_args(self, body: str, args: str) -> str:
        prompt = body
        if not args:
            return prompt.replace("$ARGUMENTS", "").strip()
        try:
            import shlex

            parts = shlex.split(args)
        except Exception:
            parts = args.split()
        prompt = prompt.replace("$ARGUMENTS", args)
        for idx, val in enumerate(parts, start=1):
            prompt = prompt.replace(f"${idx}", val)
        if prompt == body:
            prompt = f"{body}\n\nUser args: {args}".strip()
        return prompt.strip()

    def _inline_braced_files(self, text: str) -> str:
        import re
        pattern = re.compile(r"(?<![@!])\{([^}]+)\}")
        out = text
        for match in pattern.findall(text):
            path = match.strip()
            if not path:
                continue
            result = self.runtime.sandbox.read_file(Path(path))
            if not result.ok:
                replacement = f"<missing {path}>"
            else:
                content = self._truncate_output_lines(result.output, max_lines=120, head=40, tail=20)
                replacement = f"<file {path}>\n{content}\n</file {path}>"
            out = out.replace("{" + match + "}", replacement)
        return out

    def _expand_custom_macros(self, text: str) -> str:
        import re
        out = text
        # Gemini-style file includes: @{path}
        file_pattern = re.compile(r"@\\{([^}]+)\\}")
        for match in file_pattern.findall(out):
            path = match.strip()
            if not path:
                continue
            path_obj = Path(path)
            if path_obj.exists() and path_obj.is_dir():
                output = self._run_macro_tool("shell", {"command": f"ls -la {path}"})
                content = self._truncate_output_lines(output, max_lines=120, head=40, tail=20)
                out = out.replace(f"@{{{match}}}", f"<dir {path}>\n{content}\n</dir {path}>")
            else:
                output = self._run_macro_tool("read", {"path": path})
                content = self._truncate_output_lines(output, max_lines=120, head=40, tail=20)
                out = out.replace(f"@{{{match}}}", f"<file {path}>\n{content}\n</file {path}>")
        # Gemini-style shell includes: !{command}
        cmd_pattern = re.compile(r"!\\{([^}]+)\\}")
        for match in cmd_pattern.findall(out):
            cmd = match.strip()
            if not cmd:
                continue
            output = self._run_macro_tool("shell", {"command": cmd})
            content = self._truncate_output_lines(output, max_lines=120, head=40, tail=20)
            out = out.replace(f"!{{{match}}}", f"<command {cmd}>\n{content}\n</command {cmd}>")
        return out

    def _run_macro_tool(self, tool: str, args: dict[str, Any]) -> str:
        if self.config.show_actions:
            if not self._sequence_started_at:
                self._start_action_sequence()
            self._print_action_start(tool, args)
        start = time.perf_counter()
        result = self.runtime.execute(tool, args)
        elapsed = time.perf_counter() - start
        tool_note = self._format_tool_output(tool, result.output)
        action = self._action_line(tool, args, tool_note, elapsed)
        action["ok"] = result.ok
        action["started"] = True
        if self.config.show_actions:
            self._print_action_line(action)
            if action.get("show_panel"):
                self._print_tool_outputs([tool_note], [action])
        return tool_note

    def _load_custom_commands(self) -> None:
        self._custom_commands = {}
        paths = [
            Path(".tehuti/commands"),
            Path(".claude/commands"),
            Path(".gemini/commands"),
            Path.home() / ".tehuti" / "commands",
            Path.home() / ".claude" / "commands",
            Path.home() / ".gemini" / "commands",
        ]
        for base in paths:
            if not base.exists() or not base.is_dir():
                continue
            for file in base.rglob("*.md"):
                name = self._command_name_from_path(base, file)
                if not name:
                    continue
                try:
                    content = file.read_text(encoding="utf-8")
                except Exception:
                    continue
                body, desc, allowed = self._parse_command_markdown(content)
                if not body:
                    continue
                self._custom_commands[name] = {
                    "body": body,
                    "description": desc or "custom command",
                    "allowed_tools": ",".join(allowed) if allowed else "",
                }
            for file in base.rglob("*.toml"):
                name = self._command_name_from_path(base, file)
                if not name:
                    continue
                try:
                    content = file.read_text(encoding="utf-8")
                except Exception:
                    continue
                body, desc = self._parse_command_toml(content)
                if not body:
                    continue
                self._custom_commands[name] = {
                    "body": body,
                    "description": desc or "custom command",
                }

    def _command_name_from_path(self, base: Path, file: Path) -> str:
        try:
            rel = file.relative_to(base).with_suffix("")
        except Exception:
            rel = file.with_suffix("")
        parts = [p for p in rel.parts if p]
        if not parts:
            return ""
        return ":".join(parts)

    def _parse_command_toml(self, content: str) -> tuple[str, str]:
        try:
            import tomllib
        except Exception:
            return "", ""
        text = content.strip()
        if not text:
            return "", ""
        try:
            data = tomllib.loads(text)
        except Exception:
            return "", ""
        prompt = data.get("prompt", "")
        if isinstance(prompt, list):
            prompt = "\n".join(str(item) for item in prompt if item is not None)
        prompt = str(prompt).strip()
        desc = str(data.get("description", "")).strip()
        if desc:
            desc = textwrap.shorten(desc, width=80, placeholder="…")
        return prompt, desc

    def _parse_command_markdown(self, content: str) -> tuple[str, str, list[str]]:
        import re
        text = content.strip()
        if not text:
            return "", "", []
        desc = ""
        allowed_tools: list[str] = []
        if text.startswith("---"):
            parts = text.split("---", 2)
            if len(parts) == 3:
                front = parts[1]
                text = parts[2].strip()
                lines = front.splitlines()
                for line in front.splitlines():
                    line = line.strip()
                    if line.lower().startswith("description:"):
                        desc = line.split(":", 1)[1].strip().strip('"').strip("'")
                # Parse allowed-tools (yaml list or inline)
                for idx, line in enumerate(lines):
                    raw = line.strip()
                    if raw.lower().startswith("allowed-tools:"):
                        inline = raw.split(":", 1)[1].strip()
                        if inline:
                            allowed_tools = [p.strip() for p in inline.split(",") if p.strip()]
                        else:
                            for tail in lines[idx + 1 :]:
                                tail = tail.strip()
                                if not tail or tail.startswith("#"):
                                    continue
                                if tail.startswith("-"):
                                    item = tail.lstrip("-").strip()
                                    if item:
                                        allowed_tools.append(item)
                                else:
                                    break
                        break
        lines = [line.rstrip() for line in text.splitlines()]
        body = "\n".join(lines).strip()
        if not desc:
            for line in lines:
                if line.strip():
                    desc = line.strip()
                    break
        if desc:
            desc = textwrap.shorten(desc, width=80, placeholder="…")
        return body, desc, allowed_tools

    def _login_wizard(self) -> None:
        choices = [
            ("openrouter", "OpenRouter"),
            ("openai", "OpenAI"),
            ("gemini", "Gemini"),
        ]
        selection = radiolist_dialog(
            title="Configure Provider",
            text="Select your provider",
            values=choices,
        ).run()
        if not selection:
            return
        if selection == "openrouter":
            provider_cfg = self.config.providers.openrouter
        elif selection == "openai":
            provider_cfg = self.config.providers.openai
        else:
            provider_cfg = self.config.providers.gemini

        self.config.provider.type = provider_cfg.type
        self.config.provider.base_url = provider_cfg.base_url
        self.config.provider.api_key_env = provider_cfg.api_key_env
        self.config.provider.model = provider_cfg.model

        api_key = self.prompt_session.prompt(
            f"{provider_cfg.api_key_env} (leave blank to keep): ",
            is_password=True,
            style=self.prompt_style,
        ).strip()
        if api_key:
            self._write_key(provider_cfg.api_key_env, api_key)

        if selection == "openrouter":
            self._pick_model(refresh=True)
        else:
            model_id = self.prompt_session.prompt(
                "Model id (leave blank to keep): ",
                style=self.prompt_style,
            ).strip()
            if model_id:
                self.config.provider.model = model_id
                if selection == "openai":
                    self.config.providers.openai.model = model_id
                else:
                    self.config.providers.gemini.model = model_id

        save_config(self.config)
        self.console.print(f"[gold]Provider set:[/gold] {self.config.provider.type}")

    def _write_key(self, key: str, value: str) -> None:
        path = self.config.keys_file
        data = load_env_file(path)
        data[key] = value
        path.parent.mkdir(parents=True, exist_ok=True)
        lines = [f"{k}={v}" for k, v in sorted(data.items())]
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    def _run_prompt(self, prompt: str) -> None:
        # No preflight shortcuts; allow model to handle every prompt.
        tool_list = ", ".join([t.name for t in self.registry.list_tools()])
        mode = self._execution_mode
        system = (
            "You are Project Tehuti. You have access to the listed tools and may run them when needed. "
            "Never claim you lack tools or permissions when tools are available. "
            "If you need a tool, respond with ONLY JSON of the form "
            '{"type":"tool","name":"read","args":{"path":"README.md"}}. '
            "When you are done, respond with ONLY JSON of the form "
            '{"type":"final","content":"..."}.\n'
            "Do not repeat the same tool call. After a tool result, respond with final.\n"
            "Do not output markdown or code fences.\n"
            "Prefer multiple short tool calls over a single long shell chain.\n"
            "Avoid massive directory listings; scope evidence to relevant paths.\n"
            "If you ran tools, base your response on the observed outputs and do not fabricate.\n"
            "Never say you cannot run commands; if a tool fails, report the error and continue.\n"
            "Be autonomous: if a task can be completed with tools, do it without asking the user to run commands. "
            "Only request user action when truly manual or outside tool reach.\n"
            "If you need the user to verify or decide, present a CHECKPOINT with clear steps and a resume signal.\n"
            "Never ask the user to run terminal commands; run them yourself.\n"
            "If you describe verification steps that are commandable, run them before responding.\n"
            f"Execution mode: {mode}. Higher modes mean deeper evidence and stronger autonomy.\n"
            f"Available tools: {tool_list}"
        )
        history = list(self.session.iter_context())[-10:]
        messages = [{"role": "system", "content": system}]
        for item in history:
            role = item.get("role", "user")
            content = item.get("content", "")
            messages.append({"role": role, "content": content})
        messages.append({"role": "user", "content": prompt})

        self._streamed_actions = False
        self._sequence_started_at = None
        self._action_counter = 0
        self._last_actions = []
        self._last_outputs = []
        response, tool_outputs, actions = self._run_with_tools(messages)
        self._last_actions = actions
        self._last_outputs = tool_outputs
        if not response and not actions:
            # Retry once if model returned empty.
            response, tool_outputs, actions = self._retry_empty_response(messages, prompt)

        # No postflight shortcuts; allow model to handle every prompt.

        if not response:
            if actions:
                response = self._retry_action_reply(messages)
            else:
                response = self._retry_minimal_reply(messages)
            if not response:
                response = "Tool results are shown above." if actions else "Ready for the next instruction."
            self.session.append_context("user", prompt)
            self.session.append_context("assistant", response)
            self._print_thoth_response(response)
            return

        response = self._sanitize_response(response)
        # No heuristic auto-runs; only execute tools when the model explicitly requests.
        if actions and not self._response_has_evidence(response) and not self.config.show_actions:
            response = response
        self.session.append_context("user", prompt)
        self.session.append_context("assistant", response)
        self._print_thoth_response(response)
        if self.llm.last_notice:
            self.console.print(f"[warning]{self.llm.last_notice}[/warning]")
        self._sequence_started_at = None

    def _retry_empty_response(self, messages: list[dict[str, Any]], prompt: str) -> tuple[str, list[str], list[dict[str, str]]]:
        # Retry once with a stricter instruction.
        messages = list(messages)
        messages.append({"role": "system", "content": "Respond with final now."})
        try:
            response, tool_outputs, actions = self._run_with_tools(messages)
        except Exception:
            response, tool_outputs, actions = "", [], []
        if response or tool_outputs:
            return response, tool_outputs, actions
        return "", [], []

    def _retry_action_reply(self, messages: list[dict[str, Any]]) -> str:
        try:
            followup = list(messages)
            followup.append(
                {
                    "role": "system",
                    "content": (
                        "Provide a concise response grounded in the tool results you observed. "
                        "Do not claim actions you did not take."
                    ),
                }
            )
            response = self.llm.chat_messages(followup)
            if response:
                return self._sanitize_response(response)
        except Exception:
            pass
        return ""

    def _retry_minimal_reply(self, messages: list[dict[str, Any]]) -> str:
        try:
            followup = list(messages)
            followup.append(
                {
                    "role": "system",
                    "content": "Respond with a brief acknowledgement and ask for the next instruction.",
                }
            )
            response = self.llm.chat_messages(followup)
            if response:
                return self._sanitize_response(response)
        except Exception:
            pass
        return "Ready for the next instruction."


    def _run_probe_tool(self, tool: str, args: dict[str, Any]) -> tuple[str, dict[str, Any]]:
        if self.config.show_actions:
            if not self._sequence_started_at:
                self._start_action_sequence()
            self._print_action_start(tool, args)
        start = time.perf_counter()
        result = self.runtime.execute(tool, args)
        elapsed = time.perf_counter() - start
        tool_note = self._format_tool_output(tool, result.output)
        action = self._action_line(tool, args, tool_note, elapsed)
        action["ok"] = result.ok
        action["started"] = True
        if self.config.show_actions:
            self._print_action_line(action)
            if action.get("show_panel"):
                self._print_tool_outputs([tool_note], [action])
        return tool_note, action

    def _run_with_tools(self, messages: list[dict[str, Any]], max_turns: int = 3) -> tuple[str, list[str], list[dict[str, str]]]:
        import json
        from pydantic import BaseModel, Field, ValidationError
        from typing import Literal

        class ToolPayload(BaseModel):
            type: Literal["tool"]
            name: str
            args: dict = Field(default_factory=dict)

        class FinalPayload(BaseModel):
            type: Literal["final"]
            content: str

        class ToolsPayload(BaseModel):
            type: Literal["tools"]
            calls: list[ToolPayload]

        try:
            response = self.llm.chat_messages(messages)
        except Exception as exc:
            self.logger.exception("LLM chat_messages failed")
            self.console.print(f"[warning]{exc}[/warning]")
            return "", [], []

        def finalize(text: str) -> str:
            return self._sanitize_response(text or "")

        seen_tools: set[str] = set()
        tool_outputs: list[str] = []
        actions: list[dict[str, str]] = []
        for _ in range(max_turns):
            parsed = None
            parsed_from_mixed = False
            try:
                parsed = json.loads(response)
            except Exception:
                parsed = self._extract_json(response)
                if parsed is None:
                    return finalize(response), tool_outputs, actions
                parsed_from_mixed = True

            if not isinstance(parsed, dict):
                return finalize(response), tool_outputs, actions

            try:
                if parsed.get("type") == "final":
                    payload = FinalPayload(**parsed)
                    if payload.content.strip():
                        content = self._sanitize_response(payload.content)
                        return content, tool_outputs, actions
                    if tool_outputs:
                        return "", tool_outputs, actions
                    content = self._sanitize_response(payload.content)
                    return content, tool_outputs, actions
                if isinstance(parsed.get("tool_calls"), list):
                    calls = []
                    for call in parsed.get("tool_calls", []):
                        name = call.get("name") or call.get("tool") or call.get("function", {}).get("name")
                        args = call.get("args") or call.get("arguments") or call.get("function", {}).get("arguments") or {}
                        if isinstance(args, str):
                            try:
                                args = json.loads(args)
                            except Exception:
                                args = {}
                        if name:
                            calls.append({"type": "tool", "name": name, "args": args})
                    parsed = {"type": "tools", "calls": calls}
                if isinstance(parsed.get("tools"), list) and not parsed.get("type"):
                    calls = []
                    for call in parsed.get("tools", []):
                        if isinstance(call, dict):
                            c = dict(call)
                            c.setdefault("type", "tool")
                            calls.append(c)
                    parsed = {"type": "tools", "calls": calls}
                if parsed.get("type") == "tools":
                    payload = ToolsPayload(**parsed)
                    new_tools = []
                    for call in payload.calls:
                        tool_sig = self._tool_sig(call.name, call.args)
                        if tool_sig in seen_tools:
                            continue
                        seen_tools.add(tool_sig)
                        new_tools.append(call)
                    if not new_tools:
                        return "", tool_outputs, actions
                    results = []
                    self._busy = True
                    for call in new_tools:
                        if not self._sequence_started_at:
                            self._start_action_sequence()
                        if self.config.show_actions:
                            self._print_action_start(call.name, call.args)
                        start = time.perf_counter()
                        result = self.runtime.execute(call.name, call.args)
                        elapsed = time.perf_counter() - start
                        tool_note = self._format_tool_output(call.name, result.output)
                        action = self._action_line(call.name, call.args, tool_note, elapsed)
                        action["ok"] = result.ok
                        action["started"] = True
                        actions.append(action)
                        if self.config.show_actions:
                            self._print_action_line(action)
                            self._streamed_actions = True
                            if action.get("show_panel"):
                                self._print_tool_outputs([tool_note], [action])
                        if action.get("show_panel"):
                            tool_outputs.append(tool_note)
                        results.append(tool_note)
                    self._busy = False
                    if self.config.show_actions and actions:
                        pass
                    messages.append(
                        {
                            "role": "system",
                            "content": (
                                "Tool results:\n"
                                + "\n".join(results)
                                + "\nRespond with final answer only. Do not call tools."
                            ),
                        }
                    )
                    response = self.llm.chat_messages(messages)
                    continue
                if parsed.get("type") == "tool":
                    payload = ToolPayload(**parsed)
                    tool = payload.name
                    args = payload.args
                elif "tool" in parsed:
                    tool = str(parsed.get("tool"))
                    args = parsed.get("args", {})
                else:
                    return ("" if parsed_from_mixed else finalize(response)), tool_outputs, actions
            except ValidationError:
                # Ask model to repair schema once
                messages.append(
                    {
                        "role": "system",
                        "content": (
                            "Invalid tool schema. Respond ONLY with JSON: "
                            '{"type":"tool","name":"<tool>","args":{...}} '
                            'or {"type":"tools","calls":[{"type":"tool","name":"...","args":{...}}]} '
                            'or {"type":"final","content":"..."}'
                        ),
                    }
                )
                try:
                    response = self.llm.chat_messages(messages)
                except Exception as exc:
                    self.logger.exception("LLM chat_messages failed during repair")
                    self.console.print(f"[warning]{exc}[/warning]")
                    return "", [], []
                continue

            if not isinstance(args, dict):
                args = {}

            tool_sig = self._tool_sig(tool, args)
            if tool_sig in seen_tools:
                return "", tool_outputs, actions
            seen_tools.add(tool_sig)
            if self.config.show_actions:
                if not self._sequence_started_at:
                    self._start_action_sequence()
                self._print_action_start(tool, args)
            start = time.perf_counter()
            result = self.runtime.execute(tool, args)
            elapsed = time.perf_counter() - start
            tool_note = self._format_tool_output(tool, result.output)
            action = self._action_line(tool, args, tool_note, elapsed)
            action["ok"] = result.ok
            action["started"] = self.config.show_actions
            actions.append(action)
            if self.config.show_actions:
                self._print_action_line(action)
                self._streamed_actions = True
            if action.get("show_panel"):
                tool_outputs.append(tool_note)
            messages.append(
                {
                    "role": "system",
                    "content": (
                        "Tool results:\n"
                        + tool_note
                        + "\nRespond with final answer only. Do not call tools."
                    ),
                }
            )

            try:
                response = self.llm.chat_messages(messages)
            except Exception as exc:
                self.logger.exception("LLM chat_messages failed after tool")
                self.console.print(f"[warning]{exc}[/warning]")
                return "", [], []

        # If the model kept emitting tool JSON after max turns, prefer tool output only.
        return ("" if self._extract_json(response) else finalize(response)), tool_outputs, actions

    def _extract_json(self, text: str) -> dict[str, Any] | None:
        import json
        if "```" in text:
            for fence in ("```json", "```"):
                if fence in text:
                    chunk = text.split(fence, 1)[1]
                    chunk = chunk.split("```", 1)[0]
                    chunk = chunk.strip()
                    if chunk.startswith("{") and chunk.endswith("}"):
                        try:
                            return json.loads(chunk)
                        except Exception:
                            pass
        # Try to extract the first balanced JSON object from a mixed response.
        start = text.find("{")
        if start == -1:
            return None
        depth = 0
        for i in range(start, len(text)):
            ch = text[i]
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    snippet = text[start : i + 1]
                    try:
                        return json.loads(snippet)
                    except Exception:
                        return None
        return None

    def _select_model(self, refresh: bool = False, query: str = "", page_cmd: str | None = None) -> None:
        if self.config.provider.type != "openrouter":
            self.console.print(
                "[warning]Model listing is only implemented for OpenRouter.[/warning]"
            )
            return
        if query in {"fav", "favorites"}:
            self._list_favorites()
            return
        if query.startswith("add "):
            model_id = query.split(" ", 1)[1].strip()
            self._add_favorite(model_id)
            return
        if query.startswith("rm "):
            model_id = query.split(" ", 1)[1].strip()
            self._remove_favorite(model_id)
            return
        try:
            models = self.llm.list_models(refresh=refresh)
        except Exception as exc:
            self.console.print(f"[warning]{exc}[/warning]")
            return
        if not models:
            self.console.print("[dim]No models returned by OpenRouter.[/dim]")
            return

        if query:
            q = query.lower()
            models = [
                m
                for m in models
                if q in str(m.get("id") or m.get("name") or m.get("model") or "").lower()
            ]
            if not models:
                self.console.print(f"[dim]No models match '{query}'.[/dim]")
                return

        self._models_cache = models
        max_rows = 50
        if page_cmd:
            if page_cmd == "next":
                self._models_page += 1
            elif page_cmd == "prev":
                self._models_page = max(0, self._models_page - 1)
            elif page_cmd.startswith("page:"):
                try:
                    self._models_page = max(0, int(page_cmd.split(":", 1)[1]) - 1)
                except Exception:
                    pass

        total = len(self._models_cache)
        start = self._models_page * max_rows
        end = start + max_rows
        display_models = self._models_cache[start:end]
        if not display_models:
            self._models_page = 0
            start = 0
            end = max_rows
            display_models = self._models_cache[start:end]

        while True:
            table = Table(title="Models", border_style="gold")
            table.add_column("#", style="gold")
            table.add_column("Model ID", style="sand")
            table.add_column("Context", style="gold.soft")
            for idx, model in enumerate(display_models, start=1 + start):
                model_id = str(model.get("id") or model.get("name") or model.get("model") or "")
                ctx = str(model.get("context_length") or model.get("input_token_limit") or "")
                table.add_row(str(idx), model_id, ctx)
            self.console.print(table)
            if total > max_rows:
                page = self._models_page + 1
                pages = (total + max_rows - 1) // max_rows
                self.console.print(
                    f"[dim]Page {page}/{pages}. Commands: n/p, page <n>, q[/dim]"
                )

            choice = self.prompt_session.prompt(
                "Select model (#/id, n/p, page <n>, q): ",
                style=self.prompt_style,
            ).strip()
            if not choice:
                return
            if choice.lower() in {"q", "quit", "exit"}:
                return
            if choice.lower() in {"n", "next"}:
                page_cmd = "next"
            elif choice.lower() in {"p", "prev"}:
                page_cmd = "prev"
            elif choice.lower().startswith("page "):
                page_cmd = f"page:{choice.split(' ', 1)[1].strip()}"
            elif choice.startswith("/models"):
                parts = choice.split()
                if len(parts) > 1 and parts[1].isdigit():
                    page_cmd = f"page:{parts[1]}"
                else:
                    return
            else:
                page_cmd = None

            if page_cmd:
                if page_cmd == "next":
                    self._models_page += 1
                elif page_cmd == "prev":
                    self._models_page = max(0, self._models_page - 1)
                elif page_cmd.startswith("page:"):
                    try:
                        self._models_page = max(0, int(page_cmd.split(":", 1)[1]) - 1)
                    except Exception:
                        pass
                start = self._models_page * max_rows
                end = start + max_rows
                display_models = self._models_cache[start:end]
                if not display_models:
                    self._models_page = 0
                    start = 0
                    end = max_rows
                    display_models = self._models_cache[start:end]
                continue

            # no paging command, proceed to selection parsing
            break
        selected = None
        if choice.isdigit():
            i = int(choice) - 1
            if 0 <= i < len(self._models_cache):
                selected = self._models_cache[i].get("id") or self._models_cache[i].get("name") or self._models_cache[i].get("model")
        else:
            selected = choice

        if not selected:
            self.console.print("[warning]Invalid selection.[/warning]")
            return

        self.config.provider.model = str(selected)
        self.config.providers.openrouter.model = self.config.provider.model
        save_config(self.config)
        self.console.print(f"[gold]Model set:[/gold] {self.config.provider.model}")

    def _set_model(self, model_id: str) -> None:
        if not model_id:
            self.console.print("[warning]Model id cannot be empty.[/warning]")
            return
        if model_id.startswith("/"):
            self.console.print("[warning]Invalid model id.[/warning]")
            return
        self.config.provider.model = model_id
        if self.config.provider.type == "openrouter":
            self.config.providers.openrouter.model = model_id
        self._context_limit = None
        save_config(self.config)
        self.console.print(f"[gold]Model set:[/gold] {self.config.provider.model}")

    def _pick_model(self, refresh: bool = False) -> None:
        try:
            models = self.llm.list_models(refresh=refresh)
        except Exception as exc:
            self.console.print(f"[warning]{exc}[/warning]")
            return
        model_ids = [str(m.get("id") or m.get("name") or m.get("model") or "") for m in models]
        model_ids = [m for m in model_ids if m]
        if not model_ids:
            self.console.print("[dim]No models available.[/dim]")
            return
        selection = self._fuzzy_pick_model(models, model_ids)
        if selection:
            self._set_model(selection)

    def _list_favorites(self) -> None:
        if not self.config.favorite_models:
            self.console.print("[dim]No favorite models yet.[/dim]")
            return
        table = Table(title="Favorite Models", border_style="gold")
        table.add_column("#", style="gold")
        table.add_column("Model ID", style="sand")
        for idx, model_id in enumerate(self.config.favorite_models, start=1):
            table.add_row(str(idx), model_id)
        self.console.print(table)

    def _add_favorite(self, model_id: str) -> None:
        if not model_id:
            self.console.print("[warning]Model id cannot be empty.[/warning]")
            return
        if model_id in self.config.favorite_models:
            self.console.print("[dim]Already in favorites.[/dim]")
            return
        self.config.favorite_models.append(model_id)
        save_config(self.config)
        self.console.print(f"[gold]Added favorite:[/gold] {model_id}")

    def _remove_favorite(self, model_id: str) -> None:
        if model_id in self.config.favorite_models:
            self.config.favorite_models.remove(model_id)
            save_config(self.config)
            self.console.print(f"[gold]Removed favorite:[/gold] {model_id}")
        else:
            self.console.print("[warning]Model not in favorites.[/warning]")

    def _select_provider(self, refresh: bool = False, query: str = "", page_cmd: str | None = None) -> None:
        if self.config.provider.type != "openrouter":
            self.console.print(
                "[warning]Provider routing is only implemented for OpenRouter.[/warning]"
            )
            return
        providers: list[dict[str, Any]] = []
        try:
            providers = self.llm.list_providers(refresh=refresh)
        except Exception:
            providers = []

        if not providers:
            # Fallback: derive providers from model IDs like "openai/gpt-4o"
            try:
                models = self.llm.list_models()
            except Exception as exc:
                self.console.print(f"[warning]{exc}[/warning]")
                return
            prefixes = sorted({str(m.get("id", "")).split("/")[0] for m in models if m.get("id")})
            providers = [{"id": p, "name": p} for p in prefixes if p]

        if query:
            q = query.lower()
            providers = [
                p
                for p in providers
                if q
                in str(p.get("id") or p.get("slug") or p.get("name") or "").lower()
            ]
            if not providers:
                self.console.print(f"[dim]No providers match '{query}'.[/dim]")
                return
            self._providers_page = 0

        self._providers_cache = providers
        max_rows = 40
        if page_cmd:
            if page_cmd == "next":
                self._providers_page += 1
            elif page_cmd == "prev":
                self._providers_page = max(0, self._providers_page - 1)
            elif page_cmd.startswith("page:"):
                try:
                    self._providers_page = max(0, int(page_cmd.split(":", 1)[1]) - 1)
                except Exception:
                    pass

        total = len(self._providers_cache)
        start = self._providers_page * max_rows
        end = start + max_rows
        display_providers = self._providers_cache[start:end]
        if not display_providers:
            self._providers_page = 0
            start = 0
            end = max_rows
            display_providers = self._providers_cache[start:end]

        while True:
            table = Table(title="Providers", border_style="gold")
            table.add_column("#", style="gold")
            table.add_column("Provider", style="sand")
            for idx, prov in enumerate(display_providers, start=1 + start):
                label = str(prov.get("id") or prov.get("slug") or prov.get("name") or "")
                table.add_row(str(idx), label)
            self.console.print(table)
            if total > max_rows:
                page = self._providers_page + 1
                pages = (total + max_rows - 1) // max_rows
                self.console.print(
                    f"[dim]Page {page}/{pages}. Commands: n/p, page <n>, q[/dim]"
                )

            choice = self.prompt_session.prompt(
                "Select provider (#/id, n/p, page <n>, q): ",
                style=self.prompt_style,
            ).strip()
            if not choice:
                return
            if choice.lower() in {"q", "quit", "exit"}:
                return
            if choice.lower() in {"n", "next"}:
                page_cmd = "next"
            elif choice.lower() in {"p", "prev"}:
                page_cmd = "prev"
            elif choice.lower().startswith("page "):
                page_cmd = f"page:{choice.split(' ', 1)[1].strip()}"
            elif choice.startswith("/providers"):
                parts = choice.split()
                if len(parts) > 1 and parts[1].isdigit():
                    page_cmd = f"page:{parts[1]}"
                else:
                    return
            else:
                page_cmd = None

            if page_cmd:
                if page_cmd == "next":
                    self._providers_page += 1
                elif page_cmd == "prev":
                    self._providers_page = max(0, self._providers_page - 1)
                elif page_cmd.startswith("page:"):
                    try:
                        self._providers_page = max(0, int(page_cmd.split(":", 1)[1]) - 1)
                    except Exception:
                        pass
                start = self._providers_page * max_rows
                end = start + max_rows
                display_providers = self._providers_cache[start:end]
                if not display_providers:
                    self._providers_page = 0
                    start = 0
                    end = max_rows
                    display_providers = self._providers_cache[start:end]
                continue

            break
        selected = None
        if choice.isdigit():
            i = int(choice) - 1
            if 0 <= i < len(self._providers_cache):
                selected = self._providers_cache[i].get("id") or self._providers_cache[i].get("slug")
        else:
            selected = choice

        if not selected:
            self.console.print("[warning]Invalid selection.[/warning]")
            return

        self.config.openrouter.provider_order = [str(selected)]
        save_config(self.config)
        self.console.print(f"[gold]Provider order set:[/gold] {self.config.openrouter.provider_order}")

    def _pick_provider(self, refresh: bool = False) -> None:
        try:
            providers = self.llm.list_providers(refresh=refresh)
        except Exception:
            providers = []
        if not providers:
            self.console.print("[dim]No providers available.[/dim]")
            return
        names = [
            str(p.get("id") or p.get("slug") or p.get("name") or "")
            for p in providers
        ]
        names = [n for n in names if n]
        selection = self._fuzzy_pick_provider(names)
        if selection:
            self.config.openrouter.provider_order = [selection]
            save_config(self.config)
            self.console.print(f"[gold]Provider order set:[/gold] {self.config.openrouter.provider_order}")

    def _handle_profile(self, command: str) -> None:
        from tehuti_cli.storage.workdir_config import (
            clear_workdir_config,
            get_workdir_config,
            save_workdir_config,
            snapshot_config,
        )
        parts = command.split()
        action = parts[1] if len(parts) > 1 else "show"
        if action == "show":
            data = get_workdir_config(self.work_dir)
            if not data:
                self.console.print("[dim]No profile set for this directory.[/dim]")
                return
            self.console.print(Panel(Text(str(data), style="sand"), border_style="gold", expand=True))
            return
        if action == "save":
            data = snapshot_config(self.config)
            save_workdir_config(self.work_dir, data)
            self.console.print("[gold]Profile saved for this directory.[/gold]")
            return
        if action == "clear":
            clear_workdir_config(self.work_dir)
            self.console.print("[gold]Profile cleared for this directory.[/gold]")
            return
        self.console.print("[warning]Usage: /profile show|save|clear[/warning]")

    def _fuzzy_pick_model(self, models: list[dict[str, Any]], model_ids: list[str]) -> str | None:
        model_map = {str(m.get("id") or m.get("name") or m.get("model") or ""): m for m in models}
        query = ""
        limit = 50
        while True:
            if query:
                matches = process.extract(
                    query,
                    model_ids,
                    scorer=fuzz.WRatio,
                    limit=limit,
                )
                ranked = [(item, score) for item, score, _ in matches]
            else:
                ranked = [(m, None) for m in sorted(model_ids)[:limit]]

            if not ranked:
                self.console.print("[dim]No models match your search.[/dim]")
                return None

            table = Table(title="Model Picker", border_style="gold")
            table.add_column("#", style="gold", width=4)
            if query:
                table.add_column("Score", style="gold.soft", width=6)
            table.add_column("Model ID", style="sand")
            table.add_column("Ctx", style="gold.soft", width=8)
            for idx, (model_id, score) in enumerate(ranked, start=1):
                ctx = ""
                meta = model_map.get(model_id, {})
                if meta:
                    ctx = str(meta.get("context_length") or meta.get("input_token_limit") or "")
                if query:
                    table.add_row(str(idx), f"{int(score):d}", model_id, ctx)
                else:
                    table.add_row(str(idx), model_id, ctx)
            self.console.print(table)

            hint = "Select #/id, / to search, q to cancel: "
            choice = self.prompt_session.prompt(hint, style=self.prompt_style).strip()
            if not choice or choice.lower() in {"q", "quit", "exit"}:
                return None
            if choice == "/":
                query = self.prompt_session.prompt("Search: ", style=self.prompt_style).strip()
                continue
            if choice.isdigit():
                idx = int(choice) - 1
                if 0 <= idx < len(ranked):
                    return ranked[idx][0]
                self.console.print("[warning]Invalid selection.[/warning]")
                continue
            return choice

    def _fuzzy_pick_provider(self, names: list[str]) -> str | None:
        query = ""
        limit = 40
        while True:
            if query:
                matches = process.extract(
                    query,
                    names,
                    scorer=fuzz.WRatio,
                    limit=limit,
                )
                ranked = [(item, score) for item, score, _ in matches]
            else:
                ranked = [(n, None) for n in sorted(names)[:limit]]

            if not ranked:
                self.console.print("[dim]No providers match your search.[/dim]")
                return None

            table = Table(title="Provider Picker", border_style="gold")
            table.add_column("#", style="gold", width=4)
            if query:
                table.add_column("Score", style="gold.soft", width=6)
            table.add_column("Provider", style="sand")
            for idx, (name, score) in enumerate(ranked, start=1):
                if query:
                    table.add_row(str(idx), f"{int(score):d}", name)
                else:
                    table.add_row(str(idx), name)
            self.console.print(table)

            hint = "Select #/id, / to search, q to cancel: "
            choice = self.prompt_session.prompt(hint, style=self.prompt_style).strip()
            if not choice or choice.lower() in {"q", "quit", "exit"}:
                return None
            if choice == "/":
                query = self.prompt_session.prompt("Search: ", style=self.prompt_style).strip()
                continue
            if choice.isdigit():
                idx = int(choice) - 1
                if 0 <= idx < len(ranked):
                    return ranked[idx][0]
                self.console.print("[warning]Invalid selection.[/warning]")
                continue
            return choice

    def _select_base_provider(self) -> None:
        options = ["openrouter", "openai", "gemini"]
        table = Table(title="Base Providers", border_style="gold")
        table.add_column("#", style="gold")
        table.add_column("Provider", style="sand")
        for idx, name in enumerate(options, start=1):
            table.add_row(str(idx), name)
        self.console.print(table)

        choice = self.prompt_session.prompt(
            "Select provider (# or id): ",
            style=self.prompt_style,
        ).strip()
        if not choice:
            return
        selected = None
        if choice.isdigit():
            i = int(choice) - 1
            if 0 <= i < len(options):
                selected = options[i]
        else:
            selected = choice.strip().lower()

        if selected not in options:
            self.console.print("[warning]Invalid selection.[/warning]")
            return

        self.config.provider.type = selected
        # Also update provider-specific defaults from catalog
        catalog = self.config.providers
        if selected == "openrouter":
            self.config.provider.base_url = catalog.openrouter.base_url
            self.config.provider.api_key_env = catalog.openrouter.api_key_env
            if catalog.openrouter.model:
                self.config.provider.model = catalog.openrouter.model
        elif selected == "openai":
            self.config.provider.base_url = catalog.openai.base_url
            self.config.provider.api_key_env = catalog.openai.api_key_env
            if catalog.openai.model:
                self.config.provider.model = catalog.openai.model
        elif selected == "gemini":
            self.config.provider.base_url = catalog.gemini.base_url
            self.config.provider.api_key_env = catalog.gemini.api_key_env
            if catalog.gemini.model:
                self.config.provider.model = catalog.gemini.model

        save_config(self.config)
        self.console.print(f"[gold]Provider set:[/gold] {self.config.provider.type}")

    def _run_tool(self, command: str) -> None:
        parts = command.split(maxsplit=2)
        if len(parts) < 2:
            self.console.print("[warning]Usage: /run <tool> ...[/warning]")
            return
        tool = parts[1]
        args: dict[str, Any] = {}
        match tool:
            case "read":
                if len(parts) < 3:
                    self.console.print("[warning]Usage: /run read <path>[/warning]")
                    return
                args = {"path": parts[2]}
                self._busy = True
                if self.config.show_actions:
                    if not self._sequence_started_at:
                        self._start_action_sequence()
                    self._print_action_start("read", args)
                result = self.runtime.execute("read", args)
                self._busy = False
            case "write":
                if len(parts) < 3 or ":" not in parts[2]:
                    self.console.print("[warning]Usage: /run write <path>:<content>[/warning]")
                    return
                path, content = parts[2].split(":", 1)
                args = {"path": path, "content": content}
                self._busy = True
                if self.config.show_actions:
                    if not self._sequence_started_at:
                        self._start_action_sequence()
                    self._print_action_start("write", args)
                result = self.runtime.execute("write", args)
                self._busy = False
            case "shell":
                if len(parts) < 3:
                    self.console.print("[warning]Usage: /run shell <command>[/warning]")
                    return
                args = {"command": parts[2]}
                self._busy = True
                if self.config.show_actions:
                    if not self._sequence_started_at:
                        self._start_action_sequence()
                    self._print_action_start("shell", args)
                result = self.runtime.execute("shell", args)
                self._busy = False
            case "fetch":
                if len(parts) < 3:
                    self.console.print("[warning]Usage: /run fetch <url>[/warning]")
                    return
                args = {"url": parts[2]}
                self._busy = True
                if self.config.show_actions:
                    if not self._sequence_started_at:
                        self._start_action_sequence()
                    self._print_action_start("fetch", args)
                result = self.runtime.execute("fetch", args)
                self._busy = False
            case _:
                # External tools or generic invocation with JSON args
                if len(parts) < 3:
                    self.console.print("[warning]Usage: /run <tool> <json-args>[/warning]")
                    return
                import json

                try:
                    args = json.loads(parts[2])
                except Exception:
                    self.console.print("[warning]Args must be JSON for external tools.[/warning]")
                    return
                if not isinstance(args, dict):
                    self.console.print("[warning]Args must be a JSON object.[/warning]")
                    return
                self._busy = True
                if self.config.show_actions:
                    if not self._sequence_started_at:
                        self._start_action_sequence()
                    self._print_action_start(tool, args)
                result = self.runtime.execute(tool, args)
                self._busy = False

        if result.ok:
            output = self._format_tool_output(tool, result.output)
            action = self._action_line(tool, args, output, 0.0)
            action["started"] = self.config.show_actions
            if self.config.show_actions:
                self._print_action_line(action)
                self._streamed_actions = True
            if action.get("show_panel"):
                self._print_tool_outputs([output], [action])
            elif action.get("inline"):
                # Inline output already printed via _print_actions
                pass
            else:
                self.console.print(Text(output, style="sand"))
            self._last_actions = [action]
            self._last_outputs = [output] if action.get("show_panel") else []
        else:
            self.console.print(f"[warning]{result.output}[/warning]")
        self._sequence_started_at = None

    def _show_session(self) -> None:
        self.console.print(f"[gold]Session:[/gold] {self.session.id}")
        self.console.print(f"[gold]Work dir:[/gold] {self.work_dir}")

    def _show_status(self) -> None:
        table = Table(title="Status", border_style="gold")
        table.add_column("Field", style="gold")
        table.add_column("Value", style="sand")
        table.add_row("Directory", str(self.work_dir))
        table.add_row("Provider", self.config.provider.type)
        table.add_row("Model", self.config.provider.model or "not set")
        table.add_row("Session", self.session.id)
        perms = []
        if self.config.allow_shell:
            perms.append("shell")
        if self.config.allow_write:
            perms.append("write")
        if self.config.allow_external:
            perms.append("external")
        table.add_row("Permissions", ", ".join(perms) if perms else "locked")
        self.console.print(table)

    def _show_context(self) -> None:
        history = list(self.session.iter_context())
        total_chars = sum(len(item.get("content", "")) for item in history)
        approx_tokens = max(1, total_chars // 4)
        table = Table(title="Context", border_style="gold")
        table.add_column("Metric", style="gold")
        table.add_column("Value", style="sand")
        table.add_row("Messages", str(len(history)))
        table.add_row("Characters", str(total_chars))
        table.add_row("Approx tokens", str(approx_tokens))
        limit = self._get_model_context_limit()
        if limit:
            used = approx_tokens
            left = max(0, limit - used)
            pct = int((left / limit) * 100)
            table.add_row("Context window", f"{pct}% left ({left:,} / {limit:,})")
        self.console.print(table)

    def _get_model_context_limit(self) -> int | None:
        if self._context_limit is not None:
            return self._context_limit
        try:
            models = self.llm.list_models(refresh=False)
        except Exception:
            models = []
        model_id = self.config.provider.model
        if model_id:
            for model in models:
                mid = str(model.get("id") or model.get("name") or model.get("model") or "")
                if mid == model_id:
                    limit = model.get("context_length") or model.get("input_token_limit")
                    if limit:
                        try:
                            self._context_limit = int(limit)
                            return self._context_limit
                        except Exception:
                            break
        return None

    def _context_stats(self) -> tuple[int, int | None, int | None]:
        history = list(self.session.iter_context())
        total_chars = sum(len(item.get("content", "")) for item in history)
        approx_tokens = max(1, total_chars // 4)
        limit = self._get_model_context_limit()
        if not limit:
            return approx_tokens, None, None
        left = max(0, limit - approx_tokens)
        pct = int((left / limit) * 100)
        return approx_tokens, limit, pct

    def _diagnostics(self) -> None:
        table = Table(title="Diagnostics", border_style="gold")
        table.add_column("Check", style="gold")
        table.add_column("Status", style="sand")
        table.add_column("Details", style="sand")

        # Provider + model
        table.add_row("Provider", "OK", self.config.provider.type)
        table.add_row("Model", "OK" if self.config.provider.model else "WARN", self.config.provider.model or "not set")

        # API key
        key_env = self.config.provider.api_key_env
        key_val = self._resolve_api_key(key_env)
        table.add_row("API key", "OK" if key_val else "WARN", key_env)

        # Permissions
        perms = f"shell={self.config.allow_shell}, write={self.config.allow_write}, external={self.config.allow_external}, yolo={self.config.default_yolo}"
        table.add_row("Permissions", "OK", perms)

        # Logs
        table.add_row("Log file", "OK", str(self.config.log_dir / "tehuti.log"))

        # Workdir write test
        writable = "OK"
        detail = str(self.work_dir)
        try:
            test_path = self.work_dir / ".tehuti_diagnostics"
            test_path.write_text("ok", encoding="utf-8")
            test_path.unlink()
        except Exception as exc:
            writable = "WARN"
            detail = f"{self.work_dir} ({exc})"
        table.add_row("Workdir write", writable, detail)

        self.console.print(table)

    def _smoke(self) -> None:
        if not self.config.allow_shell:
            self.console.print("[warning]Shell disabled; cannot run smoke test.[/warning]")
            return
        cmds = [
            ("pwd", "pwd"),
            ("whoami", "whoami"),
            ("python", "python3 --version 2>/dev/null || true"),
            ("node", "node --version 2>/dev/null || true"),
            ("git", "git --version 2>/dev/null || true"),
        ]
        actions: list[dict[str, str]] = []
        self._sequence_started_at = None
        self._action_counter = 0
        for label, cmd in cmds:
            self._start_action_sequence()
            self._print_action_start("shell", {"command": cmd})
            start = time.perf_counter()
            result = self.runtime.execute("shell", {"command": cmd})
            elapsed = time.perf_counter() - start
            tool_note = self._format_tool_output("shell", result.output)
            action = self._action_line("shell", {"command": cmd}, tool_note, elapsed)
            action["ok"] = result.ok
            action["started"] = True
            actions.append(action)
            if self.config.show_actions:
                self._print_action_line(action)
                self._streamed_actions = True
                if action.get("show_panel"):
                    self._print_tool_outputs([tool_note], [action])
        # For smoke, the action log is the evidence.
        self._last_actions = actions
        self._last_outputs = [a.get("output", "") for a in actions if a.get("show_panel")]
        self._sequence_started_at = None

    def _just_bash(self) -> None:
        if not self.config.allow_shell:
            self.console.print("[warning]Shell disabled; cannot open bash.[/warning]")
            return
        self.console.print("[gold]Entering bash. Type 'exit' to return.[/gold]")
        try:
            subprocess.run("bash", shell=True)
        except Exception as exc:
            self.console.print(f"[warning]{exc}[/warning]")

    def _resolve_api_key(self, env_name: str) -> str:
        import os
        env_value = os.getenv(env_name, "").strip()
        if env_value:
            return env_value
        keys = load_env_file(self.config.keys_file)
        return keys.get(env_name, "").strip()

    def _show_diff(self) -> None:
        if not self.config.allow_shell:
            self.console.print("[warning]Shell disabled; cannot run diff.[/warning]")
            return
        status = self.runtime.execute("shell", {"command": "git status --short"})
        diffstat = self.runtime.execute("shell", {"command": "git diff --stat"})
        if (status.ok and status.output.strip()) or (diffstat.ok and diffstat.output.strip()):
            body = []
            if status.ok and status.output.strip():
                body.append("=== Status ===\n" + status.output.strip())
            if diffstat.ok and diffstat.output.strip():
                body.append("=== Diffstat ===\n" + diffstat.output.strip())
            self.console.print(Panel.fit(Text("\n\n".join(body), style="sand"), border_style="gold"))
        else:
            self.console.print("[dim]No diffs detected.[/dim]")

    def _show_tasks(self, command: str) -> None:
        parts = command.split()
        if len(parts) > 1 and parts[1] == "close" and len(parts) > 2:
            session_id = parts[2].strip()
            result = self.runtime.execute("pty.close", {"session_id": session_id})
            if result.ok:
                self.console.print(f"[gold]Closed:[/gold] {session_id}")
            else:
                self.console.print(f"[warning]{result.output}[/warning]")
            return
        sessions = self.runtime.pty.sessions
        table = Table(title="PTY Sessions", border_style="gold")
        table.add_column("Session ID", style="gold")
        table.add_column("Status", style="sand")
        if not sessions:
            self.console.print("[dim]No active PTY sessions.[/dim]")
            return
        for session_id, session in sessions.items():
            status = "running" if session.child.isalive() else "closed"
            table.add_row(session_id, status)
        self.console.print(table)

    def _allow_all(self) -> None:
        self.config.allow_shell = True
        self.config.allow_write = True
        self.config.allow_external = True
        self.config.default_yolo = True
        save_config(self.config)
        self.console.print("[gold]All permissions enabled.[/gold]")

    def _lockdown(self) -> None:
        self.config.allow_shell = False
        self.config.allow_write = False
        self.config.allow_external = False
        self.config.default_yolo = False
        save_config(self.config)
        self.console.print("[gold]All permissions disabled.[/gold]")

    def _allow_tool(self, command: str) -> None:
        parts = command.split()
        if len(parts) < 2:
            self.console.print("[warning]Usage: /allow-tool <tool>[/warning]")
            return
        tool = parts[1].strip()
        if tool and tool not in self.config.allow_tools:
            self.config.allow_tools.append(tool)
            save_config(self.config)
        self.console.print(f"[gold]Allowed tool:[/gold] {tool}")

    def _deny_tool(self, command: str) -> None:
        parts = command.split()
        if len(parts) < 2:
            self.console.print("[warning]Usage: /deny-tool <tool>[/warning]")
            return
        tool = parts[1].strip()
        if tool and tool not in self.config.deny_tools:
            self.config.deny_tools.append(tool)
            save_config(self.config)
        self.console.print(f"[gold]Denied tool:[/gold] {tool}")

    def _reset_allowed_tools(self) -> None:
        self.config.allow_tools = []
        self.config.deny_tools = []
        save_config(self.config)
        self.console.print("[gold]Tool allow/deny lists cleared.[/gold]")

    def _allow_url(self, command: str) -> None:
        parts = command.split()
        if len(parts) < 2:
            self.console.print("[warning]Usage: /allow-url <domain>[/warning]")
            return
        domain = parts[1].strip()
        if domain and domain not in self.config.web_allow_domains:
            self.config.web_allow_domains.append(domain)
            save_config(self.config)
        self.console.print(f"[gold]Allowed domain:[/gold] {domain}")

    def _deny_url(self, command: str) -> None:
        parts = command.split()
        if len(parts) < 2:
            self.console.print("[warning]Usage: /deny-url <domain>[/warning]")
            return
        domain = parts[1].strip()
        if domain and domain not in self.config.web_deny_domains:
            self.config.web_deny_domains.append(domain)
            save_config(self.config)
        self.console.print(f"[gold]Denied domain:[/gold] {domain}")

    def _list_dirs(self) -> None:
        if not self.config.allowed_paths:
            self.console.print("[dim]No extra allowed paths.[/dim]")
            return
        table = Table(title="Allowed Paths", border_style="gold")
        table.add_column("Path", style="sand")
        for path in self.config.allowed_paths:
            table.add_row(path)
        self.console.print(table)

    def _add_dir(self, command: str) -> None:
        parts = command.split(maxsplit=1)
        if len(parts) < 2:
            self.console.print("[warning]Usage: /add-dir <path>[/warning]")
            return
        path = parts[1].strip()
        if path and path not in self.config.allowed_paths:
            self.config.allowed_paths.append(path)
            save_config(self.config)
        self.console.print(f"[gold]Allowed path:[/gold] {path}")

    def _handle_plan(self, command: str) -> None:
        plan_file = self.session.dir / "plan.txt"
        parts = command.split(" ", 1)
        if len(parts) == 1:
            if plan_file.exists():
                self.console.print(Panel.fit(Text(plan_file.read_text(encoding="utf-8"), style="sand"), border_style="gold", title="Plan"))
            else:
                self.console.print("[dim]No plan set. Use /plan <text>.[/dim]")
            return
        content = parts[1].strip()
        if not content:
            self.console.print("[warning]Plan cannot be empty.[/warning]")
            return
        plan_file.write_text(content, encoding="utf-8")
        self.console.print("[gold]Plan set.[/gold]")

    def _rename_session(self, name: str) -> None:
        if not name:
            self.console.print("[warning]Usage: /rename <title>[/warning]")
            return
        title_file = self.session.dir / "title.txt"
        title_file.write_text(name, encoding="utf-8")
        self.console.print(f"[gold]Session renamed:[/gold] {name}")

    def _new_session(self) -> None:
        from tehuti_cli.storage.session import create_session
        self.session = create_session(self.work_dir)
        self.console.print(f"[gold]New session:[/gold] {self.session.id}")

    def _resume_session(self, session_id: str) -> None:
        if not session_id:
            self.console.print("[warning]Usage: /resume <session-id>[/warning]")
            return
        from tehuti_cli.storage.session import load_last_session
        session = load_last_session(self.work_dir)
        if session and session.id == session_id:
            self.session = session
            self.console.print(f"[gold]Resumed session:[/gold] {self.session.id}")
            return
        self.console.print("[warning]Session not found for this directory.[/warning]")

    def _mention_file(self, command: str) -> None:
        parts = command.split(maxsplit=1)
        if len(parts) == 1:
            completer = PathCompleter(expanduser=True)
            path = self.prompt_session.prompt(
                "Mention path: ",
                completer=completer,
                style=self.prompt_style,
            ).strip()
        else:
            path = parts[1].strip()
        if not path:
            self.console.print("[warning]Usage: /mention <path>[/warning]")
            return
        self.console.print(f"[gold]Mentioned:[/gold] {path}")

    def _show_mcp(self) -> None:
        import json
        path = self.config.mcp_file
        if not path.exists():
            self.console.print("[dim]No MCP config found.[/dim]")
            return
        data = json.loads(path.read_text(encoding="utf-8"))
        tools = data.get("tools", [])
        if not tools:
            self.console.print("[dim]No MCP tools configured.[/dim]")
            return
        table = Table(title="MCP Tools", border_style="gold")
        table.add_column("Name", style="gold")
        table.add_column("Description", style="sand")
        for tool in tools:
            table.add_row(str(tool.get("name", "")), str(tool.get("description", "")))
        self.console.print(table)

    def _show_skills(self) -> None:
        import json
        path = self.config.skills_file
        if not path.exists():
            self.console.print("[dim]No skills config found.[/dim]")
            return
        data = json.loads(path.read_text(encoding="utf-8"))
        skills = data.get("skills", [])
        if not skills:
            self.console.print("[dim]No skills configured.[/dim]")
            return
        table = Table(title="Skills", border_style="gold")
        table.add_column("Name", style="gold")
        table.add_column("Description", style="sand")
        for skill in skills:
            table.add_row(str(skill.get("name", "")), str(skill.get("description", "")))
        self.console.print(table)

    def _handle_permissions(self, command: str) -> None:
        parts = command.split()
        if len(parts) == 1:
            self._show_tools()
            return
        if len(parts) < 3:
            self.console.print("[warning]Usage: /permissions <shell|write|external> <on|off>[/warning]")
            return
        target = parts[1]
        flag = parts[2]
        value = True if flag == "on" else False if flag == "off" else None
        if value is None:
            self.console.print("[warning]Value must be on/off.[/warning]")
            return
        if target == "shell":
            self.config.allow_shell = value
        elif target == "write":
            self.config.allow_write = value
        elif target == "external":
            self.config.allow_external = value
        else:
            self.console.print("[warning]Unknown permission target.[/warning]")
            return
        save_config(self.config)
        self.console.print(f"[gold]Permission {target}:[/gold] {value}")

    def _handle_experimental(self, command: str) -> None:
        parts = command.split()
        if len(parts) == 1 or parts[1] == "list":
            if not self.config.experimental_flags:
                self.console.print("[dim]No experimental flags set.[/dim]")
                return
            self.console.print("[gold]Experimental flags:[/gold] " + ", ".join(self.config.experimental_flags))
            return
        if parts[1] == "add" and len(parts) > 2:
            flag = parts[2]
            if flag not in self.config.experimental_flags:
                self.config.experimental_flags.append(flag)
                save_config(self.config)
            self.console.print(f"[gold]Added flag:[/gold] {flag}")
            return
        if parts[1] == "rm" and len(parts) > 2:
            flag = parts[2]
            if flag in self.config.experimental_flags:
                self.config.experimental_flags.remove(flag)
                save_config(self.config)
            self.console.print(f"[gold]Removed flag:[/gold] {flag}")
            return
        self.console.print("[warning]Usage: /experimental [list|add|rm] [flag][/warning]")

    def _toggle_history(self, command: str) -> None:
        parts = command.split()
        if len(parts) == 1:
            self.config.show_history = not self.config.show_history
        elif parts[1] in {"on", "off"}:
            self.config.show_history = parts[1] == "on"
        else:
            self.console.print("[warning]Usage: /history [on|off][/warning]")
            return
        save_config(self.config)
        self.console.print(f"[gold]Show history:[/gold] {self.config.show_history}")

    def _review_repo(self) -> None:
        if not self.config.allow_shell:
            self.console.print("[warning]Shell disabled; cannot run review.[/warning]")
            return
        result = self.runtime.execute("shell", {"command": "git status --short"})
        if result.ok and result.output.strip():
            self.console.print(Panel.fit(Text(result.output, style="sand"), border_style="gold"))
        else:
            self.console.print("[dim]No git changes detected.[/dim]")

    def _grounding(self) -> None:
        if not self.config.allow_shell:
            self.console.print("[warning]Shell disabled; cannot run grounding.[/warning]")
            return
        commands = [
            "uname -a",
            "lsb_release -a 2>/dev/null || cat /etc/os-release",
            "whoami",
            "pwd",
            "uptime",
            "df -h -x overlay -x tmpfs",
            "free -h",
            "ip -o addr show 2>/dev/null || ifconfig 2>/dev/null",
            "ss -tulpn 2>/dev/null | head -n 20",
        ]
        output = []
        for cmd in commands:
            result = self.runtime.execute("shell", {"command": cmd})
            output.append(f"$ {cmd}\n{result.output}".strip())
        self.console.print(Panel(Text("\n\n".join(output), style="sand"), border_style="gold", expand=True))

    def _show_tools(self) -> None:
        table = Table(title="Tool Sandbox", border_style="gold")
        table.add_column("Setting", style="gold")
        table.add_column("Value", style="sand")
        table.add_row("default_yolo", str(self.config.default_yolo))
        table.add_row("allow_shell", str(self.config.allow_shell))
        table.add_row("allow_write", str(self.config.allow_write))
        table.add_row("allow_external", str(self.config.allow_external))
        table.add_row("allowed_paths", ", ".join(self.config.allowed_paths) or "(workdir only)")
        table.add_row("web_allow_domains", ", ".join(self.config.web_allow_domains) or "(all)")
        self.console.print(table)

        tools = self.registry.list_tools()
        if tools:
            t = Table(title="Available Tools", border_style="gold")
            t.add_column("Name", style="gold")
            t.add_column("Kind", style="sand")
            t.add_column("Description", style="gold.soft")
            for tool in tools:
                t.add_row(tool.name, tool.kind, tool.description)
            self.console.print(t)

    def _print_thoth_response(self, response: str) -> None:
        checkpoint = self._format_checkpoint(response)
        if checkpoint:
            self._checkpoint_counter += 1
            title = f"Checkpoint {self._checkpoint_counter}"
            panel = Panel(Text(checkpoint, style="sand"), border_style="gold", title=title)
            self.console.print(panel)
            return
        self.console.rule("Thoth", style="gold")
        self.console.print(Text(response, style="sand"))
        self.console.rule(style="gold")

    def _format_checkpoint(self, response: str) -> str:
        if "CHECKPOINT:" not in response and "YOUR ACTION:" not in response:
            return ""
        lines = [line.rstrip() for line in response.splitlines()]
        cleaned = [line for line in lines if line.strip()]
        block = "\n".join(cleaned).strip()
        return block


    def _status_bar(self) -> str:
        perms = []
        if self.config.allow_shell:
            perms.append("shell")
        if self.config.allow_write:
            perms.append("write")
        if self.config.allow_external:
            perms.append("external")
        perms_str = ",".join(perms) if perms else "locked"
        approx_tokens, limit, pct = self._context_stats()
        if limit and pct is not None:
            context_hint = f"{pct}% context left"
        else:
            context_hint = f"{approx_tokens} tokens"
        model = self.config.provider.model or "not set"
        if len(model) > 40:
            model = model[:37] + "..."
        status = "working" if self._busy else "ready"
        return (
            f"{self.config.provider.type} {model} · "
            f"{self.session.id[:8]} · {perms_str} · {status} · {context_hint}    ? shortcuts"
        )

    def _next_placeholder(self) -> str:
        # Rotate placeholder prompts to avoid static feel.
        if len(self._placeholders) == 1:
            return self._placeholders[0]
        next_text = random.choice(self._placeholders)
        if next_text == self._placeholders[self._placeholder_index % len(self._placeholders)]:
            next_text = self._placeholders[(self._placeholder_index + 1) % len(self._placeholders)]
        self._placeholder_index += 1
        return next_text

    def _format_tool_output(self, tool: str, output: str) -> str:
        output = self._sanitize_output(output or "")
        output = self._format_json_compact(output)
        output = self._normalize_output(output)
        output = self._truncate_output_lines(output)
        max_len = int(self.config.tool_output_limit or 0)
        if max_len > 0 and len(output) > max_len:
            output = output[:max_len] + f"\n... (truncated, {len(output) - max_len} chars)"
        return output.strip()

    def _tool_sig(self, tool: str, args: dict[str, Any]) -> str:
        import json
        args = dict(args or {})
        normalized: dict[str, Any] = {}
        if tool == "shell" and "command" in args:
            cmd = str(args.get("command", ""))
            cmd = " ".join(cmd.split())
            normalized["command"] = cmd
        elif tool == "read":
            normalized["path"] = args.get("path", "")
        elif tool == "write":
            normalized["path"] = args.get("path", "")
            normalized["content"] = args.get("content", "")
        elif tool == "fetch":
            normalized["url"] = args.get("url", "")
        else:
            normalized = args
        return f"{tool}:{json.dumps(normalized, sort_keys=True)}"

    def _print_tool_outputs(self, outputs: list[str], actions: list[dict[str, Any]]) -> None:
        blocks: list[str] = []
        for item in actions:
            if not item.get("show_panel"):
                continue
            output = str(item.get("output", "")).strip()
            if not output:
                continue
            title = str(item.get("title", "output")).strip()
            detail = str(item.get("detail", "")).strip()
            label = title if not detail else f"{title} · {detail}"
            line_count = len(output.splitlines())
            suffix = f" • {line_count} lines" if line_count else ""
            header = f"[{label}{suffix}]" if label else f"[output{suffix}]"
            blocks.append(f"{header}\n{output}")
        if not blocks:
            return
        body = "\n\n".join(blocks)
        panel = Panel(Text(body, style="sand"), border_style="gold", expand=True, title="Evidence")
        self.console.print(panel)

    def _sanitize_response(self, response: str) -> str:
        import re
        text = response.strip()
        if not text:
            return text
        # Strip raw tool JSON echoes.
        if "\"type\":\"tool\"" in text or "\"type\":\"tools\"" in text:
            cleaned = []
            for line in text.splitlines():
                if "\"type\":\"tool\"" in line or "\"type\":\"tools\"" in line:
                    continue
                cleaned.append(line)
            text = "\n".join(cleaned).strip()
        # Remove code fences but keep content.
        text = re.sub(r"```[a-zA-Z0-9]*\n", "", text)
        text = text.replace("```", "")
        # Strip simple markdown emphasis.
        text = re.sub(r"\*\*(.*?)\*\*", r"\1", text)
        text = re.sub(r"__(.*?)__", r"\1", text)
        text = re.sub(r"`([^`]*)`", r"\1", text)
        # Drop control characters.
        text = re.sub(r"[\x00-\x08\x0b-\x1f\x7f]", "", text)
        # Remove repeated literal "\1" artifacts if present.
        text = re.sub(r"(?:\\\\1){3,}", "", text)
        return text.strip()

    def _normalize_output(self, output: str) -> str:
        # Normalize headings to improve readability without truncation.
        lines = output.splitlines()
        cleaned: list[str] = []
        for line in lines:
            if line.startswith("===") and line.endswith("==="):
                cleaned.append("")
                cleaned.append(line)
                cleaned.append("")
            else:
                cleaned.append(line)
        return "\n".join(cleaned).strip()

    def _sanitize_output(self, output: str) -> str:
        import re
        if not output:
            return ""
        # Strip ANSI escape sequences.
        output = re.sub(r"\x1b\[[0-9;]*[A-Za-z]", "", output)
        output = re.sub(r"\x1b\][^\x07]*\x07", "", output)
        # Drop remaining control characters.
        output = re.sub(r"[\x00-\x08\x0b-\x1f\x7f]", "", output)
        return output

    def _format_json_compact(self, output: str) -> str:
        import json
        text = output.strip()
        if not text:
            return output
        try:
            parsed = json.loads(text)
        except Exception:
            return output
        try:
            return json.dumps(parsed, ensure_ascii=False, separators=(",", ": "))
        except Exception:
            return output

    def _truncate_output_lines(
        self,
        output: str,
        max_lines: int = 400,
        head: int = 120,
        tail: int = 80,
    ) -> str:
        lines = output.splitlines()
        total = len(lines)
        if total <= max_lines:
            return output
        head_lines = lines[:head]
        tail_lines = lines[-tail:] if tail > 0 else []
        omitted = total - len(head_lines) - len(tail_lines)
        mid = [f"... +{omitted} lines omitted ..."] if omitted > 0 else []
        return "\n".join(head_lines + mid + tail_lines).strip()

    def _action_line(self, tool: str, args: dict[str, Any], output: str, elapsed: float) -> dict[str, Any]:
        output = output or ""
        show_panel = self._should_show_panel(output)
        inline = [] if show_panel else self._inline_output_lines(output)
        evidence = self._evidence_snippet(output)
        if tool == "shell":
            cmd = str(args.get("command", "")).strip()
            label = cmd if len(cmd) <= 80 else cmd[:77] + "..."
            detail = "" if label == cmd else cmd
            evidence = self._evidence_for_tool(tool, args, output)
            return {
                "tool": tool,
                "title": f"shell: {label}",
                "detail": detail,
                "command": cmd,
                "evidence": evidence,
                "output": output,
                "inline": inline,
                "show_panel": show_panel,
                "elapsed": elapsed,
            }
        if tool == "read":
            # For reads, always show a small inline snippet; large outputs go to panel.
            lines = output.splitlines()
            show_panel = len(lines) > 8 or len(output) > 400
            inline = [] if show_panel else [line for line in lines[:8] if line.strip()]
            evidence = f"{len(lines)} lines"
            return {
                "tool": tool,
                "title": f"read: {str(args.get('path', ''))}",
                "detail": "",
                "path": str(args.get("path", "")),
                "evidence": evidence,
                "output": output,
                "inline": inline,
                "show_panel": show_panel,
                "elapsed": elapsed,
            }
        if tool == "write":
            content = str(args.get("content", ""))
            lines = content.splitlines()
            size = len(content.encode("utf-8"))
            evidence = f"{len(lines)} lines, {size} bytes" if content else "written"
            if content and len(content) <= 240:
                inline = [line for line in lines[:4] if line.strip()]
            return {
                "tool": tool,
                "title": f"write: {str(args.get('path', ''))}",
                "detail": "",
                "path": str(args.get("path", "")),
                "evidence": evidence,
                "output": output,
                "inline": inline,
                "show_panel": show_panel,
                "elapsed": elapsed,
            }
        if tool == "fetch":
            evidence = self._evidence_for_tool(tool, args, output)
            return {
                "tool": tool,
                "title": f"fetch: {str(args.get('url', ''))}",
                "detail": "",
                "url": str(args.get("url", "")),
                "evidence": evidence,
                "output": output,
                "inline": inline,
                "show_panel": show_panel,
                "elapsed": elapsed,
            }
        if tool.startswith("pty."):
            evidence = self._evidence_for_tool(tool, args, output)
            return {
                "tool": tool,
                "title": f"pty: {tool.split('.', 1)[1]}",
                "detail": str(args.get("command", args.get("session_id", ""))),
                "evidence": evidence,
                "output": output,
                "inline": inline,
                "show_panel": show_panel,
                "elapsed": elapsed,
            }
        return {
            "tool": tool,
            "title": f"{tool}",
            "detail": "",
            "evidence": evidence,
            "output": output,
            "inline": inline,
            "show_panel": show_panel,
            "elapsed": elapsed,
        }

    def _start_action_sequence(self, details: str | None = None) -> None:
        if self._sequence_started_at:
            return
        self._sequence_started_at = time.perf_counter()
        return

    def _print_status_indicator(self) -> None:
        return

    def _wrap_action(self, text: str, width: int = 96) -> str:
        import textwrap
        return "\n  ".join(textwrap.wrap(text, width=width, break_long_words=False))

    def _split_shell_steps(self, command: str) -> list[str]:
        steps: list[str] = []
        buf = []
        in_single = False
        in_double = False
        i = 0
        while i < len(command):
            ch = command[i]
            if ch == "'" and not in_double:
                in_single = not in_single
            elif ch == '"' and not in_single:
                in_double = not in_double
            if not in_single and not in_double:
                if command[i : i + 2] == "&&":
                    part = "".join(buf).strip()
                    if part:
                        steps.append(part)
                    buf = []
                    i += 2
                    continue
                if ch == ";":
                    part = "".join(buf).strip()
                    if part:
                        steps.append(part)
                    buf = []
                    i += 1
                    continue
            buf.append(ch)
            i += 1
        final = "".join(buf).strip()
        if final:
            steps.append(final)
        return steps

    def _evidence_snippet(self, output: str) -> str:
        if not output:
            return ""
        cleaned = self._sanitize_output(output)
        for line in cleaned.splitlines():
            line = line.strip()
            if line:
                return line[:160]
        return ""

    def _inline_output_lines(self, output: str) -> list[str]:
        if not output:
            return []
        lines = [line.strip() for line in output.splitlines() if line.strip()]
        if not lines:
            return []
        if len(lines) <= 4 and sum(len(line) for line in lines) <= 220:
            return lines
        if len(lines) <= 12:
            head = lines[:2]
            tail = lines[-2:] if len(lines) > 4 else []
            omitted = max(0, len(lines) - len(head) - len(tail))
            mid = [f"... +{omitted} lines"] if omitted else []
            return head + mid + tail
        return []

    def _should_show_panel(self, output: str) -> bool:
        if not output:
            return False
        if output.count("\n") > 12:
            return True
        if len(output) > 600:
            return True
        return False

    def _evidence_for_tool(self, tool: str, args: dict[str, Any], output: str) -> str:
        cleaned = (output or "").strip()
        if tool == "read":
            lines = cleaned.splitlines()
            if not lines:
                return "0 lines"
            return f"{len(lines)} lines"
        if tool == "write":
            return "OK" if cleaned else "written"
        if tool == "fetch":
            if cleaned:
                return f"{len(cleaned)} chars"
            return "no body"
        if tool == "shell":
            return self._evidence_snippet(output)
        if tool.startswith("pty."):
            return self._evidence_snippet(output)
        return self._evidence_snippet(output)

    def _should_show_evidence(self, actions: list[dict[str, Any]]) -> bool:
        return any(item.get("show_panel") for item in actions)

    def _response_has_evidence(self, response: str) -> bool:
        lowered = response.lower()
        if "key results" in lowered or "evidence" in lowered:
            return True
        for line in response.splitlines():
            if line.strip().startswith(("-", "•")):
                return True
        return False

    def _resolve_execution_mode(self) -> str:
        mode = os.getenv("TEHUTI_MODE", "").strip().lower()
        if mode in {"standard", "autonomous", "dominant"}:
            return mode
        return getattr(self.config, "execution_mode", "autonomous")

    def _print_actions(self, actions: list[dict[str, Any]]) -> None:
        if not actions:
            return
        unique: list[dict[str, str]] = []
        seen = set()
        for item in actions:
            key = (item.get("title", ""), item.get("detail", ""), item.get("evidence", ""))
            if key in seen:
                continue
            seen.add(key)
            unique.append(item)
        for item in unique:
            self._print_action_line(item)

    def _print_sequence_summary(self, actions: list[dict[str, Any]]) -> None:
        return

    def _print_action_line(self, item: dict[str, Any]) -> None:
        title = item.get("title", "Action")
        detail = item.get("detail", "")
        elapsed = float(item.get("elapsed", 0) or 0)
        show_panel = bool(item.get("show_panel"))
        ok = item.get("ok", True)
        elapsed_label = self._format_elapsed(elapsed)
        status = "✓" if ok else "✗"
        self.console.print(Text(f"{status} {title}{elapsed_label}", style="gold.soft"))
        if detail:
            self.console.print(Text(f"  └ {detail}", style="sand"))
        inline = item.get("inline", []) or []
        for line in inline:
            self.console.print(Text(f"  └ {line}", style="sand"))
        if not inline and show_panel:
            self.console.print(Text("  └ output below", style="sand"))
        if not inline and not show_panel:
            evidence = item.get("evidence", "")
            if evidence:
                self.console.print(Text(f"  └ {evidence}", style="sand"))

    def _format_elapsed(self, elapsed: float) -> str:
        if elapsed <= 0:
            return ""
        if elapsed < 1:
            return f" ({int(elapsed * 1000)}ms)"
        return f" ({elapsed:.2f}s)"

    def _next_action_index(self) -> int:
        self._action_counter += 1
        return self._action_counter

    def _print_action_start(self, tool: str, args: dict[str, Any]) -> None:
        self._start_action_sequence()
        title = self._action_start_title(tool, args)
        self.console.print(Text(f"◆ {title}", style="gold.soft"))

    def _action_start_title(self, tool: str, args: dict[str, Any]) -> str:
        if tool == "shell":
            cmd = str(args.get("command", "")).strip()
            label = cmd if len(cmd) <= 80 else cmd[:77] + "..."
            return f"shell: {label}"
        if tool == "read":
            return f"read: {str(args.get('path', ''))}"
        if tool == "write":
            return f"write: {str(args.get('path', ''))}"
        if tool == "fetch":
            return f"fetch: {str(args.get('url', ''))}"
        if tool.startswith("pty."):
            return f"pty: {tool.split('.', 1)[1]}"
        return f"{tool}"

    def _toggle_worklog(self, command: str) -> None:
        parts = command.split()
        if len(parts) == 1:
            self.config.show_actions = not self.config.show_actions
        else:
            value = parts[1].strip().lower()
            if value in {"on", "true", "1"}:
                self.config.show_actions = True
            elif value in {"off", "false", "0"}:
                self.config.show_actions = False
        save_config(self.config)
        state = "on" if self.config.show_actions else "off"
        self.console.print(f"[gold]Chronicle:[/gold] {state}")

    def _toggle_output(self, command: str) -> None:
        parts = command.split()
        if len(parts) == 1:
            self.config.tool_output_limit = 0 if self.config.tool_output_limit else 20000
        else:
            value = parts[1].strip().lower()
            if value in {"full", "all"}:
                self.config.tool_output_limit = 0
            elif value in {"compact", "short"}:
                self.config.tool_output_limit = 20000
            else:
                try:
                    self.config.tool_output_limit = max(0, int(value))
                except ValueError:
                    pass
        save_config(self.config)
        mode = "full" if self.config.tool_output_limit == 0 else f"compact ({self.config.tool_output_limit})"
        self.console.print(f"[gold]Output:[/gold] {mode}")

    def _show_shortcuts(self) -> None:
        self.console.rule(style="gold")
        grid = Table.grid(padding=(0, 4))
        grid.add_column(justify="left")
        grid.add_column(justify="left")
        rows = [
            ("/ commands", "! shell command"),
            ("@ file paths", "? shortcuts"),
            ("shift+enter newline", "tab queue message"),
            ("ctrl+g external editor", "esc esc edit last"),
            ("ctrl+c exit", ""),
        ]
        for left, right in rows:
            grid.add_row(left, right)
        self.console.print(Text("Shortcuts", style="gold.soft"))
        self.console.print(grid)
        self.console.rule(style="gold")

    def _toggle_yolo(self) -> None:
        self.config.default_yolo = not self.config.default_yolo
        save_config(self.config)
        self.console.print(f"[gold]Auto-approve set:[/gold] {self.config.default_yolo}")


class _SlashCompleter(Completer):
    def __init__(self, registry: dict[str, str]) -> None:
        self.registry = registry

    def get_completions(self, document: Document, complete_event: CompleteEvent):
        text = document.text_before_cursor
        if not text.startswith("/"):
            return
        for cmd, desc in self.registry.items():
            if cmd.startswith(text):
                yield Completion(cmd, start_position=-len(text), display_meta=desc)


class _HybridCompleter(Completer):
    def __init__(self, slash: Completer, path: PathCompleter) -> None:
        self.slash = slash
        self.path = path

    def get_completions(self, document: Document, complete_event: CompleteEvent):
        text = document.text_before_cursor
        stripped = text.lstrip()
        if stripped.startswith("/"):
            yield from self.slash.get_completions(document, complete_event)
            return
        if "@" in text:
            idx = text.rfind("@")
            fragment = text[idx + 1 :]
            sub_doc = Document(fragment, cursor_position=len(fragment))
            for comp in self.path.get_completions(sub_doc, complete_event):
                yield Completion(
                    comp.text,
                    start_position=-len(fragment),
                    display=comp.display,
                    display_meta=comp.display_meta,
                )
