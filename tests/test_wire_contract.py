from __future__ import annotations

from tehuti_cli.cli import _process_wire_payload
from tehuti_cli.core.app import TehutiApp
from tehuti_cli.storage.config import default_config


def test_wire_payload_success_contract() -> None:
    class _Client:
        def chat_messages(self, _messages):
            return "ok"

    data = _process_wire_payload(_Client(), {"prompt": "hello"}, app=TehutiApp(config=default_config()))
    assert data["schema"] == "tehuti.wire.v1"
    assert data["status"] == "success"
    assert data["trace_id"]
    assert data["turn_id"]
    assert "session_id" in data
    assert data["mode"] == "prompt"
    assert data["bootstrap"]["schema"] == "tehuti.preflight.v1"
    assert data["result"]["response"] == "ok"
    assert data["result"]["events"] == []
    assert data["result"]["tool_contracts"] == []
    assert data["result"]["activity_events"] == []


def test_wire_payload_missing_prompt_contract() -> None:
    class _Client:
        def chat_messages(self, _messages):
            return "unused"

    data = _process_wire_payload(_Client(), {}, app=TehutiApp(config=default_config()))
    assert data["schema"] == "tehuti.wire.v1"
    assert data["status"] == "failed"
    assert data["turn_id"]
    assert "session_id" in data
    assert data["error"]["code"] == "missing_prompt"
    assert data["error"]["category"] == "validation"


def test_wire_payload_error_contract() -> None:
    class _Client:
        def chat_messages(self, _messages):
            raise RuntimeError("boom")

    data = _process_wire_payload(_Client(), {"prompt": "hello"}, app=TehutiApp(config=default_config()))
    assert data["schema"] == "tehuti.wire.v1"
    assert data["status"] == "failed"
    assert data["trace_id"]
    assert data["turn_id"]
    assert "session_id" in data
    assert data["error"]["code"] == "unclassified_error"
