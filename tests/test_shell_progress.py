from __future__ import annotations

from io import StringIO
from types import SimpleNamespace
from pathlib import Path

from rich.console import Console

from tehuti_cli.advanced_tools import ToolResult
from tehuti_cli.ui.shell import Shell


def _shell_stub(progress_verbosity: str = "standard") -> Shell:
    shell = Shell.__new__(Shell)
    shell.config = SimpleNamespace(progress_verbosity=progress_verbosity)
    shell.console = SimpleNamespace(print=lambda *_args, **_kwargs: None)
    shell.session = SimpleNamespace(id="s-1", append_wire=lambda *_args, **_kwargs: None)
    shell._phase_sequence = 0
    shell._phase_started_at = None
    shell._phase_events = []
    shell._turn_progress_events = []
    shell._turn_activity_events = []
    shell._tool_stream_event_count = 0
    shell._tool_stream_event_limit = 24
    return shell


def _shell_envelope_stub() -> Shell:
    shell = _shell_stub()
    shell.config.experimental_flags = []
    shell.session = SimpleNamespace(
        id="s-1",
        payloads=[],
        append_wire=lambda payload: shell.session.payloads.append(payload),
    )
    shell.console = SimpleNamespace(print=lambda *_args, **_kwargs: None)
    return shell


def test_tool_preview_helpers_produce_relevant_text() -> None:
    shell = _shell_stub()

    assert shell._tool_relevance("read", "fix test") == "inspect source context"
    assert shell._tool_relevance("shell", "fix test", {"command": "pwd"}) == "confirm current working directory"
    assert (
        shell._tool_relevance(
            "shell",
            "fix test",
            {"command": "test -w . && echo workspace_writable || echo workspace_readonly"},
        )
        == "verify workspace write access"
    )
    assert shell._tool_relevance("shell", "fix test", {"command": "pytest -q"}) == "run verification command"
    assert shell._tool_relevance("unknown_tool", "fix test") == "advance objective: fix test"

    assert shell._tool_args_preview("read", {"path": "src/main.py"}) == "src/main.py"
    assert shell._tool_args_preview("shell", {"command": "pytest -q"}) == "pytest -q"
    assert shell._tool_args_preview("write", {"path": "a.txt", "content": "abc"}) == "a.txt (3 chars)"


def test_minion_working_on_extraction_strips_noise() -> None:
    shell = _shell_stub()

    assert shell._extract_minion_work_line("[gold] Executing: rg -n TODO") == "working: rg -n TODO"
    assert shell._extract_minion_work_line("INFO: compiling tests") == "compiling tests"
    assert shell._extract_minion_work_line("") == ""


def test_show_turn_meta_suppresses_noise_for_short_chat() -> None:
    shell = _shell_stub()
    assert shell._show_turn_meta("hi", actions=[]) is False
    assert shell._show_turn_meta("tell me a joke", actions=[]) is False
    assert shell._show_turn_meta("please read file.py", actions=[]) is False
    shell.config.progress_verbosity = "verbose"
    assert shell._show_turn_meta("please read file.py", actions=[]) is True


def test_print_welcome_is_compact_without_banner() -> None:
    shell = _shell_stub()
    stream = StringIO()
    shell.console = Console(file=stream, force_terminal=False, color_system=None)
    shell._show_banner = False
    shell.work_dir = "/tmp/project"
    shell.session = SimpleNamespace(id="s-1")
    shell.config.provider = SimpleNamespace(type="openrouter", model="qwen/test")
    shell._print_welcome()
    output = stream.getvalue()
    assert "Tehuti" in output
    assert "Tip:" in output
    assert "████████" not in output


def test_print_welcome_shows_missing_key_and_free_tier_hints(tmp_path: Path) -> None:
    shell = _shell_stub()
    stream = StringIO()
    shell.console = Console(file=stream, force_terminal=False, color_system=None)
    shell._show_banner = False
    shell.work_dir = "/tmp/project"
    shell.session = SimpleNamespace(id="s-1")
    shell.config.provider = SimpleNamespace(
        type="openrouter",
        model="qwen/qwen3-coder:free",
        api_key_env="OPENROUTER_API_KEY",
    )
    shell.config.keys_file = tmp_path / "keys.env"

    shell._print_welcome()

    output = stream.getvalue()
    assert "Missing OPENROUTER_API_KEY" in output
    assert "Free-tier models may be rate-limited/unavailable" in output


def test_sanitize_response_preserves_user_content_without_rigged_filtering() -> None:
    shell = _shell_stub()

    text = "Tool results are shown above.\nActual summary line.\nSee output below."
    cleaned = shell._sanitize_response(text)
    assert cleaned == text


def test_dynamic_response_from_actions_prefers_real_outputs() -> None:
    shell = _shell_stub()

    actions = [
        {
            "output": "",
            "inline": ["line 1", "line 2"],
            "evidence": "2 lines",
        }
    ]
    assert shell._dynamic_response_from_actions(actions, []) == "line 1\nline 2"


def test_progress_verbosity_defaults_to_standard_for_invalid_values() -> None:
    shell = _shell_stub("loud")
    assert shell._progress_verbosity() == "standard"


def test_retry_minimal_reply_has_no_canned_fallback() -> None:
    shell = _shell_stub()

    class _LLM:
        def chat_messages(self, _messages):
            raise RuntimeError("temporary failure")

    shell.llm = _LLM()
    assert shell._retry_minimal_reply([{"role": "user", "content": "x"}]) == ""


def test_run_with_tools_returns_user_friendly_model_error() -> None:
    shell = _shell_stub()

    class _LLM:
        def chat_messages(self, _messages):
            raise RuntimeError("Provider key spend limit exceeded")

    shell.llm = _LLM()
    shell.logger = SimpleNamespace(exception=lambda *_args, **_kwargs: None)
    response, tool_outputs, actions = shell._run_with_tools([{"role": "user", "content": "x"}])
    assert response.startswith("Model request failed:")
    assert tool_outputs == []
    assert actions == []


def test_provider_error_message_normalizes_spend_limit_payload() -> None:
    shell = _shell_stub()
    message = shell._provider_error_message(
        '{"error":{"message":"Provider returned error","code":402,"metadata":{"raw":"USD spend limit exceeded"}}}'
    )
    assert message is not None
    assert "spend limit reached" in message


def test_run_with_tools_returns_normalized_provider_error_message() -> None:
    shell = _shell_stub()

    class _LLM:
        def chat_messages(self, _messages):
            return (
                '{"error":{"message":"Provider returned error","code":402,'
                '"metadata":{"raw":"API key USD spend limit exceeded"}}}'
            )

    shell.llm = _LLM()
    shell.logger = SimpleNamespace(exception=lambda *_args, **_kwargs: None)
    shell.config.provider = SimpleNamespace(type="openrouter", model="test-model")
    shell._emit_phase_event = lambda *_args, **_kwargs: None  # type: ignore[method-assign]
    response, tool_outputs, actions = shell._run_with_tools([{"role": "user", "content": "x"}])
    assert "spend limit reached" in response.lower()
    assert tool_outputs == []
    assert actions == []


def test_is_provider_or_model_failure_response_detection() -> None:
    shell = _shell_stub()
    assert shell._is_provider_or_model_failure_response("Model request failed: Provider rejected the request")
    assert shell._is_provider_or_model_failure_response("Provider error: upstream timeout")
    assert not shell._is_provider_or_model_failure_response("All checks passed.")


def test_should_run_local_capability_demo_from_prompt_intent() -> None:
    shell = _shell_stub()
    assert shell._should_run_local_capability_demo("Tell me your capabilities and demonstrate non-destructively")
    assert not shell._should_run_local_capability_demo("hello there")


def test_run_local_capability_demo_without_shell_permission() -> None:
    shell = _shell_stub()
    shell.registry = SimpleNamespace(list_tools=lambda: [SimpleNamespace(name="read"), SimpleNamespace(name="shell")])
    shell.config.allow_shell = False
    response, outputs, actions = shell._run_local_capability_demo()
    assert "Registered tools available: 2." in response
    assert "shell permission is disabled" in response
    assert outputs == []
    assert actions == []


def test_write_evidence_is_dynamic_size_and_line_count() -> None:
    shell = _shell_stub()
    evidence = shell._evidence_for_tool("write", {"content": "a\nb\n"}, "")
    assert evidence == "4 bytes (2 lines)"


def test_thinking_message_is_dynamic_not_canned() -> None:
    shell = _shell_stub()
    message = shell._get_thinking_message("fix traceback in parser quickly")
    assert "processing" in message
    assert "focus:" in message
    assert "awakening" not in message.lower()


def test_turn_plan_default_is_evidence_oriented() -> None:
    shell = _shell_stub()
    plan = shell._build_turn_plan("summarize current repository status")
    assert len(plan) == 3
    assert plan[0] == "gather live context from tools"
    assert "evidence" in plan[-1]


def test_progress_summary_values_are_dynamic() -> None:
    shell = _shell_stub()
    summary = shell._progress_summary_values(
        actions=[{"ok": True, "output": "line"}, {"ok": False, "output": ""}],
        response="first\nsecond",
    )
    assert summary["actions"] == "1/2 succeeded, 1 failed"
    assert summary["evidence"] == "1 action outputs"
    assert summary["response"] == "2 lines, 12 chars"


def test_progress_summary_values_with_no_actions() -> None:
    shell = _shell_stub()
    summary = shell._progress_summary_values(actions=[], response="")
    assert summary["actions"] == "no tool actions executed"
    assert summary["response"] == "no response content"


def test_progress_summary_values_marks_provider_blocked_when_no_actions() -> None:
    shell = _shell_stub()
    summary = shell._progress_summary_values(
        actions=[],
        response="Model request failed: Provider rejected the request due to account/billing limits.",
    )
    assert summary["actions"] == "execution blocked before tools"


def test_chat_messages_with_phase_emits_model_start_and_done() -> None:
    shell = _shell_stub()
    shell.config.provider = SimpleNamespace(type="openrouter", model="test-model")
    emitted: list[tuple[str, str, str]] = []

    def _emit(phase: str, detail: str = "", *, status: str = "progress", meta=None) -> None:
        emitted.append((phase, detail, status))

    class _LLM:
        def chat_messages(self, _messages):
            return "ok"

    shell._emit_phase_event = _emit  # type: ignore[method-assign]
    shell.llm = _LLM()

    response = shell._chat_messages_with_phase([{"role": "user", "content": "hello"}], stage="initial")

    assert response == "ok"
    assert emitted[0][0] == "analyze.model.start"
    assert "openrouter/test-model" in emitted[0][1]
    assert emitted[1][0] == "analyze.model.done"
    assert emitted[1][2] == "done"


def test_long_workflow_progress_summary_remains_dynamic() -> None:
    shell = _shell_stub()
    actions = [
        {"ok": True, "output": "alpha\nbeta", "tool": "read"},
        {"ok": True, "output": "gamma", "tool": "glob"},
        {"ok": False, "output": "", "tool": "shell"},
        {"ok": True, "output": "delta\nepsilon\nzeta", "tool": "write"},
    ]
    summary = shell._progress_summary_values(actions=actions, response="line-1\nline-2\nline-3")
    assert summary["actions"] == "3/4 succeeded, 1 failed"
    assert summary["evidence"] == "3 action outputs"
    assert summary["response"] == "3 lines, 20 chars"


def test_emit_interactive_envelope_writes_versioned_payload() -> None:
    shell = _shell_envelope_stub()
    shell._phase_events = [{"schema": "tehuti.phase_stream.v1", "phase": "execute"}]
    shell._emit_interactive_envelope(
        "hello",
        "world",
        actions=[{"tool": "read", "args": {"path": "a.txt"}, "ok": True}],
        status="success",
    )
    assert len(shell.session.payloads) == 1
    payload = shell.session.payloads[0]
    assert payload["schema"] == "tehuti.cli.interactive.v1"
    assert payload["trace_id"]
    assert payload["turn_id"]
    assert payload["result"]["schema"] == "tehuti.agent_task.v1"
    assert payload["status"] == "success"
    assert payload["result"]["response"] == "world"
    assert payload["phase_events"][0]["phase"] == "execute"
    assert len(payload["tool_contracts"]) == 1
    assert payload["tool_contracts"][0]["contract_schema"] == "tehuti.tool_result.v1"
    names = [event["event"] for event in payload["events"]]
    assert names == ["iteration_start", "tool_start", "tool_end", "loop_terminated"]


def test_emit_interactive_envelope_failure_projects_typed_error() -> None:
    shell = _shell_envelope_stub()
    shell._emit_interactive_envelope(
        "hello",
        "",
        actions=[],
        status="failed",
        error="boom",
        error_payload={
            "category": "protocol",
            "code": "fixture_failed",
            "error": "boom",
            "retryable": True,
            "details": {"source": "fixture"},
        },
    )
    payload = shell.session.payloads[0]
    assert payload["status"] == "failed"
    assert payload["error"]["category"] == "protocol"
    assert payload["error"]["code"] == "fixture_failed"
    assert payload["error"]["message"] == "boom"
    assert payload["error"]["retryable"] is True


def test_emit_interactive_envelope_uses_recorded_progress_events_when_present() -> None:
    shell = _shell_envelope_stub()
    shell._turn_progress_events = [
        {"event": "iteration_start", "iteration": 1, "max_iterations": 3},
        {"event": "tool_start", "tool": "read", "arguments": {"path": "a.txt"}},
        {"event": "tool_end", "tool": "read", "success": True, "execution_time_ms": 5},
        {"event": "loop_terminated", "termination_reason": "final_response", "has_error": False},
    ]
    shell._phase_started_at = None
    shell._emit_interactive_envelope(
        "hello",
        "world",
        actions=[{"tool": "read", "args": {"path": "a.txt"}, "ok": True}],
        status="success",
    )
    payload = shell.session.payloads[0]
    events = payload["events"]
    assert [event["event"] for event in events] == ["iteration_start", "tool_start", "tool_end", "loop_terminated"]
    assert payload["result"]["iterations"] == 1
    assert payload["result"]["parse_status"] == "structured"


def test_interactive_envelope_toggle_updates_flag(monkeypatch) -> None:
    monkeypatch.setattr("tehuti_cli.ui.shell.save_config", lambda _cfg: None)
    shell = _shell_envelope_stub()
    shell._set_interactive_envelope("/envelope on")
    assert "interactive_envelope" in shell.config.experimental_flags
    shell._set_interactive_envelope("/envelope off")
    assert "interactive_envelope" not in shell.config.experimental_flags


def test_full_access_policy_enforces_full_capability_defaults(monkeypatch) -> None:
    monkeypatch.setattr("tehuti_cli.ui.shell.save_config", lambda _cfg: None)
    shell = _shell_stub()
    shell.config = SimpleNamespace(
        access_policy="full",
        default_yolo=False,
        allow_shell=False,
        allow_write=False,
        allow_external=False,
        allow_tools=["read"],
        deny_tools=["shell"],
        approval_mode="manual",
        execution_mode="standard",
        allowed_paths=["/tmp"],
        web_allow_domains=["example.com"],
        web_deny_domains=["bad.example"],
        show_actions=False,
    )

    shell._ensure_full_capability_defaults()

    assert shell.config.default_yolo is True
    assert shell.config.allow_shell is True
    assert shell.config.allow_write is True
    assert shell.config.allow_external is True
    assert shell.config.allow_tools == []
    assert shell.config.deny_tools == []
    assert shell.config.approval_mode == "manual"
    assert shell.config.execution_mode == "standard"
    assert shell.config.allowed_paths == []
    assert shell.config.web_allow_domains == []
    assert shell.config.web_deny_domains == []
    assert shell.config.show_actions is False


def test_restricted_access_policy_preserves_explicit_restrictions(monkeypatch) -> None:
    monkeypatch.setattr("tehuti_cli.ui.shell.save_config", lambda _cfg: None)
    shell = _shell_stub()
    shell.config = SimpleNamespace(
        access_policy="restricted",
        default_yolo=False,
        allow_shell=False,
        allow_write=False,
        allow_external=False,
        allow_tools=["read"],
        deny_tools=["shell"],
        approval_mode="manual",
        execution_mode="standard",
        allowed_paths=["/tmp"],
        web_allow_domains=["example.com"],
        web_deny_domains=["bad.example"],
        show_actions=False,
    )

    shell._ensure_full_capability_defaults()

    assert shell.config.default_yolo is False
    assert shell.config.allow_shell is False
    assert shell.config.allow_write is False
    assert shell.config.allow_external is False
    assert shell.config.allow_tools == ["read"]
    assert shell.config.deny_tools == ["shell"]
    assert shell.config.approval_mode == "manual"
    assert shell.config.execution_mode == "standard"
    assert shell.config.allowed_paths == ["/tmp"]
    assert shell.config.web_allow_domains == ["example.com"]
    assert shell.config.web_deny_domains == ["bad.example"]
    assert shell.config.show_actions is False


def test_run_once_unknown_slash_command_shows_hint_without_prompt_execution() -> None:
    shell = _shell_stub()
    printed: list[str] = []
    called = {"run_prompt": False}
    shell.console = SimpleNamespace(print=lambda msg, **_kwargs: printed.append(str(msg)))
    shell._handle_slash = lambda _command: False  # type: ignore[method-assign]
    shell._run_prompt = lambda _text: called.__setitem__("run_prompt", True)  # type: ignore[method-assign]
    shell._unknown_command_message = lambda _text: "Unknown command `/not-a-command`. Use / for commands."  # type: ignore[method-assign]

    shell.run_once("/not-a-command")

    assert called["run_prompt"] is False
    assert any("Unknown command `/not-a-command`. Use / for commands." in item for item in printed)


def test_run_once_exit_slash_prints_close_and_returns() -> None:
    shell = _shell_stub()
    printed: list[str] = []
    shell.console = SimpleNamespace(print=lambda msg, **_kwargs: printed.append(str(msg)))
    shell._handle_slash = lambda _command: (_ for _ in ()).throw(EOFError())  # type: ignore[method-assign]

    shell.run_once("/exit")

    assert any("By decree, the session closes." in item for item in printed)


def test_unknown_command_message_suggests_close_match() -> None:
    shell = _shell_stub()
    shell._slash_registry = {"/model": "set model", "/metrics": "show metrics", "/help": "help"}
    message = shell._unknown_command_message("/modle")
    assert "Did you mean:" in message
    assert "/model" in message


def test_set_ux_preset_quiet_sets_low_noise_profile(monkeypatch) -> None:
    monkeypatch.setattr("tehuti_cli.ui.shell.save_config", lambda _cfg: None)
    shell = _shell_stub()
    shell.console = SimpleNamespace(print=lambda *_args, **_kwargs: None)
    shell.config = SimpleNamespace(
        show_actions=True,
        progress_verbosity="standard",
        tool_output_limit=0,
        show_history=True,
    )

    shell._set_ux_preset("/ux quiet")

    assert shell.config.show_actions is False
    assert shell.config.progress_verbosity == "minimal"
    assert shell.config.tool_output_limit == 12000
    assert shell.config.show_history is False


def test_set_ux_preset_invalid_usage_does_not_mutate(monkeypatch) -> None:
    monkeypatch.setattr("tehuti_cli.ui.shell.save_config", lambda _cfg: None)
    printed: list[str] = []
    shell = _shell_stub()
    shell.console = SimpleNamespace(print=lambda msg, **_kwargs: printed.append(str(msg)))
    shell.config = SimpleNamespace(
        show_actions=True,
        progress_verbosity="standard",
        tool_output_limit=20000,
        show_history=False,
    )

    shell._set_ux_preset("/ux loud")

    assert shell.config.show_actions is True
    assert shell.config.progress_verbosity == "standard"
    assert shell.config.tool_output_limit == 20000
    assert shell.config.show_history is False
    assert any("Usage: /ux [quiet|standard|verbose]" in item for item in printed)


def test_set_ux_preset_cycles_when_no_arg(monkeypatch) -> None:
    monkeypatch.setattr("tehuti_cli.ui.shell.save_config", lambda _cfg: None)
    shell = _shell_stub()
    shell.console = SimpleNamespace(print=lambda *_args, **_kwargs: None)
    shell.config = SimpleNamespace(
        show_actions=False,
        progress_verbosity="minimal",
        tool_output_limit=12000,
        show_history=False,
    )

    shell._set_ux_preset("/ux")
    assert shell.config.progress_verbosity == "standard"

    shell._set_ux_preset("/ux")
    assert shell.config.progress_verbosity == "verbose"

    shell._set_ux_preset("/ux")
    assert shell.config.progress_verbosity == "minimal"


def test_slash_registry_declares_operator_commands_for_discoverability() -> None:
    source = Path("src/tehuti_cli/ui/shell.py").read_text(encoding="utf-8")
    required = [
        '"/run":',
        '"/help":',
        '"/allow-all":',
        '"/lockdown":',
        '"/grounding":',
        '"/history":',
        '"/profile":',
        '"/quit":',
    ]
    for marker in required:
        assert marker in source


def test_thinking_and_plan_render_as_stream_lines_not_tables(tmp_path) -> None:
    printed: list[str] = []
    shell = _shell_stub()
    shell.console = SimpleNamespace(print=lambda msg, **_kwargs: printed.append(str(msg)))
    shell.session = SimpleNamespace(dir=tmp_path)
    shell._summarize_objective = lambda _prompt: "inspect request context"  # type: ignore[method-assign]
    shell._get_thinking_message = lambda _prompt: "processing request"  # type: ignore[method-assign]

    shell._show_thinking_and_plan("hello")

    assert any("Focus:" in line for line in printed)
    assert any("Trace:" in line for line in printed)
    assert not any("Intent:" in line for line in printed)
    assert not any("Execution Summary" in line for line in printed)


def test_turn_progress_hidden_outside_verbose() -> None:
    printed: list[str] = []
    shell = _shell_stub()
    shell.console = SimpleNamespace(print=lambda msg, **_kwargs: printed.append(str(msg)))
    shell.config = SimpleNamespace(progress_verbosity="standard")
    shell._show_turn_progress([{"ok": True, "output": "x"}], "done")

    assert printed == []


def test_turn_progress_renders_summary_line_in_verbose() -> None:
    printed: list[str] = []
    shell = _shell_stub()
    shell.console = SimpleNamespace(print=lambda msg, **_kwargs: printed.append(str(msg)))
    shell.config = SimpleNamespace(progress_verbosity="verbose")
    shell._minion_counts = lambda: (1, 2)  # type: ignore[method-assign]

    shell._show_turn_progress([{"ok": True, "output": "x"}], "done")

    assert any("Turn summary:" in line for line in printed)


def test_emit_phase_event_increments_sequence_and_writes_wire() -> None:
    payloads: list[dict] = []
    printed: list[str] = []
    shell = _shell_stub()
    shell.console = SimpleNamespace(print=lambda msg, **_kwargs: printed.append(str(msg)))
    shell.session = SimpleNamespace(id="s-1", append_wire=lambda payload: payloads.append(payload))
    shell._reset_phase_stream()

    shell._emit_phase_event("execute", "running tools")
    shell._emit_phase_event("complete", "done", status="done")

    assert shell._phase_sequence == 2
    assert len(payloads) == 2
    assert payloads[0]["schema"] == "tehuti.phase_stream.v1"
    assert payloads[0]["event_version"] == "v1"
    assert payloads[0]["surface"] == "cli_interactive"
    assert payloads[0]["phase"] == "execute"
    assert payloads[0]["phase_group"] == "execute"
    assert payloads[1]["status"] == "done"
    assert any("[1]" in line for line in printed)


def test_print_tool_preview_uses_working_label() -> None:
    printed: list[str] = []
    shell = _shell_stub()
    shell.console = SimpleNamespace(print=lambda msg, **_kwargs: printed.append(str(msg)))
    shell._print_tool_preview("read", {"path": "src/main.py"}, objective="inspect", source="agent")
    assert any("Working:" in line for line in printed)
    assert any("Preview:" in line for line in printed)


def test_print_action_line_uses_done_fail_labels() -> None:
    printed: list[str] = []
    shell = _shell_stub()
    shell.console = SimpleNamespace(print=lambda msg, **_kwargs: printed.append(str(msg)))
    shell._print_action_line(
        {
            "tool": "shell",
            "command": "pwd",
            "title": "shell: pwd",
            "ok": True,
            "elapsed": 0.01,
            "show_panel": False,
            "evidence": "/root",
        }
    )
    shell._print_action_line(
        {
            "tool": "shell",
            "command": "badcmd",
            "title": "shell: bad",
            "ok": False,
            "elapsed": 0.0,
            "show_panel": False,
            "evidence": "error",
        }
    )
    assert any("Done:" in line for line in printed)
    assert any("Fail:" in line for line in printed)
    assert any(event.get("event") == "activity" for event in shell._turn_activity_events)


def test_emit_interactive_envelope_includes_activity_events_when_present() -> None:
    shell = _shell_envelope_stub()
    shell._turn_activity_events = [
        {
            "schema": "tehuti.activity.v1",
            "event_version": "v1",
            "event": "activity",
            "tool": "shell",
            "success": True,
            "summary": "Executed `shell` -> `pwd`",
        }
    ]
    shell._emit_interactive_envelope(
        "hello",
        "world",
        actions=[{"tool": "shell", "args": {"command": "pwd"}, "ok": True}],
        status="success",
    )
    payload = shell.session.payloads[0]
    assert payload["activity_events"][0]["event"] == "activity"
    assert payload["activity_events"][0]["tool"] == "shell"


def test_run_prompt_provider_failure_projects_failed_lifecycle() -> None:
    shell = _shell_stub()
    shell.tracer = None
    shell.memory = SimpleNamespace(search=lambda *_args, **_kwargs: [])
    shell.registry = SimpleNamespace(_tools={}, list_tools=lambda: [], get=lambda _name: None)
    shell._execution_mode = "autonomous"
    shell.config.provider = SimpleNamespace(type="openrouter", model="qwen/test")
    shell.config.allow_shell = False
    shell.config.show_actions = True
    shell.session = SimpleNamespace(
        id="s-1",
        dir=Path("."),
        iter_context=lambda: [],
        append_context=lambda *_args, **_kwargs: None,
        append_wire=lambda *_args, **_kwargs: None,
    )
    phase_events: list[tuple[str, str]] = []
    envelopes: list[str] = []
    shell._emit_phase_event = lambda phase, detail="", status="progress", meta=None: phase_events.append((phase, status))  # type: ignore[method-assign]
    shell._emit_interactive_envelope = (
        lambda _prompt, _response, _actions, *, status, error=None, error_payload=None, termination_reason=None, has_error=None: envelopes.append(status)
    )  # type: ignore[method-assign]
    shell._show_turn_meta = lambda _prompt, actions=None: False  # type: ignore[method-assign]
    shell._run_with_tools = (
        lambda _messages, max_turns=3, objective="": (
            "Model request failed: Provider rejected the request due to account/billing limits.",
            [],
            [],
        )
    )  # type: ignore[method-assign]
    shell._print_thoth_response = lambda *_args, **_kwargs: None  # type: ignore[method-assign]
    shell._show_turn_progress = lambda *_args, **_kwargs: None  # type: ignore[method-assign]

    shell._run_prompt("tell me about your capabilities and demonstrate some non destructively")

    assert "failed" in envelopes
    assert ("execute.done", "error") in phase_events
    assert ("respond", "error") in phase_events
    assert ("complete", "error") in phase_events


def test_run_prompt_provider_failure_with_local_demo_projects_degraded_success() -> None:
    shell = _shell_stub()
    shell.tracer = None
    shell.memory = SimpleNamespace(search=lambda *_args, **_kwargs: [])
    shell.registry = SimpleNamespace(_tools={}, list_tools=lambda: [], get=lambda _name: None)
    shell._execution_mode = "autonomous"
    shell.config.provider = SimpleNamespace(type="openrouter", model="qwen/test")
    shell.config.allow_shell = True
    shell.config.show_actions = True
    shell.session = SimpleNamespace(
        id="s-1",
        dir=Path("."),
        iter_context=lambda: [],
        append_context=lambda *_args, **_kwargs: None,
        append_wire=lambda *_args, **_kwargs: None,
    )
    phase_events: list[tuple[str, str]] = []
    terminations: list[tuple[str, bool]] = []
    envelopes: list[str] = []
    shell._emit_phase_event = lambda phase, detail="", status="progress", meta=None: phase_events.append((phase, status))  # type: ignore[method-assign]
    shell._emit_interactive_envelope = (
        lambda _prompt, _response, _actions, *, status, error=None, error_payload=None, termination_reason=None, has_error=None: (
            envelopes.append(status),
            terminations.append((str(termination_reason), bool(has_error))),
        )
    )  # type: ignore[method-assign]
    shell._show_turn_meta = lambda _prompt, actions=None: False  # type: ignore[method-assign]
    shell._run_with_tools = (
        lambda _messages, max_turns=3, objective="": (
            "Model request failed: Provider rejected the request due to account/billing limits.",
            [],
            [],
        )
    )  # type: ignore[method-assign]
    shell._run_local_capability_demo = lambda: ("demo ok", [], [{"tool": "shell", "ok": True}])  # type: ignore[method-assign]
    shell._print_thoth_response = lambda *_args, **_kwargs: None  # type: ignore[method-assign]
    shell._show_turn_progress = lambda *_args, **_kwargs: None  # type: ignore[method-assign]

    shell._run_prompt("tell me about your capabilities and demonstrate some non destructively")

    assert "success" in envelopes
    assert ("provider_failure_recovered", False) in terminations
    assert ("respond", "done") in phase_events
    assert ("complete", "done") in phase_events


def test_run_prompt_degraded_output_stream_is_truthful_and_non_failed() -> None:
    shell = _shell_stub()
    printed: list[str] = []
    shell.console = SimpleNamespace(print=lambda msg, **_kwargs: printed.append(str(msg)))
    shell.tracer = None
    shell.memory = SimpleNamespace(search=lambda *_args, **_kwargs: [])
    shell.registry = SimpleNamespace(_tools={}, list_tools=lambda: [], get=lambda _name: None)
    shell._execution_mode = "autonomous"
    shell.config.provider = SimpleNamespace(type="openrouter", model="qwen/test")
    shell.config.allow_shell = True
    shell.config.show_actions = True
    shell.session = SimpleNamespace(
        id="s-1",
        dir=Path("."),
        iter_context=lambda: [],
        append_context=lambda *_args, **_kwargs: None,
        append_wire=lambda *_args, **_kwargs: None,
    )
    shell._show_turn_meta = lambda _prompt, actions=None: False  # type: ignore[method-assign]
    shell._run_with_tools = (
        lambda _messages, max_turns=3, objective="": (
            "Model request failed: Provider rejected the request due to account/billing limits.",
            [],
            [],
        )
    )  # type: ignore[method-assign]
    shell._run_local_capability_demo = lambda: ("demo ok", [], [{"tool": "shell", "ok": True}])  # type: ignore[method-assign]
    shell._print_thoth_response = lambda *_args, **_kwargs: None  # type: ignore[method-assign]
    shell._emit_interactive_envelope = lambda *_args, **_kwargs: None  # type: ignore[method-assign]
    shell._show_turn_progress = lambda *_args, **_kwargs: None  # type: ignore[method-assign]

    shell._run_prompt("tell me about your capabilities and demonstrate some non destructively")

    transcript = "\n".join(printed)
    assert "FAILED" not in transcript
    assert "rendering degraded response with local evidence" in transcript
    assert "turn finished in degraded mode" in transcript


def test_handle_slash_routes_status_all_before_status() -> None:
    shell = _shell_stub()
    called = {"status": 0, "status_all": 0}
    shell._show_status = lambda: called.__setitem__("status", called["status"] + 1)  # type: ignore[method-assign]
    shell._show_full_status = lambda: called.__setitem__("status_all", called["status_all"] + 1)  # type: ignore[method-assign]

    handled = shell._handle_slash("/status-all")

    assert handled is True
    assert called["status_all"] == 1
    assert called["status"] == 0


def test_handle_slash_routes_focus_command() -> None:
    shell = _shell_stub()
    called = {"focus": 0}
    shell._show_focus = lambda: called.__setitem__("focus", called["focus"] + 1)  # type: ignore[method-assign]

    handled = shell._handle_slash("/focus")

    assert handled is True
    assert called["focus"] == 1


def test_run_prompt_conversational_path_skips_tool_loop() -> None:
    shell = _shell_stub()
    shell.tracer = None
    shell.memory = SimpleNamespace(search=lambda *_args, **_kwargs: [])
    shell.registry = SimpleNamespace(_tools={}, list_tools=lambda: [], get=lambda _name: None)
    shell._execution_mode = "autonomous"
    shell.config.provider = SimpleNamespace(type="openrouter", model="qwen/test")
    shell.config.show_actions = True
    shell.llm = SimpleNamespace(last_notice=None)
    shell.session = SimpleNamespace(
        id="s-1",
        dir=Path("."),
        iter_context=lambda: [],
        append_context=lambda *_args, **_kwargs: None,
        append_wire=lambda *_args, **_kwargs: None,
    )
    shell._emit_phase_event = lambda *_args, **_kwargs: None  # type: ignore[method-assign]
    shell._emit_interactive_envelope = lambda *_args, **_kwargs: None  # type: ignore[method-assign]
    shell._show_turn_meta = lambda _prompt, actions=None: False  # type: ignore[method-assign]
    shell._print_thoth_response = lambda *_args, **_kwargs: None  # type: ignore[method-assign]
    shell._show_turn_progress = lambda *_args, **_kwargs: None  # type: ignore[method-assign]

    called = {"tools": 0, "chat": 0}
    def _run_with_tools_stub(*_args, **_kwargs):
        called["tools"] += 1
        return "", [], []

    def _chat_with_phase_stub(*_args, **_kwargs):
        called["chat"] += 1
        return "hello back"

    shell._run_with_tools = _run_with_tools_stub  # type: ignore[method-assign]
    shell._chat_messages_with_phase = _chat_with_phase_stub  # type: ignore[method-assign]

    shell._run_prompt("hi")

    assert called["chat"] == 1
    assert called["tools"] == 0
    assert any(event.get("event") == "task_context" for event in shell._turn_progress_events)


def test_run_prompt_enforces_grounding_when_tool_mode_returns_no_actions() -> None:
    shell = _shell_stub()
    shell.tracer = None
    shell.memory = SimpleNamespace(search=lambda *_args, **_kwargs: [])
    shell.registry = SimpleNamespace(_tools={}, list_tools=lambda: [], get=lambda _name: None)
    shell._execution_mode = "autonomous"
    shell.config.provider = SimpleNamespace(type="openrouter", model="qwen/test")
    shell.config.show_actions = True
    shell.config.allow_shell = True
    shell.config.tool_output_limit = 0
    shell.llm = SimpleNamespace(last_notice=None)
    shell.session = SimpleNamespace(
        id="s-1",
        dir=Path("."),
        iter_context=lambda: [],
        append_context=lambda *_args, **_kwargs: None,
        append_wire=lambda *_args, **_kwargs: None,
    )
    phase_events: list[tuple[str, str]] = []
    captured: dict[str, object] = {}
    shell._emit_phase_event = lambda phase, detail="", status="progress", meta=None: phase_events.append((phase, detail))  # type: ignore[method-assign]
    shell._show_turn_meta = lambda _prompt, actions=None: False  # type: ignore[method-assign]
    shell._print_thoth_response = lambda response, _prompt: captured.__setitem__("response", response)  # type: ignore[method-assign]
    shell._show_turn_progress = lambda *_args, **_kwargs: None  # type: ignore[method-assign]
    shell._emit_interactive_envelope = (
        lambda _prompt, _response, actions, *, status, error=None, error_payload=None: captured.__setitem__(
            "action_count", len(actions)
        )
    )  # type: ignore[method-assign]
    shell._run_with_tools = (
        lambda _messages, max_turns=3, objective="": ("I can run `pwd` and show it.", [], [])
    )  # type: ignore[method-assign]
    shell._execute_runtime_tool_with_feedback = (  # type: ignore[method-assign]
        lambda *_args, **_kwargs: (
            ToolResult(True, "/root/project-tehuti\n"),
            {"tool": "shell", "title": "shell: pwd", "ok": True, "show_panel": True, "output": "/root/project-tehuti"},
        )
    )

    shell._run_prompt("demonstrate one non-destructive shell command")

    assert captured.get("action_count") == 1
    assert "Model returned a response without executing tools." in str(captured.get("response", ""))
    assert "- profile grounding" in str(captured.get("response", ""))
    assert any(phase == "recover" and "without tool evidence" in detail for phase, detail in phase_events)


def test_select_evidence_probe_is_intent_aware() -> None:
    shell = _shell_stub()

    repo = shell._select_evidence_probe(prompt="show git diff", objective="inspect repository")
    assert repo["profile"] == "repository"
    assert "git status" in repo["command"]

    fs = shell._select_evidence_probe(prompt="list files in directory", objective="filesystem review")
    assert fs["profile"] == "filesystem"
    assert fs["command"].startswith("pwd")

    runtime = shell._select_evidence_probe(prompt="show python capabilities", objective="runtime check")
    assert runtime["profile"] == "runtime"
    assert "python3 --version" in runtime["command"]

    diag = shell._select_evidence_probe(prompt="run system diagnostics", objective="host status")
    assert diag["profile"] == "diagnostics"
    assert "uname -s" in diag["command"]


def test_extract_json_supports_mixed_text_with_trailing_content() -> None:
    shell = _shell_stub()
    payload = shell._extract_json(
        'Plan:\\n{"type":"tool","name":"read","args":{"path":"README.md"}}\\nI will continue.'
    )
    assert payload is not None
    assert payload["type"] == "tool"
    assert payload["name"] == "read"


def test_extract_json_prefers_tool_payload_over_generic_object() -> None:
    shell = _shell_stub()
    payload = shell._extract_json(
        'preamble {"note":"ignore"} middle {"type":"tool","name":"shell","args":{"command":"pwd"}} trailing'
    )
    assert payload is not None
    assert payload["type"] == "tool"
    assert payload["name"] == "shell"


def test_run_tool_routes_through_shared_feedback_helper() -> None:
    shell = _shell_stub()
    shell.console = SimpleNamespace(print=lambda *_args, **_kwargs: None)
    shell.config = SimpleNamespace(show_actions=True)
    captured: dict[str, object] = {}

    def _exec(tool, args, **kwargs):
        captured["tool"] = tool
        captured["args"] = args
        captured["kwargs"] = kwargs
        return ToolResult(True, "/tmp\n"), {"show_panel": False, "inline": [], "ok": True}

    shell._execute_runtime_tool_with_feedback = _exec  # type: ignore[method-assign]
    shell._format_tool_output = lambda _tool, output: output  # type: ignore[method-assign]
    shell._sequence_started_at = None

    shell._run_tool("/run shell pwd")

    assert captured["tool"] == "shell"
    assert captured["args"] == {"command": "pwd"}
    kwargs = captured["kwargs"]
    assert isinstance(kwargs, dict)
    assert kwargs["source"] == "user"
    assert kwargs["record_progress"] is False


def test_shell_stream_callback_records_bounded_tool_stream_events() -> None:
    shell = _shell_stub()
    shell.console = SimpleNamespace(print=lambda *_args, **_kwargs: None)
    shell._tool_stream_event_limit = 2
    shell._tool_stream_event_count = 0
    shell._turn_progress_events = []

    callback = shell._shell_stream_callback(tool="shell", record_progress=True)
    callback("alpha\nbeta\ngamma\n")

    stream_events = [event for event in shell._turn_progress_events if event.get("event") == "tool_stream"]
    assert len(stream_events) == 2
    assert all(event.get("tool") == "shell" for event in stream_events)


def test_shell_uses_single_traced_execution_callsite() -> None:
    source = Path("src/tehuti_cli/ui/shell.py").read_text(encoding="utf-8")
    marker = "self.runtime.execute_with_tracing("
    positions = []
    idx = source.find(marker)
    while idx != -1:
        positions.append(idx)
        idx = source.find(marker, idx + 1)
    assert len(positions) == 1


def test_execute_runtime_tool_with_feedback_streams_shell_chunks_live() -> None:
    shell = _shell_stub()
    printed: list[str] = []
    shell.console = SimpleNamespace(print=lambda msg, **_kwargs: printed.append(str(msg)))
    shell.config = SimpleNamespace(progress_verbosity="standard", show_actions=True, tool_output_limit=0)
    shell.tracer = None
    shell._sequence_started_at = None
    shell._busy = False
    shell._turn_progress_events = []

    seen = {"has_callback": False}

    def _execute_with_tracing(tool, args, tracer=None, timeout=30.0, output_callback=None):
        assert tool == "shell"
        if output_callback is not None:
            seen["has_callback"] = True
            output_callback("alpha\n")
            output_callback("beta\n")
        return ToolResult(True, "alpha\nbeta\n"), {
            "duration_ms": 5,
            "trace_id": "t-1",
            "contract_schema": "tehuti.tool_result.v1",
            "error": None,
        }

    shell.runtime = SimpleNamespace(execute_with_tracing=_execute_with_tracing)

    shell._execute_runtime_tool_with_feedback("shell", {"command": "printf 'alpha\\nbeta\\n'"})

    assert seen["has_callback"] is True
    assert any("Stream: alpha" in line for line in printed)
    assert any("Stream: beta" in line for line in printed)
