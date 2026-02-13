from __future__ import annotations

from pathlib import Path

from tehuti_cli.cli import _process_wire_payload
from tehuti_cli.core.app import TehutiApp
from tehuti_cli.storage.config import default_config


def test_wire_agent_task_stream_emits_progress_events(monkeypatch, tmp_path: Path) -> None:
    class _Client:
        def chat_messages(self, _messages):
            return "unused"

    class _Agent:
        def __init__(self, **kwargs):
            self._progress = kwargs.get("progress_callback")

        def execute_task(self, task_description: str, max_iterations: int = 10):
            if self._progress:
                self._progress(
                    "tool_start",
                    {
                        "schema": "tehuti.progress.v1",
                        "event_version": "v1",
                        "event": "tool_start",
                        "tool": "read",
                    },
                )
                self._progress(
                    "tool_end",
                    {
                        "schema": "tehuti.progress.v1",
                        "event_version": "v1",
                        "event": "tool_end",
                        "tool": "read",
                        "success": True,
                        "trace_id": "trace-1",
                        "contract_schema": "tehuti.tool_result.v1",
                    },
                )
            return {
                "schema": "tehuti.agent_task.v1",
                "success": True,
                "session_id": "s-1",
                "response": "done",
                "thoughts": "",
                "tool_calls": [],
                "iterations": 1,
                "latency_ms": 10,
                "error": None,
                "parse_status": "structured",
                "parse_mode": "repair",
                "termination_reason": "final_response",
            }

    monkeypatch.setattr("tehuti_cli.agentic.TehutiAgent", _Agent)
    streamed: list[dict[str, object]] = []
    payload = {
        "mode": "agent_task",
        "task": "hello",
        "work_dir": str(tmp_path),
        "_wire_progress_emitter": lambda event: streamed.append(event),
    }
    result = _process_wire_payload(_Client(), payload, app=TehutiApp(config=default_config()))

    assert result["status"] == "success"
    assert len(streamed) == 3
    assert streamed[0]["schema"] == "tehuti.wire.progress.v1"
    assert streamed[0]["status"] == "in_progress"
    assert streamed[0]["turn_id"]
    assert "session_id" in streamed[0]
    assert streamed[0]["sequence"] == 1
    assert streamed[1]["sequence"] == 2
    assert streamed[2]["sequence"] == 3
    assert streamed[2]["event"]["schema"] == "tehuti.activity.v1"
    assert streamed[2]["event"]["event"] == "activity"
    assert streamed[2]["event"]["tool"] == "read"


def test_wire_agent_task_stream_phase_option_emits_phase_events(monkeypatch, tmp_path: Path) -> None:
    class _Client:
        def chat_messages(self, _messages):
            return "unused"

    class _Agent:
        def __init__(self, **kwargs):
            self._progress = kwargs.get("progress_callback")

        def execute_task(self, task_description: str, max_iterations: int = 10):
            if self._progress:
                self._progress(
                    "tool_start",
                    {
                        "schema": "tehuti.progress.v1",
                        "event_version": "v1",
                        "event": "tool_start",
                        "tool": "read",
                    },
                )
            return {
                "schema": "tehuti.agent_task.v1",
                "success": True,
                "session_id": "s-1",
                "response": "done",
                "thoughts": "",
                "tool_calls": [],
                "iterations": 1,
                "latency_ms": 10,
                "error": None,
                "parse_status": "structured",
                "parse_mode": "repair",
                "termination_reason": "final_response",
            }

    monkeypatch.setattr("tehuti_cli.agentic.TehutiAgent", _Agent)
    streamed: list[dict[str, object]] = []
    payload = {
        "mode": "agent_task",
        "task": "hello",
        "work_dir": str(tmp_path),
        "stream_phase": True,
        "_wire_progress_emitter": lambda event: streamed.append(event),
    }
    result = _process_wire_payload(_Client(), payload, app=TehutiApp(config=default_config()))

    assert result["status"] == "success"
    assert len(streamed) == 2
    assert streamed[1]["event"]["schema"] == "tehuti.phase_stream.v1"
    assert streamed[1]["event"]["phase"] == "inspect.start"
