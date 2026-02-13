from __future__ import annotations

from pathlib import Path

from tehuti_cli.cli import _process_wire_payload
from tehuti_cli.core.app import TehutiApp
from tehuti_cli.storage.config import default_config


def test_wire_persist_mode_sets_session_id(monkeypatch, tmp_path: Path) -> None:
    class _Client:
        def chat_messages(self, _messages):
            return "ok"

    monkeypatch.setenv("TEHUTI_HOME", str(tmp_path / ".tehuti-home"))

    result = _process_wire_payload(
        _Client(),
        {"prompt": "hello", "persist": True, "work_dir": str(tmp_path)},
        app=TehutiApp(config=default_config()),
    )
    assert result["status"] == "success"
    assert result["session_id"]
