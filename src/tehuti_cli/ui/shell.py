from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import random
import time
import subprocess
import textwrap
import shlex
import os
import signal
import json
import uuid
import sys
import shutil
import difflib
from prompt_toolkit import PromptSession
from prompt_toolkit.completion import Completion, Completer, FuzzyCompleter
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
from rich.markdown import Markdown

from tehuti_cli.constants import PROGRESS_VERBOSITY_VALUES
from tehuti_cli.storage.config import Config, save_config
from tehuti_cli.storage.paths import get_tehuti_home
from tehuti_cli.core.runtime import ToolRuntime
from tehuti_cli.core.tools import ToolRegistry
from tehuti_cli.core.phase_stream import (
    PHASE_STREAM_EVENT_VERSION,
    PHASE_STREAM_SCHEMA,
    PHASE_STREAM_SURFACE,
    normalize_phase_name,
    normalize_phase_status,
    phase_group,
    phase_should_render,
    tool_phase_kind,
)
from tehuti_cli.core.enhanced_tool_execution import ToolExecutionManager, ToolStatus, get_tool_descriptions_for_prompt
from tehuti_cli.core.memory import AgentMemory
from tehuti_cli.providers.llm import TehutiLLM
from tehuti_cli.core.agent_loop import AgentTracer
from tehuti_cli.storage.session import Session
from tehuti_cli.ui.theme import GOLD, PROMPT_AGENT, PROMPT_SHELL, THEME
from tehuti_cli.utils.env import load_env_file
from tehuti_cli.utils.logger import get_logger
from tehuti_cli.core.response_formatter import format_response, ContentScanner
from tehuti_cli.core.streaming_display import StreamingResponse, StreamConfig

@dataclass
class WelcomeItem:
    name: str
    value: str


class Shell:
    def __init__(
        self,
        config: Config,
        work_dir: Path,
        session: Session,
        show_banner: bool = False,
        interactive: bool = True,
    ):
        self.config = config
        self.work_dir = work_dir
        self.session = session
        self._interactive = interactive
        self.console = Console(theme=THEME)
        self.llm = TehutiLLM(config)
        self.runtime = ToolRuntime(config, work_dir)
        self.registry = ToolRegistry(config)
        self.execution_manager = ToolExecutionManager(self.runtime, self.console)
        self.memory = AgentMemory()
        self.tracer = None
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
            "/ux": "apply UX preset (quiet|standard|verbose)",
            "/verbosity": "set progress verbosity (minimal|standard|verbose)",
            "/output": "set tool output mode (full|compact)",
            "/context": "show context window usage",
            "/status": "show current status",
            "/diff": "show git diff summary",
            "/tasks": "list active PTY sessions",
            "/agent": "run autonomous agent (TehutiAgent)",
            "/delegate": "manage sub-agents (start|list|status|logs|follow|stop)",
            "/a2a": "connect to A2A agent",
            "/plan": "create or show a session plan",
            "/transcript": "show full session transcript",
            "/diagnostics": "run system diagnostics",
            "/smoke": "run a quick tool smoke test",
            "/just-bash": "drop into a raw bash shell",
            "/run": "run a tool directly (/run <tool> ...)",
            "/history": "toggle history replay on startup",
            "/allow-tool": "allow a specific tool",
            "/deny-tool": "deny a specific tool",
            "/reset-allowed-tools": "clear tool allow/deny lists",
            "/allow-url": "allow a web domain",
            "/deny-url": "deny a web domain",
            "/allow-all": "enable unrestricted tool capabilities",
            "/lockdown": "disable shell/write/external capabilities",
            "/list-dirs": "list allowed paths",
            "/add-dir": "allow an additional path",
            "/grounding": "collect host/runtime grounding evidence",
            "/profile": "manage per-workdir profile (show|save|clear)",
            "/focus": "show current task focus and execution state",
            "/review": "review current changes and find issues",
            "/rename": "rename the current thread",
            "/new": "start a new chat during a conversation",
            "/resume": "resume a saved chat",
            "/setup": "configure API key and model",
            "/mention": "mention a file",
            "/tools": "show tool sandbox configuration",
            "/session": "show session info",
            "/yolo": "toggle auto-approve tool actions",
            "/metrics": "show execution metrics",
            "/envelope": "toggle interactive envelope projection (on|off)",
            "/remember": "store information in memory",
            "/recall": "search memory for information",
            "/trace": "show execution trace summary",
            "/full": "enable maximum capabilities (YOLO mode)",
            "/status-all": "show full system status",
            "/help": "show command help",
            "/exit": "close the session",
            "/quit": "close the session (alias)",
        }
        self._custom_commands: dict[str, dict[str, str]] = {}
        self._load_custom_commands()
        for name, meta in self._custom_commands.items():
            self._slash_registry[f"/{name}"] = meta.get("description", "custom command")
        self._slash_completer = FuzzyCompleter(_SlashCompleter(self._slash_registry))
        self._path_completer = PathCompleter(expanduser=True)
        self._completer = _HybridCompleter(self._slash_completer, self._path_completer)
        self.prompt_session = (
            PromptSession(
                completer=self._completer,
                complete_while_typing=True,
                complete_style=CompleteStyle.MULTI_COLUMN,
                reserve_space_for_menu=4,
                bottom_toolbar=self._status_bar,
                complete_in_thread=True,
            )
            if self._interactive
            else None
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
        self._busy_depth = 0
        self._streamed_actions = False
        self._sequence_started_at: float | None = None
        self._action_counter = 0
        self._last_actions: list[dict[str, Any]] = []
        self._last_outputs: list[str] = []
        self._phase_sequence: int = 0
        self._phase_started_at: float | None = None
        self._phase_events: list[dict[str, Any]] = []
        self._turn_progress_events: list[dict[str, Any]] = []
        self._turn_activity_events: list[dict[str, Any]] = []
        self._checkpoint_counter = 0
        self._execution_mode = self._resolve_execution_mode()
        self._context_limit: int | None = None
        self._current_objective: str = ""
        self._current_phase: str = "idle"
        self._last_prompt: str = ""
        self._last_require_tools: bool = False
        self._last_turn_plan: list[str] = []
        self._tool_stream_event_count: int = 0
        self._tool_stream_event_limit: int = 24
        self._minion_state_file = self.session.context_file.parent / "minions.json"
        self._minions: dict[str, dict[str, Any]] = {}
        self._minion_announced_state: dict[str, str] = {}
        self._minion_announced_activity: dict[str, float] = {}
        self._last_minion_activity_scan: float = 0.0
        self._load_minions()
        self._ensure_full_capability_defaults()

    def _ensure_full_capability_defaults(self) -> None:
        # Respect restricted policy; only normalize unrestricted defaults
        # when access policy explicitly allows full mode.
        if str(getattr(self.config, "access_policy", "full")) != "full":
            return
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
        if self.config.allowed_paths:
            self.config.allowed_paths = []
            changed = True
        if self.config.web_allow_domains:
            self.config.web_allow_domains = []
            changed = True
        if self.config.web_deny_domains:
            self.config.web_deny_domains = []
            changed = True
        if changed:
            save_config(self.config)

    def _load_minions(self) -> None:
        if not self._minion_state_file.exists():
            self._minions = {}
            return
        try:
            data = json.loads(self._minion_state_file.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                self._minions = data
            else:
                self._minions = {}
        except Exception:
            self._minions = {}

    def _save_minions(self) -> None:
        self._minion_state_file.parent.mkdir(parents=True, exist_ok=True)
        self._minion_state_file.write_text(json.dumps(self._minions, indent=2), encoding="utf-8")

    def _is_pid_alive(self, pid: int) -> bool:
        if pid <= 0:
            return False
        proc_stat = Path(f"/proc/{pid}/stat")
        if proc_stat.exists():
            try:
                parts = proc_stat.read_text(encoding="utf-8", errors="replace").split()
                if len(parts) > 2 and parts[2] == "Z":
                    return False
            except Exception:
                pass
        try:
            os.kill(pid, 0)
            return True
        except OSError:
            return False

    def _refresh_minions(self) -> None:
        from tehuti_cli.core.delegates import DelegateState

        changed = False
        for minion_id, item in self._minions.items():
            state = str(item.get("state", "unknown"))
            if state != "running":
                continue
            pid = int(item.get("pid", 0) or 0)
            log_file = Path(str(item.get("log_file", "")))
            if log_file.exists():
                try:
                    mtime = float(log_file.stat().st_mtime)
                    if mtime > float(item.get("last_activity_at", 0) or 0):
                        item["last_activity_at"] = mtime
                        latest = self._read_log_tail(log_file, max_lines=1).strip()
                        if latest:
                            item["last_line"] = latest
                            item["working_on"] = self._extract_minion_work_line(latest)
                        changed = True
                except Exception:
                    pass
            if self._is_pid_alive(pid):
                continue
            log_text = ""
            if log_file.exists():
                log_text = log_file.read_text(encoding="utf-8", errors="replace")
            failed = self._did_minion_fail(log_text)
            item["state"] = "failed" if failed else "completed"
            item["ended_at"] = time.time()
            delegate_id = item.get("delegate_id", "")
            if delegate_id:
                if failed:
                    self.runtime.delegates.update_delegate(
                        delegate_id,
                        state=DelegateState.FAILED,
                        error=self._truncate_output_lines(log_text, max_lines=60, head=30, tail=20),
                    )
                else:
                    self.runtime.delegates.update_delegate(
                        delegate_id,
                        state=DelegateState.COMPLETED,
                        result=self._truncate_output_lines(log_text, max_lines=60, head=30, tail=20),
                    )
            changed = True
        if changed:
            self._save_minions()

    def _read_log_tail(self, log_file: Path, max_lines: int = 30) -> str:
        if not log_file.exists():
            return ""
        text = log_file.read_text(encoding="utf-8", errors="replace")
        lines = text.splitlines()
        if not lines:
            return ""
        return "\n".join(lines[-max_lines:])

    def _did_minion_fail(self, log_text: str) -> bool:
        text = (log_text or "").lower()
        failure_markers = [
            "traceback (most recent call last)",
            "exception:",
            "fatal:",
            "error:",
            "denied by approval",
            "permission denied",
            "tool error",
        ]
        return any(marker in text for marker in failure_markers)

    def _announce_minion_activity(self) -> None:
        # Keep updates visible without flooding the terminal every render pass.
        now = time.time()
        if now - self._last_minion_activity_scan < 1.5:
            return
        self._last_minion_activity_scan = now

        self._refresh_minions()
        if not self._minions:
            return

        updates: list[tuple[str, str, str, str]] = []
        for minion_id, item in sorted(
            self._minions.items(), key=lambda kv: kv[1].get("created_at", 0), reverse=True
        ):
            state = str(item.get("state", "unknown"))
            last_activity = float(item.get("last_activity_at", 0) or 0)
            previous = self._minion_announced_state.get(minion_id)
            previous_activity = self._minion_announced_activity.get(minion_id, 0.0)
            should_emit = previous != state or (state == "running" and last_activity > previous_activity)
            if not should_emit:
                continue
            self._minion_announced_state[minion_id] = state
            self._minion_announced_activity[minion_id] = last_activity
            latest = str(item.get("last_line", "")).strip()
            if len(latest) > 110:
                latest = latest[:107] + "..."
            task = str(item.get("task", "")).strip()
            if len(task) > 56:
                task = task[:53] + "..."
            working_on = str(item.get("working_on", "")).strip() or latest
            if len(working_on) > 90:
                working_on = working_on[:87] + "..."
            updates.append((minion_id, state, task, working_on))

        if not updates:
            return

        table = Table(title="Minion Activity", border_style="gold")
        table.add_column("ID", style="gold")
        table.add_column("State", style="sand")
        table.add_column("Task", style="sand")
        table.add_column("Working On", style="sand")
        for minion_id, state, task, working_on in updates[:8]:
            table.add_row(minion_id, state, task or "-", working_on or "-")
        self.console.print(table)

    def _extract_minion_work_line(self, text: str) -> str:
        line = (text or "").strip()
        if not line:
            return ""
        # Remove common noisy prefixes while preserving intent.
        markers = ("[gold]", "[dim]", "[warning]", "[error]", "INFO:", "DEBUG:", "TRACE:")
        for marker in markers:
            if line.startswith(marker):
                line = line[len(marker) :].strip()
        line = line.replace("Executing:", "working:")
        return line

    def _minion_counts(self) -> tuple[int, int]:
        self._refresh_minions()
        total = len(self._minions)
        running = sum(1 for item in self._minions.values() if item.get("state") == "running")
        return running, total

    def _print_welcome(self) -> None:
        self.console.print()
        if not self._show_banner:
            self.console.print("[gold]𓅞  Tehuti • Thoth, Tongue of Ra[/gold]")
            self.console.print(
                f"[gold.soft]Halls of Records • Balance of Ma'at • Architect of Truth[/gold.soft]"
            )
            self.console.print(
                f"[sand]dir={self.work_dir}  provider={self.config.provider.type}  model={self.config.provider.model or 'not set'}[/sand]"
            )
            self.console.print("[dim]Tip: / for commands, /m to change model, /exit to quit[/dim]")
            self._print_startup_hints()
            return
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
        self._print_startup_hints()

    def _print_startup_hints(self) -> None:
        hints: list[str] = []
        provider = getattr(self.config, "provider", None)
        key_env = str(getattr(provider, "api_key_env", "") or "").strip()
        if key_env:
            key_in_env = bool(os.getenv(key_env))
            key_in_file = False
            try:
                key_in_file = bool(load_env_file(self.config.keys_file).get(key_env, "").strip())
            except Exception:
                key_in_file = False
            if not key_in_env and not key_in_file:
                hints.append(f"Missing {key_env}. Run /setup or /login to configure provider credentials.")

        model = str(getattr(provider, "model", "") or "")
        if model.endswith(":free"):
            hints.append("Free-tier models may be rate-limited/unavailable. Use /m or /model for stable options.")

        for hint in hints[:2]:
            self.console.print(f"[dim]Hint: {hint}[/dim]")

    def _show_turn_meta(self, prompt: str, actions: list[dict[str, Any]] | None = None) -> bool:
        verbosity = self._progress_verbosity()
        return verbosity == "verbose"

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
        if self.prompt_session is None:
            raise RuntimeError("Prompt session unavailable in non-interactive mode.")
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
        if self.prompt_session is None:
            raise RuntimeError("Shell.run() requires interactive mode.")
        if self._show_banner:
            self._animate_banner()
        self._print_welcome()
        if self.config.show_history:
            self._replay_history(limit=6)
        while True:
            try:
                self._announce_minion_activity()
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
                self.console.print(f"[warning]{self._unknown_command_message(user_input)}[/warning]")
                continue

            try:
                self._run_prompt(user_input)
            except Exception as exc:
                from tehuti_cli.core.errors import to_error_payload

                self._emit_interactive_envelope(
                    user_input,
                    "",
                    actions=[],
                    status="failed",
                    error=str(exc),
                    error_payload=to_error_payload(exc),
                )
                self.console.print(f"[warning]{exc}[/warning]")

    def run_once(self, prompt: str) -> None:
        text = prompt.strip()
        if not text:
            return
        if text.startswith("/"):
            try:
                handled = self._handle_slash(text)
            except EOFError:
                self.console.print("By decree, the session closes.")
                return
            if handled:
                return
            self.console.print(f"[warning]{self._unknown_command_message(text)}[/warning]")
            return
        try:
            self._run_prompt(text)
        except Exception as exc:
            from tehuti_cli.core.errors import to_error_payload

            self._emit_interactive_envelope(
                text,
                "",
                actions=[],
                status="failed",
                error=str(exc),
                error_payload=to_error_payload(exc),
            )
            self.console.print(f"[warning]{exc}[/warning]")

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
        if command.startswith("/ux"):
            self._set_ux_preset(command)
            return True
        if command.startswith("/verbosity"):
            self._set_progress_verbosity(command)
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
        if command.startswith("/focus"):
            self._show_focus()
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
        if command.startswith("/status-all"):
            self._show_full_status()
            return True
        if command == "/status" or command.startswith("/status "):
            self._show_status()
            return True
        if command.startswith("/diff"):
            self._show_diff()
            return True
        if command.startswith("/tasks"):
            self._show_tasks(command)
            return True
        if command.startswith("/agent"):
            self._run_agent(command)
            return True
        if command.startswith("/delegate"):
            self._delegate_task(command)
            return True
        if command.startswith("/a2a"):
            import asyncio

            asyncio.run(self._connect_a2a(command))
            return True
        if command.startswith("/full"):
            self._enable_full_mode()
            return True
        if command.startswith("/plan"):
            self._handle_plan(command)
            return True
        if command.startswith("/envelope"):
            self._set_interactive_envelope(command)
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
        if command.startswith("/metrics"):
            self._show_metrics()
            return True
        if command.startswith("/remember"):
            self._remember(command)
            return True
        if command.startswith("/recall"):
            self._recall(command)
            return True
        if command.startswith("/trace"):
            self._show_trace()
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
        table.add_row("/focus", "Show current task objective/mode/phase")
        table.add_row("/mcp", "List configured MCP tools")
        table.add_row("/permissions [shell|write|external] [on|off]", "Set permissions")
        table.add_row("/experimental [list|add|rm] [flag]", "Experimental flags")
        table.add_row("/worklog [on|off]", "Toggle chronicle")
        table.add_row("/ux [quiet|standard|verbose]", "Apply UX preset")
        table.add_row("/verbosity [minimal|standard|verbose]", "Progress preview verbosity")
        table.add_row("/output [full|compact|<chars>]", "Tool output size")
        table.add_row("/context", "Show context usage")
        table.add_row("/status", "Show status")
        table.add_row("/diff", "Show git diff summary")
        table.add_row("/tasks", "List active PTY sessions")
        table.add_row("/agent <task>", "Run autonomous TehutiAgent task")
        table.add_row("/delegate start <task>", "Start background minion")
        table.add_row("/delegate list", "List minions")
        table.add_row("/delegate status <id>", "Show minion status")
        table.add_row("/delegate logs <id>", "Show minion logs")
        table.add_row("/delegate follow <id>", "Live-tail minion logs")
        table.add_row("/delegate stop <id>", "Stop a minion")
        table.add_row("/a2a <url>", "Connect to A2A agent")
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
        table.add_row("/metrics", "Show execution metrics")
        table.add_row("/envelope [on|off]", "Toggle interactive envelope projection")
        table.add_row("/remember", "Store information in memory")
        table.add_row("/recall", "Search memory for information")
        table.add_row("/trace", "Show execution trace summary")
        table.add_row("/full", "Enable MAXIMUM capabilities (YOLO)")
        table.add_row("/status-all", "Show full system status")
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
        self._print_tool_preview(tool, args, objective="expand prompt context", source="macro")
        if self.config.show_actions:
            if not self._sequence_started_at:
                self._start_action_sequence()
            self._print_action_start(tool, args)
        result, trace_event, elapsed = self._execute_traced_tool(tool, args, timeout=30.0, stream_shell=True)
        tool_note = self._format_tool_output(tool, result.output)
        action = self._action_line(tool, args, tool_note, elapsed)
        action["ok"] = result.ok
        action["started"] = True
        action["trace_id"] = trace_event.get("trace_id")
        action["contract_schema"] = trace_event.get("contract_schema")
        if self.config.show_actions:
            self._print_action_line(action)
            if action.get("show_panel") and self._should_render_evidence_panel():
                self._print_tool_outputs([tool_note], [action])
        return tool_note

    def _load_custom_commands(self) -> None:
        self._custom_commands = {}
        paths = [
            Path(".tehuti/commands"),
            Path(".claude/commands"),
            Path(".gemini/commands"),
            get_tehuti_home() / "commands",
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

    def _get_egyptian_symbol(self, tool: str) -> str:
        """Get Egyptian-themed symbol for a tool."""
        symbols = {
            "read": "𓏞",
            "write": "𓏠",
            "edit": "𓏛",
            "shell": "𓃾",
            "glob": "𓃀",
            "grep": "𓁹",
            "find": "𓃃",
            "fetch": "𓁹",
            "web_search": "𓁼",
            "git_status": "𓂄",
            "git_log": "𓂅",
            "git_diff": "𓂆",
            "docker_ps": "𓃍",
            "docker_run": "𓃎",
            "pytest": "𓏏",
            "image_analyze": "𓁹",
        }
        return symbols.get(tool, "𓋴")

    def _get_thinking_message(self, prompt: str) -> str:
        """Build an adaptive planning line from prompt and runtime posture."""
        text = (prompt or "").strip()
        words = [w for w in text.split() if w.strip()]
        if not text:
            return "processing request"

        intents: list[str] = []
        lower = text.lower()
        if any(word in lower for word in ["bug", "error", "traceback", "fix"]):
            intents.append("debugging")
        if any(word in lower for word in ["test", "verify", "smoke", "check"]):
            intents.append("verification")
        if any(word in lower for word in ["read", "file", "directory", "grep", "find", "search"]):
            intents.append("context discovery")
        if any(word in lower for word in ["edit", "write", "refactor", "update"]):
            intents.append("code changes")
        if any(word in lower for word in ["review", "audit"]):
            intents.append("risk review")
        if not intents:
            intents.append("task planning")
        joined = " + ".join(dict.fromkeys(intents))
        posture = "tools:on" if self._tool_required_for_prompt(text) else "tools:optional"
        mode = str(getattr(self, "_execution_mode", "autonomous") or "autonomous")
        variants = [
            "processing {count} words | focus: {focus} | {posture} | mode:{mode}",
            "scoping {count}-word request | focus: {focus} | {posture} | mode:{mode}",
            "routing {count} words through {focus} | {posture} | mode:{mode}",
        ]
        seed = sum(ord(ch) for ch in lower) % len(variants)
        return variants[seed].format(count=len(words), focus=joined, posture=posture, mode=mode)

    def _show_thinking_and_plan(self, prompt: str) -> None:
        thinking = self._get_thinking_message(prompt)
        objective = self._summarize_objective(prompt)
        self.console.print(f"[gold]Focus:[/gold] [sand]{objective}[/sand]")
        self.console.print(f"[gold]Trace:[/gold] [sand]{thinking}[/sand]")
        allow_shell = bool(getattr(self.config, "allow_shell", False))
        allow_write = bool(getattr(self.config, "allow_write", False))
        allow_external = bool(getattr(self.config, "allow_external", False))
        self.console.print(
            "[gold]Guardrails:[/gold] "
            f"[sand]shell={allow_shell} write={allow_write} external={allow_external}[/sand]"
        )
        plan_file = self.session.dir / "plan.txt"
        if plan_file.exists():
            plan_text = plan_file.read_text(encoding="utf-8").strip()
            if plan_text:
                first = plan_text.splitlines()[0]
                if len(first) > 120:
                    first = first[:117] + "..."
                self.console.print(f"[gold]Active:[/gold] [sand]{first}[/sand]")

    def _build_turn_plan(self, prompt: str) -> list[str]:
        prompt_lower = (prompt or "").lower()
        plan = ["gather live context from tools"]
        if any(word in prompt_lower for word in ["fix", "bug", "error", "traceback"]):
            plan.append("reproduce issue and isolate root cause")
            plan.append("patch safely and verify correction")
        elif any(word in prompt_lower for word in ["test", "smoke", "verify", "check"]):
            plan.append("run targeted verification commands")
            plan.append("report concrete pass/fail evidence")
        elif any(word in prompt_lower for word in ["review", "audit"]):
            plan.append("inspect modified surfaces and risks")
            plan.append("return findings ordered by severity")
        elif any(word in prompt_lower for word in ["delegate", "minion", "agent", "sub-agent"]):
            plan.append("inspect delegated execution state")
            plan.append("summarize progress, blockers, and next actions")
        else:
            plan.append("execute only required tool calls")
            plan.append("return evidence-backed outcome")
        if hasattr(self.config, "allow_shell") and not bool(getattr(self.config, "allow_shell", False)):
            plan.append("respect shell-disabled constraints")
        return plan

    def _show_turn_progress(self, actions: list[dict[str, Any]], response: str) -> None:
        if self._progress_verbosity() != "verbose":
            return
        summary = self._progress_summary_values(actions, response)
        minions_running, minions_total = self._minion_counts()
        primary = summary.get("primary_execution", "")
        fallback = summary.get("fallback_execution", "")
        status_bits = []
        if primary:
            status_bits.append(primary)
        if fallback:
            status_bits.append(fallback)
        status_prefix = f"{' | '.join(status_bits)} | " if status_bits else ""
        self.console.print(
            f"[gold]Turn summary:[/gold] [sand]{status_prefix}{summary['actions']} | {summary['evidence']} | "
            f"minions {minions_running}/{minions_total} | {summary['response']}[/sand]"
        )

    def _reset_phase_stream(self) -> None:
        self._phase_sequence = 0
        self._phase_started_at = time.perf_counter()
        self._phase_events = []

    def _reset_turn_progress_events(self) -> None:
        self._turn_progress_events = []
        self._turn_activity_events = []
        self._tool_stream_event_count = 0

    def _record_progress_event(self, event: str, **data: Any) -> None:
        payload: dict[str, Any] = {
            "schema": "tehuti.progress.v1",
            "event_version": "v1",
            "event": str(event),
            "session_id": self.session.id,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "surface": "cli_interactive",
        }
        payload.update({k: v for k, v in data.items() if v is not None})
        self._turn_progress_events.append(payload)

    def _record_activity_event(self, item: dict[str, Any], *, ok: bool) -> None:
        summary = self._activity_line(item, ok=ok)
        if not summary:
            return
        payload: dict[str, Any] = {
            "schema": "tehuti.activity.v1",
            "event_version": "v1",
            "event": "activity",
            "session_id": self.session.id,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "surface": "cli_interactive",
            "tool": str(item.get("tool", "") or ""),
            "success": bool(ok),
            "summary": summary,
        }
        events = getattr(self, "_turn_activity_events", None)
        if isinstance(events, list):
            events.append(payload)

    def _phase_elapsed_ms(self) -> int:
        started_at = getattr(self, "_phase_started_at", None)
        if started_at is None:
            return 0
        return int((time.perf_counter() - started_at) * 1000)

    def _phase_style(self, status: str) -> str:
        if status == "error":
            return "warning"
        if status == "done":
            return "gold.soft"
        return "sand"

    def _phase_symbol(self, status: str) -> str:
        if status == "error":
            return "✗"
        if status == "done":
            return "✓"
        return "◆"

    def _emit_phase_event(
        self,
        phase: str,
        detail: str = "",
        *,
        status: str = "progress",
        meta: dict[str, Any] | None = None,
    ) -> None:
        normalized_phase = normalize_phase_name(phase)
        normalized_status = normalize_phase_status(status)
        group = phase_group(normalized_phase)
        self._current_phase = normalized_phase
        self._phase_sequence += 1
        elapsed = self._phase_elapsed_ms()
        symbol = self._phase_symbol(normalized_status)
        lead = f"{symbol} [{self._phase_sequence}] {normalized_phase}"
        suffix = f" | {detail}" if detail else ""
        if phase_should_render(self._progress_verbosity(), normalized_phase, normalized_status):
            self.console.print(Text(f"{lead}{suffix}", style=self._phase_style(normalized_status)))
        payload: dict[str, Any] = {
            "schema": PHASE_STREAM_SCHEMA,
            "event_version": PHASE_STREAM_EVENT_VERSION,
            "event": "phase",
            "sequence": self._phase_sequence,
            "session_id": self.session.id,
            "surface": PHASE_STREAM_SURFACE,
            "phase": normalized_phase,
            "phase_group": group,
            "status": normalized_status,
            "detail": detail,
            "elapsed_ms": elapsed,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
        }
        if meta:
            payload["meta"] = meta
        self._phase_events.append(payload)
        self.session.append_wire(payload)

    def _tool_phase_kind(self, tool: str) -> str:
        return tool_phase_kind(tool, self.registry.get(tool))

    def _progress_summary_values(self, actions: list[dict[str, Any]], response: str) -> dict[str, str]:
        action_count = len(actions or [])
        success_count = sum(1 for action in (actions or []) if action.get("ok") is not False)
        failure_count = max(0, action_count - success_count)
        response_text = (response or "").strip()
        response_lines = len(response_text.splitlines()) if response_text else 0
        response_chars = len(response_text)
        evidence_actions = sum(1 for action in (actions or []) if str(action.get("output", "")).strip())
        provider_blocked = self._is_provider_or_model_failure_response(response_text)
        fallback_used = "live non-destructive local demo" in response_text.lower()
        if action_count == 0:
            actions_value = "execution blocked before tools" if provider_blocked else "no tool actions executed"
        elif failure_count == 0:
            actions_value = f"{success_count}/{action_count} succeeded"
        else:
            actions_value = f"{success_count}/{action_count} succeeded, {failure_count} failed"
        response_value = (
            f"{response_lines} lines, {response_chars} chars"
            if response_text
            else "no response content"
        )
        return {
            "actions": actions_value,
            "evidence": f"{evidence_actions} action outputs",
            "response": response_value,
            "primary_execution": "primary=failed(provider)" if provider_blocked else "",
            "fallback_execution": (
                f"fallback=succeeded({success_count}/{action_count})"
                if provider_blocked and fallback_used and action_count > 0
                else ""
            ),
        }

    def _tool_required_for_prompt(self, prompt: str) -> bool:
        text = str(prompt or "").strip().lower()
        if not text:
            return False
        conversational = {
            "hi",
            "hello",
            "hey",
            "thanks",
            "thank you",
            "what can you do",
            "capabilities",
            "help",
        }
        if text in conversational:
            return False
        tool_intent_terms = (
            "read",
            "write",
            "edit",
            "file",
            "directory",
            "grep",
            "search",
            "find",
            "list",
            "run",
            "shell",
            "test",
            "verify",
            "check",
            "analyze",
            "review",
            "show me",
            "demonstrate",
            "demo",
            "capabilities and demonstrate",
        )
        return any(term in text for term in tool_intent_terms)

    def _chat_messages_with_phase(self, messages: list[dict[str, Any]], *, stage: str) -> str:
        provider_cfg = getattr(self.config, "provider", None)
        model = str(getattr(provider_cfg, "model", "") or "not set")
        provider = str(getattr(provider_cfg, "type", "") or "unknown")
        self._emit_phase_event("analyze.model.start", f"{provider}/{model} | {stage}")
        response = self.llm.chat_messages(messages)
        self._emit_phase_event("analyze.model.done", f"{stage} | {len(response or '')} chars", status="done")
        return response

    def _run_prompt(self, prompt: str) -> None:
        # Initialize tracing for this turn
        if not self.tracer:
            from tehuti_cli.core.agent_loop import AgentTracer

            self.tracer = AgentTracer(self.session.id)
        self.tracer.log_turn_start(prompt)

        tool_descriptions = get_tool_descriptions_for_prompt(self.registry)
        mode = self._execution_mode

        # Get relevant memories
        relevant_memories = ""
        try:
            memories = self.memory.search(prompt, top_k=3)
            if memories:
                relevant_memories = "\nRelevant context from memory:\n"
                for entry, score in memories:
                    relevant_memories += f"- {entry.content}\n"
        except Exception:
            pass

        require_tools = self._tool_required_for_prompt(prompt)
        if require_tools:
            policy = (
                "TOOL USAGE POLICY:\n"
                "- This prompt requires tool-backed evidence. Use tools before final response.\n"
                "- NEVER fabricate file contents, directory listings, or command output.\n\n"
            )
            system = (
                "You are Project Tehuti, an AI assistant with tool access.\n\n"
                f"{relevant_memories}\n"
                f"{policy}"
                "STRICT RESPONSE FORMAT - JSON ONLY, NO MARKDOWN:\n"
                "- To use a tool, respond with VALID JSON only (no markdown, no code fences):\n"
                '  {"type":"tool","name":"TOOL_NAME","args":{"arg1":"value1"}}\n'
                "- When finished, respond with VALID JSON only:\n"
                '  {"type":"final","content":"your response here"}\n\n'
                "EXAMPLES:\n"
                '- To list files: {"type":"tool","name":"shell","args":{"command":"ls -la"}}\n'
                '- To read a file: {"type":"tool","name":"read","args":{"path":"file.txt"}}\n'
                '- To search: {"type":"tool","name":"grep","args":{"pattern":"search_term"}}\n'
                '- Final response: {"type":"final","content":"I found 5 files in the directory."}\n\n'
                "CRITICAL - FOLLOW THESE RULES:\n"
                "- Your ENTIRE response must be valid JSON\n"
                "- NO markdown code blocks (```json, ```)\n"
                "- NO explanatory text outside the JSON\n"
                "- Each response must have exactly one top-level JSON object\n"
                "- Do NOT explain what you will do - JUST DO IT\n"
                "- Do NOT ask the user to run commands - YOU run them\n"
                "- Do NOT make up information\n\n"
                f"{tool_descriptions}\n\n"
                f"Execution mode: {mode}\n"
                "Respond truthfully and concisely."
            )
        else:
            system = (
                "You are Project Tehuti, an AI assistant.\n\n"
                f"{relevant_memories}\n"
                "For conversational prompts, respond directly without tools.\n"
                "Be concise, truthful, and avoid operational claims that require tool evidence.\n"
            )
        history = list(self.session.iter_context())[-10:]
        messages = [{"role": "system", "content": system}]
        for item in history:
            role = item.get("role", "user")
            content = item.get("content", "")
            messages.append({"role": role, "content": content})
        messages.append({"role": "user", "content": prompt})

        self._busy_enter()
        self._streamed_actions = False
        self._sequence_started_at = None
        self._action_counter = 0
        self._last_actions = []
        self._last_outputs = []
        self._reset_phase_stream()
        self._reset_turn_progress_events()
        self._emit_phase_event("intake", f"{len(prompt.split())} words accepted", status="done")

        objective = self._summarize_objective(prompt)
        turn_plan = self._build_turn_plan(prompt)
        self._last_prompt = str(prompt or "").strip()
        self._last_require_tools = bool(require_tools)
        self._last_turn_plan = list(turn_plan)
        self._current_objective = objective
        self._record_progress_event(
            "task_context",
            objective=objective,
            require_tools=require_tools,
            execution_mode=self._execution_mode,
            plan=turn_plan,
        )
        try:
            self._emit_phase_event("analyze", "building turn context")
            show_meta = self._show_turn_meta(prompt)
            if show_meta:
                self._show_thinking_and_plan(prompt)
            if require_tools:
                self._emit_phase_event("execute", "running model/tool loop")
                response, tool_outputs, actions = self._run_with_tools(messages, objective=objective)
            else:
                self._emit_phase_event("execute", "requesting direct model response")
                response = self._chat_messages_with_phase(messages, stage="initial-chat")
                provider_error = self._provider_error_message(response)
                if provider_error:
                    self._emit_phase_event("error", provider_error, status="error", meta={"source": "provider"})
                    response = provider_error
                tool_outputs, actions = [], []
            self._last_actions = actions
            self._last_outputs = tool_outputs
            if not response and not actions:
                # Retry once if model returned empty.
                self._emit_phase_event("recover", "empty model response, retrying", meta={"reason": "empty_response"})
                response, tool_outputs, actions = self._retry_empty_response(messages, prompt)
            if require_tools and not actions and not self._is_provider_or_model_failure_response(response):
                response, tool_outputs, actions = self._enforce_minimum_tool_evidence(
                    response=response,
                    tool_outputs=tool_outputs,
                    actions=actions,
                    prompt=prompt,
                    objective=objective,
                )
                self._last_actions = actions
                self._last_outputs = tool_outputs

            # Truthful failure lifecycle: provider/model failure is not a successful execute/respond cycle.
            if self._is_provider_or_model_failure_response(response) and not actions:
                self._emit_phase_event(
                    "execute.done",
                    f"{len(actions)} actions, {len(tool_outputs)} evidence blocks",
                    status="error",
                    meta={"actions": len(actions), "evidence_blocks": len(tool_outputs), "provider_failure": True},
                )
                error_payload = self._provider_failure_error_payload(response)
                demo_actions: list[dict[str, Any]] = []
                demo_outputs: list[str] = []
                if self._should_run_local_capability_demo(prompt):
                    self._emit_phase_event(
                        "recover",
                        "provider unavailable; running local non-destructive capability demo",
                        meta={"mode": "local_capability_demo"},
                    )
                    demo_response, demo_outputs, demo_actions = self._run_local_capability_demo()
                    actions.extend(demo_actions)
                    tool_outputs.extend(demo_outputs)
                    response = (
                        f"{str(response).strip()}\n\n"
                        "Live non-destructive local demo (provider-independent):\n"
                        f"{demo_response}"
                    ).strip()
                self._last_actions = actions
                self._last_outputs = tool_outputs
                self.session.append_context("user", prompt)
                self.session.append_context("assistant", str(response or "").strip())
                recovered_with_demo = bool(demo_actions)
                termination_reason = "provider_failure_recovered" if recovered_with_demo else "loop_exception"
                has_error = not recovered_with_demo
                envelope_status = "success" if recovered_with_demo else "failed"
                self._record_progress_event(
                    "loop_terminated",
                    termination_reason=termination_reason,
                    has_error=has_error,
                )
                self._emit_interactive_envelope(
                    prompt,
                    str(response or "").strip(),
                    actions,
                    status=envelope_status,
                    error=str(response or "").strip(),
                    error_payload=error_payload,
                    termination_reason=termination_reason,
                    has_error=has_error,
                )
                if recovered_with_demo:
                    self._emit_phase_event("respond", "rendering degraded response with local evidence", status="done")
                else:
                    self._emit_phase_event("respond", "rendering failure response", status="error")
                self._print_thoth_response(str(response or "").strip(), prompt)
                self._show_turn_progress(actions, str(response or "").strip())
                if recovered_with_demo:
                    self._emit_phase_event("complete", "turn finished in degraded mode", status="done")
                else:
                    self._emit_phase_event("complete", "turn finished with provider failure", status="error")
                self._sequence_started_at = None
                return

            # No postflight shortcuts; allow model to handle every prompt.

            if not response:
                if actions:
                    self._emit_phase_event("synthesize", "assembling response from tool evidence")
                    response = self._retry_action_reply(messages)
                    if not response:
                        response = self._dynamic_response_from_actions(actions, tool_outputs)
                else:
                    self._emit_phase_event("synthesize", "requesting compact acknowledgement")
                    response = self._retry_minimal_reply(messages)
                if not response:
                    response = ""
                self._emit_phase_event(
                    "execute.done",
                    f"{len(actions)} actions, {len(tool_outputs)} evidence blocks",
                    status="done",
                    meta={"actions": len(actions), "evidence_blocks": len(tool_outputs)},
                )
                self.session.append_context("user", prompt)
                self.session.append_context("assistant", response)
                self._record_progress_event(
                    "loop_terminated",
                    termination_reason="final_response",
                    has_error=False,
                )
                self._emit_interactive_envelope(prompt, response, actions, status="success")
                self._emit_phase_event("respond", "rendering final response", status="done")
                self._print_thoth_response(response, prompt)
                self._show_turn_progress(actions, response)
                self._emit_phase_event("complete", "turn finished", status="done")
                return

            response = self._sanitize_response(response)
            # No heuristic auto-runs; only execute tools when the model explicitly requests.
            if actions and not self._response_has_evidence(response):
                response = self._inject_evidence_digest(response, actions)
            self._emit_phase_event(
                "execute.done",
                f"{len(actions)} actions, {len(tool_outputs)} evidence blocks",
                status="done",
                meta={"actions": len(actions), "evidence_blocks": len(tool_outputs)},
            )
            self.session.append_context("user", prompt)
            self.session.append_context("assistant", response)
            self._record_progress_event(
                "loop_terminated",
                termination_reason="final_response",
                has_error=False,
            )
            self._emit_interactive_envelope(prompt, response, actions, status="success")
            self._emit_phase_event("respond", "rendering final response", status="done")
            self._print_thoth_response(response, prompt)
            self._show_turn_progress(actions, response)
            if self.llm.last_notice:
                self.console.print(f"[dim]Note: {self.llm.last_notice}[/dim]")
            self._emit_phase_event("complete", "turn finished", status="done")
            self._sequence_started_at = None
        except Exception as exc:
            self._emit_phase_event("error", str(exc), status="error")
            raise
        finally:
            self._busy_exit()
            self._current_objective = ""
            self._current_phase = "idle"

    def _is_provider_or_model_failure_response(self, response: str) -> bool:
        text = str(response or "").strip().lower()
        if not text:
            return False
        if text.startswith("model request failed:"):
            return True
        if text.startswith("provider error:"):
            return True
        return any(
            token in text
            for token in (
                "billing limits",
                "spend limit",
                "rate-limit",
                "rate limit",
                "unavailable for this request",
                "provider rejected the request",
            )
        )

    def _provider_failure_error_payload(self, response: str) -> dict[str, Any]:
        text = str(response or "").strip()
        lowered = text.lower()
        retryable = True
        code = "provider_error"
        if "spend limit" in lowered or "billing" in lowered:
            code = "provider_billing_limit"
            retryable = False
        elif "unavailable" in lowered:
            code = "model_unavailable"
        elif "rate-limit" in lowered or "rate limit" in lowered:
            code = "provider_rate_limited"
        return {
            "category": "provider",
            "code": code,
            "error": text or "provider failure",
            "retryable": retryable,
            "details": {"source": "shell_model_loop"},
        }

    def _should_run_local_capability_demo(self, prompt: str) -> bool:
        text = str(prompt or "").strip().lower()
        if not text:
            return False
        capability_terms = ("capabilities", "capability", "what can you do", "tools", "tooling")
        demo_terms = ("demonstrate", "demo", "show", "prove")
        if any(term in text for term in capability_terms) and any(term in text for term in demo_terms):
            return True
        return False

    def _enforce_minimum_tool_evidence(
        self,
        *,
        response: str,
        tool_outputs: list[str],
        actions: list[dict[str, Any]],
        prompt: str,
        objective: str,
    ) -> tuple[str, list[str], list[dict[str, Any]]]:
        probe = self._select_evidence_probe(prompt=prompt, objective=objective)
        self._emit_phase_event(
            "recover",
            f"model returned final text without tool evidence; enforcing {probe['profile']} probe",
            meta={"mode": "tool_evidence_enforcement", "profile": probe["profile"]},
        )
        if not self.config.allow_shell:
            fallback = (
                "Model returned a response without tool execution and shell access is disabled, "
                "so Tehuti cannot guarantee tool-backed evidence for this turn."
            )
            return fallback, tool_outputs, actions

        tool = "shell"
        args = {"command": probe["command"]}
        kind = self._tool_phase_kind(tool)
        self._emit_phase_event(
            f"{kind}.start",
            f"shell {probe['command']}",
            meta={"tool": tool, "source": "evidence_enforcer", "profile": probe["profile"]},
        )
        result, action = self._execute_runtime_tool_with_feedback(
            tool,
            args,
            objective=objective or probe["purpose"],
            source="enforcer",
            record_progress=True,
        )
        action["args"] = args
        actions.append(action)
        tool_note = self._format_tool_output(tool, result.output)
        if action.get("show_panel"):
            tool_outputs.append(tool_note)
        self._emit_phase_event(
            f"{kind}.done",
            f"shell ok={result.ok}",
            status="done" if result.ok else "error",
            meta={"tool": tool, "source": "evidence_enforcer", "ok": result.ok, "profile": probe["profile"]},
        )
        snippet = self._evidence_snippet(tool_note) or "(no output)"
        grounded = (
            "Model returned a response without executing tools. "
            "To keep this turn evidence-backed, Tehuti ran a non-destructive grounding command.\n\n"
            f"- profile `{probe['profile']}`\n"
            f"- shell `{probe['command']}` -> {snippet}"
        )
        return grounded, tool_outputs, actions

    def _select_evidence_probe(self, *, prompt: str, objective: str) -> dict[str, str]:
        text = f"{prompt} {objective}".strip().lower()
        if any(token in text for token in ("git", "diff", "commit", "branch", "repo", "repository", "pr")):
            return {
                "profile": "repository",
                "purpose": "collect repository state evidence",
                "command": "git status --short 2>/dev/null || echo git_status_unavailable",
            }
        if any(token in text for token in ("file", "directory", "folder", "read", "list", "find", "search", "path")):
            return {
                "profile": "filesystem",
                "purpose": "collect filesystem evidence",
                "command": "pwd && ls -1 | head -n 12",
            }
        if any(token in text for token in ("diagnostic", "health", "status", "system", "host", "infra")):
            return {
                "profile": "diagnostics",
                "purpose": "collect host diagnostics evidence",
                "command": "uname -s && whoami",
            }
        if any(token in text for token in ("python", "node", "runtime", "version", "capability", "capabilities")):
            return {
                "profile": "runtime",
                "purpose": "collect runtime capability evidence",
                "command": "python3 --version 2>/dev/null || echo python3_unavailable",
            }
        return {
            "profile": "grounding",
            "purpose": "establish non-destructive grounding evidence",
            "command": "pwd",
        }

    def _run_local_capability_demo(self) -> tuple[str, list[str], list[dict[str, Any]]]:
        outputs: list[str] = []
        actions: list[dict[str, Any]] = []
        tool_count = len(self.registry.list_tools())
        lines = [f"Registered tools available: {tool_count}."]

        # Non-destructive runtime demonstration even when model provider is unavailable.
        if self.config.allow_shell:
            demo_cmds = [
                "pwd",
                "test -w . && echo workspace_writable || echo workspace_readonly",
                "python3 --version 2>/dev/null || echo python3_unavailable",
            ]
            for cmd in demo_cmds:
                result, action = self._execute_runtime_tool_with_feedback(
                    "shell",
                    {"command": cmd},
                    objective="provider-independent non-destructive demonstration",
                    source="fallback",
                )
                action["args"] = {"command": cmd}
                actions.append(action)
                formatted = self._format_tool_output("shell", result.output)
                if action.get("show_panel"):
                    outputs.append(formatted)
                snippet = self._evidence_snippet(formatted) or "(no output)"
                lines.append(f"- shell `{cmd}` -> {snippet}")
        else:
            lines.append("- Shell demonstration unavailable because shell permission is disabled.")
        return "\n".join(lines), outputs, actions

    def _interactive_envelope_enabled(self) -> bool:
        return "interactive_envelope" in self.config.experimental_flags

    def _emit_interactive_envelope(
        self,
        prompt: str,
        response: str,
        actions: list[dict[str, Any]],
        *,
        status: str,
        error: str | None = None,
        error_payload: dict[str, Any] | None = None,
        termination_reason: str | None = None,
        has_error: bool | None = None,
    ) -> None:
        trace_id = str(uuid.uuid4())[:12]
        turn_id = str(uuid.uuid4())[:12]
        timestamp = time.strftime("%Y-%m-%dT%H:%M:%S")
        tool_calls: list[dict[str, Any]] = []
        events: list[dict[str, Any]] = []
        tool_contracts: list[dict[str, Any]] = []
        sequence = 0
        projected = list(getattr(self, "_turn_progress_events", []) or [])
        if projected:
            for base_event in projected:
                sequence += 1
                event_payload = dict(base_event)
                event_payload["sequence"] = sequence
                event_payload["session_id"] = self.session.id
                event_payload["trace_id"] = trace_id
                event_payload["turn_id"] = turn_id
                event_payload.setdefault("schema", "tehuti.progress.v1")
                event_payload.setdefault("event_version", "v1")
                event_payload.setdefault("timestamp", timestamp)
                event_payload.setdefault("surface", "cli_interactive")
                events.append(event_payload)
        else:
            events.append(
                {
                    "schema": "tehuti.progress.v1",
                    "event_version": "v1",
                    "event": "iteration_start",
                    "sequence": sequence + 1,
                    "session_id": self.session.id,
                    "trace_id": trace_id,
                    "turn_id": turn_id,
                    "timestamp": timestamp,
                    "surface": "cli_interactive",
                    "iteration": 1,
                }
            )
            sequence += 1
            for action in actions or []:
                tool_name = str(action.get("tool") or action.get("title") or "")
                args = action.get("args") if isinstance(action.get("args"), dict) else {}
                success = bool(action.get("ok", True))
                events.append(
                    {
                        "schema": "tehuti.progress.v1",
                        "event_version": "v1",
                        "event": "tool_start",
                        "sequence": sequence + 1,
                        "session_id": self.session.id,
                        "trace_id": trace_id,
                        "turn_id": turn_id,
                        "timestamp": timestamp,
                        "surface": "cli_interactive",
                        "tool": tool_name,
                        "arguments": args,
                    }
                )
                sequence += 1
                events.append(
                    {
                        "schema": "tehuti.progress.v1",
                        "event_version": "v1",
                        "event": "tool_end",
                        "sequence": sequence + 1,
                        "session_id": self.session.id,
                        "trace_id": trace_id,
                        "turn_id": turn_id,
                        "timestamp": timestamp,
                        "surface": "cli_interactive",
                        "tool": tool_name,
                        "success": success,
                    }
                )
                sequence += 1

        for action in actions or []:
            tool_name = str(action.get("tool") or action.get("title") or "")
            args = action.get("args") if isinstance(action.get("args"), dict) else {}
            if tool_name:
                tool_calls.append({"name": tool_name, "arguments": args})
            success = bool(action.get("ok", True))
            tool_contracts.append(
                {
                    "tool": tool_name,
                    "success": success,
                    "trace_id": str(action.get("trace_id") or trace_id),
                    "contract_schema": str(action.get("contract_schema") or "tehuti.tool_result.v1"),
                    "error_payload": None if success else {"message": str(action.get("error") or action.get("output") or "")},
                }
            )

        normalized_error = None
        if status == "failed":
            payload = error_payload or {}
            normalized_error = {
                "category": str(payload.get("category", "internal")),
                "code": str(payload.get("code", "unclassified_error")),
                "message": str(payload.get("error", error or "")),
                "retryable": bool(payload.get("retryable", False)),
                    "details": payload.get("details", {}) if isinstance(payload.get("details"), dict) else {},
            }
        resolved_termination_reason = termination_reason or ("final_response" if status == "success" else "loop_exception")
        resolved_has_error = bool(normalized_error) if has_error is None else bool(has_error)

        has_terminated = any(str(event.get("event")) == "loop_terminated" for event in events)
        if not has_terminated:
            events.append(
                {
                    "schema": "tehuti.progress.v1",
                    "event_version": "v1",
                    "event": "loop_terminated",
                    "sequence": sequence + 1,
                    "session_id": self.session.id,
                    "trace_id": trace_id,
                    "turn_id": turn_id,
                    "timestamp": timestamp,
                    "surface": "cli_interactive",
                    "termination_reason": resolved_termination_reason,
                    "has_error": resolved_has_error,
                }
            )

        iterations = sum(1 for event in events if str(event.get("event")) == "iteration_start")
        parse_status = "structured" if iterations > 0 or bool(actions) else "text"
        latency_ms = self._phase_elapsed_ms()

        payload: dict[str, Any] = {
            "schema": "tehuti.cli.interactive.v1",
            "status": status,
            "trace_id": trace_id,
            "turn_id": turn_id,
            "session_id": self.session.id,
            "result": {
                "schema": "tehuti.agent_task.v1",
                "success": status == "success",
                "session_id": self.session.id,
                "response": response,
                "thoughts": "",
                "tool_calls": tool_calls,
                "iterations": max(1, iterations),
                "latency_ms": latency_ms,
                "error": error,
                "parse_status": parse_status,
                "parse_mode": "repair",
                "termination_reason": resolved_termination_reason,
                "degraded": resolved_termination_reason == "provider_failure_recovered",
                "prompt": prompt,
            },
            "events": events,
            "phase_events": list(getattr(self, "_phase_events", [])),
            "activity_events": list(getattr(self, "_turn_activity_events", [])),
            "tool_contracts": tool_contracts,
            "error": normalized_error,
        }
        self.session.append_wire(payload)
        if self._interactive_envelope_enabled():
            self.console.print(json.dumps(payload))

    def _set_interactive_envelope(self, command: str) -> None:
        parts = command.split()
        if len(parts) == 1:
            enabled = self._interactive_envelope_enabled()
            self.console.print(f"[gold]Interactive envelope projection:[/gold] {'on' if enabled else 'off'}")
            return
        value = parts[1].strip().lower()
        if value not in {"on", "off"}:
            self.console.print("[warning]Usage: /envelope [on|off][/warning]")
            return
        if value == "on" and "interactive_envelope" not in self.config.experimental_flags:
            self.config.experimental_flags.append("interactive_envelope")
        if value == "off" and "interactive_envelope" in self.config.experimental_flags:
            self.config.experimental_flags.remove("interactive_envelope")
        save_config(self.config)
        self.console.print(f"[gold]Interactive envelope projection:[/gold] {value}")

    def _retry_empty_response(
        self, messages: list[dict[str, Any]], prompt: str
    ) -> tuple[str, list[str], list[dict[str, str]]]:
        # Retry once with a stricter instruction.
        messages = list(messages)
        messages.append({"role": "system", "content": "Respond with final now."})
        try:
            response, tool_outputs, actions = self._run_with_tools(messages, objective=self._summarize_objective(prompt))
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
            response = self._chat_messages_with_phase(followup, stage="retry-action-reply")
            if response:
                provider_error = self._provider_error_message(response)
                if provider_error:
                    return provider_error
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
            response = self._chat_messages_with_phase(followup, stage="retry-minimal-reply")
            if response:
                provider_error = self._provider_error_message(response)
                if provider_error:
                    return provider_error
                return self._sanitize_response(response)
        except Exception:
            pass
        return ""

    def _run_probe_tool(self, tool: str, args: dict[str, Any]) -> tuple[str, dict[str, Any]]:
        result, action = self._execute_runtime_tool_with_feedback(
            tool,
            args,
            objective="probe runtime state",
            source="probe",
            record_progress=False,
        )
        return self._format_tool_output(tool, result.output), action

    def _execute_traced_tool(
        self,
        tool: str,
        args: dict[str, Any],
        *,
        timeout: float = 30.0,
        stream_shell: bool = True,
        record_progress: bool = True,
    ) -> tuple[Any, dict[str, Any], float]:
        self._busy_enter()
        try:
            result, trace_event = self.runtime.execute_with_tracing(
                tool,
                args,
                tracer=self.tracer,
                timeout=timeout,
                output_callback=(
                    self._shell_stream_callback(tool=tool, record_progress=record_progress)
                    if stream_shell and tool == "shell"
                    else None
                ),
            )
            elapsed = float(trace_event.get("duration_ms", 0) or 0) / 1000.0
            return result, trace_event, elapsed
        finally:
            self._busy_exit()

    def _busy_enter(self) -> None:
        self._busy_depth = int(getattr(self, "_busy_depth", 0)) + 1
        self._busy = True

    def _busy_exit(self) -> None:
        self._busy_depth = max(0, int(getattr(self, "_busy_depth", 0)) - 1)
        self._busy = self._busy_depth > 0

    def _execute_runtime_tool_with_feedback(
        self,
        tool: str,
        args: dict[str, Any],
        *,
        objective: str = "",
        source: str = "system",
        timeout: float | None = None,
        record_progress: bool = True,
    ):
        self._print_tool_preview(tool, args, objective=objective, source=source)
        if self.config.show_actions:
            if not self._sequence_started_at:
                self._start_action_sequence()
            self._print_action_start(tool, args)
        if record_progress:
            self._record_progress_event("tool_start", tool=tool, arguments=args)
        result, trace_event, elapsed = self._execute_traced_tool(
            tool,
            args,
            timeout=timeout or 30.0,
            stream_shell=True,
            record_progress=record_progress,
        )

        tool_note = self._format_tool_output(tool, result.output)
        action = self._action_line(tool, args, tool_note, elapsed)
        action["ok"] = result.ok
        action["started"] = self.config.show_actions
        action["trace_id"] = trace_event.get("trace_id")
        action["contract_schema"] = trace_event.get("contract_schema")
        if record_progress:
            self._record_progress_event(
                "tool_end",
                tool=tool,
                success=result.ok,
                execution_time_ms=int(elapsed * 1000),
                result=result.output if result.ok else "",
                error="" if result.ok else result.output,
                trace_id=str(trace_event.get("trace_id") or ""),
                contract_schema=trace_event.get("contract_schema"),
                error_payload=trace_event.get("error"),
            )
        self._print_action_line(action)
        if action.get("show_panel") and self._should_render_evidence_panel():
            self._print_tool_outputs([tool_note], [action])
        return result, action

    def _run_with_tools(
        self, messages: list[dict[str, Any]], max_turns: int = 3, objective: str = ""
    ) -> tuple[str, list[str], list[dict[str, str]]]:
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
            response = self._chat_messages_with_phase(messages, stage="initial")
        except Exception as exc:
            self.logger.exception("LLM chat_messages failed")
            return f"Model request failed: {exc}", [], []
        provider_error = self._provider_error_message(response)
        if provider_error:
            self._emit_phase_event("error", provider_error, status="error", meta={"source": "provider"})
            return provider_error, [], []

        def finalize(text: str) -> str:
            return self._sanitize_response(text or "")

        seen_tools: set[str] = set()
        tool_outputs: list[str] = []
        actions: list[dict[str, str]] = []
        iteration = 0
        for _ in range(max_turns):
            iteration += 1
            self._record_progress_event(
                "iteration_start",
                iteration=iteration,
                max_iterations=max_turns,
            )
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
                        args = (
                            call.get("args") or call.get("arguments") or call.get("function", {}).get("arguments") or {}
                        )
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
                    for i, call in enumerate(new_tools, 1):
                        self._announce_minion_activity()
                        if not self._sequence_started_at:
                            self._start_action_sequence()
                        kind = self._tool_phase_kind(call.name)
                        preview = self._tool_args_preview(call.name, call.args)
                        self._emit_phase_event(
                            f"{kind}.start",
                            f"{call.name} ({i}/{len(new_tools)}) {preview}".strip(),
                            meta={"tool": call.name, "step": i, "total": len(new_tools)},
                        )

                        self._print_tool_preview(
                            call.name, call.args, objective=objective, step=i, total=len(new_tools), source="agent"
                        )

                        if self.config.show_actions:
                            self._print_action_start(call.name, call.args)
                        self._record_progress_event(
                            "tool_start",
                            tool=call.name,
                            arguments=call.args,
                            index=i,
                            total=len(new_tools),
                        )

                        result, trace_event, elapsed = self._execute_traced_tool(
                            call.name,
                            call.args,
                            timeout=30.0,
                            stream_shell=True,
                        )
                        tool_note = self._format_tool_output(call.name, result.output)
                        action = self._action_line(call.name, call.args, tool_note, elapsed)
                        action["ok"] = result.ok
                        action["started"] = True
                        action["trace_id"] = trace_event.get("trace_id")
                        action["contract_schema"] = trace_event.get("contract_schema")
                        actions.append(action)
                        self._print_action_line(action)
                        self._streamed_actions = True
                        if action.get("show_panel") and self._should_render_evidence_panel():
                            self._print_tool_outputs([tool_note], [action])
                        if action.get("show_panel"):
                            tool_outputs.append(tool_note)
                        self._emit_phase_event(
                            f"{kind}.done",
                            f"{call.name} ok={result.ok} elapsed={int(elapsed * 1000)}ms",
                            status="done" if result.ok else "error",
                            meta={"tool": call.name, "ok": result.ok, "elapsed_ms": int(elapsed * 1000)},
                        )
                        self._record_progress_event(
                            "tool_end",
                            tool=call.name,
                            success=result.ok,
                            execution_time_ms=int(elapsed * 1000),
                            result=result.output if result.ok else "",
                            error="" if result.ok else result.output,
                            index=i,
                            total=len(new_tools),
                            trace_id=str(trace_event.get("trace_id") or ""),
                            contract_schema=trace_event.get("contract_schema"),
                            error_payload=trace_event.get("error"),
                        )
                        results.append(tool_note)
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
                    response = self._chat_messages_with_phase(messages, stage="post-tools-batch")
                    provider_error = self._provider_error_message(response)
                    if provider_error:
                        self._emit_phase_event("error", provider_error, status="error", meta={"source": "provider"})
                        return provider_error, tool_outputs, actions
                    continue
                # Extract tool info from various possible JSON formats
                tool = None
                args = {}

                # Format 1: {"type": "tool", "name": "...", "args": {...}}
                if parsed.get("type") == "tool":
                    payload = ToolPayload(**parsed)
                    tool = payload.name
                    args = payload.args

                # Format 2: {"tool": "...", "args": {...}}
                elif "tool" in parsed:
                    tool = str(parsed.get("tool"))
                    args = parsed.get("args", {})

                # Format 3: Model uses any registered tool name as "type" value
                # e.g., {"type": "shell", "name": "shell", "args": {...}}
                #   or {"type": "read", "path": "..."}
                #   or {"type": "glob", "pattern": "*.py"}
                elif parsed.get("type"):
                    possible_tool = parsed.get("type")
                    # Check if this type matches any registered tool
                    registered_tools = [t.name for t in self.registry.list_tools()]

                    if possible_tool in registered_tools:
                        tool = possible_tool
                        # Try to extract args from various possible locations
                        args = parsed.get("args", {})
                        if not args:
                            args = parsed.get("arguments", {})
                        if not args:
                            # If no explicit args dict, use all fields except type/name as args
                            args = {k: v for k, v in parsed.items() if k not in ("type", "name", "tool", "arguments")}

                # Format 4: Direct tool call without wrapper
                # e.g., {"read": {"path": "..."}} or {"shell": "ls -la"}
                if tool is None:
                    registered_tools = [t.name for t in self.registry.list_tools()]
                    for key, value in parsed.items():
                        if key in registered_tools:
                            tool = key
                            # Value could be args dict or direct argument
                            if isinstance(value, dict):
                                args = value
                            else:
                                # Try to infer the primary argument name based on tool
                                if key in ("read", "write", "edit"):
                                    args = {"path": value}
                                elif key == "shell":
                                    args = {"command": value}
                                elif key in ("glob", "grep"):
                                    args = {"pattern": value}
                                else:
                                    args = {"value": value}
                            break

                # If we still don't have a tool, return the response as-is
                if tool is None:
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
                    response = self._chat_messages_with_phase(messages, stage="schema-repair")
                    provider_error = self._provider_error_message(response)
                    if provider_error:
                        self._emit_phase_event("error", provider_error, status="error", meta={"source": "provider"})
                        return provider_error, tool_outputs, actions
                except Exception as exc:
                    self.logger.exception("LLM chat_messages failed during repair")
                    return f"Model request failed: {exc}", [], []
                continue

            if not isinstance(args, dict):
                args = {}

            tool_sig = self._tool_sig(tool, args)
            if tool_sig in seen_tools:
                return "", tool_outputs, actions
            seen_tools.add(tool_sig)
            kind = self._tool_phase_kind(tool)
            preview = self._tool_args_preview(tool, args)
            self._emit_phase_event(f"{kind}.start", f"{tool} {preview}".strip(), meta={"tool": tool})

            self._print_tool_preview(tool, args, objective=objective, source="agent")
            self._announce_minion_activity()

            if self.config.show_actions:
                if not self._sequence_started_at:
                    self._start_action_sequence()
                self._print_action_start(tool, args)
            self._record_progress_event("tool_start", tool=tool, arguments=args, index=1, total=1)
            result, trace_event, elapsed = self._execute_traced_tool(
                tool,
                args,
                timeout=30.0,
                stream_shell=True,
            )
            tool_note = self._format_tool_output(tool, result.output)
            action = self._action_line(tool, args, tool_note, elapsed)
            action["ok"] = result.ok
            action["started"] = self.config.show_actions
            action["trace_id"] = trace_event.get("trace_id")
            action["contract_schema"] = trace_event.get("contract_schema")
            actions.append(action)
            self._print_action_line(action)
            self._streamed_actions = True
            if action.get("show_panel"):
                tool_outputs.append(tool_note)
                if self._should_render_evidence_panel():
                    self._print_tool_outputs([tool_note], [action])
            self._emit_phase_event(
                f"{kind}.done",
                f"{tool} ok={result.ok} elapsed={int(elapsed * 1000)}ms",
                status="done" if result.ok else "error",
                meta={"tool": tool, "ok": result.ok, "elapsed_ms": int(elapsed * 1000)},
            )
            self._record_progress_event(
                "tool_end",
                tool=tool,
                success=result.ok,
                execution_time_ms=int(elapsed * 1000),
                result=result.output if result.ok else "",
                error="" if result.ok else result.output,
                index=1,
                total=1,
                trace_id=str(trace_event.get("trace_id") or ""),
                contract_schema=trace_event.get("contract_schema"),
                error_payload=trace_event.get("error"),
            )
            messages.append(
                {
                    "role": "system",
                    "content": ("Tool results:\n" + tool_note + "\nRespond with final answer only. Do not call tools."),
                }
            )

            try:
                response = self._chat_messages_with_phase(messages, stage="post-tool")
                provider_error = self._provider_error_message(response)
                if provider_error:
                    self._emit_phase_event("error", provider_error, status="error", meta={"source": "provider"})
                    return provider_error, tool_outputs, actions
            except Exception as exc:
                self.logger.exception("LLM chat_messages failed after tool")
                return f"Model request failed: {exc}", tool_outputs, actions

        # If the model kept emitting tool JSON after max turns, prefer tool output only.
        return ("" if self._extract_json(response) else finalize(response)), tool_outputs, actions

    def _provider_error_message(self, response: str) -> str | None:
        text = str(response or "").strip()
        if not text:
            return None
        payload: dict[str, Any] | None = None
        try:
            parsed = json.loads(text)
            if isinstance(parsed, dict):
                payload = parsed
        except Exception:
            payload = self._extract_json(text)

        if not payload or "error" not in payload:
            return None
        err = payload.get("error")
        if isinstance(err, dict):
            message = str(err.get("message") or err.get("raw") or "").strip()
            code = str(err.get("code") or "").strip()
        else:
            message = str(err).strip()
            code = ""
        lowered = message.lower()
        if "spend limit" in lowered or "billing" in lowered or code == "402":
            return (
                "Provider spend limit reached for this key. Update billing/limit, "
                "or switch model/provider with `/model` or `/provider`."
            )
        if "unavailable" in lowered or "not available" in lowered:
            return "Selected model/provider is unavailable for this request. Switch via `/model` or `/provider`."
        if not message:
            return "Provider returned an error. Try another model/provider or retry."
        return f"Provider error: {message}"

    def _extract_json(self, text: str) -> dict[str, Any] | None:
        import json

        candidate = str(text or "").strip()
        if not candidate:
            return None
        if candidate.startswith("{") and candidate.endswith("}"):
            try:
                parsed = json.loads(candidate)
                if isinstance(parsed, dict):
                    return parsed
            except Exception:
                pass

        if "```" in candidate:
            for fence in ("```json", "```"):
                if fence in candidate:
                    chunk = candidate.split(fence, 1)[1]
                    chunk = chunk.split("```", 1)[0]
                    chunk = chunk.strip()
                    if chunk.startswith("{") and chunk.endswith("}"):
                        try:
                            parsed = json.loads(chunk)
                            if isinstance(parsed, dict):
                                return parsed
                        except Exception:
                            pass

        decoder = json.JSONDecoder()
        first_generic: dict[str, Any] | None = None
        for idx, ch in enumerate(candidate):
            if ch != "{":
                continue
            try:
                parsed, _end = decoder.raw_decode(candidate[idx:])
            except Exception:
                continue
            if isinstance(parsed, dict):
                if any(key in parsed for key in ("type", "tool", "tools", "tool_calls", "name")):
                    return parsed
                if first_generic is None:
                    first_generic = parsed
        return first_generic

    def _select_model(self, refresh: bool = False, query: str = "", page_cmd: str | None = None) -> None:
        if self.config.provider.type != "openrouter":
            self.console.print("[warning]Model listing is only implemented for OpenRouter.[/warning]")
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
            models = [m for m in models if q in str(m.get("id") or m.get("name") or m.get("model") or "").lower()]
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
                self.console.print(f"[dim]Page {page}/{pages}. Commands: n/p, page <n>, q[/dim]")

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
                selected = (
                    self._models_cache[i].get("id")
                    or self._models_cache[i].get("name")
                    or self._models_cache[i].get("model")
                )
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
            self.console.print("[warning]Provider routing is only implemented for OpenRouter.[/warning]")
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
            providers = [p for p in providers if q in str(p.get("id") or p.get("slug") or p.get("name") or "").lower()]
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
                self.console.print(f"[dim]Page {page}/{pages}. Commands: n/p, page <n>, q[/dim]")

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
        names = [str(p.get("id") or p.get("slug") or p.get("name") or "") for p in providers]
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
            case "write":
                if len(parts) < 3 or ":" not in parts[2]:
                    self.console.print("[warning]Usage: /run write <path>:<content>[/warning]")
                    return
                path, content = parts[2].split(":", 1)
                args = {"path": path, "content": content}
            case "shell":
                if len(parts) < 3:
                    self.console.print("[warning]Usage: /run shell <command>[/warning]")
                    return
                args = {"command": parts[2]}
            case "fetch":
                if len(parts) < 3:
                    self.console.print("[warning]Usage: /run fetch <url>[/warning]")
                    return
                args = {"url": parts[2]}
            case _:
                # External tools or generic invocation with JSON args.
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

        result, action = self._execute_runtime_tool_with_feedback(
            tool,
            args,
            objective="manual /run request",
            source="user",
            record_progress=False,
        )

        if result.ok:
            output = self._format_tool_output(tool, result.output)
            self._streamed_actions = True
            if action.get("show_panel") and self._should_render_evidence_panel():
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

    def _show_metrics(self) -> None:
        exec_metrics = self.execution_manager.get_metrics()

        # Get token usage
        token_usage = self.llm.token_usage
        cost_info = f"${token_usage.estimated_cost:.4f}" if token_usage.estimated_cost > 0 else "N/A"

        table = Table(title="Execution Metrics", border_style="gold")
        table.add_column("Metric", style="gold")
        table.add_column("Value", style="sand")
        table.add_row("Total Executions", str(exec_metrics["total_executions"]))
        table.add_row("Successful", str(exec_metrics["successful"]))
        table.add_row("Failed", str(exec_metrics["failed"]))
        table.add_row("Success Rate", exec_metrics["success_rate"])
        table.add_row("Avg Duration", f"{exec_metrics['average_duration_ms']}ms")
        table.add_row("Total Retries", str(exec_metrics["retries"]))
        self.console.print(table)

        # Token usage table
        token_table = Table(title="LLM Token Usage", border_style="gold")
        token_table.add_column("Metric", style="gold")
        token_table.add_column("Value", style="sand")
        token_table.add_row("Prompt Tokens", str(token_usage.prompt_tokens))
        token_table.add_row("Completion Tokens", str(token_usage.completion_tokens))
        token_table.add_row("Total Tokens", str(token_usage.total_tokens))
        token_table.add_row("Estimated Cost", cost_info)
        token_table.add_row("API Requests", str(token_usage.requests))
        token_table.add_row("Actual Prompt Tokens", str(token_usage.actual_prompt_tokens))
        token_table.add_row("Actual Completion Tokens", str(token_usage.actual_completion_tokens))
        token_table.add_row("Actual Total Tokens", str(token_usage.actual_total_tokens))
        token_table.add_row("Actual Cost", f"${token_usage.actual_cost:.4f}" if token_usage.actual_cost > 0 else "N/A")
        token_table.add_row("Usage Reports", str(token_usage.actual_usage_reports))
        self.console.print(token_table)

        if exec_metrics["total_executions"] > 0 and self.execution_manager.execution_history:
            history_table = Table(title="Recent Executions", border_style="gold")
            history_table.add_column("Tool", style="gold")
            history_table.add_column("Status", style="sand")
            history_table.add_column("Duration", style="sand")
            for exec in self.execution_manager.execution_history[-10:]:
                status_symbol = {
                    ToolStatus.SUCCESS: "✅",
                    ToolStatus.FAILED: "❌",
                    ToolStatus.TIMEOUT: "⏱️",
                    ToolStatus.DENIED: "🚫",
                    ToolStatus.RETRYING: "🔄",
                    ToolStatus.RUNNING: "▶️",
                    ToolStatus.PENDING: "⏳",
                    ToolStatus.CANCELLED: "🛑",
                }.get(exec.status, "❓")
                duration = f"{exec.duration_ms}ms" if exec.duration_ms > 0 else "-"
                history_table.add_row(exec.tool, f"{status_symbol} {exec.status.name}", duration)
            self.console.print(history_table)

    def _remember(self, command: str) -> None:
        """Store information in memory."""
        parts = command.split(maxsplit=2)
        if len(parts) < 2:
            self.console.print("[warning]Usage: /remember <content>[/warning]")
            return

        content = parts[1]
        category = "general"
        importance = 1.0

        if " " in content:
            # Check for category flag
            if content.startswith("--category="):
                cat_part = content.split("--category=")[1]
                if " " in cat_part:
                    content, category = cat_part.split(" ", 1)
                else:
                    content = ""
                    category = cat_part
            elif content.startswith("--importance="):
                imp_part = content.split("--importance=")[1]
                if " " in imp_part:
                    content, rest = imp_part.split(" ", 1)
                    try:
                        importance = float(rest.split(" ")[0])
                    except ValueError:
                        pass
                else:
                    content = ""

        if not content.strip():
            self.console.print("[warning]Usage: /remember <content>[/warning]")
            return

        entry = self.memory.add(content, category=category, importance=importance)
        self.console.print(f"[gold]✓ Stored in memory[/gold] (category: {category}, importance: {importance})")

    def _recall(self, command: str) -> None:
        """Search memory for information."""
        parts = command.split(maxsplit=1)
        if len(parts) < 2:
            self.console.print("[warning]Usage: /recall <query>[/warning]")
            return

        query = parts[1]
        results = self.memory.search(query, top_k=5)

        if not results:
            self.console.print("[dim]No matching memories found.[/dim]")
            return

        table = Table(title=f'Memory Search: "{query}"', border_style="gold")
        table.add_column("Content", style="sand")
        table.add_column("Category", style="gold")
        table.add_column("Score", style="gold")

        for entry, score in results:
            truncated = entry.content[:100] + "..." if len(entry.content) > 100 else entry.content
            table.add_row(truncated, entry.category, f"{score:.2f}")

        self.console.print(table)

    def _run_agent(self, command: str) -> None:
        """Run autonomous agent task using TehutiAgent."""
        from tehuti_cli.agentic import TehutiAgent

        parts = command.split(maxsplit=1)
        if len(parts) < 2:
            self.console.print("[warning]Usage: /agent <task description>[/warning]")
            return

        task = parts[1]
        self.console.print(f"[gold]𓅞 Running autonomous agent for: {task}[/gold]")
        objective = self._summarize_objective(task)
        self._current_objective = objective

        def on_agent_progress(event: str, data: dict[str, Any]) -> None:
            verbosity = self._progress_verbosity()
            try:
                if event == "iteration_start":
                    if verbosity == "minimal":
                        return
                    idx = int(data.get("iteration", 0) or 0)
                    total = int(data.get("max_iterations", 0) or 0)
                    if idx > 0 and total > 0:
                        self.console.print(Text(f"◉ iteration {idx}/{total}", style="sand"))
                    return
                if event == "thought":
                    if verbosity != "verbose":
                        return
                    thought = str(data.get("thought", "")).strip()
                    if thought:
                        self.console.print(Text(f"◈ thought: {thought}", style="sand"))
                    return
                if event == "tool_start":
                    if verbosity == "minimal":
                        return
                    tool = str(data.get("tool", "")).strip()
                    args = data.get("arguments", {}) or {}
                    step = int(data.get("index", 0) or 0) or None
                    total = int(data.get("total", 0) or 0) or None
                    self._print_tool_preview(
                        tool,
                        args,
                        objective=objective or "autonomous task execution",
                        step=step,
                        total=total,
                        source="agent-loop",
                    )
                    if self.config.show_actions:
                        self._print_action_start(tool, args)
                    return
                if event == "tool_end":
                    tool = str(data.get("tool", "")).strip()
                    args = data.get("arguments", {}) or {}
                    output_text = str(data.get("result") or data.get("error") or "")
                    elapsed = float(data.get("execution_time_ms", 0) or 0) / 1000.0
                    action = self._action_line(tool, args, self._format_tool_output(tool, output_text), elapsed)
                    action["ok"] = bool(data.get("success"))
                    action["started"] = True
                    self._print_action_line(action)
                    if action.get("show_panel") and self._should_render_evidence_panel():
                        self._print_tool_outputs([str(action.get("output", ""))], [action])
                    return
            except Exception:
                return

        agent = TehutiAgent(
            config=self.config,
            work_dir=self.work_dir,
            enable_memory=True,
            enable_tracing=True,
            session_id=self.session.id,
            progress_callback=on_agent_progress,
        )

        try:
            result = agent.execute_task(
                task_description=task,
                max_iterations=10,
            )

            table = Table(title="Agent Result", border_style="gold")
            table.add_column("Field", style="gold")
            table.add_column("Value", style="sand")

            if result.get("success"):
                table.add_row("Status", "✅ Completed")
            else:
                table.add_row("Status", "❌ Failed")

            table.add_row("Iterations", str(result.get("iterations", 0)))
            latency_ms = int(result.get("latency_ms", 0) or 0)
            table.add_row("Duration", f"{latency_ms}ms")

            if result.get("response"):
                response_value = str(result.get("response", ""))
                response = response_value[:200] + "..." if len(response_value) > 200 else response_value
                table.add_row("Response", response)

            if result.get("error"):
                table.add_row("Error", str(result.get("error")))

            self.console.print(table)

        except Exception as e:
            self.console.print(f"[error]Agent error: {e}[/error]")
        finally:
            self._current_objective = ""

    def _delegate_task(self, command: str) -> None:
        """Manage sub-agent/minion tasks."""
        from tehuti_cli.core.delegates import DelegateState

        parts = command.strip().split(maxsplit=2)
        if len(parts) == 1:
            self.console.print("[warning]Usage: /delegate <start|list|status|logs|follow|stop> ...[/warning]")
            return

        sub = parts[1].lower()
        self._refresh_minions()

        if sub in {"list", "ls"}:
            if not self._minions:
                self.console.print("[dim]No minions registered.[/dim]")
                return
            table = Table(title="Minions", border_style="gold")
            table.add_column("ID", style="gold")
            table.add_column("State", style="sand")
            table.add_column("PID", style="sand")
            table.add_column("Age", style="sand")
            table.add_column("Task", style="sand")
            table.add_column("Working On", style="sand")
            for minion_id, item in sorted(
                self._minions.items(), key=lambda kv: kv[1].get("created_at", 0), reverse=True
            ):
                task = str(item.get("task", ""))
                if len(task) > 60:
                    task = task[:57] + "..."
                working_on = str(item.get("working_on", "")).strip()
                if len(working_on) > 54:
                    working_on = working_on[:51] + "..."
                created = float(item.get("created_at", 0) or 0)
                age = f"{max(0, int(time.time() - created))}s" if created > 0 else "-"
                table.add_row(
                    minion_id,
                    str(item.get("state", "unknown")),
                    str(item.get("pid", "")),
                    age,
                    task,
                    working_on or "-",
                )
            self.console.print(table)
            return

        if sub == "status":
            if len(parts) < 3:
                self.console.print("[warning]Usage: /delegate status <minion-id>[/warning]")
                return
            minion_id = parts[2].strip()
            item = self._minions.get(minion_id)
            if not item:
                self.console.print("[warning]Minion not found.[/warning]")
                return
            table = Table(title=f"Minion {minion_id}", border_style="gold")
            table.add_column("Field", style="gold")
            table.add_column("Value", style="sand")
            table.add_row("State", str(item.get("state", "unknown")))
            table.add_row("PID", str(item.get("pid", "")))
            table.add_row("Task", str(item.get("task", "")))
            table.add_row("Log", str(item.get("log_file", "")))
            command_text = str(item.get("command", "")).strip()
            if command_text:
                if len(command_text) > 120:
                    command_text = command_text[:117] + "..."
                table.add_row("Command", command_text)
            last_line = str(item.get("last_line", "")).strip()
            if last_line:
                if len(last_line) > 120:
                    last_line = last_line[:117] + "..."
                table.add_row("Latest", last_line)
            working_on = str(item.get("working_on", "")).strip()
            if working_on:
                if len(working_on) > 120:
                    working_on = working_on[:117] + "..."
                table.add_row("Working On", working_on)
            created = float(item.get("created_at", 0) or 0)
            if created > 0:
                age = max(0, int(time.time() - created))
                table.add_row("Age", f"{age}s")
            self.console.print(table)
            return

        if sub == "logs":
            if len(parts) < 3:
                self.console.print("[warning]Usage: /delegate logs <minion-id>[/warning]")
                return
            self._refresh_minions()
            minion_id = parts[2].strip()
            item = self._minions.get(minion_id)
            if not item:
                self.console.print("[warning]Minion not found.[/warning]")
                return
            log_file = Path(str(item.get("log_file", "")))
            if not log_file.exists():
                self.console.print("[dim]No logs yet.[/dim]")
                return
            output = log_file.read_text(encoding="utf-8", errors="replace")
            output = self._truncate_output_lines(output, max_lines=120, head=80, tail=30)
            self.console.print(
                Panel(Text(output or "(empty)", style="sand"), title=f"Minion Logs: {minion_id}", border_style="gold")
            )
            return

        if sub == "follow":
            if len(parts) < 3:
                self.console.print("[warning]Usage: /delegate follow <minion-id>[/warning]")
                return
            minion_id = parts[2].strip()
            item = self._minions.get(minion_id)
            if not item:
                self.console.print("[warning]Minion not found.[/warning]")
                return
            log_file = Path(str(item.get("log_file", "")))
            if not log_file.exists():
                self.console.print("[dim]No logs yet.[/dim]")
                return
            self.console.print(f"[gold]Following minion logs:[/gold] {minion_id} [dim](Ctrl+C to stop)[/dim]")
            pos = 0
            started = time.time()
            try:
                while True:
                    self._refresh_minions()
                    if log_file.exists():
                        size = log_file.stat().st_size
                        if size < pos:
                            pos = 0
                        if size > pos:
                            with log_file.open("r", encoding="utf-8", errors="replace") as fh:
                                fh.seek(pos)
                                chunk = fh.read()
                                pos = fh.tell()
                            if chunk:
                                self.console.print(Text(chunk.rstrip("\n"), style="sand"))
                    state = str(self._minions.get(minion_id, {}).get("state", "unknown"))
                    if state != "running":
                        self.console.print(f"[gold]Minion state:[/gold] {state}")
                        break
                    if (time.time() - started) > 120:
                        self.console.print("[dim]Follow timeout reached (120s). Use /delegate logs for snapshot.[/dim]")
                        break
                    time.sleep(0.8)
            except KeyboardInterrupt:
                self.console.print("[dim]Stopped following logs.[/dim]")
            return

        if sub == "stop":
            if len(parts) < 3:
                self.console.print("[warning]Usage: /delegate stop <minion-id>[/warning]")
                return
            minion_id = parts[2].strip()
            item = self._minions.get(minion_id)
            if not item:
                self.console.print("[warning]Minion not found.[/warning]")
                return
            pid = int(item.get("pid", 0) or 0)
            if pid > 0 and self._is_pid_alive(pid):
                try:
                    os.killpg(pid, signal.SIGTERM)
                except Exception:
                    try:
                        os.kill(pid, signal.SIGTERM)
                    except Exception:
                        pass
                deadline = time.time() + 1.5
                while time.time() < deadline and self._is_pid_alive(pid):
                    time.sleep(0.1)
                if self._is_pid_alive(pid):
                    try:
                        os.killpg(pid, signal.SIGKILL)
                    except Exception:
                        try:
                            os.kill(pid, signal.SIGKILL)
                        except Exception:
                            pass
            item["state"] = "stopped"
            item["ended_at"] = time.time()
            delegate_id = str(item.get("delegate_id", ""))
            if delegate_id:
                self.runtime.delegates.update_delegate(delegate_id, state=DelegateState.CANCELLED)
            self._save_minions()
            self.console.print(f"[gold]Stopped minion:[/gold] {minion_id}")
            return

        if sub == "start":
            if len(parts) < 3:
                self.console.print("[warning]Usage: /delegate start <task description>[/warning]")
                return
            task = parts[2].strip()
        else:
            # Backward-compatible: /delegate <task description>
            task = command.split(maxsplit=1)[1].strip()

        if not task:
            self.console.print("[warning]Task cannot be empty.[/warning]")
            return

        delegate_id = self.runtime.delegates.create_delegate(
            name="minion",
            prompt=task,
            metadata={"session_id": self.session.id, "origin": "shell"},
        )
        self.runtime.delegates.update_delegate(delegate_id, state=DelegateState.RUNNING)

        minion_id = str(uuid.uuid4())[:8]
        log_dir = self.session.dir / "minions"
        log_dir.mkdir(parents=True, exist_ok=True)
        log_file = log_dir / f"{minion_id}.log"
        tehuti_bin = shutil.which("tehuti")
        if tehuti_bin:
            cmd_argv = [tehuti_bin, "--print", "--prompt", task]
            display_cmd = " ".join(shlex.quote(part) for part in cmd_argv)
        else:
            cmd_argv = [sys.executable, "-m", "tehuti_cli.cli", "--print", "--prompt", task]
            display_cmd = " ".join(shlex.quote(part) for part in cmd_argv)
        env = os.environ.copy()
        env["TEHUTI_ASCII"] = "1"
        env["PYTHONUNBUFFERED"] = "1"
        with log_file.open("w", encoding="utf-8") as fh:
            proc = subprocess.Popen(
                cmd_argv,
                stdout=fh,
                stderr=subprocess.STDOUT,
                preexec_fn=os.setsid,
                cwd=str(self.work_dir),
                env=env,
            )

        self._minions[minion_id] = {
            "delegate_id": delegate_id,
            "task": task,
            "pid": proc.pid,
            "state": "running",
            "created_at": time.time(),
            "last_activity_at": time.time(),
            "log_file": str(log_file),
            "command": display_cmd,
        }
        self._save_minions()
        self._minion_announced_state[minion_id] = "starting"
        self.console.print(f"[gold]𓃾 Minion started:[/gold] {minion_id} (pid {proc.pid})")
        self.console.print(f"[dim]Watch progress: /delegate logs {minion_id}[/dim]")

    async def _connect_a2a(self, command: str) -> None:
        """Connect to an A2A agent."""
        parts = command.split(maxsplit=1)
        if len(parts) < 2:
            self.console.print("[warning]Usage: /a2a <agent-url>[/warning]")
            return

        url = parts[1]
        self.console.print(f"[gold]𓈗 Connecting to A2A agent: {url}[/gold]")

        try:
            from tehuti_cli.core.a2a_client import A2AClient

            client = A2AClient(endpoint=url)
            agent_card = await client.get_agent_card()

            table = Table(title=f"Connected to: {agent_card.name}", border_style="gold")
            table.add_column("Field", style="gold")
            table.add_column("Value", style="sand")
            table.add_row("Version", agent_card.version)
            table.add_row(
                "Description",
                agent_card.description[:60] + "..." if len(agent_card.description) > 60 else agent_card.description,
            )
            table.add_row("Provider", agent_card.provider or "N/A")
            table.add_row("Model", agent_card.model or "N/A")
            table.add_row("Memory", "✓" if agent_card.memory_support else "✗")
            table.add_row("Context Window", str(agent_card.context_window))
            self.console.print(table)

            skills_table = Table(title="Agent Skills", border_style="gold")
            skills_table.add_column("Skill", style="gold")
            skills_table.add_column("Description", style="sand")
            for skill in agent_card.skills[:10]:
                skills_table.add_row(skill.name, skill.description[:50])
            self.console.print(skills_table)

            await client.close()
            self.console.print(f"[gold]✓ Connected to A2A agent[/gold]")

        except ImportError as e:
            self.console.print(f"[error]A2A client not available: {e}[/error]")
        except Exception as e:
            self.console.print(f"[error]Failed to connect: {e}[/error]")

    def _enable_full_mode(self) -> None:
        """Enable maximum capabilities (YOLO mode)."""
        self.config.default_yolo = True
        self.config.allow_shell = True
        self.config.allow_write = True
        self.config.allow_external = True
        self.config.execution_mode = "dominant"
        self.config.approval_mode = "auto"
        self.config.web_allow_domains = []
        self.config.web_deny_domains = []
        self.config.allowed_paths = []
        self.config.deny_tools = []
        self.config.allow_tools = []
        save_config(self.config)

        table = Table(title="MAXIMUM CAPABILITIES ENABLED", border_style="gold")
        table.add_column("Setting", style="gold")
        table.add_column("Value", style="sand")
        table.add_row("YOLO Mode", "✅ ENABLED")
        table.add_row("Shell Access", "✅ ENABLED")
        table.add_row("Write Access", "✅ ENABLED")
        table.add_row("External Tools", "✅ ENABLED")
        table.add_row("Approval Mode", "auto")
        table.add_row("Path Restrictions", "NONE (all paths allowed)")
        table.add_row("Web Restrictions", "NONE (all domains allowed)")
        table.add_row("Tool Restrictions", "NONE (all tools allowed)")
        self.console.print(table)
        self.console.print("[gold]𓅞 Tehuti now has MAXIMUM capabilities![/gold]")

    def _show_full_status(self) -> None:
        """Show complete system status including capabilities."""
        from tehuti_cli.core.tools import ToolRegistry

        registry = ToolRegistry(self.config)

        table = Table(title="FULL SYSTEM STATUS", border_style="gold")
        table.add_column("Component", style="gold")
        table.add_column("Status", style="sand")

        table.add_row("Mode", "YOLO (Maximum)" if self.config.default_yolo else "Restricted")
        table.add_row("Provider", self.config.provider.type)
        table.add_row("Model", self.config.provider.model or "not set")
        table.add_row("Session", self.session.id[:8] + "...")
        table.add_row("Work Dir", str(self.work_dir))
        table.add_row("Shell", "✅" if self.config.allow_shell else "❌")
        table.add_row("Write", "✅" if self.config.allow_write else "❌")
        table.add_row("External", "✅" if self.config.allow_external else "❌")
        table.add_row("Approval", self.config.approval_mode)
        table.add_row("Allowed Paths", str(len(self.config.allowed_paths)) if self.config.allowed_paths else "ALL")
        table.add_row(
            "Allowed Domains", str(len(self.config.web_allow_domains)) if self.config.web_allow_domains else "ALL"
        )
        table.add_row("Denied Tools", str(len(self.config.deny_tools)) if self.config.deny_tools else "NONE")
        table.add_row("Registered Tools", str(len(registry._tools)))
        table.add_row("Memory Entries", str(len(self.memory.entries)) if hasattr(self.memory, "entries") else "N/A")
        running, total = self._minion_counts()
        table.add_row("Minions", f"{running} running / {total} total")
        self.console.print(table)

        if self.execution_manager.execution_history:
            metrics = self.execution_manager.get_metrics()
            exec_table = Table(title="Execution Stats", border_style="gold")
            exec_table.add_row("Total Executions", str(metrics["total_executions"]))
            exec_table.add_row("Success Rate", metrics["success_rate"])
            exec_table.add_row("Avg Duration", f"{metrics['average_duration_ms']}ms")
            self.console.print(exec_table)

    def _show_trace(self) -> None:
        """Show execution trace summary."""
        if not self.tracer:
            self.console.print("[dim]No trace data available. Starting trace collection...[/dim]")
            self.tracer = AgentTracer(self.session.id)
            self.console.print("[gold]✓ Trace collection started[/gold]")
            return

        summary = self.tracer.get_summary()
        table = Table(title="Execution Trace", border_style="gold")
        table.add_column("Metric", style="gold")
        table.add_column("Value", style="sand")
        table.add_row("Session ID", summary.get("session_id", "N/A"))
        table.add_row("Total Turns", str(summary.get("total_turns", 0)))
        table.add_row("Total Tool Calls", str(summary.get("total_tool_calls", 0)))
        table.add_row("Total Errors", str(summary.get("total_errors", 0)))
        table.add_row("Duration", f"{summary.get('duration_seconds', 0):.2f}s")
        table.add_row("Events Logged", str(len(self.tracer.events)))
        self.console.print(table)

        if self.tracer.events:
            recent_table = Table(title="Recent Events", border_style="gold")
            recent_table.add_column("Type", style="gold")
            recent_table.add_column("Details", style="sand")
            for event in self.tracer.events[-10:]:
                details = str(event.get("data", {}))[:80]
                recent_table.add_row(event.get("event_type", "unknown"), details)
            self.console.print(recent_table)

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
        running, total = self._minion_counts()
        table.add_row("Minions", f"{running} running / {total} total")
        self.console.print(table)

    def _show_focus(self) -> None:
        table = Table(title="Task Focus", border_style="gold")
        table.add_column("Field", style="gold")
        table.add_column("Value", style="sand")
        objective = str(getattr(self, "_current_objective", "") or "").strip()
        phase = str(getattr(self, "_current_phase", "idle") or "idle")
        mode = "tool-backed" if bool(getattr(self, "_last_require_tools", False)) else "direct-chat"
        prompt = str(getattr(self, "_last_prompt", "") or "").strip()
        if len(prompt) > 120:
            prompt = prompt[:117] + "..."
        plan = list(getattr(self, "_last_turn_plan", []) or [])
        running, total = self._minion_counts()

        table.add_row("Objective", objective or "(idle)")
        table.add_row("Phase", phase)
        table.add_row("Mode", mode)
        table.add_row("Prompt", prompt or "(none)")
        table.add_row("Minions", f"{running} running / {total} total")
        table.add_row("Actions in last turn", str(len(getattr(self, "_last_actions", []) or [])))
        if plan:
            table.add_row("Plan", " -> ".join(plan[:4]))
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
            self._print_tool_preview("shell", {"command": cmd}, objective="smoke validation", source="smoke")
            self._print_action_start("shell", {"command": cmd})
            result, trace_event, elapsed = self._execute_traced_tool(
                "shell",
                {"command": cmd},
                timeout=30.0,
                stream_shell=True,
            )
            tool_note = self._format_tool_output("shell", result.output)
            action = self._action_line("shell", {"command": cmd}, tool_note, elapsed)
            action["ok"] = result.ok
            action["started"] = True
            actions.append(action)
            if self.config.show_actions:
                self._print_action_line(action)
                self._streamed_actions = True
                if action.get("show_panel") and self._should_render_evidence_panel():
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
        status, _ = self._execute_runtime_tool_with_feedback(
            "shell",
            {"command": "git status --short"},
            objective="inspect repository status",
            source="diff",
        )
        diffstat, _ = self._execute_runtime_tool_with_feedback(
            "shell",
            {"command": "git diff --stat"},
            objective="summarize changed files",
            source="diff",
        )
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
            result, _ = self._execute_runtime_tool_with_feedback(
                "pty.close",
                {"session_id": session_id},
                objective="close PTY session",
                source="tasks",
            )
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
        self.config.execution_mode = "dominant"
        self.config.approval_mode = "auto"
        self.config.allowed_paths = []
        self.config.web_allow_domains = []
        self.config.web_deny_domains = []
        self.config.allow_tools = []
        self.config.deny_tools = []
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
                self.console.print(
                    Panel.fit(
                        Text(plan_file.read_text(encoding="utf-8"), style="sand"), border_style="gold", title="Plan"
                    )
                )
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
            if self.prompt_session is None:
                self.console.print("[warning]Usage: /mention <path>[/warning]")
                return
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
        result, _ = self._execute_runtime_tool_with_feedback(
            "shell",
            {"command": "git status --short"},
            objective="inspect working tree changes",
            source="review",
        )
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
            result, _ = self._execute_runtime_tool_with_feedback(
                "shell",
                {"command": cmd},
                objective="collect host grounding evidence",
                source="grounding",
            )
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

    def _print_thoth_response(self, response: str, prompt: str = "") -> None:
        checkpoint = self._format_checkpoint(response)
        if checkpoint:
            self._checkpoint_counter += 1
            title = f"Checkpoint {self._checkpoint_counter}"
            panel = Panel(Text(checkpoint, style="sand"), border_style="gold", title=title)
            self.console.print(panel)
            return

        # Format the response based on content type
        formatted = format_response(response, query=prompt)

        # Determine content type for specialized rendering
        scanner = ContentScanner()
        content_type = scanner.scan(formatted)

        # For longer responses with code, use enhanced formatting with streaming
        if len(formatted) > 100 and "```" in formatted:
            # Use streaming for long code responses
            streamer = StreamingResponse(
                self.console,
                StreamConfig(
                    char_delay=0.01,  # Faster for code
                    min_length_to_stream=200,
                ),
            )
            streamer.stream(formatted, title="𓅞 Thoth", border_style="gold", subtitle="𓋹 Ma'at 𓋹")
        elif content_type.value == "analysis":
            # Analysis gets special panel with structured formatting
            self._print_analysis_response(formatted)
        elif content_type.value == "steps":
            # Step-by-step gets numbered formatting
            self._print_steps_response(formatted)
        elif "```" in formatted:
            # Code blocks get syntax highlighting
            self.console.rule("𓅞 Thoth speaks", style="gold")
            self._print_formatted_with_code(formatted)
            self.console.print()
        else:
            # Standard response with markdown rendering
            self.console.print()
            panel = Panel(
                Markdown(formatted),
                title="[gold]𓅞 Thoth[/gold]",
                border_style="gold",
                subtitle="𓋹 Ma'at 𓋹",
                padding=(1, 2),
            )
            self.console.print(panel)
        self.console.print()

    def _print_analysis_response(self, text: str) -> None:
        """Print analysis-type responses with enhanced structure."""
        # Add analysis header if not present
        if not text.strip().startswith("#") and "**Analysis" not in text[:50]:
            text = "**Analysis**\n\n" + text

        panel = Panel(
            Markdown(text),
            title="[gold]𓅞 Thoth - Analysis[/gold]",
            border_style="blue",
            subtitle="𓋹 Ma'at 𓋹",
            padding=(1, 2),
        )
        self.console.print(panel)

    def _print_steps_response(self, text: str) -> None:
        """Print step-by-step instructions with visual enhancement."""
        # Ensure steps are clearly formatted
        lines = text.split("\n")
        formatted_lines = []

        for line in lines:
            stripped = line.strip()
            # Enhance step lines
            if stripped and stripped[0].isdigit() and "." in stripped[:3]:
                # It's a step - ensure it's bold
                if not stripped.startswith("**"):
                    parts = stripped.split(".", 1)
                    if len(parts) == 2:
                        line = f"**{parts[0]}.**{parts[1]}"
            formatted_lines.append(line)

        formatted_text = "\n".join(formatted_lines)

        panel = Panel(
            Markdown(formatted_text),
            title="[gold]𓅞 Thoth - Steps[/gold]",
            border_style="green",
            subtitle="𓋹 Ma'at 𓋹",
            padding=(1, 2),
        )
        self.console.print(panel)

    def _print_formatted_with_code(self, text: str) -> None:
        """Print text with proper code block formatting."""
        import re

        parts = []
        current_pos = 0

        # Find all code blocks
        for match in re.finditer(r"```(\w+)?\n(.*?)```", text, re.DOTALL):
            # Add text before code block
            if match.start() > current_pos:
                before = text[current_pos : match.start()].strip()
                if before:
                    self.console.print(Text(before, style="sand"))

            # Print code block with syntax highlighting
            lang = match.group(1) or "text"
            code = match.group(2).strip()

            from rich.syntax import Syntax

            try:
                syntax = Syntax(code, lang, theme="monokai", line_numbers=False)
                self.console.print(syntax)
            except Exception:
                # Fallback if language not recognized
                self.console.print(Panel(code, border_style="dim"))

            current_pos = match.end()

        # Print remaining text
        if current_pos < len(text):
            remaining = text[current_pos:].strip()
            if remaining:
                self.console.print(Text(remaining, style="sand"))

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
        if self._busy and self._current_objective:
            status = f"working: {self._current_objective[:28]}"
        minion_running, minion_total = self._minion_counts()
        minion_hint = f"minions {minion_running}/{minion_total}"
        verbosity = self._progress_verbosity()
        return (
            f"{self.config.provider.type} {model} · "
            f"{self.session.id[:8]} · {perms_str} · {status} · {context_hint} · {minion_hint} · {verbosity}    ? shortcuts"
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

    def _should_render_evidence_panel(self) -> bool:
        # Default UX remains stream-first and concise. Full panels are opt-in via
        # verbose mode for deep inspection.
        return self._progress_verbosity() == "verbose"

    def _sanitize_response(self, response: str) -> str:
        import re

        text = response.strip()
        if not text:
            return text
        # Strip raw tool JSON echoes.
        if '"type":"tool"' in text or '"type":"tools"' in text:
            cleaned = []
            for line in text.splitlines():
                if '"type":"tool"' in line or '"type":"tools"' in line:
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

    def _dynamic_response_from_actions(self, actions: list[dict[str, Any]], tool_outputs: list[str]) -> str:
        """Build a fallback reply directly from real tool output/evidence."""
        for output in tool_outputs:
            text = self._sanitize_response(str(output or "").strip())
            if text:
                return text
        for action in actions:
            output = self._sanitize_response(str(action.get("output", "")).strip())
            if output:
                return output
            inline = action.get("inline", []) or []
            if inline:
                joined = self._sanitize_response("\n".join(str(line) for line in inline if str(line).strip()))
                if joined:
                    return joined
            evidence = self._sanitize_response(str(action.get("evidence", "")).strip())
            if evidence:
                return evidence
        return ""

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
            evidence = f"{len(lines)} lines, {size} bytes"
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
        if tool == "edit":
            path = str(args.get("path", ""))
            old_string = str(args.get("old_string", ""))
            new_string = str(args.get("new_string", ""))
            removed = len(old_string.splitlines()) if old_string else 0
            added = len(new_string.splitlines()) if new_string else 0
            delta_label = f"(+{added} -{removed} lines)" if (added or removed) else ""
            return {
                "tool": tool,
                "title": f"edit: {path}".strip(),
                "detail": delta_label,
                "path": path,
                "added_lines": added,
                "removed_lines": removed,
                "evidence": self._evidence_for_tool(tool, args, output),
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

    def _summarize_objective(self, prompt: str) -> str:
        text = " ".join((prompt or "").strip().split())
        if not text:
            return ""
        if len(text) <= 70:
            return text
        return text[:67] + "..."

    def _tool_args_preview(self, tool: str, args: dict[str, Any]) -> str:
        if tool == "shell":
            return str(args.get("command", "")).strip()
        if tool == "read":
            return str(args.get("path", "")).strip()
        if tool == "write":
            path = str(args.get("path", "")).strip()
            content = str(args.get("content", ""))
            return f"{path} ({len(content)} chars)"
        if tool == "fetch":
            return str(args.get("url", "")).strip()
        if tool.startswith("pty."):
            return str(args.get("session_id", args.get("command", ""))).strip()
        keys = sorted(str(k) for k in (args or {}).keys())
        return ", ".join(keys[:5])

    def _tool_relevance(self, tool: str, objective: str, args: dict[str, Any] | None = None) -> str:
        if tool == "read":
            return "inspect source context"
        if tool == "write":
            return "apply the requested change"
        if tool == "edit":
            return "patch targeted code"
        if tool in {"grep", "glob", "find", "web_search"}:
            return "locate relevant evidence"
        if tool == "shell":
            command = ""
            if isinstance(args, dict):
                command = str(args.get("command", "")).strip()
            return self._shell_command_purpose(objective, command)
        if tool == "fetch":
            return "retrieve external data"
        if tool.startswith("pty."):
            return "manage long-running task"
        registry = getattr(self, "registry", None)
        spec = registry.get(tool) if registry else None
        if spec and str(spec.description or "").strip():
            return str(spec.description).strip()[:120]
        if objective:
            return f"advance objective: {objective}"
        return "advance the current task"

    def _shell_command_purpose(self, objective: str, command: str = "") -> str:
        cmd = str(command or "").strip().lower()
        if cmd:
            if cmd.startswith("pwd"):
                return "confirm current working directory"
            if cmd.startswith("ls") or " find " in f" {cmd} " or " tree " in f" {cmd} ":
                return "inspect filesystem state"
            if cmd.startswith("git status") or cmd.startswith("git diff") or cmd.startswith("git log"):
                return "inspect repository state"
            if cmd.startswith("pytest") or " test" in cmd:
                return "run verification command"
            if cmd.startswith("test -w") or " workspace_writable" in cmd or " workspace_readonly" in cmd:
                return "verify workspace write access"
            if cmd.startswith("python") and "--version" in cmd:
                return "verify runtime availability"
            if cmd.startswith("node") and "--version" in cmd:
                return "verify runtime availability"
            if cmd.startswith("rg ") or cmd.startswith("grep ") or cmd.startswith("sed ") or cmd.startswith("awk "):
                return "inspect local content"
            if cmd.startswith("cat ") or cmd.startswith("head ") or cmd.startswith("tail "):
                return "inspect local content"
            if cmd.startswith("echo "):
                return "emit probe marker"
        text = str(objective or "").lower()
        if any(token in text for token in ("list", "directory", "files", "inventory")):
            return "inspect filesystem state"
        if any(token in text for token in ("test", "verify", "check", "smoke")):
            return "run verification command"
        if any(token in text for token in ("build", "compile")):
            return "run build command"
        if any(token in text for token in ("status", "diagnostic", "ground", "health")):
            return "collect runtime diagnostics"
        return "execute a local command"

    def _progress_verbosity(self) -> str:
        value = str(getattr(self.config, "progress_verbosity", "standard") or "standard").strip().lower()
        if value not in PROGRESS_VERBOSITY_VALUES:
            return "standard"
        return value

    def _print_tool_preview(
        self,
        tool: str,
        args: dict[str, Any],
        *,
        objective: str = "",
        step: int | None = None,
        total: int | None = None,
        source: str = "agent",
    ) -> None:
        verbosity = self._progress_verbosity()
        step_hint = f" ({step}/{total})" if step and total else ""
        source_hint = source if source else "agent"
        if verbosity == "minimal":
            self.console.print(f"[gold]Working:[/gold] [sand]{tool}{step_hint} ({source_hint})[/sand]")
            return
        relevance = self._tool_relevance(tool, objective, args)
        self.console.print(
            f"[gold]Working:[/gold] [sand]{tool}{step_hint} ({source_hint})[/sand] [dim]{relevance}[/dim]"
        )
        args_preview = self._tool_args_preview(tool, args)
        if args_preview:
            max_preview = 300 if verbosity == "verbose" else 140
            if len(args_preview) > max_preview:
                args_preview = args_preview[: max_preview - 3] + "..."
            self.console.print(Text(f"  Preview: {args_preview}", style="sand"))

    def _shell_stream_callback(self, *, tool: str, record_progress: bool):
        def _emit(chunk: str) -> None:
            if self._progress_verbosity() == "minimal":
                return
            text = self._sanitize_output(str(chunk or ""))
            if not text:
                return
            for raw in text.splitlines():
                line = raw.rstrip()
                if not line:
                    continue
                if len(line) > 280:
                    line = line[:277] + "..."
                self.console.print(Text(f"  Stream: {line}", style="sand"))
                if record_progress and self._tool_stream_event_count < self._tool_stream_event_limit:
                    self._record_progress_event("tool_stream", tool=tool, output=line)
                    self._tool_stream_event_count += 1

        return _emit

    def _start_action_sequence(self, details: str | None = None) -> None:
        if self._sequence_started_at:
            return
        self._sequence_started_at = time.perf_counter()
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
            if cleaned:
                return self._evidence_snippet(cleaned)
            content = str(args.get("content", ""))
            size = len(content.encode("utf-8"))
            lines = len(content.splitlines()) if content else 0
            return f"{size} bytes ({lines} lines)"
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

    def _inject_evidence_digest(self, response: str, actions: list[dict[str, Any]]) -> str:
        evidence_lines: list[str] = []
        for item in actions[:3]:
            title = str(item.get("title", item.get("tool", "tool"))).strip() or "tool"
            evidence = str(item.get("evidence", "")).strip()
            if not evidence:
                inline = item.get("inline", []) or []
                if inline:
                    evidence = str(inline[0]).strip()
            if evidence:
                evidence_lines.append(f"- {title}: {evidence}")
        if not evidence_lines:
            return response
        digest = "Evidence summary:\n" + "\n".join(evidence_lines)
        response_text = str(response or "").strip()
        if not response_text:
            return digest
        return f"{response_text}\n\n{digest}"

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

    def _print_action_line(self, item: dict[str, Any]) -> None:
        title = item.get("title", "Action")
        detail = item.get("detail", "")
        elapsed = float(item.get("elapsed", 0) or 0)
        show_panel = bool(item.get("show_panel"))
        ok = item.get("ok", True)
        elapsed_label = self._format_elapsed(elapsed)
        status = "Done" if ok else "Fail"
        style = "gold.soft" if ok else "warning"
        self.console.print(Text(f"{status}: {title}{elapsed_label}", style=style))
        if detail:
            self.console.print(Text(f"  Detail: {detail}", style="sand"))
        inline = item.get("inline", []) or []
        for line in inline:
            self.console.print(Text(f"  Output: {line}", style="sand"))
        if not inline and not show_panel:
            evidence = item.get("evidence", "")
            if evidence:
                self.console.print(Text(f"  Output: {evidence}", style="sand"))
        activity = self._activity_line(item, ok=ok)
        if activity:
            self.console.print(Text(f"• {activity}", style="gold.soft" if ok else "warning"))
            self._record_activity_event(item, ok=ok)

    def _activity_line(self, item: dict[str, Any], *, ok: bool) -> str:
        tool = str(item.get("tool", "") or "").strip().lower()
        if not tool:
            return ""
        if not ok:
            title = str(item.get("title", tool)).strip()
            return f"Failed: {title}"
        if tool == "edit":
            path = str(item.get("path", "")).strip()
            added = int(item.get("added_lines", 0) or 0)
            removed = int(item.get("removed_lines", 0) or 0)
            delta = f" (+{added} -{removed} lines)" if (added or removed) else ""
            return f"Edited `{path}`{delta}".strip()
        if tool == "write":
            path = str(item.get("path", "")).strip()
            evidence = str(item.get("evidence", "")).strip()
            suffix = f" [{evidence}]" if evidence else ""
            return f"Wrote `{path}`{suffix}".strip()
        if tool == "read":
            path = str(item.get("path", "")).strip()
            evidence = str(item.get("evidence", "")).strip()
            suffix = f" [{evidence}]" if evidence else ""
            return f"Explored `{path}`{suffix}".strip()
        if tool in {"grep", "glob", "find", "search", "list_dir", "list_files"}:
            detail = str(item.get("detail", "")).strip()
            detail_suffix = f": {detail}" if detail else ""
            return f"Explored `{tool}`{detail_suffix}".strip()
        if tool == "shell":
            cmd = str(item.get("command", "")).strip()
            preview = cmd if len(cmd) <= 72 else cmd[:69] + "..."
            return f"Executed `shell` -> `{preview}`".strip()
        if tool.startswith("pty."):
            session_detail = str(item.get("detail", "")).strip()
            suffix = f" ({session_detail})" if session_detail else ""
            return f"Operated `{tool}`{suffix}".strip()
        return f"Executed `{tool}`"

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
        self.console.print(Text(f"Start: {title}", style="gold.soft"))

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

    def _set_ux_preset(self, command: str) -> None:
        parts = command.split()
        if len(parts) == 1:
            current = self._ux_preset_name()
            order = ["quiet", "standard", "verbose"]
            target = order[(order.index(current) + 1) % len(order)] if current in order else "quiet"
        else:
            target = parts[1].strip().lower()
            if target not in {"quiet", "standard", "verbose"}:
                self.console.print("[warning]Usage: /ux [quiet|standard|verbose][/warning]")
                return

        if target == "quiet":
            self.config.show_actions = False
            self.config.progress_verbosity = "minimal"  # type: ignore[assignment]
            self.config.tool_output_limit = 12000
            self.config.show_history = False
        elif target == "standard":
            self.config.show_actions = True
            self.config.progress_verbosity = "standard"  # type: ignore[assignment]
            self.config.tool_output_limit = 20000
            self.config.show_history = False
        else:
            self.config.show_actions = True
            self.config.progress_verbosity = "verbose"  # type: ignore[assignment]
            self.config.tool_output_limit = 0
            self.config.show_history = True

        save_config(self.config)
        self.console.print(f"[gold]UX preset:[/gold] {target}")

    def _ux_preset_name(self) -> str:
        if (
            self.config.show_actions is False
            and self._progress_verbosity() == "minimal"
            and self.config.tool_output_limit == 12000
            and self.config.show_history is False
        ):
            return "quiet"
        if (
            self.config.show_actions is True
            and self._progress_verbosity() == "verbose"
            and self.config.tool_output_limit == 0
            and self.config.show_history is True
        ):
            return "verbose"
        return "standard"

    def _set_progress_verbosity(self, command: str) -> None:
        parts = command.split()
        current = self._progress_verbosity()
        if len(parts) == 1:
            order = ["minimal", "standard", "verbose"]
            target = order[(order.index(current) + 1) % len(order)]
        else:
            target = parts[1].strip().lower()
            if target not in PROGRESS_VERBOSITY_VALUES:
                self.console.print("[warning]Usage: /verbosity [minimal|standard|verbose][/warning]")
                return
        self.config.progress_verbosity = target  # type: ignore[assignment]
        save_config(self.config)
        self.console.print(f"[gold]Progress verbosity:[/gold] {target}")

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

    def _unknown_command_message(self, command: str) -> str:
        token = (command or "").strip().split()[0] if command else ""
        if not token.startswith("/"):
            return "Unknown command. Use / for commands."
        options = sorted(self._slash_registry.keys())
        matches = difflib.get_close_matches(token, options, n=3, cutoff=0.5)
        if matches:
            return f"Unknown command `{token}`. Did you mean: {', '.join(matches)} ? Use / for commands."
        return f"Unknown command `{token}`. Use / for commands."


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
