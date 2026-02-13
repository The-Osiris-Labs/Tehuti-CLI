from __future__ import annotations

from tehuti_cli.core.telemetry import TelemetryStore


def test_metrics_snapshot_includes_estimates() -> None:
    telemetry = TelemetryStore()
    telemetry.record_agent_task(
        success=True,
        latency_ms=25,
        token_estimate=120,
        cost_estimate_usd=0.0012,
        token_actual=110,
        cost_actual_usd=0.0011,
    )
    telemetry.record_tool_contract(success=False, error_code="unknown_tool", latency_ms=5)
    telemetry.record_surface_result(surface="wire", success=False, latency_ms=12, error_code="a2a_timeout")
    telemetry.record_provider_result(provider="openrouter", success=False, latency_ms=88, error_code="llm_request_failed")

    snap = telemetry.snapshot()
    assert snap["schema"] == "tehuti.metrics.v1"
    assert snap["estimates"]["token_estimate_total"] == 120
    assert snap["estimates"]["cost_estimate_usd_total"] == 0.0012
    assert snap["actuals"]["token_actual_total"] == 110
    assert snap["actuals"]["cost_actual_usd_total"] == 0.0011
    assert snap["tool_failures_by_code"]["unknown_tool"] == 1
    assert snap["surface_failures_by_code"]["wire"]["a2a_timeout"] == 1
    assert snap["provider_failures_by_code"]["openrouter"]["llm_request_failed"] == 1
    assert snap["latency_ms"]["tool"]["p95"] >= 0
    assert snap["latency_ms"]["agent_task"]["p99"] >= 0


def test_metrics_prometheus_includes_estimate_lines() -> None:
    telemetry = TelemetryStore()
    telemetry.record_agent_task(
        success=True,
        latency_ms=25,
        token_estimate=50,
        cost_estimate_usd=0.0005,
        token_actual=48,
        cost_actual_usd=0.00048,
    )

    text = telemetry.to_prometheus()
    assert "tehuti_token_estimate_total" in text
    assert "tehuti_cost_estimate_usd_total" in text
    assert "tehuti_token_actual_total" in text
    assert "tehuti_cost_actual_usd_total" in text
    assert "tehuti_tool_latency_p95_ms" in text


def test_metrics_diagnostics_view_filters_by_trace_and_error_code() -> None:
    telemetry = TelemetryStore()
    telemetry.record_surface_result(
        surface="wire",
        success=False,
        latency_ms=42,
        error_code="a2a_timeout",
        trace_id="trace-a",
        turn_id="turn-a",
        retryable=True,
    )
    telemetry.record_surface_result(
        surface="wire",
        success=False,
        latency_ms=43,
        error_code="mcp_not_connected",
        trace_id="trace-b",
        turn_id="turn-b",
        retryable=False,
    )

    by_trace = telemetry.diagnostics_view(trace_id="trace-a")
    assert by_trace["schema"] == "tehuti.diagnostics.v1"
    assert by_trace["count"] == 1
    assert by_trace["items"][0]["error_code"] == "a2a_timeout"

    by_code = telemetry.diagnostics_view(error_code="mcp_not_connected")
    assert by_code["count"] == 1
    assert by_code["items"][0]["trace_id"] == "trace-b"
