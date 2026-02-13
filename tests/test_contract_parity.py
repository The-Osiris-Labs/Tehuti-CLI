from __future__ import annotations

from pathlib import Path

from tehuti_cli.cli import _process_wire_payload, _process_cli_prompt_envelope
from tehuti_cli.core.app import TehutiApp
from tehuti_cli.storage.config import default_config
from tehuti_cli.web.app import create_app


def _endpoint(app, path: str, method: str):
    for route in app.router.routes:
        if getattr(route, "path", None) == path and method.upper() in getattr(route, "methods", set()):
            return route.endpoint
    raise AssertionError(f"Endpoint not found: {method} {path}")


def test_surface_contract_status_and_schema_parity(monkeypatch, tmp_path: Path) -> None:
    class _Client:
        def chat_messages(self, _messages):
            return "ok"

    class _Agent:
        def __init__(self, **_kwargs):
            pass

        def execute_task(self, task_description: str, max_iterations: int = 10):
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
                "token_estimate": 20,
                "cost_estimate_usd": 0.00001,
            }

    monkeypatch.setattr("tehuti_cli.agentic.TehutiAgent", _Agent)
    monkeypatch.setattr("tehuti_cli.web.app._create_agent_for_web", lambda **_kwargs: _Agent())

    app = TehutiApp(config=default_config())
    wire = _process_wire_payload(_Client(), {"prompt": "hello"}, app=app)
    cli = _process_cli_prompt_envelope(app, "hello", work_dir=tmp_path)
    web = _endpoint(create_app(), "/api/agent_task", "POST")({"task": "hello"})

    assert wire["status"] == "success"
    assert cli["status"] == "success"
    assert web["status"] == "success"
    assert wire["schema"] == "tehuti.wire.v1"
    assert cli["schema"] == "tehuti.cli.prompt.v1"
    assert web["schema"] == "tehuti.web.agent_task.v1"
    assert wire["trace_id"] and wire["turn_id"]
    assert web["trace_id"] and web["turn_id"]
    assert cli["bootstrap"]["schema"] == "tehuti.preflight.v1"
    assert web["bootstrap"]["schema"] == "tehuti.preflight.v1"
    assert wire["bootstrap"]["schema"] == "tehuti.preflight.v1"
