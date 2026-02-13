from __future__ import annotations

from types import SimpleNamespace

from tehuti_cli.ui.shell import Shell


def _shell_stub() -> Shell:
    shell = Shell.__new__(Shell)
    shell.config = SimpleNamespace(experimental_flags=[])
    shell.session = SimpleNamespace(
        id="s-1",
        payloads=[],
        append_wire=lambda payload: shell.session.payloads.append(payload),
    )
    shell.console = SimpleNamespace(print=lambda *_args, **_kwargs: None)
    return shell


def test_interactive_envelope_success_has_ids_and_tool_contract_projection() -> None:
    shell = _shell_stub()
    shell._emit_interactive_envelope(
        "prompt",
        "response",
        actions=[{"tool": "read", "args": {"path": "a.txt"}, "ok": True}],
        status="success",
    )

    payload = shell.session.payloads[0]
    assert payload["schema"] == "tehuti.cli.interactive.v1"
    assert payload["status"] == "success"
    assert payload["trace_id"]
    assert payload["turn_id"]
    assert payload["result"]["schema"] == "tehuti.agent_task.v1"
    assert payload["tool_contracts"][0]["contract_schema"] == "tehuti.tool_result.v1"


def test_interactive_envelope_failure_has_typed_error_payload() -> None:
    shell = _shell_stub()
    shell._emit_interactive_envelope(
        "prompt",
        "",
        actions=[],
        status="failed",
        error="downstream timeout",
        error_payload={
            "category": "protocol",
            "code": "a2a_timeout",
            "error": "downstream timeout",
            "retryable": True,
            "details": {"provider": "fixture"},
        },
    )

    payload = shell.session.payloads[0]
    assert payload["status"] == "failed"
    assert payload["error"]["category"] == "protocol"
    assert payload["error"]["code"] == "a2a_timeout"
    assert payload["error"]["message"] == "downstream timeout"
    assert payload["error"]["retryable"] is True


def test_interactive_envelope_degraded_success_projects_recovered_termination() -> None:
    shell = _shell_stub()
    shell._emit_interactive_envelope(
        "prompt",
        "provider unavailable, local demo used",
        actions=[{"tool": "shell", "args": {"command": "pwd"}, "ok": True}],
        status="success",
        termination_reason="provider_failure_recovered",
        has_error=False,
    )

    payload = shell.session.payloads[0]
    assert payload["status"] == "success"
    assert payload["result"]["termination_reason"] == "provider_failure_recovered"
    assert payload["result"]["degraded"] is True
    loop_event = [event for event in payload["events"] if event.get("event") == "loop_terminated"][0]
    assert loop_event["termination_reason"] == "provider_failure_recovered"
    assert loop_event["has_error"] is False
