#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
from typing import Annotated

import sys
import typer
import uuid
import json
import time

from tehuti_cli.constants import PROGRESS_VERBOSITY_VALUES
from tehuti_cli.core.errors import to_error_payload
from tehuti_cli.core.phase_stream import phase_should_render, project_phase_event_from_progress
from tehuti_cli.core.preflight import run_preflight
from tehuti_cli.core.telemetry import get_telemetry
from tehuti_cli.core.app import TehutiApp
from tehuti_cli.storage.config import default_config
from tehuti_cli.storage.session import load_last_session, create_session


cli = typer.Typer(
    help="Project Tehuti: Thoth (Tehuti), Architect of Truth.",
    add_completion=False,
    context_settings={"help_option_names": ["-h", "--help"]},
)


def _wire_error_payload(
    *,
    code: str,
    message: str,
    category: str,
    retryable: bool = False,
    details: dict[str, object] | None = None,
) -> dict[str, object]:
    return {
        "category": category,
        "code": code,
        "message": message,
        "retryable": retryable,
        "details": details or {},
    }


def _extract_tool_contracts(events: list[dict[str, object]]) -> list[dict[str, object]]:
    contracts: list[dict[str, object]] = []
    for event in events:
        if event.get("event") != "tool_end":
            continue
        trace_id = event.get("trace_id")
        contract_schema = event.get("contract_schema")
        if not trace_id and not contract_schema:
            continue
        contracts.append(
            {
                "tool": event.get("tool"),
                "success": bool(event.get("success")),
                "trace_id": trace_id,
                "contract_schema": contract_schema,
                "error_payload": event.get("error_payload"),
            }
        )
    return contracts


def _project_activity_event(event: dict[str, object], *, surface: str) -> dict[str, object] | None:
    if event.get("event") != "tool_end":
        return None
    tool = str(event.get("tool", "") or "").strip()
    if not tool:
        return None
    success = bool(event.get("success"))
    raw_detail = str(event.get("result") or event.get("error") or "").strip()
    detail = raw_detail.splitlines()[0].strip() if raw_detail else ""
    if len(detail) > 120:
        detail = detail[:117] + "..."
    if success:
        summary = f"Executed `{tool}`"
        if detail:
            summary = f"{summary} -> {detail}"
    else:
        summary = f"Failed `{tool}`"
        if detail:
            summary = f"{summary}: {detail}"
    return {
        "schema": "tehuti.activity.v1",
        "event_version": "v1",
        "event": "activity",
        "surface": surface,
        "tool": tool,
        "success": success,
        "summary": summary,
        "trace_id": event.get("trace_id"),
        "contract_schema": event.get("contract_schema"),
    }


def _extract_activity_events(events: list[dict[str, object]], *, surface: str) -> list[dict[str, object]]:
    activity: list[dict[str, object]] = []
    for event in events:
        projected = _project_activity_event(event, surface=surface)
        if projected:
            activity.append(projected)
    return activity


def _process_wire_payload(client: object, payload: dict[str, object], app: TehutiApp | None = None) -> dict[str, object]:
    import time
    from datetime import datetime
    from tehuti_cli.agentic import TehutiAgent

    trace_id = str(uuid.uuid4())[:12]
    turn_id = str(uuid.uuid4())[:12]
    mode = str(payload.get("mode", "")).strip().lower()
    if not mode:
        mode = "agent_task" if str(payload.get("task", "")).strip() else "prompt"
    work_dir = Path(payload.get("work_dir") or Path.cwd())
    verbosity = str(payload.get("progress_verbosity", "standard") or "standard").strip().lower()
    if verbosity not in PROGRESS_VERBOSITY_VALUES:
        verbosity = "standard"
    phase_stream_enabled = bool(payload.get("phase_stream", True))
    stream_phase = bool(payload.get("stream_phase", False))
    cfg = app.config if app else default_config()
    bootstrap = run_preflight(cfg, work_dir, include_tool_registry=False).to_dict()
    persist = bool(payload.get("persist", False))
    session = None
    if persist:
        requested_session_id = str(payload.get("session_id", "")).strip()
        if requested_session_id:
            session = create_session(work_dir, session_id=requested_session_id)
        else:
            session = load_last_session(work_dir) or create_session(work_dir)
    text = str(payload.get("task" if mode == "agent_task" else "prompt", "")).strip()
    if not text:
        missing_code = "missing_task" if mode == "agent_task" else "missing_prompt"
        return {
            "schema": "tehuti.wire.v1",
            "status": "failed",
            "trace_id": trace_id,
            "turn_id": turn_id,
            "session_id": session.id if session else None,
            "mode": mode,
            "bootstrap": bootstrap,
            "error": _wire_error_payload(
                code=missing_code,
                message="Task is required" if mode == "agent_task" else "Prompt is required",
                category="validation",
                details={"mode": mode},
            ),
        }

    started = time.perf_counter()
    try:
        if mode == "agent_task":
            if app is None:
                return {
                    "schema": "tehuti.wire.v1",
                    "status": "failed",
                    "trace_id": trace_id,
                    "turn_id": turn_id,
                    "session_id": session.id if session else None,
                    "bootstrap": bootstrap,
                    "error": _wire_error_payload(
                        code="wire_agent_requires_app",
                        message="Wire agent_task mode requires app context",
                        category="internal",
                    ),
                }
            events: list[dict[str, object]] = []
            phase_events: list[dict[str, object]] = []

            progress_sequence = 0
            phase_sequence = 0
            stream_sequence = 0

            def on_progress(_event: str, data: dict[str, object]) -> None:
                nonlocal progress_sequence, phase_sequence, stream_sequence
                events.append(data)
                progress_sequence += 1
                progress_event = {
                    "schema": "tehuti.wire.progress.v1",
                    "status": "in_progress",
                    "trace_id": trace_id,
                    "turn_id": turn_id,
                    "session_id": session.id if session else None,
                    "mode": mode,
                    "sequence": progress_sequence,
                    "timestamp": datetime.now().isoformat(),
                    "event": data,
                }
                emitter = payload.get("_wire_progress_emitter")
                if callable(emitter):
                    emitter(progress_event)
                if session:
                    session.append_wire(progress_event)
                activity_event = _project_activity_event(data, surface="wire")
                if activity_event is not None:
                    progress_sequence += 1
                    activity_stream_event = {
                        "schema": "tehuti.wire.progress.v1",
                        "status": "in_progress",
                        "trace_id": trace_id,
                        "turn_id": turn_id,
                        "session_id": session.id if session else None,
                        "mode": mode,
                        "sequence": progress_sequence,
                        "timestamp": datetime.now().isoformat(),
                        "event": activity_event,
                    }
                    if callable(emitter):
                        emitter(activity_stream_event)
                    if session:
                        session.append_wire(activity_stream_event)
                if phase_stream_enabled:
                    phase_sequence += 1
                    phase_event = project_phase_event_from_progress(
                        _event,
                        data,
                        sequence=phase_sequence,
                        session_id=session.id if session else None,
                        surface="wire",
                    )
                    if phase_should_render(
                        verbosity,
                        str(phase_event.get("phase", "")),
                        str(phase_event.get("status", "progress")),
                    ):
                        phase_events.append(phase_event)
                        if stream_phase:
                            stream_sequence += 1
                            phase_stream_event = {
                                "schema": "tehuti.wire.progress.v1",
                                "status": "in_progress",
                                "trace_id": trace_id,
                                "turn_id": turn_id,
                                "session_id": session.id if session else None,
                                "mode": mode,
                                "sequence": stream_sequence,
                                "timestamp": datetime.now().isoformat(),
                                "event": phase_event,
                            }
                            if callable(emitter):
                                emitter(phase_stream_event)
                            if session:
                                session.append_wire(phase_stream_event)

            agent = TehutiAgent(
                config=app.config,
                work_dir=work_dir,
                enable_memory=True,
                enable_tracing=True,
                progress_callback=on_progress,
            )
            result = agent.execute_task(
                task_description=text,
                max_iterations=int(payload.get("max_iterations", 10) or 10),
            )
            response = result.get("response")
            tool_contracts = _extract_tool_contracts(events)
            activity_events = _extract_activity_events(events, surface="wire")
            result_payload: dict[str, object] = {
                "response": response,
                "agent_task": result,
                "events": events,
                "phase_events": phase_events,
                "tool_contracts": tool_contracts,
                "activity_events": activity_events,
            }
            if session:
                session.append_context("user", text)
                session.append_context("assistant", str(response or ""))
        else:
            response = client.chat_messages([{"role": "user", "content": text}])
            result_payload = {
                "response": response,
                "events": [],
                "phase_events": [],
                "tool_contracts": [],
                "activity_events": [],
            }
            if session:
                session.append_context("user", text)
                session.append_context("assistant", str(response or ""))

        get_telemetry().record_surface_result(
            surface="wire",
            success=True,
            latency_ms=int((time.perf_counter() - started) * 1000),
            trace_id=trace_id,
            turn_id=turn_id,
        )
        final_payload = {
            "schema": "tehuti.wire.v1",
            "status": "success",
            "trace_id": trace_id,
            "turn_id": turn_id,
            "session_id": session.id if session else None,
            "mode": mode,
            "bootstrap": bootstrap,
            "result": result_payload,
        }
        if session:
            session.append_wire(final_payload)
        return final_payload
    except Exception as exc:
        latency_ms = int((time.perf_counter() - started) * 1000)
        error = to_error_payload(exc)
        get_telemetry().record_surface_result(
            surface="wire",
            success=False,
            latency_ms=latency_ms,
            error_code=str(error.get("code", "unclassified_error")),
            trace_id=trace_id,
            turn_id=turn_id,
            retryable=bool(error.get("retryable", False)),
            details=dict(error.get("details", {})) if isinstance(error.get("details"), dict) else {},
        )
        failure_payload = {
            "schema": "tehuti.wire.v1",
            "status": "failed",
            "trace_id": trace_id,
            "turn_id": turn_id,
            "session_id": session.id if session else None,
            "mode": mode,
            "bootstrap": bootstrap,
            "error": _wire_error_payload(
                code=str(error.get("code", "unclassified_error")),
                message=str(error.get("error", str(exc))),
                category=str(error.get("category", "internal")),
                retryable=bool(error.get("retryable", False)),
                details=dict(error.get("details", {})) if isinstance(error.get("details"), dict) else {},
            ),
        }
        if session:
            session.append_wire(failure_payload)
        return failure_payload


def _process_cli_prompt_envelope(
    app: TehutiApp,
    prompt: str,
    *,
    work_dir: Path | None = None,
    max_iterations: int = 10,
) -> dict[str, object]:
    from tehuti_cli.agentic import TehutiAgent

    wd = work_dir or Path.cwd()
    trace_id = str(uuid.uuid4())[:12]
    turn_id = str(uuid.uuid4())[:12]
    events: list[dict[str, object]] = []
    tool_contracts: list[dict[str, object]] = []
    activity_events: list[dict[str, object]] = []
    preflight_report = run_preflight(app.config, wd, include_tool_registry=False)
    started = time.perf_counter()

    def on_progress(_event: str, data: dict[str, object]) -> None:
        events.append(data)
        tool_contracts[:] = _extract_tool_contracts(events)
        activity_events[:] = _extract_activity_events(events, surface="cli_prompt")

    try:
        preflight_report.ensure_ok()
        agent = TehutiAgent(
            config=app.config,
            work_dir=wd,
            enable_memory=True,
            enable_tracing=True,
            progress_callback=on_progress,
        )
        result = agent.execute_task(task_description=prompt, max_iterations=max_iterations)
        payload = {
            "schema": "tehuti.cli.prompt.v1",
            "status": "success" if result.get("success") else "failed",
            "bootstrap": preflight_report.to_dict(),
            "result": result,
            "events": events,
            "tool_contracts": tool_contracts,
            "activity_events": activity_events,
        }
        get_telemetry().record_surface_result(
            surface="cli_prompt",
            success=payload["status"] == "success",
            latency_ms=int((time.perf_counter() - started) * 1000),
            error_code=None if payload["status"] == "success" else str(result.get("error") or "agent_task_failed"),
            trace_id=trace_id,
            turn_id=turn_id,
        )
        return payload
    except Exception as exc:
        error = to_error_payload(exc)
        get_telemetry().record_surface_result(
            surface="cli_prompt",
            success=False,
            latency_ms=int((time.perf_counter() - started) * 1000),
            error_code=str(error.get("code", "unclassified_error")),
            trace_id=trace_id,
            turn_id=turn_id,
            retryable=bool(error.get("retryable", False)),
            details=dict(error.get("details", {})) if isinstance(error.get("details"), dict) else {},
        )
        payload = to_error_payload(exc)
        payload["schema"] = "tehuti.cli.prompt.v1"
        payload["status"] = "failed"
        payload["bootstrap"] = preflight_report.to_dict()
        payload["events"] = events
        payload["tool_contracts"] = tool_contracts
        payload["activity_events"] = activity_events
        return payload


@cli.callback(invoke_without_command=True)
def main(
    ctx: typer.Context,
    config_file: Annotated[
        Path | None,
        typer.Option(
            "--config-file",
            exists=True,
            file_okay=True,
            dir_okay=False,
            readable=True,
            help="Config TOML file to load. Default: ~/.tehuti/config.toml.",
        ),
    ] = None,
    model: Annotated[
        str | None,
        typer.Option(
            "--model",
            "-m",
            help="Model to use. Overrides config.",
        ),
    ] = None,
    prompt: Annotated[
        str | None,
        typer.Option(
            "--prompt",
            "-p",
            help="Run a single prompt and exit (print mode).",
        ),
    ] = None,
    banner: Annotated[
        bool,
        typer.Option(
            "--banner",
            help="Show the animated banner on startup.",
        ),
    ] = True,
    print_mode: Annotated[
        bool,
        typer.Option(
            "--print",
            help="Run in print mode (non-interactive).",
        ),
    ] = False,
    envelope: Annotated[
        bool,
        typer.Option(
            "--envelope",
            help="Emit stable JSON envelope for non-interactive prompt execution.",
        ),
    ] = False,
    resume: Annotated[
        bool,
        typer.Option(
            "--resume",
            help="Resume the last session for this working directory.",
        ),
    ] = False,
    session_id: Annotated[
        str | None,
        typer.Option(
            "--session-id",
            help="Resume a specific session by ID.",
        ),
    ] = None,
):
    if ctx.invoked_subcommand is not None:
        return

    try:
        app = TehutiApp.create(config_file=config_file, model=model)
    except Exception as exc:
        print(to_error_payload(exc))
        raise typer.Exit(code=1)

    try:
        if prompt is not None:
            if envelope:
                payload = _process_cli_prompt_envelope(app, prompt)
                print(json.dumps(payload))
                raise typer.Exit(code=0 if payload.get("status") == "success" else 1)
            raise typer.Exit(code=app.run_print(prompt))
        if print_mode:
            stdin_text = sys.stdin.read()
            if not stdin_text.strip():
                raise typer.Exit(code=0)
            if envelope:
                payload = _process_cli_prompt_envelope(app, stdin_text)
                print(json.dumps(payload))
                raise typer.Exit(code=0 if payload.get("status") == "success" else 1)
            raise typer.Exit(code=app.run_print(stdin_text))

        work_dir = Path.cwd()
        raise typer.Exit(code=app.run_shell(work_dir, show_banner=banner, resume=resume, session_id=session_id))
    except typer.Exit:
        raise
    except Exception as exc:
        print(to_error_payload(exc))
        raise typer.Exit(code=1)


@cli.command()
def resume(session_id: str | None = typer.Option(None, help="Specific session ID (optional)")) -> None:
    """Resume a previous Tehuti session."""
    app = TehutiApp.create()
    work_dir = Path.cwd()
    if session_id is None:
        last = load_last_session(work_dir)
        if not last:
            raise typer.Exit(code=app.run_shell(work_dir, show_banner=False, resume=False))
        raise typer.Exit(code=app.run_shell(work_dir, show_banner=False, resume=True))
    raise typer.Exit(code=app.run_shell(work_dir, show_banner=False, session_id=session_id))


@cli.command()
def web(
    host: str = typer.Option("127.0.0.1", help="Host to bind"),
    port: int = typer.Option(5494, help="Port to bind"),
) -> None:
    """Run the Tehuti web UI."""
    from tehuti_cli.web.app import create_app
    import uvicorn

    uvicorn.run(create_app(), host=host, port=port)


@cli.command()
def wire() -> None:
    """Run a minimal wire server over stdio (JSON lines)."""
    import json

    app = TehutiApp.create()
    llm = app.config
    from tehuti_cli.providers.llm import TehutiLLM

    client = TehutiLLM(llm)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            print(json.dumps({"error": "invalid_json"}))
            continue
        if "persist" not in payload:
            payload["persist"] = True
        stream_progress = bool(payload.get("stream", False))
        if stream_progress:
            payload["_wire_progress_emitter"] = lambda event: print(json.dumps(event), flush=True)
        result = _process_wire_payload(client, payload, app=app)
        payload.pop("_wire_progress_emitter", None)
        print(json.dumps(result))


@cli.command()
def acp() -> None:
    """Run a minimal ACP-compatible stdio server (alias of wire)."""
    wire()


@cli.command(name="tools")
def check_tools() -> None:
    """Check availability of external tools."""
    import sys

    sys.path.insert(0, "src")
    from tehuti_cli.tool_availability import ToolAvailability

    print(ToolAvailability.format_status())


@cli.command(name="lint-tools")
def lint_tools() -> None:
    """Lint tool metadata contract coverage."""
    from tehuti_cli.core.tool_contract_linter import lint_tool_registry
    from tehuti_cli.core.tools import ToolRegistry
    from tehuti_cli.storage.config import default_config

    registry = ToolRegistry(default_config())
    errors = lint_tool_registry(registry)
    if not errors:
        print("tool metadata lint: OK")
        raise typer.Exit(code=0)
    for err in errors:
        print(err)
    raise typer.Exit(code=1)


@cli.command(name="doctor")
def doctor() -> None:
    """Run diagnostics and check system health."""
    import sys

    sys.path.insert(0, "src")
    from tehuti_cli.storage.config import load_config
    from tehuti_cli.tool_availability import ToolAvailability

    print("Tehuti System Diagnostics")
    print("=" * 50)
    print()

    config = None
    work_dir = Path.cwd()

    # Check config and preflight
    try:
        config = load_config()
        report = run_preflight(config, work_dir, include_tool_registry=True)
        print("✓ Preflight report generated")
        print(f"  Provider: {config.provider.type}")
        print(f"  Model: {config.provider.model}")
        print(f"  Access policy: {config.access_policy}")
        print(f"  YOLO mode: {config.default_yolo}")
        for check in report.checks:
            symbol = "✓" if check.ok else ("!" if check.severity == "warning" else "✗")
            print(f"  {symbol} {check.name}: {check.detail}")
    except Exception as e:
        print(f"✗ Configuration error: {e}")

    print()

    # Check external tools
    print(ToolAvailability.format_status())

    print()
    print("=" * 50)
    print("Diagnostics complete")


if __name__ == "__main__":
    raise SystemExit(cli())
