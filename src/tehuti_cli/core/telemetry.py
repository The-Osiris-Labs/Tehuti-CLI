from __future__ import annotations

from dataclasses import dataclass, field
from threading import Lock
from typing import Any


@dataclass
class TelemetryStore:
    counters: dict[str, int] = field(default_factory=dict)
    tool_failures_by_code: dict[str, int] = field(default_factory=dict)
    latency_buckets_ms: dict[str, list[int]] = field(default_factory=lambda: {"tool": [], "agent_task": []})
    surface_failures_by_code: dict[str, dict[str, int]] = field(default_factory=dict)
    provider_failures_by_code: dict[str, dict[str, int]] = field(default_factory=dict)
    diagnostics: list[dict[str, Any]] = field(default_factory=list)
    cost_estimate_usd_total: float = 0.0
    cost_actual_usd_total: float = 0.0
    _lock: Lock = field(default_factory=Lock)
    _max_diagnostics: int = 400

    def increment(self, name: str, value: int = 1) -> None:
        with self._lock:
            self.counters[name] = int(self.counters.get(name, 0)) + int(value)

    def observe_latency(self, family: str, latency_ms: int) -> None:
        with self._lock:
            bucket = self.latency_buckets_ms.setdefault(family, [])
            bucket.append(max(0, int(latency_ms)))

    def _increment_nested_counter(self, store: dict[str, dict[str, int]], key: str, code: str) -> None:
        bucket = store.setdefault(key, {})
        bucket[code] = int(bucket.get(code, 0)) + 1

    def _record_diagnostic(self, payload: dict[str, Any]) -> None:
        self.diagnostics.append(payload)
        if len(self.diagnostics) > self._max_diagnostics:
            self.diagnostics = self.diagnostics[-self._max_diagnostics :]

    def record_tool_contract(self, *, success: bool, error_code: str | None, latency_ms: int) -> None:
        self.increment("tool_contract_total")
        if success:
            self.increment("tool_contract_success_total")
        else:
            self.increment("tool_contract_failed_total")
            if error_code:
                with self._lock:
                    self.tool_failures_by_code[error_code] = self.tool_failures_by_code.get(error_code, 0) + 1
        self.observe_latency("tool", latency_ms)

    def record_surface_result(
        self,
        *,
        surface: str,
        success: bool,
        latency_ms: int,
        error_code: str | None = None,
        trace_id: str | None = None,
        turn_id: str | None = None,
        retryable: bool | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        safe_surface = "".join(ch if ch.isalnum() or ch == "_" else "_" for ch in (surface or "unknown").lower())
        self.increment(f"{safe_surface}_request_total")
        if success:
            self.increment(f"{safe_surface}_request_success_total")
        else:
            self.increment(f"{safe_surface}_request_failed_total")
            if error_code:
                with self._lock:
                    self._increment_nested_counter(self.surface_failures_by_code, safe_surface, str(error_code))
        self.observe_latency(safe_surface, latency_ms)
        with self._lock:
            self._record_diagnostic(
                {
                    "kind": "surface_result",
                    "surface": safe_surface,
                    "success": bool(success),
                    "latency_ms": int(latency_ms),
                    "error_code": str(error_code) if error_code else None,
                    "trace_id": str(trace_id) if trace_id else None,
                    "turn_id": str(turn_id) if turn_id else None,
                    "retryable": retryable,
                    "details": details or {},
                }
            )

    def record_provider_result(
        self,
        *,
        provider: str,
        success: bool,
        latency_ms: int,
        error_code: str | None = None,
        trace_id: str | None = None,
    ) -> None:
        safe_provider = "".join(ch if ch.isalnum() or ch == "_" else "_" for ch in (provider or "unknown").lower())
        self.increment(f"provider_{safe_provider}_request_total")
        if success:
            self.increment(f"provider_{safe_provider}_request_success_total")
        else:
            self.increment(f"provider_{safe_provider}_request_failed_total")
            if error_code:
                with self._lock:
                    self._increment_nested_counter(self.provider_failures_by_code, safe_provider, str(error_code))
        self.observe_latency(f"provider_{safe_provider}", latency_ms)
        with self._lock:
            self._record_diagnostic(
                {
                    "kind": "provider_result",
                    "provider": safe_provider,
                    "success": bool(success),
                    "latency_ms": int(latency_ms),
                    "error_code": str(error_code) if error_code else None,
                    "trace_id": str(trace_id) if trace_id else None,
                }
            )

    def record_agent_task(
        self,
        *,
        success: bool,
        latency_ms: int,
        surface: str | None = None,
        provider: str | None = None,
        token_estimate: int | None = None,
        cost_estimate_usd: float | None = None,
        token_actual: int | None = None,
        cost_actual_usd: float | None = None,
        trace_id: str | None = None,
        turn_id: str | None = None,
        token_actual_source: str | None = None,
        cost_actual_source: str | None = None,
        error_code: str | None = None,
    ) -> None:
        self.increment("agent_task_total")
        if success:
            self.increment("agent_task_success_total")
        else:
            self.increment("agent_task_failed_total")
        if token_estimate is not None:
            self.increment("token_estimate_total", max(0, int(token_estimate)))
        if cost_estimate_usd is not None:
            with self._lock:
                self.cost_estimate_usd_total += max(0.0, float(cost_estimate_usd))
        if token_actual is not None:
            self.increment("token_actual_total", max(0, int(token_actual)))
        if cost_actual_usd is not None:
            with self._lock:
                self.cost_actual_usd_total += max(0.0, float(cost_actual_usd))
        self.observe_latency("agent_task", latency_ms)
        with self._lock:
            self._record_diagnostic(
                {
                    "kind": "agent_task",
                    "surface": surface or "agent_task",
                    "provider": provider or "unknown",
                    "success": bool(success),
                    "latency_ms": int(latency_ms),
                    "trace_id": str(trace_id) if trace_id else None,
                    "turn_id": str(turn_id) if turn_id else None,
                    "error_code": str(error_code) if error_code else None,
                    "token_actual_source": token_actual_source or "unknown",
                    "cost_actual_source": cost_actual_source or "unknown",
                    "token_estimate": int(token_estimate or 0),
                    "token_actual": int(token_actual or 0),
                    "cost_estimate_usd": round(float(cost_estimate_usd or 0.0), 8),
                    "cost_actual_usd": round(float(cost_actual_usd or 0.0), 8),
                }
            )
        if surface:
            self.record_surface_result(
                surface=surface,
                success=success,
                latency_ms=latency_ms,
                error_code=error_code,
                trace_id=trace_id,
                turn_id=turn_id,
            )
        if provider:
            self.record_provider_result(
                provider=provider,
                success=success,
                latency_ms=latency_ms,
                error_code=error_code,
                trace_id=trace_id,
            )

    def diagnostics_view(
        self,
        *,
        trace_id: str | None = None,
        error_code: str | None = None,
        limit: int = 50,
    ) -> dict[str, Any]:
        with self._lock:
            entries = list(self.diagnostics)
        if trace_id:
            entries = [e for e in entries if str(e.get("trace_id", "")) == str(trace_id)]
        if error_code:
            entries = [e for e in entries if str(e.get("error_code", "")) == str(error_code)]
        limited = entries[-max(1, min(int(limit), 200)) :]
        return {
            "schema": "tehuti.diagnostics.v1",
            "count": len(limited),
            "items": limited,
        }

    def _percentile(self, values: list[int], percentile: float) -> int:
        if not values:
            return 0
        ordered = sorted(values)
        idx = int(round((percentile / 100.0) * (len(ordered) - 1)))
        return int(ordered[max(0, min(idx, len(ordered) - 1))])

    def _latency_stats(self, family: str) -> dict[str, int]:
        values = list(self.latency_buckets_ms.get(family, []))
        if not values:
            return {"count": 0, "min": 0, "max": 0, "avg": 0, "p50": 0, "p95": 0, "p99": 0}
        return {
            "count": len(values),
            "min": min(values),
            "max": max(values),
            "avg": int(sum(values) / len(values)),
            "p50": self._percentile(values, 50),
            "p95": self._percentile(values, 95),
            "p99": self._percentile(values, 99),
        }

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            counters = dict(self.counters)
            failures = dict(self.tool_failures_by_code)
            surface_failures = {surface: dict(codes) for surface, codes in self.surface_failures_by_code.items()}
            provider_failures = {provider: dict(codes) for provider, codes in self.provider_failures_by_code.items()}
            tool_stats = self._latency_stats("tool")
            agent_stats = self._latency_stats("agent_task")
            all_latency_stats = {family: self._latency_stats(family) for family in sorted(self.latency_buckets_ms.keys())}
        return {
            "schema": "tehuti.metrics.v1",
            "counters": counters,
            "tool_failures_by_code": failures,
            "surface_failures_by_code": surface_failures,
            "provider_failures_by_code": provider_failures,
            "estimates": {
                "token_estimate_total": int(counters.get("token_estimate_total", 0)),
                "cost_estimate_usd_total": round(self.cost_estimate_usd_total, 8),
            },
            "actuals": {
                "token_actual_total": int(counters.get("token_actual_total", 0)),
                "cost_actual_usd_total": round(self.cost_actual_usd_total, 8),
            },
            "latency_ms": {
                "tool": tool_stats,
                "agent_task": agent_stats,
            },
            "latency_ms_by_family": all_latency_stats,
            "diagnostics_recent": self.diagnostics_view(limit=20)["items"],
        }

    def to_prometheus(self) -> str:
        snap = self.snapshot()
        lines: list[str] = []
        for key, value in snap["counters"].items():
            lines.append(f"tehuti_{key} {int(value)}")
        for code, value in snap["tool_failures_by_code"].items():
            safe_code = "".join(ch if ch.isalnum() or ch == "_" else "_" for ch in code.lower())
            lines.append(f'tehuti_tool_failure_code_total{{code="{safe_code}"}} {int(value)}')
        for surface, failures in snap.get("surface_failures_by_code", {}).items():
            for code, value in failures.items():
                safe_code = "".join(ch if ch.isalnum() or ch == "_" else "_" for ch in code.lower())
                lines.append(
                    f'tehuti_surface_failure_code_total{{surface="{surface}",code="{safe_code}"}} {int(value)}'
                )
        for provider, failures in snap.get("provider_failures_by_code", {}).items():
            for code, value in failures.items():
                safe_code = "".join(ch if ch.isalnum() or ch == "_" else "_" for ch in code.lower())
                lines.append(
                    f'tehuti_provider_failure_code_total{{provider="{provider}",code="{safe_code}"}} {int(value)}'
                )
        lines.append(f'tehuti_token_estimate_total {snap["estimates"]["token_estimate_total"]}')
        lines.append(f'tehuti_cost_estimate_usd_total {snap["estimates"]["cost_estimate_usd_total"]}')
        lines.append(f'tehuti_token_actual_total {snap["actuals"]["token_actual_total"]}')
        lines.append(f'tehuti_cost_actual_usd_total {snap["actuals"]["cost_actual_usd_total"]}')
        lines.append(f'tehuti_tool_latency_avg_ms {snap["latency_ms"]["tool"]["avg"]}')
        lines.append(f'tehuti_tool_latency_p95_ms {snap["latency_ms"]["tool"]["p95"]}')
        lines.append(f'tehuti_agent_task_latency_avg_ms {snap["latency_ms"]["agent_task"]["avg"]}')
        lines.append(f'tehuti_agent_task_latency_p95_ms {snap["latency_ms"]["agent_task"]["p95"]}')
        return "\n".join(lines) + "\n"


_TELEMETRY = TelemetryStore()


def get_telemetry() -> TelemetryStore:
    return _TELEMETRY
