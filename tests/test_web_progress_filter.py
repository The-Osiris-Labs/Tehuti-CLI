from __future__ import annotations

from tehuti_cli.web.app import _should_include_progress_event


def test_progress_filter_minimal_mode() -> None:
    assert _should_include_progress_event("minimal", "iteration_start") is False
    assert _should_include_progress_event("minimal", "thought") is False
    assert _should_include_progress_event("minimal", "tool_start") is False
    assert _should_include_progress_event("minimal", "tool_end") is True


def test_progress_filter_standard_mode() -> None:
    assert _should_include_progress_event("standard", "thought") is False
    assert _should_include_progress_event("standard", "iteration_start") is True
    assert _should_include_progress_event("standard", "tool_start") is True
    assert _should_include_progress_event("standard", "tool_end") is True


def test_progress_filter_verbose_mode() -> None:
    assert _should_include_progress_event("verbose", "thought") is True
    assert _should_include_progress_event("verbose", "tool_start") is True
