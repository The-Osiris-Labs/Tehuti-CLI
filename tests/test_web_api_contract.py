from __future__ import annotations

from fastapi.responses import PlainTextResponse

from tehuti_cli.web.app import create_app


def _endpoint(app, path: str, method: str):
    for route in app.router.routes:
        if getattr(route, "path", None) == path and method.upper() in getattr(route, "methods", set()):
            return route.endpoint
    raise AssertionError(f"Endpoint not found: {method} {path}")


def test_api_metrics_endpoint_returns_metrics_schema() -> None:
    app = create_app()
    endpoint = _endpoint(app, "/api/metrics", "GET")

    data = endpoint()
    assert data["schema"] == "tehuti.metrics.v1"
    assert "counters" in data
    assert "estimates" in data
    assert "actuals" in data
    assert "latency_ms" in data
    assert "diagnostics_recent" in data


def test_api_metrics_diagnostics_endpoint_returns_contract() -> None:
    app = create_app()
    endpoint = _endpoint(app, "/api/metrics/diagnostics", "GET")

    data = endpoint(limit=5)
    assert data["schema"] == "tehuti.diagnostics.v1"
    assert "items" in data


def test_metrics_endpoint_returns_prometheus_lines() -> None:
    app = create_app()
    endpoint = _endpoint(app, "/metrics", "GET")

    response = endpoint()
    assert isinstance(response, PlainTextResponse)
    body = response.body.decode("utf-8")
    assert "tehuti_" in body


def test_agent_task_endpoint_returns_contract_envelope(monkeypatch) -> None:
    app = create_app()
    endpoint = _endpoint(app, "/api/agent_task", "POST")

    class _Agent:
        def execute_task(self, task_description: str, max_iterations: int = 10):
            return {
                "schema": "tehuti.agent_task.v1",
                "success": True,
                "session_id": "s-1",
                "response": f"done: {task_description}",
                "thoughts": "ok",
                "tool_calls": [],
                "iterations": 1,
                "latency_ms": 10,
                "error": None,
                "parse_status": "structured",
                "parse_mode": "repair",
                "termination_reason": "final_response",
            }

    monkeypatch.setattr("tehuti_cli.web.app._create_agent_for_web", lambda **_kwargs: _Agent())

    data = endpoint({"task": "test task"})
    assert data["schema"] == "tehuti.web.agent_task.v1"
    assert data["status"] == "success"
    assert data["trace_id"]
    assert data["turn_id"]
    assert data["bootstrap"]["schema"] == "tehuti.preflight.v1"
    assert data["result"]["schema"] == "tehuti.agent_task.v1"
    assert isinstance(data["phase_events"], list)
    assert "tool_contracts" in data
    assert isinstance(data["tool_contracts"], list)
    assert "activity_events" in data
    assert isinstance(data["activity_events"], list)


def test_prompt_endpoint_returns_contract_envelope(monkeypatch) -> None:
    app = create_app()
    endpoint = _endpoint(app, "/api/prompt", "POST")

    class _LLM:
        def __init__(self, _cfg):
            pass

        def chat_messages(self, _messages):
            return "hello"

    monkeypatch.setattr("tehuti_cli.web.app.TehutiLLM", _LLM)

    data = endpoint({"prompt": "hello"})
    assert data["schema"] == "tehuti.web.prompt.v1"
    assert data["status"] == "success"
    assert data["trace_id"]
    assert data["turn_id"]
    assert data["bootstrap"]["schema"] == "tehuti.preflight.v1"
    assert data["result"]["response"] == "hello"


def test_agent_task_endpoint_projects_tool_contracts(monkeypatch) -> None:
    app = create_app()
    endpoint = _endpoint(app, "/api/agent_task", "POST")

    class _Agent:
        def __init__(self, progress_callback=None):
            self._progress = progress_callback

        def execute_task(self, task_description: str, max_iterations: int = 10):
            if self._progress:
                self._progress(
                    "tool_end",
                    {
                        "schema": "tehuti.progress.v1",
                        "event_version": 1,
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
                "thoughts": "ok",
                "tool_calls": [],
                "iterations": 1,
                "latency_ms": 10,
                "error": None,
                "parse_status": "structured",
                "parse_mode": "repair",
                "termination_reason": "final_response",
            }

    monkeypatch.setattr(
        "tehuti_cli.web.app._create_agent_for_web",
        lambda **kwargs: _Agent(progress_callback=kwargs.get("progress_callback")),
    )

    data = endpoint({"task": "test task"})
    assert len(data["tool_contracts"]) == 1
    assert len(data["activity_events"]) == 1
    assert len(data["phase_events"]) == 1
    assert data["phase_events"][0]["phase"] == "inspect.done"
    contract = data["tool_contracts"][0]
    assert contract["tool"] == "read"
    assert contract["trace_id"] == "trace-1"
    assert contract["contract_schema"] == "tehuti.tool_result.v1"
    activity = data["activity_events"][0]
    assert activity["schema"] == "tehuti.activity.v1"
    assert activity["tool"] == "read"
