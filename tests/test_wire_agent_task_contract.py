from __future__ import annotations

from pathlib import Path

from tehuti_cli.cli import _process_wire_payload
from tehuti_cli.core.app import TehutiApp
from tehuti_cli.storage.config import default_config


def test_wire_agent_task_mode_projects_tool_contracts(monkeypatch, tmp_path: Path) -> None:
    class _Client:
        def chat_messages(self, _messages):
            return "unused"

    class _Agent:
        def __init__(self, **kwargs):
            self._progress = kwargs.get("progress_callback")

        def execute_task(self, task_description: str, max_iterations: int = 10):
            if self._progress:
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
                        "error_payload": None,
                    },
                )
            return {
                "schema": "tehuti.agent_task.v1",
                "success": True,
                "session_id": "s-1",
                "response": f"done: {task_description}",
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

    payload = _process_wire_payload(
        _Client(),
        {"mode": "agent_task", "task": "hello", "max_iterations": 3, "work_dir": str(tmp_path)},
        app=TehutiApp(config=default_config()),
    )
    assert payload["schema"] == "tehuti.wire.v1"
    assert payload["status"] == "success"
    assert payload["mode"] == "agent_task"
    assert payload["turn_id"]
    assert "session_id" in payload
    assert payload["bootstrap"]["schema"] == "tehuti.preflight.v1"
    assert payload["result"]["response"] == "done: hello"
    assert isinstance(payload["result"]["events"], list)
    assert isinstance(payload["result"]["phase_events"], list)
    assert isinstance(payload["result"]["tool_contracts"], list)
    assert isinstance(payload["result"]["activity_events"], list)
    assert len(payload["result"]["tool_contracts"]) == 1
    assert len(payload["result"]["activity_events"]) == 1
    assert payload["result"]["activity_events"][0]["schema"] == "tehuti.activity.v1"
    assert payload["result"]["activity_events"][0]["tool"] == "read"
    assert payload["result"]["phase_events"]
