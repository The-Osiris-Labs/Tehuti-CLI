from __future__ import annotations

from tehuti_cli.web.app import create_app


def _endpoint(app, path: str, method: str):
    for route in app.router.routes:
        if getattr(route, "path", None) == path and method.upper() in getattr(route, "methods", set()):
            return route.endpoint
    raise AssertionError(f"Endpoint not found: {method} {path}")


def test_web_agent_task_missing_task_returns_typed_envelope() -> None:
    app = create_app()
    endpoint = _endpoint(app, "/api/agent_task", "POST")
    data = endpoint({})
    assert data["schema"] == "tehuti.web.agent_task.v1"
    assert data["status"] == "failed"
    assert data["trace_id"]
    assert data["turn_id"]
    assert data["error"]["category"] == "validation"
    assert data["error"]["code"] == "missing_task"


def test_web_prompt_failure_returns_typed_envelope(monkeypatch) -> None:
    app = create_app()
    endpoint = _endpoint(app, "/api/prompt", "POST")

    class _LLM:
        def __init__(self, _cfg):
            pass

        def chat_messages(self, _messages):
            raise RuntimeError("boom")

    monkeypatch.setattr("tehuti_cli.web.app.TehutiLLM", _LLM)

    data = endpoint({"prompt": "hello"})
    assert data["schema"] == "tehuti.web.prompt.v1"
    assert data["status"] == "failed"
    assert data["trace_id"]
    assert data["turn_id"]
    assert data["error"]["code"]
