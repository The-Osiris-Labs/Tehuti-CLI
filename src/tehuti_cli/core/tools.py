from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from tehuti_cli.storage.config import Config


@dataclass
class ToolSpec:
    name: str
    description: str
    kind: str  # "builtin" or "external"
    command: str | None = None


class ToolRegistry:
    def __init__(self, config: Config):
        self.config = config
        self._tools: dict[str, ToolSpec] = {}
        self._load_builtin()
        self._load_external()

    def _load_builtin(self) -> None:
        self._tools["read"] = ToolSpec("read", "Read a file from disk", "builtin")
        self._tools["write"] = ToolSpec("write", "Write a file to disk", "builtin")
        self._tools["shell"] = ToolSpec("shell", "Run a shell command", "builtin")
        self._tools["fetch"] = ToolSpec("fetch", "Fetch a URL over HTTP", "builtin")
        self._tools["pty.spawn"] = ToolSpec("pty.spawn", "Spawn interactive PTY session", "builtin")
        self._tools["pty.send"] = ToolSpec("pty.send", "Send input to PTY session", "builtin")
        self._tools["pty.read"] = ToolSpec("pty.read", "Read output from PTY session", "builtin")
        self._tools["pty.close"] = ToolSpec("pty.close", "Close PTY session", "builtin")

    def _load_external(self) -> None:
        path = self.config.external_tools_file
        if not path.exists():
            return
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return
        for item in data.get("tools", []):
            name = str(item.get("name", "")).strip()
            if not name:
                continue
            description = str(item.get("description", "")).strip()
            command = str(item.get("command", "")).strip()
            if not command:
                continue
            self._tools[name] = ToolSpec(name, description, "external", command=command)

    def list_tools(self) -> list[ToolSpec]:
        return list(self._tools.values())

    def get(self, name: str) -> ToolSpec | None:
        return self._tools.get(name)
