#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from tehuti_cli.cli import _process_cli_prompt_envelope, _process_wire_payload
from tehuti_cli.core.app import TehutiApp
from tehuti_cli.storage.config import default_config
from tehuti_cli.ui.shell import Shell
from tehuti_cli.web.app import create_app


def _endpoint(app, path: str, method: str):
    for route in app.router.routes:
        if getattr(route, "path", None) == path and method.upper() in getattr(route, "methods", set()):
            return route.endpoint
    raise RuntimeError(f"Endpoint not found: {method} {path}")


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
        "schema": payload.get("schema"),
        "has_ids": False,
        "response": result.get("response") if isinstance(result, dict) else None,
        "termination_reason": result.get("termination_reason") if isinstance(result, dict) else None,
        "event_order": event_order,
        "activity_count": len(activity_events),
        "error_category": payload.get("category"),
        "error_code": payload.get("code"),
        "retryable": payload.get("retryable"),
    }


def _normalize_cli_interactive(payload: dict[str, object]) -> dict[str, object]:
    result = payload.get("result") if isinstance(payload.get("result"), dict) else {}
    events = payload.get("events") if isinstance(payload.get("events"), list) else []
    activity_events = payload.get("activity_events") if isinstance(payload.get("activity_events"), list) else []
    event_order = [str(e.get("event")) for e in events if isinstance(e, dict)]
    return {
        "status": payload.get("status"),
        "schema": payload.get("schema"),
        "has_ids": bool(payload.get("trace_id")) and bool(payload.get("turn_id")),
        "response": result.get("response") if isinstance(result, dict) else None,
        "termination_reason": result.get("termination_reason") if isinstance(result, dict) else None,
        "degraded": bool(result.get("degraded")) if isinstance(result, dict) else False,
        "event_order": event_order,
        "activity_count": len(activity_events),
        "error_category": (payload.get("error") or {}).get("category") if isinstance(payload.get("error"), dict) else None,
        "error_code": (payload.get("error") or {}).get("code") if isinstance(payload.get("error"), dict) else None,
        "retryable": (payload.get("error") or {}).get("retryable") if isinstance(payload.get("error"), dict) else None,
    }


def _normalize_web(payload: dict[str, object]) -> dict[str, object]:
    result = payload.get("result") if isinstance(payload.get("result"), dict) else {}
    events = payload.get("events") if isinstance(payload.get("events"), list) else []
    activity_events = payload.get("activity_events") if isinstance(payload.get("activity_events"), list) else []
    event_order = [str(e.get("event")) for e in events if isinstance(e, dict)]
    response = None
    if isinstance(result, dict):
        response = result.get("response")
    return {
        "status": payload.get("status"),
        "schema": payload.get("schema"),
        "has_ids": bool(payload.get("trace_id")) and bool(payload.get("turn_id")),
        "response": response,
        "termination_reason": result.get("termination_reason") if isinstance(result, dict) else None,
        "event_order": event_order,
        "activity_count": len(activity_events),
        "error_category": (payload.get("error") or {}).get("category") if isinstance(payload.get("error"), dict) else None,
        "error_code": (payload.get("error") or {}).get("code") if isinstance(payload.get("error"), dict) else None,
        "retryable": (payload.get("error") or {}).get("retryable") if isinstance(payload.get("error"), dict) else None,
    }


def run_fixture(prompt: str = "conformance-fixture") -> dict[str, dict[str, object]]:
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

    # Web path
    endpoint = _endpoint(create_app(), "/api/agent_task", "POST")

    import tehuti_cli.agentic as agentic_module
    import tehuti_cli.web.app as web_app_module

    original_agent = agentic_module.TehutiAgent
    original_factory = web_app_module._create_agent_for_web
    try:
        agentic_module.TehutiAgent = _Agent
        web_app_module._create_agent_for_web = lambda **_kwargs: _Agent(**_kwargs)
        wire_payload = _process_wire_payload(
            _Client(),
            {"mode": "agent_task", "task": prompt},
            app=TehutiApp(config=default_config()),
        )
        cli_payload = _process_cli_prompt_envelope(TehutiApp(config=default_config()), prompt, work_dir=ROOT)
        web_payload = endpoint({"task": prompt})
    finally:
        agentic_module.TehutiAgent = original_agent
        web_app_module._create_agent_for_web = original_factory

    shell = Shell.__new__(Shell)
    shell.config = default_config()

    class _Session:
        id = "s-interactive"

        def __init__(self):
            self.payloads: list[dict[str, object]] = []

        def append_wire(self, payload: dict[str, object]) -> None:
            self.payloads.append(payload)

    shell.session = _Session()
    shell.console = type("_Console", (), {"print": lambda *args, **kwargs: None})()
    shell._emit_interactive_envelope(
        prompt,
        "fixture-ok",
        actions=[{"tool": "read", "args": {"path": "fixture.txt"}, "ok": True}],
        status="success",
    )
    interactive_payload = shell.session.payloads[0]

    return {
        "cli": _normalize_cli(cli_payload),
        "cli_interactive": _normalize_cli_interactive(interactive_payload),
        "wire": _normalize_wire(wire_payload),
        "web": _normalize_web(web_payload),
    }


def run_failure_fixture(prompt: str = "conformance-fixture-fail") -> dict[str, dict[str, object]]:
    class _Client:
        def chat_messages(self, _messages):
            raise RuntimeError("fixture-failure")

    class _Agent:
        def __init__(self, **_kwargs):
            raise RuntimeError("fixture-failure")

    endpoint = _endpoint(create_app(), "/api/agent_task", "POST")

    import tehuti_cli.agentic as agentic_module
    import tehuti_cli.web.app as web_app_module

    original_agent = agentic_module.TehutiAgent
    original_factory = web_app_module._create_agent_for_web
    try:
        agentic_module.TehutiAgent = _Agent
        web_app_module._create_agent_for_web = lambda **kwargs: _Agent(**kwargs)
        wire_payload = _process_wire_payload(_Client(), {"prompt": prompt}, app=TehutiApp(config=default_config()))
        cli_payload = _process_cli_prompt_envelope(TehutiApp(config=default_config()), prompt, work_dir=ROOT)
        web_payload = endpoint({"task": prompt})
    finally:
        agentic_module.TehutiAgent = original_agent
        web_app_module._create_agent_for_web = original_factory

    shell = Shell.__new__(Shell)
    shell.config = default_config()

    class _Session:
        id = "s-interactive"

        def __init__(self):
            self.payloads: list[dict[str, object]] = []

        def append_wire(self, payload: dict[str, object]) -> None:
            self.payloads.append(payload)

    shell.session = _Session()
    shell.console = type("_Console", (), {"print": lambda *args, **kwargs: None})()
    shell._emit_interactive_envelope(
        prompt,
        "",
        actions=[],
        status="failed",
        error="fixture-failure",
        error_payload={
            "category": "internal",
            "code": "unclassified_error",
            "error": "fixture-failure",
            "retryable": False,
            "details": {},
        },
    )
    interactive_payload = shell.session.payloads[0]

    return {
        "cli": _normalize_cli(cli_payload),
        "cli_interactive": _normalize_cli_interactive(interactive_payload),
        "wire": _normalize_wire(wire_payload),
        "web": _normalize_web(web_payload),
    }


def run_degraded_fixture(prompt: str = "conformance-fixture-degraded") -> dict[str, dict[str, object]]:
    shell = Shell.__new__(Shell)
    shell.config = default_config()

    class _Session:
        id = "s-interactive"

        def __init__(self):
            self.payloads: list[dict[str, object]] = []

        def append_wire(self, payload: dict[str, object]) -> None:
            self.payloads.append(payload)

    shell.session = _Session()
    shell.console = type("_Console", (), {"print": lambda *args, **kwargs: None})()
    shell._emit_interactive_envelope(
        prompt,
        "provider unavailable; local evidence demo executed",
        actions=[{"tool": "shell", "args": {"command": "pwd"}, "ok": True}],
        status="success",
        termination_reason="provider_failure_recovered",
        has_error=False,
    )
    return {"cli_interactive": _normalize_cli_interactive(shell.session.payloads[0])}


def main() -> int:
    results = run_fixture()
    failures = run_failure_fixture()
    degraded = run_degraded_fixture()
    print(json.dumps({"success": results, "failure": failures, "degraded": degraded}, indent=2))
    responses = {
        results["cli"]["response"],
        results["cli_interactive"]["response"],
        results["wire"]["response"],
        results["web"]["response"],
    }
    if len(responses) != 1:
        print("surface conformance: FAILED (response mismatch)")
        return 1
    if (
        results["cli"]["status"] != "success"
        or results["cli_interactive"]["status"] != "success"
        or results["wire"]["status"] != "success"
        or results["web"]["status"] != "success"
    ):
        print("surface conformance: FAILED (status mismatch)")
        return 1
    if not results["cli_interactive"].get("has_ids") or not results["wire"].get("has_ids") or not results["web"].get("has_ids"):
        print("surface conformance: FAILED (missing trace/turn identifiers)")
        return 1
    reasons = {
        results["cli"]["termination_reason"],
        results["cli_interactive"]["termination_reason"],
        results["wire"]["termination_reason"],
        results["web"]["termination_reason"],
    }
    if len(reasons) != 1:
        print("surface conformance: FAILED (termination reason mismatch)")
        return 1
    event_orders = {tuple(results["cli"]["event_order"]), tuple(results["wire"]["event_order"]), tuple(results["web"]["event_order"])}
    if len(event_orders) != 1:
        print("surface conformance: FAILED (event order mismatch)")
        return 1
    activity_counts = {
        results["cli"].get("activity_count"),
        results["wire"].get("activity_count"),
        results["web"].get("activity_count"),
    }
    if len(activity_counts) != 1:
        print("surface conformance: FAILED (activity count mismatch)")
        return 1
    interactive_events = tuple(results["cli_interactive"]["event_order"])
    if interactive_events != ("iteration_start", "tool_start", "tool_end", "loop_terminated"):
        print("surface conformance: FAILED (interactive event order mismatch)")
        return 1
    failure_statuses = {
        failures["cli"]["status"],
        failures["cli_interactive"]["status"],
        failures["wire"]["status"],
        failures["web"]["status"],
    }
    if failure_statuses != {"failed"}:
        print("surface conformance: FAILED (failure status mismatch)")
        return 1
    failure_codes = {
        failures["cli"]["error_code"],
        failures["cli_interactive"]["error_code"],
        failures["wire"]["error_code"],
        failures["web"]["error_code"],
    }
    if len(failure_codes) != 1:
        print("surface conformance: FAILED (failure code mismatch)")
        return 1
    failure_categories = {
        failures["cli"]["error_category"],
        failures["cli_interactive"]["error_category"],
        failures["wire"]["error_category"],
        failures["web"]["error_category"],
    }
    if len(failure_categories) != 1:
        print("surface conformance: FAILED (failure category mismatch)")
        return 1
    failure_retryable = {
        failures["cli"]["retryable"],
        failures["cli_interactive"]["retryable"],
        failures["wire"]["retryable"],
        failures["web"]["retryable"],
    }
    if len(failure_retryable) != 1:
        print("surface conformance: FAILED (failure retryable mismatch)")
        return 1
    degraded_interactive = degraded.get("cli_interactive", {})
    if not isinstance(degraded_interactive, dict):
        print("surface conformance: FAILED (degraded interactive payload missing)")
        return 1
    if degraded_interactive.get("status") != "success":
        print("surface conformance: FAILED (degraded status mismatch)")
        return 1
    if degraded_interactive.get("termination_reason") != "provider_failure_recovered":
        print("surface conformance: FAILED (degraded termination reason mismatch)")
        return 1
    if degraded_interactive.get("degraded") is not True:
        print("surface conformance: FAILED (degraded flag mismatch)")
        return 1
    if tuple(degraded_interactive.get("event_order") or ()) != (
        "iteration_start",
        "tool_start",
        "tool_end",
        "loop_terminated",
    ):
        print("surface conformance: FAILED (degraded event order mismatch)")
        return 1
    if (
        degraded_interactive.get("error_category") is not None
        or degraded_interactive.get("error_code") is not None
        or degraded_interactive.get("retryable") is not None
    ):
        print("surface conformance: FAILED (degraded error projection mismatch)")
        return 1
    print("surface conformance: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
