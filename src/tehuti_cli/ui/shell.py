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
        # self._load_custom_commands()  # This method doesn't exist in the partial implementation
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
        # self._execution_mode = self._resolve_execution_mode()  # This method doesn't exist
        # self._context_limit: int | None = None
        self._ensure_full_capability_defaults()

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

    def _context_stats(self):
        return 0, None, 0

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

    def _next_placeholder(self):
        if not self._placeholders:
            return ""
        self._placeholder_index = (self._placeholder_index + 1) % len(self._placeholders)
        return self._placeholders[self._placeholder_index]


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
        else:
            yield from self.path.get_completions(document, complete_event)

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

    def _context_stats(self):
        return 0, None, 0
