#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path


def _load_metrics(path: Path | None) -> dict[str, object]:
    if path is None:
        return {}
    if not path.exists():
        raise RuntimeError(f"metrics file not found: {path}")
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise RuntimeError("metrics payload must be an object")
    return data


def _counter(metrics: dict[str, object], name: str) -> int:
    counters = metrics.get("counters", {})
    if isinstance(counters, dict):
        return int(counters.get(name, 0) or 0)
    return 0


def _ratio(failed: int, total: int) -> float:
    if total <= 0:
        return 0.0
    return float(failed) / float(total)


def main() -> int:
    parser = argparse.ArgumentParser(description="Canary promotion gate by error budget and latency budgets.")
    parser.add_argument("--channel-from", choices=["alpha", "beta"], required=True)
    parser.add_argument("--channel-to", choices=["beta", "ga"], required=True)
    parser.add_argument("--metrics-file", type=Path, default=None)
    parser.add_argument("--max-error-rate", type=float, default=0.05)
    parser.add_argument("--max-agent-p95-ms", type=int, default=4000)
    parser.add_argument("--max-tool-p95-ms", type=int, default=1500)
    args = parser.parse_args()

    allowed = {("alpha", "beta"), ("beta", "ga")}
    transition = (args.channel_from, args.channel_to)
    if transition not in allowed:
        raise RuntimeError(f"invalid promotion path: {args.channel_from} -> {args.channel_to}")

    metrics = _load_metrics(args.metrics_file)
    total = _counter(metrics, "agent_task_total") + _counter(metrics, "wire_request_total")
    failed = (
        _counter(metrics, "agent_task_failed_total")
        + _counter(metrics, "wire_request_failed_total")
        + _counter(metrics, "web_agent_task_request_failed_total")
        + _counter(metrics, "web_prompt_request_failed_total")
    )
    error_rate = _ratio(failed, total)

    latency = metrics.get("latency_ms", {}) if isinstance(metrics.get("latency_ms"), dict) else {}
    agent_p95 = int(((latency.get("agent_task") or {}) if isinstance(latency.get("agent_task"), dict) else {}).get("p95", 0) or 0)
    tool_p95 = int(((latency.get("tool") or {}) if isinstance(latency.get("tool"), dict) else {}).get("p95", 0) or 0)

    print(
        f"[canary] transition={args.channel_from}->{args.channel_to} "
        f"error_rate={error_rate:.4f} agent_p95={agent_p95}ms tool_p95={tool_p95}ms"
    )

    if error_rate > float(args.max_error_rate):
        raise RuntimeError(
            f"canary gate failed: error_rate {error_rate:.4f} exceeds max {float(args.max_error_rate):.4f}"
        )
    if agent_p95 > int(args.max_agent_p95_ms):
        raise RuntimeError(
            f"canary gate failed: agent_task p95 {agent_p95}ms exceeds max {int(args.max_agent_p95_ms)}ms"
        )
    if tool_p95 > int(args.max_tool_p95_ms):
        raise RuntimeError(f"canary gate failed: tool p95 {tool_p95}ms exceeds max {int(args.max_tool_p95_ms)}ms")

    print("[canary] PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
