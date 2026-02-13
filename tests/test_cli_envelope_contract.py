from __future__ import annotations

from pathlib import Path

from tehuti_cli.cli import _process_cli_prompt_envelope
from tehuti_cli.core.app import TehutiApp
from tehuti_cli.storage.config import default_config


def test_cli_prompt_envelope_success(monkeypatch, tmp_path: Path) -> None:
    class _Agent:
        def __init__(self, **_kwargs):
            pass

        def execute_task(self, task_description: str, max_iterations: int = 10):
            return {
                "schema": "tehuti.agent_task.v1",
                "success": True,
                "session_id": "s1",
                "response": task_description,
                "thoughts": "",
                "tool_calls": [],
                "iterations": 1,
                "latency_ms": 5,
                "error": None,
                "parse_status": "structured",
                "parse_mode": "repair",
                "termination_reason": "final_response",
                "token_estimate": 10,
                "cost_estimate_usd": 0.00001,
            }

    monkeypatch.setattr("tehuti_cli.agentic.TehutiAgent", _Agent)
    app = TehutiApp(config=default_config())
    data = _process_cli_prompt_envelope(app, "hello", work_dir=tmp_path)

    assert data["schema"] == "tehuti.cli.prompt.v1"
    assert data["status"] == "success"
    assert data["bootstrap"]["schema"] == "tehuti.preflight.v1"
    assert data["result"]["schema"] == "tehuti.agent_task.v1"
    assert "tool_contracts" in data
    assert isinstance(data["tool_contracts"], list)
    assert "activity_events" in data
    assert isinstance(data["activity_events"], list)


def test_cli_prompt_envelope_failure(monkeypatch, tmp_path: Path) -> None:
    class _Agent:
        def __init__(self, **_kwargs):
            raise RuntimeError("boom")

    monkeypatch.setattr("tehuti_cli.agentic.TehutiAgent", _Agent)
    app = TehutiApp(config=default_config())
    data = _process_cli_prompt_envelope(app, "hello", work_dir=tmp_path)

    assert data["schema"] == "tehuti.cli.prompt.v1"
    assert data["status"] == "failed"
    assert data["bootstrap"]["schema"] == "tehuti.preflight.v1"
    assert data["code"] == "unclassified_error"
    assert "tool_contracts" in data
    assert isinstance(data["tool_contracts"], list)
    assert "activity_events" in data
    assert isinstance(data["activity_events"], list)


def test_cli_prompt_envelope_projects_tool_contracts_from_events(monkeypatch, tmp_path: Path) -> None:
    class _Agent:
        def __init__(self, **kwargs):
            self._progress = kwargs.get("progress_callback")

        def execute_task(self, task_description: str, max_iterations: int = 10):
            if self._progress:
                self._progress(
                    "tool_end",
                    {
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
                "session_id": "s1",
                "response": task_description,
                "thoughts": "",
                "tool_calls": [],
                "iterations": 1,
                "latency_ms": 5,
                "error": None,
                "parse_status": "structured",
                "parse_mode": "repair",
                "termination_reason": "final_response",
                "token_estimate": 10,
                "cost_estimate_usd": 0.00001,
            }

    monkeypatch.setattr("tehuti_cli.agentic.TehutiAgent", _Agent)
    app = TehutiApp(config=default_config())
    data = _process_cli_prompt_envelope(app, "hello", work_dir=tmp_path)

    assert len(data["tool_contracts"]) == 1
    assert len(data["activity_events"]) == 1
    contract = data["tool_contracts"][0]
    assert contract["tool"] == "read"
    assert contract["trace_id"] == "trace-1"
    assert contract["contract_schema"] == "tehuti.tool_result.v1"
    activity = data["activity_events"][0]
    assert activity["schema"] == "tehuti.activity.v1"
    assert activity["tool"] == "read"
