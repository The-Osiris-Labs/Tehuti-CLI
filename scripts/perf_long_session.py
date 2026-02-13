#!/usr/bin/env python3
from __future__ import annotations

import statistics
import time
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from tehuti_cli.core.agent_loop import AgentLoop, AgentTurn
from tehuti_cli.core.memory import AgentMemory
from tehuti_cli.core.runtime import ToolRuntime
from tehuti_cli.storage.config import default_config


class _NoopLLM:
    def chat_messages(self, _messages):
        return '{"content":"ok","should_continue":false}'


def _p95(values: list[float]) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    idx = int(round(0.95 * (len(ordered) - 1)))
    return ordered[idx]


def _assert_budget(name: str, *, avg_ms: float, p95_ms: float, avg_budget: float, p95_budget: float) -> None:
    print(f"[perf-long] {name}: avg={avg_ms:.2f}ms p95={p95_ms:.2f}ms")
    if avg_ms > avg_budget:
        raise RuntimeError(f"{name} avg exceeded budget: {avg_ms:.2f}ms > {avg_budget:.2f}ms")
    if p95_ms > p95_budget:
        raise RuntimeError(f"{name} p95 exceeded budget: {p95_ms:.2f}ms > {p95_budget:.2f}ms")


def main() -> int:
    cfg = default_config()
    runtime = ToolRuntime(cfg, Path.cwd())
    loop = AgentLoop(
        llm_client=_NoopLLM(),
        runtime=runtime,
        enable_tracing=False,
        context_token_budget=12000,
    )

    # Simulate prolonged history pressure.
    for i in range(600):
        loop.state.add_turn(
            AgentTurn(
                user_input=f"user-{i} " + ("u" * 180),
                response=f"assistant-{i} " + ("a" * 180),
            )
        )

    context_runs: list[float] = []
    for i in range(120):
        started = time.perf_counter()
        messages = loop._build_messages(f"long-session prompt {i}")
        elapsed = (time.perf_counter() - started) * 1000.0
        if not messages or messages[-1]["content"] != f"long-session prompt {i}":
            raise RuntimeError("context packing lost latest prompt")
        context_runs.append(elapsed)

    memory = AgentMemory()
    for i in range(4000):
        memory.add(
            content=f"long memory item {i} around tooling parity diagnostics contracts and recovery {i % 19}",
            category="conversation",
            importance=1.0,
        )

    search_runs: list[float] = []
    for i in range(180):
        started = time.perf_counter()
        found = memory.search(f"tooling diagnostics contracts {i % 19}", top_k=10)
        elapsed = (time.perf_counter() - started) * 1000.0
        if not found:
            raise RuntimeError("long-session memory retrieval returned no items")
        search_runs.append(elapsed)

    _assert_budget(
        "context_build",
        avg_ms=statistics.mean(context_runs),
        p95_ms=_p95(context_runs),
        avg_budget=28.0,
        p95_budget=70.0,
    )
    _assert_budget(
        "memory_search",
        avg_ms=statistics.mean(search_runs),
        p95_ms=_p95(search_runs),
        avg_budget=75.0,
        p95_budget=110.0,
    )
    print("[perf-long] PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
