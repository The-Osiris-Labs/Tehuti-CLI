from __future__ import annotations

from typing import Any
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from tehuti_cli.core.tools import ToolSpec


PHASE_STREAM_SCHEMA = "tehuti.phase_stream.v1"
PHASE_STREAM_EVENT_VERSION = "v1"
PHASE_STREAM_SURFACE = "cli_interactive"

PHASE_STATUS_VALUES = {"progress", "done", "error", "skipped"}
PHASE_VERBOSITY_VALUES = {"minimal", "standard", "verbose"}

_READ_TOOL_PREFIXES = (
    "read",
    "find",
    "grep",
    "glob",
    "search_",
    "context_",
    "extract_",
    "list_",
    "mcp_list_",
    "task_get",
    "task_stats",
    "task_schedulable",
    "task_blocked",
    "blueprint_get",
    "blueprint_list",
    "automation_get",
    "automation_list",
    "automation_stats",
    "delegate_get",
    "delegate_list",
    "delegate_tree",
)

_WRITE_TOOL_PREFIXES = (
    "write",
    "edit",
    "stream_",
    "tool_create_",
    "tool_edit",
    "tool_delete",
    "tool_import",
    "tool_clone",
    "task_create",
    "task_update",
    "task_add_dep",
    "blueprint_create",
    "blueprint_add_section",
    "automation_create",
    "automation_add_",
    "delegate_create",
    "delegate_cancel",
)

_EXEC_TOOL_PREFIXES = (
    "shell",
    "pytest",
    "go_test",
    "cargo_test",
    "unittest",
    "jest",
    "docker_",
    "git_",
    "systemctl",
    "service",
    "ssh",
    "kubectl",
    "terraform",
    "ansible_",
    "python",
    "node",
    "ruby",
    "perl",
    "bash_",
    "make",
    "cmake",
    "maven",
    "gradle",
    "ninja",
    "meson",
)

_RETRIEVE_TOOL_PREFIXES = (
    "fetch",
    "web_",
    "api_",
    "browser_",
    "image_",
    "mcp_read_",
    "mcp_get_",
    "mcp_call_",
)

_SESSION_TOOL_PREFIXES = ("pty.", "delegate_")

_HIGH_LEVEL_GROUPS = {"intake", "analyze", "execute", "recover", "synthesize", "respond", "complete", "error"}


def normalize_phase_status(status: str) -> str:
    value = (status or "progress").strip().lower()
    return value if value in PHASE_STATUS_VALUES else "progress"


def normalize_phase_name(phase: str) -> str:
    value = (phase or "unknown").strip().lower()
    return value or "unknown"


def phase_group(phase: str) -> str:
    value = normalize_phase_name(phase)
    if "." not in value:
        return value
    return value.split(".", 1)[0]


def phase_should_render(verbosity: str, phase: str, status: str) -> bool:
    level = (verbosity or "standard").strip().lower()
    if level not in PHASE_VERBOSITY_VALUES:
        level = "standard"
    group = phase_group(phase)
    normalized_status = normalize_phase_status(status)
    if level == "verbose":
        return True
    if level == "minimal":
        if normalized_status == "error":
            return True
        return group in {"execute", "respond", "complete"}
    # standard: always include high-level groups and all error events.
    if normalized_status == "error":
        return True
    if group in _HIGH_LEVEL_GROUPS:
        return True
    # Include tool lifecycle in standard mode to preserve "what's happening now".
    return group in {"inspect", "mutate", "execute", "retrieve", "session", "tool", "operate"}


def tool_phase_kind(tool: str, spec: ToolSpec | None = None) -> str:
    name = (tool or "").strip().lower()
    if not name:
        return "tool"
    if spec:
        if spec.idempotency == "safe_read":
            return "inspect"
        if spec.idempotency in {"idempotent_write", "mutating_write"}:
            return "mutate"
        if spec.risk_class in {"high", "critical"}:
            return "operate"
    if _matches_prefixes(name, _SESSION_TOOL_PREFIXES):
        return "session"
    if _matches_prefixes(name, _READ_TOOL_PREFIXES):
        return "inspect"
    if _matches_prefixes(name, _WRITE_TOOL_PREFIXES):
        return "mutate"
    if _matches_prefixes(name, _RETRIEVE_TOOL_PREFIXES):
        return "retrieve"
    if _matches_prefixes(name, _EXEC_TOOL_PREFIXES):
        return "execute"
    return "tool"


def _matches_prefixes(value: str, prefixes: tuple[str, ...]) -> bool:
    return any(value.startswith(prefix) for prefix in prefixes)


def project_phase_event_from_progress(
    event: str,
    data: dict[str, Any],
    *,
    sequence: int,
    session_id: str | None,
    surface: str,
) -> dict[str, Any]:
    source_event = (event or "").strip().lower() or "unknown"
    payload = data if isinstance(data, dict) else {}
    phase, status, detail = _phase_fields_from_progress(source_event, payload)
    normalized_phase = normalize_phase_name(phase)
    normalized_status = normalize_phase_status(status)
    phase_payload: dict[str, Any] = {
        "schema": PHASE_STREAM_SCHEMA,
        "event_version": PHASE_STREAM_EVENT_VERSION,
        "event": "phase",
        "sequence": sequence,
        "session_id": payload.get("session_id") or session_id,
        "surface": surface,
        "phase": normalized_phase,
        "phase_group": phase_group(normalized_phase),
        "status": normalized_status,
        "detail": detail,
        "elapsed_ms": _elapsed_ms_from_progress(payload),
        "timestamp": str(payload.get("timestamp") or ""),
        "meta": {
            "source_event": source_event,
            "source_surface": str(payload.get("surface") or "agent_loop"),
        },
    }
    if payload.get("tool"):
        phase_payload["meta"]["tool"] = str(payload.get("tool"))
    if payload.get("index") is not None:
        phase_payload["meta"]["index"] = payload.get("index")
    if payload.get("total") is not None:
        phase_payload["meta"]["total"] = payload.get("total")
    return phase_payload


def _phase_fields_from_progress(event: str, data: dict[str, Any]) -> tuple[str, str, str]:
    if event == "iteration_start":
        iteration = data.get("iteration")
        total = data.get("max_iterations")
        detail = f"iteration {iteration}/{total}" if iteration and total else "iteration started"
        return "analyze", "progress", detail
    if event == "thought":
        thought = str(data.get("thought") or "").strip()
        if len(thought) > 140:
            thought = thought[:137] + "..."
        return "analyze", "progress", thought or "updating plan"
    if event == "tool_start":
        tool = str(data.get("tool") or "").strip()
        kind = tool_phase_kind(tool)
        idx = data.get("index")
        total = data.get("total")
        ratio = f" ({idx}/{total})" if idx and total else ""
        return f"{kind}.start", "progress", f"{tool}{ratio}".strip() or "tool start"
    if event == "tool_end":
        tool = str(data.get("tool") or "").strip()
        kind = tool_phase_kind(tool)
        ok = bool(data.get("success", False))
        elapsed = _elapsed_ms_from_progress(data)
        return (
            f"{kind}.done",
            "done" if ok else "error",
            f"{tool} ok={ok} elapsed={elapsed}ms".strip() if tool else f"ok={ok} elapsed={elapsed}ms",
        )
    if event == "iteration_end":
        iteration = data.get("iteration")
        calls = data.get("tool_calls")
        failures = data.get("failed_tool_calls", 0)
        detail = f"iteration {iteration}: tools={calls} failed={failures}"
        return "execute.done", "done", detail
    if event == "stuck_detected":
        backoff = data.get("backoff_seconds")
        return "recover", "progress", f"stuck cycle detected; backoff {backoff}s"
    if event == "loop_terminated":
        reason = str(data.get("termination_reason") or "").strip()
        has_error = bool(data.get("has_error", False))
        return ("error" if has_error else "complete"), ("error" if has_error else "done"), reason or "loop terminated"
    if event == "loop_error":
        return "error", "error", str(data.get("error") or "loop error")
    if event == "state_transition":
        target = str(data.get("to") or "").strip().lower()
        if target == "executing_tools":
            return "execute", "progress", "executing tools"
        if target in {"building_context", "parsing_response", "updating_context", "llm_request"}:
            return "analyze", "progress", target.replace("_", " ")
        if target == "terminated":
            return "complete", "done", "terminated"
        if target == "error":
            return "error", "error", "loop entered error state"
        return "analyze", "progress", f"state -> {target}" if target else "state transition"
    return f"progress.{event}", "progress", event


def _elapsed_ms_from_progress(data: dict[str, Any]) -> int:
    for key in ("execution_time_ms", "latency_ms", "llm_latency_ms"):
        value = data.get(key)
        if isinstance(value, int):
            return max(0, value)
        if isinstance(value, float):
            return max(0, int(value))
    return 0
