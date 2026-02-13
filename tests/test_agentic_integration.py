from __future__ import annotations

from pathlib import Path

from tehuti_cli.agentic import TehutiAgent
from tehuti_cli.core.agent_loop import AgentTurn, LoopTerminationReason
from tehuti_cli.core.memory import AgentMemory, ContextManager
from tehuti_cli.core.structured_output import ToolCall, ToolResultOutput
from tehuti_cli.storage.config import default_config


def test_agent_execute_task_includes_reconciliation_and_enforces_evidence_mode(tmp_path: Path) -> None:
    cfg = default_config()
    cfg.default_yolo = True
    cfg.require_tool_evidence = True
    agent = TehutiAgent(config=cfg, work_dir=tmp_path, enable_memory=False, enable_tracing=False)

    captured: dict[str, object] = {}

    def _fake_run(**kwargs):
        captured.update(kwargs)
        turn = AgentTurn(
            user_input=str(kwargs.get("user_input", "")),
            response="done",
            iterations=1,
            latency_ms=5,
            parse_status="structured",
            parse_mode="repair",
            termination_reason=LoopTerminationReason.FINAL_RESPONSE.value,
        )
        turn.tool_calls = [
            ToolCall(name="task_create", arguments={"title": "x"}),
            ToolCall(name="task_update", arguments={"task_id": "t1", "status": "completed"}),
        ]
        turn.tool_results = [
            ToolResultOutput(success=True, result="t1", error=None, execution_time_ms=1),
            ToolResultOutput(success=True, result="True", error=None, execution_time_ms=1),
        ]
        return turn

    agent.agent_loop.run = _fake_run  # type: ignore[method-assign]
    result = agent.execute_task("create and close task", max_iterations=2)

    assert captured["require_tool_evidence"] is True
    assert result["reconciliation"]["created"] == 1
    assert result["reconciliation"]["updated"] == 1
    assert result["reconciliation"]["completed"] == 1


def test_compose_system_prompt_adds_memory_context(tmp_path: Path) -> None:
    cfg = default_config()
    cfg.default_yolo = True
    agent = TehutiAgent(config=cfg, work_dir=tmp_path, enable_memory=False, enable_tracing=False)
    agent.memory = AgentMemory(storage_path=tmp_path / "memory.json")
    agent.context_manager = ContextManager(memory=agent.memory, max_context_length=10)
    agent.memory.add("critical deployment note for release rollback", category="ops")

    prompt = agent._compose_system_prompt("rollback release", base_prompt="base")
    assert "base" in prompt
    assert "Relevant context from memory" in prompt
