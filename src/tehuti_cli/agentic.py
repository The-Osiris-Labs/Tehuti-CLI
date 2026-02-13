"""Integration module for Tehuti agentic system.

This module provides a high-level API that integrates all the agentic improvements:
- Structured outputs
- Enhanced agent loop
- Memory management
- Observability
"""

from __future__ import annotations

from pathlib import Path
from typing import Any
from typing import Callable
import time
import uuid

from tehuti_cli.providers.llm import TehutiLLM
from tehuti_cli.providers.enhanced_llm import EnhancedLLM, enhance_llm
from tehuti_cli.core.runtime import ToolRuntime
from tehuti_cli.core.agent_loop import AgentLoop, AgentTurn, AgentState
from tehuti_cli.core.memory import AgentMemory, ContextManager, ConversationSummarizer
from tehuti_cli.core.structured_output import (
    AgentResponse,
    ToolCall,
    ToolSchema,
    FileEditOutput,
    ShellCommandOutput,
    AnalysisOutput,
    CodeReviewOutput,
)
from tehuti_cli.storage.config import Config
from tehuti_cli.core.telemetry import get_telemetry


class TehutiAgent:
    """High-level agent interface with all modern agentic features."""

    def __init__(
        self,
        config: Config,
        work_dir: Path | None = None,
        enable_memory: bool = True,
        enable_tracing: bool = True,
        session_id: str | None = None,
        progress_callback: Callable[[str, dict[str, Any]], None] | None = None,
        parser_mode: str | None = None,
    ):
        """Initialize the Tehuti Agent.

        Args:
            config: Tehuti configuration
            work_dir: Working directory (defaults to current directory)
            enable_memory: Whether to enable semantic memory
            enable_tracing: Whether to enable execution tracing
            session_id: Optional session ID for resuming
        """
        self.config = config
        self.work_dir = work_dir or Path.cwd()

        # Initialize components
        self.base_llm = TehutiLLM(config)
        self.enhanced_llm = enhance_llm(self.base_llm)
        self.runtime = ToolRuntime(config, self.work_dir)
        self.agent_loop = AgentLoop(
            llm_client=self.base_llm,
            runtime=self.runtime,
            enable_tracing=enable_tracing,
            parser_mode=(parser_mode or str(getattr(config, "agent_parser_mode", "repair"))),
            progress_callback=progress_callback,
        )

        # Load session if provided
        if session_id:
            self.agent_loop.state = AgentState(session_id=session_id)

        # Initialize memory
        if enable_memory:
            memory_path = Path.home() / ".tehuti" / "memory" / f"{self.agent_loop.state.session_id}.json"
            self.memory = AgentMemory(storage_path=memory_path)
            self.context_manager = ContextManager(
                memory=self.memory,
                max_context_length=10,
            )
        else:
            self.memory = None
            self.context_manager = None

    def chat(
        self,
        message: str,
        system_prompt: str | None = None,
        use_structured: bool = True,
    ) -> AgentTurn:
        """Send a message to the agent and get a response.

        Args:
            message: User message
            system_prompt: Optional custom system prompt
            use_structured: Whether to request structured output

        Returns:
            AgentTurn with full interaction details
        """
        # Enrich prompt with memory context when available.
        effective_system = self._compose_system_prompt(message, base_prompt=system_prompt)
        if self.context_manager:
            self.context_manager.add_message("user", message)

        # Use enhanced agent loop
        turn = self.agent_loop.run(
            user_input=message,
            system_prompt=effective_system,
            require_tool_evidence=False,
        )

        # Store in memory/context if enabled.
        if turn.response:
            if self.context_manager:
                self.context_manager.add_message("assistant", turn.response)
                self.context_manager.remember_interaction(message, turn.response, importance=0.7)
            elif self.memory:
                self.memory.add(
                    content=f"User: {message}\nAgent: {turn.response}",
                    category="conversation",
                    importance=0.7,
                )

        return turn

    def execute_task(
        self,
        task_description: str,
        max_iterations: int = 10,
    ) -> dict[str, Any]:
        """Execute a complex task with autonomous tool use.

        Args:
            task_description: Description of the task
            max_iterations: Maximum tool call iterations

        Returns:
            Dict with results and metadata
        """
        # Update max iterations
        original_max = self.agent_loop.max_iterations
        self.agent_loop.max_iterations = max_iterations

        started = time.perf_counter()
        usage_before = self.base_llm.token_usage.to_dict()
        try:
            trace_id = str(uuid.uuid4())[:12]
            base_prompt = f"""You are an autonomous task executor.
Your goal: {task_description}

Use available tools to complete the task. Think step by step:
1. Analyze what needs to be done
2. Plan your approach
3. Execute using tools
4. Verify results
5. Report completion

Respond in JSON format with your thought process and tool calls."""
            system_prompt = self._compose_system_prompt(task_description, base_prompt=base_prompt)
            if self.context_manager:
                self.context_manager.add_message("user", task_description)

            turn = self.agent_loop.run(
                user_input=task_description,
                system_prompt=system_prompt,
                require_tool_evidence=bool(getattr(self.config, "require_tool_evidence", True)),
            )
            if turn.response and self.context_manager:
                self.context_manager.add_message("assistant", turn.response)
                self.context_manager.remember_interaction(task_description, turn.response, importance=0.9)
            reconciliation = self._reconcile_work_tracking(turn)
            task_result = {
                "schema": "tehuti.agent_task.v1",
                "success": turn.error is None,
                "trace_id": trace_id,
                "turn_id": turn.turn_id,
                "session_id": self.agent_loop.state.session_id,
                "response": turn.response,
                "thoughts": turn.thought,
                "tool_calls": [tc.model_dump() for tc in turn.tool_calls],
                "iterations": turn.iterations,
                "latency_ms": turn.latency_ms,
                "error": turn.error,
                "parse_status": turn.parse_status,
                "parse_mode": turn.parse_mode,
                "termination_reason": turn.termination_reason,
                "reconciliation": reconciliation,
            }
            response_text = str(task_result.get("response") or "")
            token_estimate = max(1, len(response_text) // 4) if response_text else 0
            # Conservative fixed-rate estimate for observability only.
            cost_estimate_usd = round((token_estimate / 1_000_000.0) * 0.5, 8)
            task_result["token_estimate"] = token_estimate
            task_result["cost_estimate_usd"] = cost_estimate_usd
            usage_after = self.base_llm.token_usage.to_dict()
            before_actual_tokens = int(usage_before.get("actual_total_tokens", 0) or 0)
            after_actual_tokens = int(usage_after.get("actual_total_tokens", 0) or 0)
            token_actual_source = "provider"
            if before_actual_tokens == 0 and after_actual_tokens == 0:
                before_actual_tokens = int(usage_before.get("total_tokens", 0) or 0)
                after_actual_tokens = int(usage_after.get("total_tokens", 0) or 0)
                token_actual_source = "estimate_fallback"
            token_actual = max(0, after_actual_tokens - before_actual_tokens)

            before_actual_cost = float(usage_before.get("actual_cost", 0.0) or 0.0)
            after_actual_cost = float(usage_after.get("actual_cost", 0.0) or 0.0)
            cost_actual_source = "provider"
            if before_actual_cost == 0.0 and after_actual_cost == 0.0:
                before_actual_cost = float(usage_before.get("estimated_cost", 0.0) or 0.0)
                after_actual_cost = float(usage_after.get("estimated_cost", 0.0) or 0.0)
                cost_actual_source = "estimate_fallback"
            cost_actual_usd = round(max(0.0, after_actual_cost - before_actual_cost), 8)
            task_result["token_actual"] = token_actual
            task_result["cost_actual_usd"] = cost_actual_usd
            task_result["token_actual_source"] = token_actual_source
            task_result["cost_actual_source"] = cost_actual_source
            get_telemetry().record_agent_task(
                success=bool(task_result["success"]),
                latency_ms=int((time.perf_counter() - started) * 1000),
                surface="agent_task",
                provider=str(getattr(self.base_llm.config.provider, "type", "unknown")),
                token_estimate=token_estimate,
                cost_estimate_usd=cost_estimate_usd,
                token_actual=token_actual,
                cost_actual_usd=cost_actual_usd,
                trace_id=trace_id,
                turn_id=turn.turn_id,
                token_actual_source=token_actual_source,
                cost_actual_source=cost_actual_source,
                error_code=None if bool(task_result["success"]) else "agent_task_failed",
            )
            return task_result

        finally:
            self.agent_loop.max_iterations = original_max

    def remember(self, content: str, category: str = "general", importance: float = 1.0) -> None:
        """Store information in the agent's memory.

        Args:
            content: Information to remember
            category: Category for organization
            importance: Importance score (0-1)
        """
        if self.memory:
            self.memory.add(content, category, importance)

    def recall(self, query: str, top_k: int = 5) -> list[tuple[str, float]]:
        """Recall relevant information from memory.

        Args:
            query: Search query
            top_k: Number of results

        Returns:
            List of (content, relevance_score) tuples
        """
        if not self.memory:
            return []

        results = self.memory.search(query, top_k=top_k)
        return [(entry.content, score) for entry, score in results]

    def get_metrics(self) -> dict[str, Any]:
        """Get agent performance metrics."""
        metrics = self.agent_loop.get_metrics()

        if self.memory:
            metrics["memory_entries"] = len(self.memory.entries)

        return metrics

    def _compose_system_prompt(self, query: str, *, base_prompt: str | None = None) -> str:
        prompt = (base_prompt or "").strip()
        if self.memory:
            relevant = self.memory.search_fused(query, top_k=3)
            if relevant:
                lines = ["Relevant context from memory:"]
                for entry, _score in relevant:
                    lines.append(f"- {entry.content}")
                memory_block = "\n".join(lines)
                prompt = f"{prompt}\n\n{memory_block}".strip() if prompt else memory_block
        return prompt

    def _reconcile_work_tracking(self, turn: AgentTurn) -> dict[str, Any]:
        created = 0
        updated = 0
        completed = 0
        failed = 0
        for call, result in zip(turn.tool_calls, turn.tool_results):
            if not result.success:
                failed += 1
                continue
            name = str(call.name or "")
            args = call.arguments if isinstance(call.arguments, dict) else {}
            if name == "task_create":
                created += 1
            elif name == "task_update":
                updated += 1
                if str(args.get("status", "")).strip().lower() == "completed":
                    completed += 1
        return {
            "created": created,
            "updated": updated,
            "completed": completed,
            "failed": failed,
            "tool_events": len(turn.tool_calls),
        }

    def save_session(self, checkpoint_dir: Path | None = None) -> Path:
        """Save the current session state.

        Args:
            checkpoint_dir: Directory to save checkpoint

        Returns:
            Path to saved checkpoint
        """
        if checkpoint_dir is None:
            checkpoint_dir = Path.home() / ".tehuti" / "checkpoints"

        checkpoint_path = self.agent_loop.state.save_checkpoint(checkpoint_dir)

        if self.memory:
            self.memory._save()

        return checkpoint_path

    def load_session(self, checkpoint_path: Path) -> None:
        """Load a session from a checkpoint.

        Args:
            checkpoint_path: Path to checkpoint file
        """
        self.agent_loop.state = AgentState.load_checkpoint(checkpoint_path)

        # Reload memory for this session
        if self.memory:
            memory_path = Path.home() / ".tehuti" / "memory" / f"{self.agent_loop.state.session_id}.json"
            self.memory = AgentMemory(storage_path=memory_path)

    def analyze_code(
        self,
        code: str,
        language: str = "python",
    ) -> AnalysisOutput:
        """Analyze code using structured output.

        Args:
            code: Code to analyze
            language: Programming language

        Returns:
            Structured analysis output
        """
        prompt = f"Analyze this {language} code:\n\n```{language}\n{code}\n```"

        messages = [
            {"role": "system", "content": "You are a code analysis expert. Provide structured analysis."},
            {"role": "user", "content": prompt},
        ]

        return self.enhanced_llm.chat_structured(messages, AnalysisOutput)

    def review_code(
        self,
        code: str,
        context: str | None = None,
    ) -> CodeReviewOutput:
        """Review code with structured output.

        Args:
            code: Code to review
            context: Optional context about the code

        Returns:
            Structured code review output
        """
        prompt = f"Review this code:\n\n```\n{code}\n```"
        if context:
            prompt += f"\n\nContext: {context}"

        messages = [
            {"role": "system", "content": "You are a senior code reviewer. Provide thorough, structured feedback."},
            {"role": "user", "content": prompt},
        ]

        return self.enhanced_llm.chat_structured(messages, CodeReviewOutput)

    def plan_edit(
        self,
        file_path: str,
        instruction: str,
    ) -> FileEditOutput:
        """Plan a file edit operation.

        Args:
            file_path: Path to the file
            instruction: What to change

        Returns:
            Structured edit plan
        """
        # Read current file content
        result = self.runtime.sandbox.read_file(Path(file_path))
        if not result.ok:
            raise FileNotFoundError(f"Could not read {file_path}")

        current_content = result.output

        prompt = f"""Edit this file according to the instruction.

File: {file_path}

Current content:
```
{current_content}
```

Instruction: {instruction}

Provide the exact strings to find and replace."""

        messages = [
            {"role": "system", "content": "You are a precise file editor. Provide exact find/replace strings."},
            {"role": "user", "content": prompt},
        ]

        return self.enhanced_llm.chat_structured(messages, FileEditOutput)

    def generate_shell_command(
        self,
        task: str,
        safe_mode: bool = True,
    ) -> ShellCommandOutput:
        """Generate a shell command for a task.

        Args:
            task: Description of what to do
            safe_mode: If True, avoid destructive operations

        Returns:
            Structured command output
        """
        safety_note = "\n\nIMPORTANT: Only generate safe, read-only commands." if safe_mode else ""

        prompt = f"Generate a shell command for this task: {task}{safety_note}"

        messages = [
            {"role": "system", "content": "You are a shell command expert. Generate precise, safe commands."},
            {"role": "user", "content": prompt},
        ]

        return self.enhanced_llm.chat_structured(messages, ShellCommandOutput)

    def get_available_tools(self) -> list[ToolSchema]:
        """Get list of available tools."""
        return self.enhanced_llm.get_available_tools()

    def get_session_info(self) -> dict[str, Any]:
        """Get information about the current session."""
        return {
            "session_id": self.agent_loop.state.session_id,
            "work_dir": str(self.work_dir),
            "model": self.config.provider.model,
            "provider": self.config.provider.type,
            "total_turns": len(self.agent_loop.state.turns),
            "memory_enabled": self.memory is not None,
        }


# Factory function for easy creation
def create_agent(
    work_dir: Path | str | None = None,
    config: Config | None = None,
    **kwargs,
) -> TehutiAgent:
    """Create a TehutiAgent with sensible defaults.

    Args:
        work_dir: Working directory
        config: Optional config (loads default if not provided)
        **kwargs: Additional arguments passed to TehutiAgent

    Returns:
        Configured TehutiAgent instance
    """
    from tehuti_cli.storage.config import load_config

    if config is None:
        config = load_config()

    if work_dir is not None:
        work_dir = Path(work_dir)

    return TehutiAgent(config=config, work_dir=work_dir, **kwargs)
