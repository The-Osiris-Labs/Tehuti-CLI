from __future__ import annotations

from types import SimpleNamespace

from tehuti_cli.core.phase_stream import (
    normalize_phase_status,
    phase_should_render,
    project_phase_event_from_progress,
    tool_phase_kind,
)


def test_phase_status_normalization_defaults_to_progress() -> None:
    assert normalize_phase_status("done") == "done"
    assert normalize_phase_status("weird") == "progress"


def test_phase_render_respects_verbosity_profiles() -> None:
    assert phase_should_render("minimal", "inspect.start", "progress") is False
    assert phase_should_render("minimal", "complete", "done") is True
    assert phase_should_render("standard", "mutate.start", "progress") is True
    assert phase_should_render("standard", "inspect.done", "error") is True
    assert phase_should_render("verbose", "random.phase", "progress") is True


def test_tool_phase_kind_uses_tool_metadata_when_available() -> None:
    read_like = SimpleNamespace(idempotency="safe_read", risk_class="low")
    write_like = SimpleNamespace(idempotency="mutating_write", risk_class="medium")
    critical_exec = SimpleNamespace(idempotency="system_exec", risk_class="critical")

    assert tool_phase_kind("anything", read_like) == "inspect"
    assert tool_phase_kind("anything", write_like) == "mutate"
    assert tool_phase_kind("anything", critical_exec) == "operate"
    assert tool_phase_kind("web_fetch") == "retrieve"
    assert tool_phase_kind("pty.spawn") == "session"


def test_project_phase_event_from_progress_maps_tool_end_and_error() -> None:
    phase = project_phase_event_from_progress(
        "tool_end",
        {
            "tool": "read",
            "success": False,
            "execution_time_ms": 42,
            "timestamp": "2026-02-12T00:00:00",
            "surface": "agent_loop",
        },
        sequence=3,
        session_id="s-1",
        surface="wire",
    )
    assert phase["schema"] == "tehuti.phase_stream.v1"
    assert phase["phase"] == "inspect.done"
    assert phase["status"] == "error"
    assert phase["surface"] == "wire"
    assert phase["phase_group"] == "inspect"
    assert phase["elapsed_ms"] == 42
    assert phase["meta"]["source_event"] == "tool_end"
