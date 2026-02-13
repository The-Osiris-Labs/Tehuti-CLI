"""Enhanced agent loop with ReAct pattern and observability.

This module implements a modern agentic loop following 2025 best practices:
- ReAct (Reasoning + Acting) pattern
- Structured output validation
- Checkpointing and state management
- Observability with tracing and metrics
"""

from __future__ import annotations

import json
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any, Callable

from tehuti_cli.constants import PROGRESS_SCHEMA, PROGRESS_EVENT_VERSION
from tehuti_cli.core.errors import AgentLoopError
from tehuti_cli.core.structured_output import (
    AgentResponse,
    ToolCall,
    ToolResultOutput,
    StructuredOutputParser,
)
from tehuti_cli.core.runtime import ToolRuntime


class LoopTerminationReason(str, Enum):
    FINAL_RESPONSE = "final_response"
    MAX_ITERATIONS = "max_iterations"
    SHOULD_CONTINUE_WITHOUT_TOOLS = "should_continue_without_tools"
    INSUFFICIENT_EVIDENCE = "insufficient_evidence"
    PARSER_ERROR = "parser_error"
    STUCK_DETECTED = "stuck_detected"
    LOOP_EXCEPTION = "loop_exception"


class LoopState(str, Enum):
    INITIALIZED = "initialized"
    BUILDING_CONTEXT = "building_context"
    LLM_REQUEST = "llm_request"
    PARSING_RESPONSE = "parsing_response"
    EXECUTING_TOOLS = "executing_tools"
    UPDATING_CONTEXT = "updating_context"
    FINALIZING = "finalizing"
    TERMINATED = "terminated"
    ERROR = "error"


LOOP_STATE_TRANSITIONS: dict[LoopState, set[LoopState]] = {
    LoopState.INITIALIZED: {LoopState.BUILDING_CONTEXT, LoopState.ERROR},
    LoopState.BUILDING_CONTEXT: {LoopState.LLM_REQUEST, LoopState.ERROR},
    LoopState.LLM_REQUEST: {LoopState.PARSING_RESPONSE, LoopState.ERROR},
    LoopState.PARSING_RESPONSE: {LoopState.EXECUTING_TOOLS, LoopState.UPDATING_CONTEXT, LoopState.FINALIZING, LoopState.ERROR},
    LoopState.EXECUTING_TOOLS: {LoopState.UPDATING_CONTEXT, LoopState.ERROR},
    LoopState.UPDATING_CONTEXT: {LoopState.LLM_REQUEST, LoopState.FINALIZING, LoopState.ERROR},
    LoopState.FINALIZING: {LoopState.TERMINATED, LoopState.ERROR},
    LoopState.TERMINATED: set(),
    LoopState.ERROR: set(),
}


@dataclass
class AgentTurn:
    """Represents a single turn in the agent conversation."""

    turn_id: str = field(default_factory=lambda: str(uuid.uuid4())[:8])
    timestamp: datetime = field(default_factory=datetime.now)
    user_input: str = ""
    thought: str | None = None
    tool_calls: list[ToolCall] = field(default_factory=list)
    tool_results: list[ToolResultOutput] = field(default_factory=list)
    response: str | None = None
    tokens_used: int = 0
    latency_ms: int = 0
    error: str | None = None
    should_continue: bool = False
    iterations: int = 0
    parse_mode: str = "repair"
    parse_status: str = "unknown"
    termination_reason: str = LoopTerminationReason.FINAL_RESPONSE.value
    loop_state: str = LoopState.INITIALIZED.value
    state_transitions: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for serialization."""
        return {
            "turn_id": self.turn_id,
            "timestamp": self.timestamp.isoformat(),
            "user_input": self.user_input,
            "thought": self.thought,
            "tool_calls": [tc.model_dump() for tc in self.tool_calls],
            "tool_results": [tr.model_dump() for tr in self.tool_results],
            "response": self.response,
            "tokens_used": self.tokens_used,
            "latency_ms": self.latency_ms,
            "error": self.error,
            "should_continue": self.should_continue,
            "iterations": self.iterations,
            "parse_mode": self.parse_mode,
            "parse_status": self.parse_status,
            "termination_reason": self.termination_reason,
            "loop_state": self.loop_state,
            "state_transitions": self.state_transitions,
        }


@dataclass
class AgentState:
    """Persistent state for the agent across turns."""

    session_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    turns: list[AgentTurn] = field(default_factory=list)
    context_summary: str | None = None
    user_preferences: dict[str, Any] = field(default_factory=dict)
    accumulated_knowledge: dict[str, Any] = field(default_factory=dict)

    def add_turn(self, turn: AgentTurn) -> None:
        """Add a turn to the state."""
        self.turns.append(turn)

        # Keep only last 20 turns in memory
        if len(self.turns) > 20:
            self.turns = self.turns[-20:]

    def get_recent_turns(self, n: int = 10) -> list[AgentTurn]:
        """Get the n most recent turns."""
        return self.turns[-n:] if self.turns else []

    def save_checkpoint(self, checkpoint_dir: Path) -> Path:
        """Save state checkpoint to disk."""
        checkpoint_dir.mkdir(parents=True, exist_ok=True)
        checkpoint_path = checkpoint_dir / f"checkpoint_{self.session_id}_{int(time.time())}.json"

        data = {
            "session_id": self.session_id,
            "turns": [t.to_dict() for t in self.turns],
            "context_summary": self.context_summary,
            "user_preferences": self.user_preferences,
            "accumulated_knowledge": self.accumulated_knowledge,
        }

        checkpoint_path.write_text(json.dumps(data, indent=2))
        return checkpoint_path

    @classmethod
    def load_checkpoint(cls, checkpoint_path: Path) -> AgentState:
        """Load state from checkpoint."""
        data = json.loads(checkpoint_path.read_text())

        state = cls(
            session_id=data["session_id"],
            context_summary=data.get("context_summary"),
            user_preferences=data.get("user_preferences", {}),
            accumulated_knowledge=data.get("accumulated_knowledge", {}),
        )

        # Reconstruct turns
        for turn_data in data.get("turns", []):
            turn = AgentTurn(
                turn_id=turn_data["turn_id"],
                timestamp=datetime.fromisoformat(turn_data["timestamp"]),
                user_input=turn_data["user_input"],
                thought=turn_data.get("thought"),
                tool_calls=[ToolCall.model_validate(tc) for tc in turn_data.get("tool_calls", [])],
                tool_results=[ToolResultOutput.model_validate(tr) for tr in turn_data.get("tool_results", [])],
                response=turn_data.get("response"),
                tokens_used=turn_data.get("tokens_used", 0),
                latency_ms=turn_data.get("latency_ms", 0),
                error=turn_data.get("error"),
                should_continue=bool(turn_data.get("should_continue", False)),
                iterations=int(turn_data.get("iterations", 0)),
                parse_mode=str(turn_data.get("parse_mode", "repair")),
                parse_status=str(turn_data.get("parse_status", "unknown")),
                termination_reason=str(
                    turn_data.get("termination_reason", LoopTerminationReason.FINAL_RESPONSE.value)
                ),
                loop_state=str(turn_data.get("loop_state", LoopState.TERMINATED.value)),
                state_transitions=list(turn_data.get("state_transitions", [])),
            )
            state.turns.append(turn)

        return state


class AgentTracer:
    """Traces agent execution for observability."""

    def __init__(self, session_id: str, log_dir: Path | None = None):
        self.session_id = session_id
        self.log_dir = log_dir or Path.home() / ".tehuti" / "traces"
        self.log_dir.mkdir(parents=True, exist_ok=True)
        self.events: list[dict[str, Any]] = []

    def log_event(self, event_type: str, data: dict[str, Any]) -> None:
        """Log an event."""
        event = {
            "timestamp": datetime.now().isoformat(),
            "session_id": self.session_id,
            "event_type": event_type,
            "data": data,
        }
        self.events.append(event)

    def log_turn_start(self, user_input: str) -> None:
        """Log the start of a turn."""
        self.log_event("turn_start", {"user_input": user_input})

    def log_thought(self, thought: str) -> None:
        """Log agent thought."""
        self.log_event("thought", {"thought": thought})

    def log_tool_call(self, tool_name: str, arguments: dict[str, Any]) -> None:
        """Log a tool call."""
        self.log_event("tool_call", {"tool": tool_name, "arguments": arguments})

    def log_tool_result(self, tool_name: str, success: bool, execution_time_ms: int) -> None:
        """Log a tool result."""
        self.log_event(
            "tool_result",
            {
                "tool": tool_name,
                "success": success,
                "execution_time_ms": execution_time_ms,
            },
        )

    def log_turn_end(self, response: str, tokens_used: int, latency_ms: int) -> None:
        """Log the end of a turn."""
        self.log_event(
            "turn_end",
            {
                "response": response,
                "tokens_used": tokens_used,
                "latency_ms": latency_ms,
            },
        )

    def log_error(self, error: str) -> None:
        """Log an error."""
        self.log_event("error", {"error": error})

    def save_trace(self) -> Path:
        """Save the trace to disk."""
        trace_path = self.log_dir / f"trace_{self.session_id}_{int(time.time())}.jsonl"

        with open(trace_path, "w") as f:
            for event in self.events:
                f.write(json.dumps(event) + "\n")

        return trace_path

    def get_summary(self) -> dict[str, Any]:
        """Get a summary of the trace."""
        turn_starts = [e for e in self.events if e["event_type"] == "turn_start"]
        tool_calls = [e for e in self.events if e["event_type"] == "tool_call"]
        errors = [e for e in self.events if e["event_type"] == "error"]

        return {
            "session_id": self.session_id,
            "total_turns": len(turn_starts),
            "total_tool_calls": len(tool_calls),
            "total_errors": len(errors),
            "duration_seconds": (
                (
                    datetime.fromisoformat(self.events[-1]["timestamp"])
                    - datetime.fromisoformat(self.events[0]["timestamp"])
                ).total_seconds()
                if len(self.events) >= 2
                else 0
            ),
        }


class AgentLoop:
    """Enhanced agent loop with ReAct pattern and observability."""

    def __init__(
        self,
        llm_client: Any,
        runtime: ToolRuntime,
        max_iterations: int = 10,
        enable_tracing: bool = True,
        parser_mode: str = "repair",
        progress_callback: Callable[[str, dict[str, Any]], None] | None = None,
        context_token_budget: int = 8000,
    ):
        self.llm = llm_client
        self.runtime = runtime
        self.max_iterations = max_iterations
        self.enable_tracing = enable_tracing
        mode = str(parser_mode or "repair").strip().lower()
        self.parser_mode = mode if mode in {"strict", "repair", "fallback"} else "repair"
        self.progress_callback = progress_callback
        self.context_token_budget = max(512, int(context_token_budget))

        self.state = AgentState()
        self.tracer: AgentTracer | None = None
        self._parser = StructuredOutputParser(AgentResponse)
        self._progress_sequence = 0
        self._loop_state = LoopState.INITIALIZED
        self._active_trace_id: str = ""
        self._active_turn_id: str = ""

    def _allowed_state_transitions(self) -> dict[LoopState, set[LoopState]]:
        return LOOP_STATE_TRANSITIONS

    def _stuck_cycle_backoff_seconds(self, repeated_tool_sig: int) -> float:
        base = max(0.1, float(getattr(self.runtime.config, "loop_stuck_backoff_base_seconds", 1.0)))
        cap = max(base, float(getattr(self.runtime.config, "loop_stuck_backoff_cap_seconds", 4.0)))
        exponent = max(0, repeated_tool_sig - 2)
        return min(base * (2 ** exponent), cap)

    def _transition_state(self, next_state: LoopState, turn: AgentTurn, reason: str = "") -> None:
        allowed = self._allowed_state_transitions()
        current = self._loop_state
        if current != next_state and next_state not in allowed.get(current, set()):
            raise AgentLoopError(
                f"Invalid loop state transition: {current.value} -> {next_state.value}",
                code="invalid_loop_state_transition",
                details={"from": current.value, "to": next_state.value},
            )
        self._loop_state = next_state
        turn.loop_state = next_state.value
        transition = {
            "from": current.value,
            "to": next_state.value,
            "at": datetime.now().isoformat(),
            "reason": reason,
        }
        turn.state_transitions.append(transition)
        self._emit_progress_event("state_transition", transition)

    def _tool_calls_signature(self, tool_calls: list[ToolCall]) -> str:
        serialized = [{"name": c.name, "arguments": c.arguments} for c in tool_calls]
        return json.dumps(serialized, sort_keys=True)

    def _emit_progress_event(self, event: str, data: dict[str, Any]) -> None:
        """Emit progress telemetry using a stable callback schema."""
        self._progress_sequence += 1
        payload = {
            "schema": PROGRESS_SCHEMA,
            "event_version": PROGRESS_EVENT_VERSION,
            "event": event,
            "sequence": self._progress_sequence,
            "session_id": self.state.session_id,
            "trace_id": self._active_trace_id,
            "turn_id": self._active_turn_id,
            "timestamp": datetime.now().isoformat(),
            "surface": "agent_loop",
            **(data or {}),
        }
        if self.tracer:
            self.tracer.log_event("progress", payload)
        if self.progress_callback:
            self.progress_callback(event, payload)

    def run(
        self,
        user_input: str,
        system_prompt: str | None = None,
        checkpoint_dir: Path | None = None,
        require_tool_evidence: bool = False,
    ) -> AgentTurn:
        """Run the agent loop for a single user input.

        Args:
            user_input: The user's input
            system_prompt: Optional system prompt override
            checkpoint_dir: Optional directory to save checkpoints

        Returns:
            The final AgentTurn with results
        """
        # Initialize tracer
        if self.enable_tracing:
            self.tracer = AgentTracer(self.state.session_id)
            self.tracer.log_turn_start(user_input)

        turn = AgentTurn(user_input=user_input)
        turn.parse_mode = self.parser_mode
        self._active_turn_id = turn.turn_id
        self._active_trace_id = str(uuid.uuid4())[:12]
        start_time = time.time()
        termination_reason = LoopTerminationReason.MAX_ITERATIONS
        self._loop_state = LoopState.INITIALIZED

        try:
            # Build conversation context
            self._transition_state(LoopState.BUILDING_CONTEXT, turn, reason="initialize_turn")
            messages = self._build_messages(user_input, system_prompt)

            iteration = 0
            previous_tool_sig = ""
            repeated_tool_sig = 0
            has_tool_evidence = False
            while iteration < self.max_iterations:
                iteration += 1
                self._emit_progress_event(
                    "iteration_start",
                    {"iteration": iteration, "max_iterations": self.max_iterations, "user_input": user_input},
                )

                # Get response from LLM
                self._transition_state(LoopState.LLM_REQUEST, turn, reason=f"iteration_{iteration}")
                llm_start = time.time()
                response_text = self.llm.chat_messages(messages)
                llm_latency_ms = int((time.time() - llm_start) * 1000)

                # Parse structured response
                self._transition_state(LoopState.PARSING_RESPONSE, turn, reason=f"iteration_{iteration}")
                try:
                    agent_response = self._parse_agent_response(response_text, turn)
                except AgentLoopError:
                    termination_reason = LoopTerminationReason.PARSER_ERROR
                    turn.response = "Unable to parse model response safely."
                    turn.should_continue = False
                    self._transition_state(LoopState.FINALIZING, turn, reason="parser_error")
                    break

                # Record thought
                if agent_response.thought:
                    turn.thought = agent_response.thought
                    if self.tracer:
                        self.tracer.log_thought(agent_response.thought)
                    self._emit_progress_event("thought", {"thought": agent_response.thought, "iteration": iteration})

                # Check if we should continue with tool calls
                if not agent_response.tool_calls:
                    # Final response
                    if require_tool_evidence and not has_tool_evidence:
                        self._emit_progress_event(
                            "evidence_required",
                            {
                                "iteration": iteration,
                                "reason": "no_tool_evidence",
                            },
                        )
                        self._transition_state(LoopState.UPDATING_CONTEXT, turn, reason="evidence_required")
                        messages.append({"role": "assistant", "content": response_text})
                        messages.append(
                            {
                                "role": "system",
                                "content": (
                                    "You must execute at least one tool call before returning a final response. "
                                    "Return JSON with tool_calls and should_continue=true."
                                ),
                            }
                        )
                        continue
                    self._transition_state(LoopState.FINALIZING, turn, reason="no_tool_calls")
                    turn.response = agent_response.content or response_text
                    turn.should_continue = bool(agent_response.should_continue)
                    if turn.should_continue:
                        termination_reason = LoopTerminationReason.SHOULD_CONTINUE_WITHOUT_TOOLS
                    else:
                        termination_reason = LoopTerminationReason.FINAL_RESPONSE
                    self._emit_progress_event(
                        "iteration_end",
                        {
                            "iteration": iteration,
                            "llm_latency_ms": llm_latency_ms,
                            "tool_calls": 0,
                            "termination_reason": termination_reason.value,
                        },
                    )
                    break

                # Execute tool calls
                current_sig = self._tool_calls_signature(agent_response.tool_calls)
                if current_sig == previous_tool_sig:
                    repeated_tool_sig += 1
                else:
                    repeated_tool_sig = 0
                    previous_tool_sig = current_sig
                if repeated_tool_sig >= 2:
                    backoff_s = self._stuck_cycle_backoff_seconds(repeated_tool_sig)
                    self._emit_progress_event(
                        "stuck_detected",
                        {
                            "iteration": iteration,
                            "repeated_signature_count": repeated_tool_sig + 1,
                            "backoff_seconds": backoff_s,
                        },
                    )
                    time.sleep(backoff_s)
                if repeated_tool_sig >= 3:
                    turn.response = "Stopped due to repeated identical tool-call cycles."
                    turn.should_continue = False
                    termination_reason = LoopTerminationReason.STUCK_DETECTED
                    self._transition_state(LoopState.FINALIZING, turn, reason="stuck_detected")
                    break

                self._transition_state(LoopState.EXECUTING_TOOLS, turn, reason=f"iteration_{iteration}")
                tool_results = self._execute_tool_calls(agent_response.tool_calls)
                turn.tool_calls.extend(agent_response.tool_calls)
                turn.tool_results.extend(tool_results)
                failed_tool_calls = sum(1 for result in tool_results if not result.success)
                has_tool_evidence = has_tool_evidence or any(result.success for result in tool_results)
                self._emit_progress_event(
                    "iteration_end",
                    {
                        "iteration": iteration,
                        "llm_latency_ms": llm_latency_ms,
                        "tool_calls": len(agent_response.tool_calls),
                        "failed_tool_calls": failed_tool_calls,
                    },
                )

                # Update messages for next iteration
                self._transition_state(LoopState.UPDATING_CONTEXT, turn, reason=f"iteration_{iteration}")
                messages.append({"role": "assistant", "content": response_text})
                messages.append({"role": "user", "content": self._format_tool_results(tool_results)})

            turn.iterations = iteration
            if not turn.response and require_tool_evidence and not has_tool_evidence:
                turn.response = (
                    "Stopped without sufficient evidence: no successful tool result was collected. "
                    "Refine the task and retry."
                )
                turn.should_continue = False
                termination_reason = LoopTerminationReason.INSUFFICIENT_EVIDENCE
                if self._loop_state not in {LoopState.FINALIZING, LoopState.TERMINATED}:
                    self._transition_state(LoopState.FINALIZING, turn, reason="insufficient_evidence")
            elif not turn.response and iteration >= self.max_iterations:
                turn.response = (
                    f"Stopped after {self.max_iterations} iterations without a final response. "
                    "Review tool outputs and continue if needed."
                )
                turn.should_continue = False
                termination_reason = LoopTerminationReason.MAX_ITERATIONS
                if self._loop_state not in {LoopState.FINALIZING, LoopState.TERMINATED}:
                    self._transition_state(LoopState.FINALIZING, turn, reason="iteration_cap")
            turn.latency_ms = int((time.time() - start_time) * 1000)
            turn.termination_reason = termination_reason.value
            self._transition_state(LoopState.TERMINATED, turn, reason=turn.termination_reason)
            self._emit_progress_event(
                "loop_terminated",
                {
                    "iterations": turn.iterations,
                    "termination_reason": turn.termination_reason,
                    "has_error": bool(turn.error),
                },
            )

            # Save checkpoint
            if checkpoint_dir:
                self.state.save_checkpoint(checkpoint_dir)

            # Log completion
            if self.tracer:
                self.tracer.log_turn_end(turn.response or "", turn.tokens_used, turn.latency_ms)
                self.tracer.save_trace()

            # Add turn to state
            self.state.add_turn(turn)

        except Exception as e:
            turn.error = str(e)
            turn.should_continue = False
            turn.termination_reason = LoopTerminationReason.LOOP_EXCEPTION.value
            try:
                self._loop_state = LoopState.ERROR
                turn.loop_state = LoopState.ERROR.value
            except Exception:
                pass
            self._emit_progress_event(
                "loop_error",
                {"error": str(e), "termination_reason": turn.termination_reason},
            )
            if self.tracer:
                self.tracer.log_error(str(e))
            raise

        return turn

    def _build_messages(
        self,
        user_input: str,
        system_prompt: str | None = None,
    ) -> list[dict[str, str]]:
        """Build the message list for the LLM."""
        messages: list[dict[str, str]] = []

        # Add system prompt
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        else:
            messages.append({"role": "system", "content": self._get_default_system_prompt()})

        def _estimate_tokens(text: str) -> int:
            return max(1, len(text) // 4) if text else 0

        budget = self.context_token_budget
        used = sum(_estimate_tokens(m.get("content", "")) for m in messages) + _estimate_tokens(user_input)

        # Add as much recent history as fits within the token budget.
        selected_pairs: list[list[dict[str, str]]] = []
        for past_turn in reversed(self.state.get_recent_turns(20)):
            pair: list[dict[str, str]] = [{"role": "user", "content": past_turn.user_input}]
            if past_turn.response:
                pair.append({"role": "assistant", "content": past_turn.response})
            pair_tokens = sum(_estimate_tokens(item["content"]) for item in pair)
            if used + pair_tokens > budget:
                continue
            selected_pairs.append(pair)
            used += pair_tokens

        for pair in reversed(selected_pairs):
            messages.extend(pair)

        # Add current input
        messages.append({"role": "user", "content": user_input})

        return messages

    def _get_default_system_prompt(self) -> str:
        """Get the default system prompt with tool instructions."""
        return """You are Tehuti, an advanced AI assistant with access to tools.

Respond in JSON format:
{
  "thought": "Your reasoning about what to do",
  "tool_calls": [
    {
      "name": "tool_name",
      "arguments": {"arg1": "value1"},
      "call_id": "optional-id"
    }
  ],
  "content": "Your response to the user",
  "should_continue": false
}

If you need to use tools, set should_continue to true and include tool_calls.
If you're ready to respond to the user, set should_continue to false and provide content.

Available tools include: read, write, edit, shell, fetch, web_search, docker_ps, git_status, etc.

Be concise but thorough in your reasoning."""

    def _execute_tool_calls(self, tool_calls: list[ToolCall]) -> list[ToolResultOutput]:
        """Execute a list of tool calls."""
        results = []

        total_calls = len(tool_calls)
        for index, call in enumerate(tool_calls, start=1):
            tool_start = time.time()
            if self.tracer:
                self.tracer.log_tool_call(call.name, call.arguments)
            self._emit_progress_event(
                "tool_start",
                {
                    "index": index,
                    "total": total_calls,
                    "tool": call.name,
                    "arguments": call.arguments,
                },
            )

            try:
                # Execute via normalized tool contract
                contract = self.runtime.execute_contract(call.name, call.arguments)
                result_ok = bool(contract.get("result", {}).get("ok", False))
                result_output = str(contract.get("result", {}).get("output", ""))
                trace = contract.get("trace", {})
                trace_id = str(trace.get("trace_id", ""))
                error_payload = contract.get("error")

                execution_time_ms = int((time.time() - tool_start) * 1000)

                tool_result = ToolResultOutput(
                    success=result_ok,
                    result=result_output,
                    error=None if result_ok else result_output,
                    execution_time_ms=execution_time_ms,
                )

                if self.tracer:
                    self.tracer.log_tool_result(call.name, result_ok, execution_time_ms)
                self._emit_progress_event(
                    "tool_end",
                    {
                        "index": index,
                        "total": total_calls,
                        "tool": call.name,
                        "arguments": call.arguments,
                        "success": result_ok,
                        "result": result_output,
                        "error": None if result_ok else result_output,
                        "trace_id": trace_id,
                        "contract_schema": contract.get("schema"),
                        "error_payload": error_payload,
                        "execution_time_ms": execution_time_ms,
                    },
                )

            except Exception as e:
                execution_time_ms = int((time.time() - tool_start) * 1000)
                tool_result = ToolResultOutput(
                    success=False, result=None, error=str(e), execution_time_ms=execution_time_ms
                )

                if self.tracer:
                    self.tracer.log_tool_result(call.name, False, execution_time_ms)
                self._emit_progress_event(
                    "tool_end",
                    {
                        "index": index,
                        "total": total_calls,
                        "tool": call.name,
                        "arguments": call.arguments,
                        "success": False,
                        "result": None,
                        "error": str(e),
                        "execution_time_ms": execution_time_ms,
                    },
                )

            results.append(tool_result)

        return results

    def _format_tool_results(self, results: list[ToolResultOutput]) -> str:
        """Format tool results for the LLM."""
        lines = ["Tool execution results:"]

        for i, result in enumerate(results, 1):
            status = "✓" if result.success else "✗"
            lines.append(f"\n{status} Tool {i}:")
            if result.success:
                lines.append(f"Result: {result.result}")
            else:
                lines.append(f"Error: {result.error}")
            if result.execution_time_ms:
                lines.append(f"Time: {result.execution_time_ms}ms")

        lines.append("\nPlease provide your next response or tool calls.")

        return "\n".join(lines)

    def _parse_agent_response(self, response_text: str, turn: AgentTurn) -> AgentResponse:
        """Parse model output according to parser mode."""
        if self.parser_mode == "strict":
            try:
                parsed = self._parser.parse(response_text)
                turn.parse_status = "structured"
                return parsed
            except Exception as exc:
                turn.parse_status = "error"
                raise AgentLoopError(
                    "Structured parse failed in strict mode.",
                    code="parse_failed_strict",
                    details={"error": str(exc)},
                ) from exc

        if self.parser_mode == "fallback":
            parsed, fallback = self._parser.parse_or_fallback(response_text)
            if parsed is not None:
                turn.parse_status = "structured"
                return parsed
            turn.parse_status = "fallback_text"
            return AgentResponse(content=fallback, should_continue=False)

        # repair mode: parse structured output, then repair with AgentResponse.from_text
        parsed, fallback = self._parser.parse_or_fallback(response_text)
        if parsed is not None:
            turn.parse_status = "structured"
            return parsed
        repaired, plain_text = AgentResponse.from_text(fallback)
        if repaired is not None:
            turn.parse_status = "repaired"
            return repaired
        turn.parse_status = "fallback_text"
        return AgentResponse(content=plain_text, should_continue=False)

    def get_metrics(self) -> dict[str, Any]:
        """Get metrics about agent performance."""
        total_turns = len(self.state.turns)
        total_tool_calls = sum(len(t.tool_calls) for t in self.state.turns)
        avg_latency = sum(t.latency_ms for t in self.state.turns) / total_turns if total_turns > 0 else 0

        return {
            "session_id": self.state.session_id,
            "total_turns": total_turns,
            "total_tool_calls": total_tool_calls,
            "average_latency_ms": int(avg_latency),
        }
