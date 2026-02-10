from __future__ import annotations

import os
import shlex
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx

from tehuti_cli.storage.config import Config
from tehuti_cli.core.tools import ToolRegistry
from tehuti_cli.core.pty import PtyManager


@dataclass
class ToolResult:
    ok: bool
    output: str


class ToolSandbox:
    def __init__(self, config: Config, work_dir: Path):
        self.config = config
        self.work_dir = work_dir.resolve()

    def _is_path_allowed(self, path: Path) -> bool:
        if self.config.default_yolo:
            return True
        allowed = [self.work_dir] + [Path(p).resolve() for p in self.config.allowed_paths]
        resolved = path.resolve()
        return any(str(resolved).startswith(str(base)) for base in allowed)

    def read_file(self, path: Path) -> ToolResult:
        if not self._is_path_allowed(path):
            return ToolResult(False, "Path is outside allowed sandbox.")
        if not path.exists():
            return ToolResult(False, "File not found.")
        return ToolResult(True, path.read_text(encoding="utf-8", errors="replace"))

    def write_file(self, path: Path, content: str) -> ToolResult:
        if not self.config.allow_write and not self.config.default_yolo:
            return ToolResult(False, "Write tool disabled. Use /allow-all or /permissions write on.")
        if not self._is_path_allowed(path):
            return ToolResult(False, "Path is outside allowed sandbox.")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        return ToolResult(True, "OK")

    def run_shell(self, command: str) -> ToolResult:
        if not self.config.allow_shell and not self.config.default_yolo:
            return ToolResult(False, "Shell disabled. Use /allow-all or /permissions shell on.")
        try:
            proc = subprocess.run(
                command,
                shell=True,
                cwd=str(self.work_dir),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                env=os.environ.copy(),
            )
            return ToolResult(proc.returncode == 0, proc.stdout or "")
        except Exception as exc:
            return ToolResult(False, str(exc))

    def fetch_url(self, url: str) -> ToolResult:
        if self.config.default_yolo:
            # Full access in YOLO mode.
            pass
        parsed = urlparse(url)
        domain = parsed.netloc
        if self.config.web_deny_domains and domain in self.config.web_deny_domains:
            return ToolResult(False, "Domain denied by web_deny_domains.")
        if self.config.web_allow_domains and domain not in self.config.web_allow_domains:
            return ToolResult(False, "Domain not allowed by web_allow_domains.")
        try:
            with httpx.Client(timeout=30.0, follow_redirects=True) as client:
                resp = client.get(url)
                resp.raise_for_status()
                return ToolResult(True, resp.text)
        except Exception as exc:
            return ToolResult(False, str(exc))


class ToolRuntime:
    def __init__(self, config: Config, work_dir: Path):
        self.config = config
        self.work_dir = work_dir
        self.sandbox = ToolSandbox(config, work_dir)
        self.registry = ToolRegistry(config)
        self.pty = PtyManager()

    def approve(self, tool: str, args: dict[str, Any]) -> bool:
        if self.config.default_yolo:
            return True
        if self.config.deny_tools and tool in self.config.deny_tools:
            return False
        if self.config.allow_tools and tool not in self.config.allow_tools:
            return False
        if self.config.default_yolo:
            return True
        # For now, approvals are controlled by config flags.
        return True

    def execute(self, tool: str, args: dict[str, Any]) -> ToolResult:
        if not self.approve(tool, args):
            return ToolResult(False, "Denied by approval.")
        match tool:
            case "read":
                return self.sandbox.read_file(Path(args["path"]))
            case "write":
                return self.sandbox.write_file(Path(args["path"]), args.get("content", ""))
            case "shell":
                return self.sandbox.run_shell(args["command"])
            case "fetch":
                return self.sandbox.fetch_url(args["url"])
            case "pty.spawn":
                ok, out = self.pty.spawn(args.get("command", ""))
                return ToolResult(ok, out)
            case "pty.send":
                ok, out = self.pty.send(args.get("session_id", ""), args.get("input", ""))
                return ToolResult(ok, out)
            case "pty.read":
                ok, out = self.pty.read(args.get("session_id", ""))
                return ToolResult(ok, out)
            case "pty.close":
                ok, out = self.pty.close(args.get("session_id", ""))
                return ToolResult(ok, out)

        spec = self.registry.get(tool)
        if spec and spec.kind == "external":
            if not self.config.allow_external and not self.config.default_yolo:
                return ToolResult(False, "External tools disabled. Use /allow-all or /permissions external on.")
            if not spec.command:
                return ToolResult(False, "External tool is missing command.")
            # Command templates can reference args by {key}
            try:
                command = spec.command.format(**args)
            except KeyError as exc:
                return ToolResult(False, f"Missing argument for tool: {exc}")
            return self.sandbox.run_shell(command)

        return ToolResult(False, f"Unknown tool: {tool}")
