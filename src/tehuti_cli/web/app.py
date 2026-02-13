from __future__ import annotations

from pathlib import Path
from typing import Any
import uuid
import time

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.responses import PlainTextResponse

from tehuti_cli.constants import PROGRESS_VERBOSITY_VALUES
from tehuti_cli.core.errors import to_error_payload
from tehuti_cli.core.phase_stream import phase_should_render, project_phase_event_from_progress
from tehuti_cli.core.preflight import run_preflight
from tehuti_cli.core.telemetry import get_telemetry
from tehuti_cli.providers.llm import TehutiLLM
from tehuti_cli.storage.config import load_config, save_config
from tehuti_cli.storage.session import create_session, load_last_session


def _create_agent_for_web(*, config, work_dir: Path, session_id: str, progress_callback):
    from tehuti_cli.agentic import TehutiAgent

    return TehutiAgent(
        config=config,
        work_dir=work_dir,
        enable_memory=True,
        enable_tracing=True,
        session_id=session_id,
        progress_callback=progress_callback,
    )


def _should_include_progress_event(verbosity: str, event: str) -> bool:
    if verbosity == "minimal" and event in {"iteration_start", "thought", "tool_start"}:
        return False
    if verbosity == "standard" and event == "thought":
        return False
    return True


def _extract_tool_contracts(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    contracts: list[dict[str, Any]] = []
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


def _extract_activity_events(events: list[dict[str, Any]], *, surface: str) -> list[dict[str, Any]]:
    activity: list[dict[str, Any]] = []
    for event in events:
        if event.get("event") != "tool_end":
            continue
        tool = str(event.get("tool", "") or "").strip()
        if not tool:
            continue
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
        activity.append(
            {
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
        )
    return activity


def _surface_error_envelope(
    schema: str,
    exc: Exception,
    *,
    code: str | None = None,
    category: str | None = None,
    trace_id: str | None = None,
    turn_id: str | None = None,
) -> dict[str, Any]:
    payload = to_error_payload(exc)
    err_code = code or str(payload.get("code", "unclassified_error"))
    err_category = category or str(payload.get("category", "internal"))
    return {
        "schema": schema,
        "status": "failed",
        "trace_id": trace_id,
        "turn_id": turn_id,
        "error": {
            "category": err_category,
            "code": err_code,
            "message": str(payload.get("error", str(exc))),
            "retryable": bool(payload.get("retryable", False)),
            "details": payload.get("details", {}) if isinstance(payload.get("details"), dict) else {},
        },
    }


def create_app() -> FastAPI:
    app = FastAPI(title="Project Tehuti Web")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/")
    def index() -> HTMLResponse:
        html = """
        <html>
        <head>
          <title>Project Tehuti</title>
          <style>
            body { background:#0b0b0d; color:#d4af37; font-family: ui-monospace, monospace; }
            .wrap { max-width: 900px; margin: 30px auto; padding: 20px; }
            textarea { width:100%; height:120px; background:#121214; color:#f4e7c5; border:1px solid #d4af37; }
            button { background:#d4af37; color:#0b0b0d; padding:8px 16px; border:none; cursor:pointer; }
            select { background:#121214; color:#f4e7c5; border:1px solid #d4af37; }
            pre { background:#121214; padding:12px; white-space:pre-wrap; }
          </style>
        </head>
        <body>
          <div class="wrap">
            <h1>Project Tehuti</h1>
            <div>
              <label>Provider</label>
              <select id="provider">
                <option value="openrouter">openrouter</option>
                <option value="openai">openai</option>
                <option value="gemini">gemini</option>
              </select>
              <label>Model</label>
              <select id="model"></select>
              <button id="refresh">Refresh Models</button>
            </div>
            <p></p>
            <textarea id="prompt" placeholder="Decree..."></textarea>
            <p><button id="send">Send</button></p>
            <pre id="out"></pre>
          </div>
          <script>
            async function loadConfig() {
              const res = await fetch('/api/config');
              const cfg = await res.json();
              document.getElementById('provider').value = cfg.provider;
            }
            async function loadModels() {
              const provider = document.getElementById('provider').value;
              const res = await fetch('/api/models?provider=' + provider);
              const data = await res.json();
              const modelSel = document.getElementById('model');
              modelSel.innerHTML = '';
              for (const m of data.data) {
                const id = m.id || m.name || m.model || '';
                if (!id) continue;
                const opt = document.createElement('option');
                opt.value = id;
                opt.textContent = id;
                modelSel.appendChild(opt);
              }
            }
            async function sendPrompt() {
              const prompt = document.getElementById('prompt').value;
              const provider = document.getElementById('provider').value;
              const model = document.getElementById('model').value;
              await fetch('/api/config', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({provider, model})});
              const res = await fetch('/api/prompt', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({prompt})});
              const data = await res.json();
              document.getElementById('out').textContent = data.response || '';
            }
            document.getElementById('send').addEventListener('click', sendPrompt);
            document.getElementById('refresh').addEventListener('click', loadModels);
            loadConfig().then(loadModels);
          </script>
        </body>
        </html>
        """
        return HTMLResponse(html)

    @app.get("/api/models")
    def models(refresh: bool = False, provider: str | None = None) -> dict[str, Any]:
        cfg = load_config()
        if provider:
            cfg.provider.type = provider
        llm = TehutiLLM(cfg)
        return {"data": llm.list_models(refresh=refresh)}

    @app.get("/api/providers")
    def providers(refresh: bool = False) -> dict[str, Any]:
        cfg = load_config()
        llm = TehutiLLM(cfg)
        return {"data": llm.list_providers(refresh=refresh)}

    @app.post("/api/prompt")
    def prompt(payload: dict[str, Any]) -> dict[str, Any]:
        trace_id = str(uuid.uuid4())[:12]
        turn_id = str(uuid.uuid4())[:12]
        started = time.perf_counter()
        try:
            text = str(payload.get("prompt", ""))
            work_dir = Path(payload.get("work_dir") or Path.cwd())
            session = load_last_session(work_dir) or create_session(work_dir)
            cfg = load_config()
            preflight = run_preflight(cfg, work_dir, include_tool_registry=False)
            preflight.ensure_ok()
            llm = TehutiLLM(cfg)
            response = llm.chat_messages([{"role": "user", "content": text}])
            session.append_context("user", text)
            session.append_context("assistant", response)
            response_payload = {
                "schema": "tehuti.web.prompt.v1",
                "status": "success",
                "trace_id": trace_id,
                "turn_id": turn_id,
                "bootstrap": preflight.to_dict(),
                "session_id": session.id,
                "result": {"response": response},
                "tool_contracts": [],
            }
            get_telemetry().record_surface_result(
                surface="web_prompt",
                success=True,
                latency_ms=int((time.perf_counter() - started) * 1000),
                trace_id=trace_id,
                turn_id=turn_id,
            )
            return response_payload
        except Exception as exc:
            payload = _surface_error_envelope(
                "tehuti.web.prompt.v1",
                exc,
                trace_id=trace_id,
                turn_id=turn_id,
            )
            get_telemetry().record_surface_result(
                surface="web_prompt",
                success=False,
                latency_ms=int((time.perf_counter() - started) * 1000),
                error_code=str((payload.get("error") or {}).get("code", "unclassified_error")),
                trace_id=trace_id,
                turn_id=turn_id,
                retryable=bool((payload.get("error") or {}).get("retryable", False)),
                details=(payload.get("error") or {}).get("details", {}),
            )
            return payload

    @app.post("/api/agent_task")
    def agent_task(payload: dict[str, Any]) -> dict[str, Any]:
        trace_id = str(uuid.uuid4())[:12]
        turn_id = str(uuid.uuid4())[:12]
        started = time.perf_counter()
        try:
            task = str(payload.get("task", "")).strip()
            if not task:
                return _surface_error_envelope(
                    "tehuti.web.agent_task.v1",
                    RuntimeError("Task is required"),
                    code="missing_task",
                    category="validation",
                    trace_id=trace_id,
                    turn_id=turn_id,
                )
            max_iterations = int(payload.get("max_iterations", 10) or 10)
            verbosity = str(payload.get("progress_verbosity", "standard") or "standard").strip().lower()
            if verbosity not in PROGRESS_VERBOSITY_VALUES:
                verbosity = "standard"

            work_dir = Path(payload.get("work_dir") or Path.cwd())
            session = load_last_session(work_dir) or create_session(work_dir)
            cfg = load_config()
            parser_mode = str(payload.get("parser_mode", "") or "").strip().lower()
            if parser_mode not in {"strict", "repair", "fallback"}:
                parser_mode = str(getattr(cfg, "agent_parser_mode", "repair"))
            preflight = run_preflight(cfg, work_dir, include_tool_registry=False)
            preflight.ensure_ok()
            cfg.progress_verbosity = verbosity  # type: ignore[assignment]
            cfg.agent_parser_mode = parser_mode  # type: ignore[assignment]

            progress_events: list[dict[str, Any]] = []
            phase_events: list[dict[str, Any]] = []
            phase_sequence = 0

            def on_progress(event: str, data: dict[str, Any]) -> None:
                nonlocal phase_sequence
                if not _should_include_progress_event(verbosity, event):
                    return
                progress_events.append(data)
                phase_sequence += 1
                phase_event = project_phase_event_from_progress(
                    event,
                    data,
                    sequence=phase_sequence,
                    session_id=session.id,
                    surface="web_agent_task",
                )
                if phase_should_render(
                    verbosity,
                    str(phase_event.get("phase", "")),
                    str(phase_event.get("status", "progress")),
                ):
                    phase_events.append(phase_event)

            agent = _create_agent_for_web(
                config=cfg,
                work_dir=work_dir,
                session_id=session.id,
                progress_callback=on_progress,
            )
            result = agent.execute_task(task_description=task, max_iterations=max_iterations)
            tool_contracts = _extract_tool_contracts(progress_events)
            activity_events = _extract_activity_events(progress_events, surface="web_agent_task")
            response_payload = {
                "schema": "tehuti.web.agent_task.v1",
                "status": "success" if result.get("success") else "failed",
                "trace_id": trace_id,
                "turn_id": turn_id,
                "bootstrap": preflight.to_dict(),
                "session_id": session.id,
                "result": result,
                "events": progress_events,
                "phase_events": phase_events,
                "tool_contracts": tool_contracts,
                "activity_events": activity_events,
            }
            get_telemetry().record_surface_result(
                surface="web_agent_task",
                success=response_payload["status"] == "success",
                latency_ms=int((time.perf_counter() - started) * 1000),
                error_code=None
                if response_payload["status"] == "success"
                else str(result.get("error") or "agent_task_failed"),
                trace_id=trace_id,
                turn_id=turn_id,
            )
            return response_payload
        except Exception as exc:
            response_payload = _surface_error_envelope(
                "tehuti.web.agent_task.v1",
                exc,
                trace_id=trace_id,
                turn_id=turn_id,
            )
            get_telemetry().record_surface_result(
                surface="web_agent_task",
                success=False,
                latency_ms=int((time.perf_counter() - started) * 1000),
                error_code=str((response_payload.get("error") or {}).get("code", "unclassified_error")),
                trace_id=trace_id,
                turn_id=turn_id,
                retryable=bool((response_payload.get("error") or {}).get("retryable", False)),
                details=(response_payload.get("error") or {}).get("details", {}),
            )
            return response_payload

    @app.get("/api/metrics")
    def metrics_json() -> dict[str, Any]:
        return get_telemetry().snapshot()

    @app.get("/api/metrics/diagnostics")
    def metrics_diagnostics(trace_id: str | None = None, error_code: str | None = None, limit: int = 50) -> dict[str, Any]:
        return get_telemetry().diagnostics_view(trace_id=trace_id, error_code=error_code, limit=limit)

    @app.get("/metrics")
    def metrics_prometheus() -> PlainTextResponse:
        return PlainTextResponse(get_telemetry().to_prometheus())

    @app.get("/api/config")
    def get_config() -> dict[str, Any]:
        cfg = load_config()
        return {
            "provider": cfg.provider.type,
            "model": cfg.provider.model,
            "openrouter_provider_order": cfg.openrouter.provider_order,
            "agent_parser_mode": cfg.agent_parser_mode,
        }

    @app.post("/api/config")
    def set_config(payload: dict[str, Any]) -> dict[str, Any]:
        cfg = load_config()
        provider = payload.get("provider")
        model = payload.get("model")
        parser_mode = payload.get("agent_parser_mode")
        if provider:
            cfg.provider.type = str(provider)
        if model:
            cfg.provider.model = str(model)
        if parser_mode and str(parser_mode) in {"strict", "repair", "fallback"}:
            cfg.agent_parser_mode = str(parser_mode)  # type: ignore[assignment]
        save_config(cfg)
        return {"ok": True}

    return app
