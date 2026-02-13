from __future__ import annotations

import json
import subprocess
from pathlib import Path

from tehuti_cli.cli import _process_cli_prompt_envelope, _process_wire_payload
from tehuti_cli.core.app import TehutiApp
from tehuti_cli.storage.config import default_config
from tehuti_cli.ui.shell import Shell
from tehuti_cli.web.app import create_app


def _endpoint(app, path: str, method: str):
    for route in app.router.routes:
        if getattr(route, "path", None) == path and method.upper() in getattr(route, "methods", set()):
            return route.endpoint
    raise AssertionError(f"Endpoint not found: {method} {path}")


def _normalize_wire(payload: dict[str, object]) -> dict[str, object]:
    result = payload.get("result") if isinstance(payload.get("result"), dict) else {}
    events = result.get("events") if isinstance(result, dict) and isinstance(result.get("events"), list) else []
    activity_events = (
        result.get("activity_events")
        if isinstance(result, dict) and isinstance(result.get("activity_events"), list)
        else []
    )
    event_order = [str(e.get("event")) for e in events if isinstance(e, dict)]
    agent_task = result.get("agent_task") if isinstance(result, dict) and isinstance(result.get("agent_task"), dict) else {}
    return {
        "status": payload.get("status"),
        "success": payload.get("status") == "success",
        "schema": payload.get("schema"),
        "has_ids": bool(payload.get("trace_id")) and bool(payload.get("turn_id")),
        "response": result.get("response") if isinstance(result, dict) else None,
        "termination_reason": agent_task.get("termination_reason") if isinstance(agent_task, dict) else None,
        "event_order": event_order,
        "activity_count": len(activity_events),
        "error_category": (payload.get("error") or {}).get("category") if isinstance(payload.get("error"), dict) else None,
        "error_code": (payload.get("error") or {}).get("code") if isinstance(payload.get("error"), dict) else None,
        "retryable": (payload.get("error") or {}).get("retryable") if isinstance(payload.get("error"), dict) else None,
    }


def _normalize_cli(payload: dict[str, object]) -> dict[str, object]:
    result = payload.get("result") if isinstance(payload.get("result"), dict) else {}
    events = payload.get("events") if isinstance(payload.get("events"), list) else []
    activity_events = payload.get("activity_events") if isinstance(payload.get("activity_events"), list) else []
    event_order = [str(e.get("event")) for e in events if isinstance(e, dict)]
    return {
        "status": payload.get("status"),
        "success": payload.get("status") == "success",
        "schema": payload.get("schema"),
        "response": result.get("response") if isinstance(result, dict) else None,
        "termination_reason": result.get("termination_reason") if isinstance(result, dict) else None,
        "event_order": event_order,
        "activity_count": len(activity_events),
        "error_category": payload.get("category"),
        "error_code": payload.get("code"),
        "retryable": payload.get("retryable"),
    }


def _normalize_web(payload: dict[str, object]) -> dict[str, object]:
    result = payload.get("result") if isinstance(payload.get("result"), dict) else {}
    events = payload.get("events") if isinstance(payload.get("events"), list) else []
    activity_events = payload.get("activity_events") if isinstance(payload.get("activity_events"), list) else []
    event_order = [str(e.get("event")) for e in events if isinstance(e, dict)]
    return {
        "status": payload.get("status"),
        "success": payload.get("status") == "success",
        "schema": payload.get("schema"),
        "has_ids": bool(payload.get("trace_id")) and bool(payload.get("turn_id")),
        "response": result.get("response") if isinstance(result, dict) else None,
        "termination_reason": result.get("termination_reason") if isinstance(result, dict) else None,
        "event_order": event_order,
        "activity_count": len(activity_events),
        "error_category": (payload.get("error") or {}).get("category") if isinstance(payload.get("error"), dict) else None,
        "error_code": (payload.get("error") or {}).get("code") if isinstance(payload.get("error"), dict) else None,
        "retryable": (payload.get("error") or {}).get("retryable") if isinstance(payload.get("error"), dict) else None,
    }


def _interactive_payload(status: str, response: str, *, error_payload: dict[str, object] | None = None) -> dict[str, object]:
    shell = Shell.__new__(Shell)
    shell.config = default_config()
    shell.console = type("_Console", (), {"print": lambda *args, **kwargs: None})()

    class _Session:
        id = "s-interactive"

        def __init__(self):
            self.payloads: list[dict[str, object]] = []

        def append_wire(self, payload: dict[str, object]) -> None:
            self.payloads.append(payload)

    shell.session = _Session()
    shell._emit_interactive_envelope(
        "fixture",
        response,
        actions=[{"tool": "read", "args": {"path": "fixture.txt"}, "ok": True}] if status == "success" else [],
        status=status,
        error="fixture-failure" if status == "failed" else None,
        error_payload=error_payload,
    )
    return shell.session.payloads[0]


def test_surface_conformance_runner_success_fixture(monkeypatch, tmp_path: Path) -> None:
    class _Client:
        def chat_messages(self, _messages):
            return "fixture-ok"

    class _Agent:
        def __init__(self, **kwargs):
            self._progress = kwargs.get("progress_callback")

        def execute_task(self, task_description: str, max_iterations: int = 10):
            if self._progress:
                self._progress("iteration_start", {"event": "iteration_start"})
                self._progress("tool_start", {"event": "tool_start", "tool": "read"})
                self._progress(
                    "tool_end",
                    {
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
                "response": "fixture-ok",
                "thoughts": "",
                "tool_calls": [],
                "iterations": 1,
                "latency_ms": 7,
                "error": None,
                "parse_status": "structured",
                "parse_mode": "repair",
                "termination_reason": "final_response",
                "token_estimate": 10,
                "cost_estimate_usd": 0.00001,
                "token_actual": 9,
                "cost_actual_usd": 0.000009,
            }

    monkeypatch.setattr("tehuti_cli.agentic.TehutiAgent", _Agent)
    monkeypatch.setattr("tehuti_cli.web.app._create_agent_for_web", lambda **kwargs: _Agent(**kwargs))

    wire_payload = _process_wire_payload(
        _Client(),
        {"mode": "agent_task", "task": "fixture"},
        app=TehutiApp(config=default_config()),
    )
    cli_payload = _process_cli_prompt_envelope(TehutiApp(config=default_config()), "fixture", work_dir=tmp_path)
    web_payload = _endpoint(create_app(), "/api/agent_task", "POST")({"task": "fixture"})

    wire_norm = _normalize_wire(wire_payload)
    cli_norm = _normalize_cli(cli_payload)
    web_norm = _normalize_web(web_payload)
    interactive_payload = _interactive_payload("success", "fixture-ok")

    assert wire_norm["success"] is True
    assert cli_norm["success"] is True
    assert web_norm["success"] is True
    assert wire_norm["has_ids"] is True
    assert web_norm["has_ids"] is True
    assert wire_norm["response"] == "fixture-ok"
    assert cli_norm["response"] == "fixture-ok"
    assert web_norm["response"] == "fixture-ok"
    assert wire_norm["termination_reason"] == "final_response"
    assert cli_norm["termination_reason"] == "final_response"
    assert web_norm["termination_reason"] == "final_response"
    assert wire_norm["event_order"] == ["iteration_start", "tool_start", "tool_end"]
    assert cli_norm["event_order"] == ["iteration_start", "tool_start", "tool_end"]
    assert web_norm["event_order"] == ["iteration_start", "tool_start", "tool_end"]
    assert wire_norm["activity_count"] == 1
    assert cli_norm["activity_count"] == 1
    assert web_norm["activity_count"] == 1
    assert interactive_payload["trace_id"]
    assert interactive_payload["turn_id"]
    assert [item["event"] for item in interactive_payload["events"]] == [
        "iteration_start",
        "tool_start",
        "tool_end",
        "loop_terminated",
    ]
    assert interactive_payload["result"]["degraded"] is False


def test_surface_conformance_failure_parity(monkeypatch, tmp_path: Path) -> None:
    class _Client:
        def chat_messages(self, _messages):
            raise RuntimeError("fixture-failure")

    class _Agent:
        def __init__(self, **_kwargs):
            raise RuntimeError("fixture-failure")

    monkeypatch.setattr("tehuti_cli.agentic.TehutiAgent", _Agent)
    monkeypatch.setattr("tehuti_cli.web.app._create_agent_for_web", lambda **kwargs: _Agent(**kwargs))

    wire_payload = _process_wire_payload(_Client(), {"prompt": "fixture"}, app=TehutiApp(config=default_config()))
    cli_payload = _process_cli_prompt_envelope(TehutiApp(config=default_config()), "fixture", work_dir=tmp_path)
    web_payload = _endpoint(create_app(), "/api/agent_task", "POST")({"task": "fixture"})

    wire_norm = _normalize_wire(wire_payload)
    cli_norm = _normalize_cli(cli_payload)
    web_norm = _normalize_web(web_payload)
    interactive_payload = _interactive_payload(
        "failed",
        "",
        error_payload={
            "category": "internal",
            "code": "unclassified_error",
            "error": "fixture-failure",
            "retryable": False,
            "details": {},
        },
    )

    assert wire_norm["status"] == "failed"
    assert cli_norm["status"] == "failed"
    assert web_norm["status"] == "failed"
    assert wire_norm["error_code"] == "unclassified_error"
    assert cli_norm["error_code"] == "unclassified_error"
    assert web_norm["error_code"] == "unclassified_error"
    assert wire_norm["error_category"] == "internal"
    assert cli_norm["error_category"] == "internal"
    assert web_norm["error_category"] == "internal"
    assert wire_norm["retryable"] is False
    assert cli_norm["retryable"] is False
    assert web_norm["retryable"] is False
    assert interactive_payload["status"] == "failed"
    assert interactive_payload["error"]["code"] == "unclassified_error"
    assert interactive_payload["error"]["category"] == "internal"
    assert interactive_payload["error"]["retryable"] is False


def test_interactive_degraded_fixture_contract_projection() -> None:
    shell = Shell.__new__(Shell)
    shell.config = default_config()
    shell.console = type("_Console", (), {"print": lambda *args, **kwargs: None})()

    class _Session:
        id = "s-interactive"

        def __init__(self):
            self.payloads: list[dict[str, object]] = []

        def append_wire(self, payload: dict[str, object]) -> None:
            self.payloads.append(payload)

    shell.session = _Session()
    shell._emit_interactive_envelope(
        "fixture-degraded",
        "provider unavailable; local evidence demo executed",
        actions=[{"tool": "shell", "args": {"command": "pwd"}, "ok": True}],
        status="success",
        termination_reason="provider_failure_recovered",
        has_error=False,
    )
    payload = shell.session.payloads[0]
    assert payload["status"] == "success"
    assert payload["result"]["termination_reason"] == "provider_failure_recovered"
    assert payload["result"]["degraded"] is True
    loop_terminated = [event for event in payload["events"] if event.get("event") == "loop_terminated"][0]
    assert loop_terminated["termination_reason"] == "provider_failure_recovered"
    assert loop_terminated["has_error"] is False


def test_surface_conformance_runner_script_reports_and_enforces_degraded_block() -> None:
    result = subprocess.run(
        ["python3", "scripts/surface_conformance_runner.py"],
        check=False,
        text=True,
        capture_output=True,
    )
    assert result.returncode == 0
    stdout = result.stdout
    assert "surface conformance: OK" in stdout
    json_blob = stdout.split("surface conformance: OK", 1)[0].strip()
    payload = json.loads(json_blob)
    degraded = payload["degraded"]["cli_interactive"]
    assert degraded["termination_reason"] == "provider_failure_recovered"
    assert degraded["degraded"] is True
