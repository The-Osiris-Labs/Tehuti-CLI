#!/usr/bin/env python3
from __future__ import annotations

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


def _assert_under(name: str, value_ms: float, budget_ms: float) -> None:
    if value_ms > budget_ms:
        raise RuntimeError(f"{name} exceeded budget: {value_ms:.2f}ms > {budget_ms:.2f}ms")
    print(f"[perf] {name}: {value_ms:.2f}ms (budget {budget_ms:.2f}ms)")


def main() -> int:
    cfg = default_config()
    runtime = ToolRuntime(cfg, Path.cwd())
    loop = AgentLoop(
        llm_client=_NoopLLM(),
        runtime=runtime,
        enable_tracing=False,
        context_token_budget=4000,
    )

    # Seed long history.
    for i in range(120):
        loop.state.add_turn(
            AgentTurn(
                user_input=f"user-{i} " + ("u" * 120),
                response=f"assistant-{i} " + ("a" * 120),
            )
        )

    started = time.perf_counter()
    msgs = loop._build_messages("perf smoke prompt")
    context_ms = (time.perf_counter() - started) * 1000.0
    if not msgs or msgs[-1]["content"] != "perf smoke prompt":
        raise RuntimeError("context packing failed to retain current user prompt")

    memory = AgentMemory()
    for i in range(300):
        memory.add(
            content=f"memory item {i} about runtime contracts and tool outputs {i % 7}",
            category="conversation",
            importance=1.0,
        )
    started = time.perf_counter()
    results = memory.search("runtime contracts tool outputs", top_k=5)
    search_ms = (time.perf_counter() - started) * 1000.0
    if len(results) == 0:
        raise RuntimeError("memory search returned no results")

    # Conservative local smoke budgets; not a full benchmark.
    _assert_under("context_build", context_ms, 120.0)
    _assert_under("memory_search", search_ms, 120.0)
    print("[perf] PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
