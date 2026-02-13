from __future__ import annotations

from pathlib import Path

from tehuti_cli.cli import _process_cli_prompt_envelope, _process_wire_payload
from tehuti_cli.core.app import TehutiApp
from tehuti_cli.core.errors import ProtocolError
from tehuti_cli.storage.config import default_config
from tehuti_cli.web.app import create_app


def _endpoint(app, path: str, method: str):
    for route in app.router.routes:
        if getattr(route, "path", None) == path and method.upper() in getattr(route, "methods", set()):
            return route.endpoint
    raise AssertionError(f"Endpoint not found: {method} {path}")


def test_retryable_failure_parity_across_cli_wire_web(monkeypatch, tmp_path: Path) -> None:
    class _Agent:
        def __init__(self, **_kwargs):
            raise ProtocolError(
                "transient downstream timeout",
                code="a2a_timeout",
                retryable=True,
                details={"provider": "fixture"},
            )

    class _Client:
        def chat_messages(self, _messages):
            return "unused"

    monkeypatch.setattr("tehuti_cli.agentic.TehutiAgent", _Agent)
    monkeypatch.setattr("tehuti_cli.web.app._create_agent_for_web", lambda **kwargs: _Agent(**kwargs))

    wire_payload = _process_wire_payload(
        _Client(),
        {"mode": "agent_task", "task": "fixture"},
        app=TehutiApp(config=default_config()),
    )
    cli_payload = _process_cli_prompt_envelope(TehutiApp(config=default_config()), "fixture", work_dir=tmp_path)
    web_payload = _endpoint(create_app(), "/api/agent_task", "POST")({"task": "fixture"})

    assert wire_payload["status"] == "failed"
    assert cli_payload["status"] == "failed"
    assert web_payload["status"] == "failed"

    assert wire_payload["error"]["code"] == "a2a_timeout"
    assert cli_payload["code"] == "a2a_timeout"
    assert web_payload["error"]["code"] == "a2a_timeout"

    assert wire_payload["error"]["retryable"] is True
    assert cli_payload["retryable"] is True
    assert web_payload["error"]["retryable"] is True
