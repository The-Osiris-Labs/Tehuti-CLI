from __future__ import annotations

import json
from pathlib import Path

from tehuti_cli.core.runtime import ToolRuntime
from tehuti_cli.storage.config import default_config


def _first_json_line(output: str) -> dict[str, object]:
    lines = [line for line in output.splitlines() if line.strip()]
    assert lines, "expected at least one JSON line"
    return json.loads(lines[0])


def test_delegate_list_outputs_json_lines(tmp_path: Path) -> None:
    cfg = default_config()
    runtime = ToolRuntime(cfg, tmp_path)

    created = runtime.execute("delegate_create", {"name": "worker-1", "prompt": "echo hi"})
    assert created.ok is True

    listed = runtime.execute("delegate_list", {})
    assert listed.ok is True
    payload = _first_json_line(listed.output)
    assert payload["name"] == "worker-1"
    assert payload["prompt"] == "echo hi"


def test_task_schedulable_outputs_json_lines(tmp_path: Path) -> None:
    cfg = default_config()
    runtime = ToolRuntime(cfg, tmp_path)

    created = runtime.execute("task_create", {"title": "Task A", "description": "demo"})
    assert created.ok is True

    schedulable = runtime.execute("task_schedulable", {})
    assert schedulable.ok is True
    payload = _first_json_line(schedulable.output)
    assert payload["title"] == "Task A"
