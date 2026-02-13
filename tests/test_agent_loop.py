from __future__ import annotations

import json
from pathlib import Path

from tehuti_cli.core.agent_loop import AgentLoop, LoopTerminationReason, LoopState, LOOP_STATE_TRANSITIONS
from tehuti_cli.core.agent_loop import AgentTurn
from tehuti_cli.core.runtime import ToolRuntime
from tehuti_cli.storage.config import default_config


class FakeLLM:
    def __init__(self, responses: list[dict]):
        self._responses = [json.dumps(item) for item in responses]
        self._idx = 0

    def chat_messages(self, _messages):
        if self._idx >= len(self._responses):
            return json.dumps({"content": "done", "should_continue": False})
        value = self._responses[self._idx]
        self._idx += 1
        return value


def test_agent_loop_executes_tool_and_returns_final_content(tmp_path: Path):
    cfg = default_config()
    cfg.default_yolo = True
    runtime = ToolRuntime(cfg, tmp_path)

    fixture = tmp_path / "fixture.txt"
    fixture.write_text("hello from tool runtime", encoding="utf-8")

    llm = FakeLLM(
        [
            {
                "thought": "Need to read fixture file first",
                "tool_calls": [{"name": "read", "arguments": {"path": "fixture.txt"}}],
                "should_continue": True,
            },
            {
                "content": "Read completed successfully.",
                "should_continue": False,
            },
        ]
    )

    checkpoint_dir = tmp_path / "checkpoints"
    loop = AgentLoop(llm_client=llm, runtime=runtime, max_iterations=3, enable_tracing=False)
    turn = loop.run("Read fixture.txt", checkpoint_dir=checkpoint_dir)

    assert turn.error is None
    assert turn.response == "Read completed successfully."
    assert len(turn.tool_calls) == 1
    assert len(turn.tool_results) == 1
    assert turn.tool_results[0].success is True
    assert "hello from tool runtime" in str(turn.tool_results[0].result)
    assert turn.termination_reason == LoopTerminationReason.FINAL_RESPONSE.value
    assert any(checkpoint_dir.glob("checkpoint_*.json"))


def test_agent_loop_progress_callback_emits_stable_events(tmp_path: Path):
    cfg = default_config()
    cfg.default_yolo = True
    runtime = ToolRuntime(cfg, tmp_path)

    fixture = tmp_path / "fixture.txt"
    fixture.write_text("hello", encoding="utf-8")

    llm = FakeLLM(
        [
            {
                "thought": "read first",
                "tool_calls": [{"name": "read", "arguments": {"path": "fixture.txt"}}],
                "should_continue": True,
            },
            {
                "content": "done",
                "should_continue": False,
            },
        ]
    )

    events: list[tuple[str, dict]] = []

    def on_progress(event: str, data: dict) -> None:
        events.append((event, data))

    loop = AgentLoop(
        llm_client=llm,
        runtime=runtime,
        max_iterations=3,
        enable_tracing=False,
        progress_callback=on_progress,
    )
    turn = loop.run("read fixture")

    assert turn.error is None
    names = [event for event, _ in events]
    assert "iteration_start" in names
    assert "thought" in names
    assert "tool_start" in names
    assert "tool_end" in names
    assert "iteration_end" in names
    assert "loop_terminated" in names

    for event, payload in events:
        assert payload["schema"] == "tehuti.progress.v1"
        assert payload["event_version"] == 1
        assert payload["event"] == event
        assert payload["session_id"]
        assert payload["trace_id"]
        assert payload["turn_id"]
        assert payload["surface"] == "agent_loop"
        assert payload["sequence"] >= 1
        if event == "tool_end":
            assert payload["contract_schema"] == "tehuti.tool_result.v1"


def test_agent_loop_sets_max_iteration_reason(tmp_path: Path):
    cfg = default_config()
    cfg.default_yolo = True
    runtime = ToolRuntime(cfg, tmp_path)

    llm = FakeLLM(
        [
            {
                "thought": "keep going",
                "tool_calls": [{"name": "shell", "arguments": {"command": "echo hi"}}],
                "should_continue": True,
            }
        ]
    )
    loop = AgentLoop(llm_client=llm, runtime=runtime, max_iterations=1, enable_tracing=False)
    turn = loop.run("run once")

    assert turn.termination_reason == LoopTerminationReason.MAX_ITERATIONS.value
    assert turn.iterations == 1
    assert "Stopped after 1 iterations" in (turn.response or "")


def test_agent_loop_strict_parser_reports_parser_error(tmp_path: Path):
    cfg = default_config()
    cfg.default_yolo = True
    runtime = ToolRuntime(cfg, tmp_path)

    class BrokenLLM:
        def chat_messages(self, _messages):
            return "not valid json"

    loop = AgentLoop(
        llm_client=BrokenLLM(),
        runtime=runtime,
        max_iterations=2,
        enable_tracing=False,
        parser_mode="strict",
    )
    turn = loop.run("do something")

    assert turn.termination_reason == LoopTerminationReason.PARSER_ERROR.value
    assert turn.parse_status == "error"


def test_agent_loop_requires_tool_evidence_when_enabled(tmp_path: Path):
    cfg = default_config()
    cfg.default_yolo = True
    runtime = ToolRuntime(cfg, tmp_path)

    llm = FakeLLM(
        [
            {"content": "final without tools", "should_continue": False},
            {"content": "still no tools", "should_continue": False},
        ]
    )
    loop = AgentLoop(llm_client=llm, runtime=runtime, max_iterations=2, enable_tracing=False)
    turn = loop.run("answer directly", require_tool_evidence=True)

    assert turn.termination_reason == LoopTerminationReason.INSUFFICIENT_EVIDENCE.value
    assert "sufficient evidence" in (turn.response or "").lower()


def test_agent_loop_allows_no_tool_final_when_evidence_mode_disabled(tmp_path: Path):
    cfg = default_config()
    cfg.default_yolo = True
    runtime = ToolRuntime(cfg, tmp_path)

    llm = FakeLLM([{"content": "no tools needed", "should_continue": False}])
    loop = AgentLoop(llm_client=llm, runtime=runtime, max_iterations=2, enable_tracing=False)
    turn = loop.run("simple reply", require_tool_evidence=False)

    assert turn.termination_reason == LoopTerminationReason.FINAL_RESPONSE.value
    assert turn.response == "no tools needed"


def test_agent_loop_records_state_transitions(tmp_path: Path):
    cfg = default_config()
    cfg.default_yolo = True
    runtime = ToolRuntime(cfg, tmp_path)

    llm = FakeLLM([{"content": "done", "should_continue": False}])
    loop = AgentLoop(llm_client=llm, runtime=runtime, max_iterations=2, enable_tracing=False)
    turn = loop.run("hello")

    assert turn.loop_state == "terminated"
    assert len(turn.state_transitions) >= 3
    states = [item["to"] for item in turn.state_transitions]
    assert "building_context" in states
    assert "llm_request" in states
    assert "parsing_response" in states
    assert "finalizing" in states
    assert "terminated" in states


def test_agent_loop_stuck_detection_terminates_repeated_cycles(tmp_path: Path, monkeypatch):
    cfg = default_config()
    cfg.default_yolo = True
    runtime = ToolRuntime(cfg, tmp_path)
    monkeypatch.setattr("tehuti_cli.core.agent_loop.time.sleep", lambda _s: None)

    llm = FakeLLM(
        [
            {"tool_calls": [{"name": "shell", "arguments": {"command": "echo hi"}}], "should_continue": True},
            {"tool_calls": [{"name": "shell", "arguments": {"command": "echo hi"}}], "should_continue": True},
            {"tool_calls": [{"name": "shell", "arguments": {"command": "echo hi"}}], "should_continue": True},
            {"tool_calls": [{"name": "shell", "arguments": {"command": "echo hi"}}], "should_continue": True},
        ]
    )
    loop = AgentLoop(llm_client=llm, runtime=runtime, max_iterations=10, enable_tracing=False)
    turn = loop.run("loop forever")

    assert turn.termination_reason == LoopTerminationReason.STUCK_DETECTED.value
    assert "repeated identical tool-call cycles" in (turn.response or "")


def test_agent_loop_context_budget_is_deterministic_and_keeps_current_turn(tmp_path: Path):
    cfg = default_config()
    cfg.default_yolo = True
    runtime = ToolRuntime(cfg, tmp_path)
    llm = FakeLLM([{"content": "done", "should_continue": False}])

    loop = AgentLoop(
        llm_client=llm,
        runtime=runtime,
        max_iterations=2,
        enable_tracing=False,
        context_token_budget=200,  # small budget to force trimming
    )
    # Seed lots of history that cannot fully fit budget.
    for i in range(12):
        loop.state.add_turn(
            AgentTurn(
                user_input=f"user-{i}-" + ("u" * 120),
                response=f"assistant-{i}-" + ("a" * 120),
            )
        )

    msgs1 = loop._build_messages("current-request")
    msgs2 = loop._build_messages("current-request")

    assert msgs1 == msgs2
    assert msgs1[-1]["role"] == "user"
    assert msgs1[-1]["content"] == "current-request"
    # Budget should trim history, not include all 12 turns.
    history_user_count = sum(1 for m in msgs1[:-1] if m["role"] == "user")
    assert history_user_count < 12


def test_agent_loop_transition_matrix_is_total_for_all_states(tmp_path: Path):
    cfg = default_config()
    cfg.default_yolo = True
    runtime = ToolRuntime(cfg, tmp_path)
    llm = FakeLLM([{"content": "done", "should_continue": False}])
    loop = AgentLoop(llm_client=llm, runtime=runtime, max_iterations=1, enable_tracing=False)

    transitions = loop._allowed_state_transitions()
    assert set(transitions.keys()) == set(LoopState)
    assert transitions == LOOP_STATE_TRANSITIONS


def test_agent_loop_stuck_backoff_uses_config_cap(tmp_path: Path):
    cfg = default_config()
    cfg.default_yolo = True
    cfg.loop_stuck_backoff_base_seconds = 0.5
    cfg.loop_stuck_backoff_cap_seconds = 1.0
    runtime = ToolRuntime(cfg, tmp_path)
    llm = FakeLLM([{"content": "done", "should_continue": False}])
    loop = AgentLoop(llm_client=llm, runtime=runtime, max_iterations=1, enable_tracing=False)

    assert loop._stuck_cycle_backoff_seconds(2) == 0.5
    assert loop._stuck_cycle_backoff_seconds(3) == 1.0
    assert loop._stuck_cycle_backoff_seconds(4) == 1.0
