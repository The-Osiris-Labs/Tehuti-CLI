from __future__ import annotations

from pathlib import Path

from tehuti_cli.core.runtime import ToolRuntime
from tehuti_cli.storage.config import default_config


def test_write_tool_returns_dynamic_summary(tmp_path: Path) -> None:
    cfg = default_config()
    cfg.default_yolo = True
    runtime = ToolRuntime(cfg, tmp_path)

    result = runtime.execute("write", {"path": "notes.txt", "content": "a\nb\nc\n"})
    assert result.ok is True
    assert "Wrote" in result.output
    assert "bytes" in result.output
    assert "lines" in result.output
    assert "notes.txt" in result.output


def test_edit_tool_returns_dynamic_summary(tmp_path: Path) -> None:
    cfg = default_config()
    cfg.default_yolo = True
    runtime = ToolRuntime(cfg, tmp_path)

    file_path = tmp_path / "app.txt"
    file_path.write_text("hello old world", encoding="utf-8")

    result = runtime.execute(
        "edit",
        {"path": "app.txt", "old_string": "old", "new_string": "new"},
    )
    assert result.ok is True
    assert "Edited" in result.output
    assert "replaced 1 occurrence" in result.output
    assert "app.txt" in result.output
