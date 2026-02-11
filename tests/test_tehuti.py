"""
Test suite for Project Tehuti

Run with: python -m pytest tests/ -v
"""

import sys
from pathlib import Path
import json

# Add src to path
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

import pytest


class TestConfiguration:
    """Test configuration system."""

    def test_config_import(self):
        """Test that config module imports correctly."""
        from tehuti_cli.storage.config import Config, ProviderConfig

        assert Config is not None
        assert ProviderConfig is not None

    def test_default_config(self):
        """Test default configuration values."""
        from tehuti_cli.storage.config import default_config

        config = default_config()
        assert config.provider.type == "openrouter"
        assert config.provider.model == "nvidia/nemotron-3-nano-30b-a3b:free"
        assert config.default_yolo is True


class TestTools:
    """Test tool system."""

    def test_tool_registry_import(self):
        """Test tool registry imports."""
        from tehuti_cli.core.tools import ToolRegistry, ToolSpec

        assert ToolRegistry is not None
        assert ToolSpec is not None

    def test_tool_count(self):
        """Test that all tools are registered."""
        from tehuti_cli.storage.config import load_config
        from tehuti_cli.core.tools import ToolRegistry

        config = load_config()
        registry = ToolRegistry(config)
        tools = registry.list_tools()
        assert len(tools) >= 200
        names = {tool.name for tool in tools}
        assert "delegate_create" in names
        assert "task_create" in names
        assert "automation_create" in names

    def test_core_tools_exist(self):
        """Test core tools are available."""
        from tehuti_cli.storage.config import load_config
        from tehuti_cli.core.tools import ToolRegistry

        config = load_config()
        registry = ToolRegistry(config)

        core_tools = ["read", "write", "edit", "shell", "fetch"]
        for tool in core_tools:
            assert registry.get(tool) is not None, f"Missing tool: {tool}"

    def test_file_operations_tools(self):
        """Test file operations tools are available."""
        from tehuti_cli.storage.config import load_config
        from tehuti_cli.core.tools import ToolRegistry

        config = load_config()
        registry = ToolRegistry(config)

        file_tools = ["glob", "grep", "find", "sed"]
        for tool in file_tools:
            assert registry.get(tool) is not None, f"Missing tool: {tool}"

    def test_advanced_tools_exist(self):
        """Test advanced tools are available."""
        from tehuti_cli.storage.config import load_config
        from tehuti_cli.core.tools import ToolRegistry

        config = load_config()
        registry = ToolRegistry(config)

        advanced_tools = ["docker_ps", "web_search", "kubectl", "pytest"]
        for tool in advanced_tools:
            assert registry.get(tool) is not None, f"Missing tool: {tool}"


class TestRuntime:
    """Test tool runtime execution."""

    def test_runtime_import(self):
        """Test runtime module imports."""
        from tehuti_cli.core.runtime import ToolRuntime, ToolResult

        assert ToolRuntime is not None
        assert ToolResult is not None

    def test_tool_result_creation(self):
        """Test ToolResult creation."""
        from tehuti_cli.core.runtime import ToolResult

        result = ToolResult(ok=True, output="test output")
        assert result.ok is True
        assert result.output == "test output"

    def test_shell_execution(self):
        """Test shell command execution."""
        from tehuti_cli.storage.config import load_config
        from tehuti_cli.core.runtime import ToolRuntime

        config = load_config()
        runtime = ToolRuntime(config, Path("/tmp"))

        result = runtime.execute("shell", {"command": 'echo "test"'})
        assert result.ok is True
        assert "test" in result.output

    def test_shell_execution_accepts_cmd_alias(self):
        """Test shell command execution with cmd alias."""
        from tehuti_cli.storage.config import load_config
        from tehuti_cli.core.runtime import ToolRuntime

        config = load_config()
        runtime = ToolRuntime(config, Path("/tmp"))

        result = runtime.execute("shell", {"cmd": 'echo "alias"'})
        assert result.ok is True
        assert "alias" in result.output

    def test_shell_execution_missing_command_fails_cleanly(self):
        """Test shell command execution validates required args."""
        from tehuti_cli.storage.config import load_config
        from tehuti_cli.core.runtime import ToolRuntime

        config = load_config()
        runtime = ToolRuntime(config, Path("/tmp"))

        result = runtime.execute("shell", {})
        assert result.ok is False
        assert "Missing required arg: command" in result.output

    def test_web_search_accepts_q_alias(self, monkeypatch):
        """Test web_search accepts query alias q."""
        from tehuti_cli.storage.config import load_config
        from tehuti_cli.core.runtime import ToolRuntime, ToolResult

        config = load_config()
        runtime = ToolRuntime(config, Path("/tmp"))
        monkeypatch.setattr(runtime.advanced, "web_search", lambda query, engine, num: ToolResult(True, query))
        result = runtime.execute("web_search", {"q": "weather egypt"})
        assert result.ok is True
        assert result.output == "weather egypt"

    def test_search_ddg_calls_search_with_ddg(self, monkeypatch):
        """Test search_ddg maps to duckduckgo web_search path."""
        from tehuti_cli.storage.config import load_config
        from tehuti_cli.core.runtime import ToolRuntime, ToolResult

        config = load_config()
        runtime = ToolRuntime(config, Path("/tmp"))
        monkeypatch.setattr(
            runtime.advanced, "web_search", lambda query, engine, num: ToolResult(True, f"{engine}:{query}")
        )
        result = runtime.execute("search_ddg", {"q": "weather egypt"})
        assert result.ok is True
        assert result.output == "duckduckgo:weather egypt"

    def test_host_discovery_tool(self, monkeypatch):
        """Test host_discovery produces a report."""
        from tehuti_cli.storage.config import load_config
        from tehuti_cli.core.runtime import ToolRuntime, ToolResult

        config = load_config()
        runtime = ToolRuntime(config, Path("/tmp"))
        monkeypatch.setattr(runtime.sandbox, "run_shell", lambda _cmd: ToolResult(True, "ok\n"))
        result = runtime.execute("host_discovery", {})
        assert result.ok is True
        assert "Discovery report:" in result.output
        assert "TL;DR findings:" in result.output


class TestAdvancedTools:
    """Test advanced tools."""

    def test_advanced_tools_import(self):
        """Test advanced tools module imports."""
        from tehuti_cli.advanced_tools import AdvancedToolSuite

        assert AdvancedToolSuite is not None

    def test_web_search(self):
        """Test web search functionality."""
        from tehuti_cli.storage.config import load_config
        from tehuti_cli.advanced_tools import AdvancedToolSuite

        config = load_config()
        advanced = AdvancedToolSuite(config, Path("/tmp"))

        result = advanced.web_search("python programming", num_results=3)
        # Should either succeed or fail gracefully
        assert isinstance(result.ok, bool)


class TestToolAvailability:
    """Test tool availability checking."""

    def test_availability_import(self):
        """Test availability module imports."""
        from tehuti_cli.tool_availability import ToolAvailability

        assert ToolAvailability is not None

    def test_check_tool(self):
        """Test checking individual tool."""
        from tehuti_cli.tool_availability import ToolAvailability

        available, version = ToolAvailability.check_tool("docker")
        assert isinstance(available, bool)
        # Version can be None or a string
        assert version is None or isinstance(version, str)

    def test_check_all(self):
        """Test checking all tools."""
        from tehuti_cli.tool_availability import ToolAvailability

        results = ToolAvailability.check_all()
        assert isinstance(results, dict)
        assert len(results) > 0

        for tool, info in results.items():
            assert "available" in info
            assert isinstance(info["available"], bool)


class TestPlanning:
    """Test planning system."""

    def test_planning_import(self):
        """Test planning module imports."""
        from tehuti_cli.storage.planning import PlanningStorage

        assert PlanningStorage is not None

    def test_project_initialization(self):
        """Test project initialization."""
        from tehuti_cli.storage.planning import PlanningStorage
        import tempfile
        import shutil

        with tempfile.TemporaryDirectory() as tmpdir:
            storage = PlanningStorage(tmpdir)
            storage.init_project("TestProject", "Test description")

            assert storage.project_exists() is True

            status = storage.get_project_status()
            assert status["project_name"] == "TestProject"


class TestProviders:
    """Test LLM providers."""

    def test_providers_import(self):
        """Test provider modules import."""
        from tehuti_cli.providers.llm import TehutiLLM
        from tehuti_cli.providers.openrouter import OpenRouterClient
        from tehuti_cli.providers.openai import OpenAIClient
        from tehuti_cli.providers.gemini import GeminiClient

        assert TehutiLLM is not None
        assert OpenRouterClient is not None
        assert OpenAIClient is not None
        assert GeminiClient is not None


class TestExecutor:
    """Test executor system."""

    def test_executor_import(self):
        """Test executor module imports."""
        from tehuti_cli.core.executor import DependencyResolver

        assert DependencyResolver is not None

    def test_topological_sort(self):
        """Test dependency resolution."""
        from tehuti_cli.core.executor import DependencyResolver

        tasks = [
            {"id": "a", "dependencies": []},
            {"id": "b", "dependencies": ["a"]},
            {"id": "c", "dependencies": ["a"]},
        ]

        sorted_tasks = DependencyResolver.topological_sort(tasks)
        assert len(sorted_tasks) == 3
        # 'a' should come before 'b' and 'c'
        assert sorted_tasks[0]["id"] == "a"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])


class TestDelegates:
    """Test delegate/sub-agent system."""

    def test_delegates_import(self):
        """Test delegates module imports."""
        from tehuti_cli.core.delegates import DelegateManager, DelegateTask, DelegateState

        assert DelegateManager is not None
        assert DelegateTask is not None
        assert DelegateState is not None

    def test_delegate_creation(self):
        """Test delegate creation."""
        from tehuti_cli.core.delegates import DelegateManager, DelegateState
        from tehuti_cli.storage.config import load_config
        import tempfile

        config = load_config()
        with tempfile.TemporaryDirectory() as tmpdir:
            manager = DelegateManager(config, Path(tmpdir))
            delegate_id = manager.create_delegate("test", "test prompt")
            assert delegate_id is not None
            assert len(delegate_id) == 8

            delegate = manager.get_delegate(delegate_id)
            assert delegate is not None
            assert delegate.name == "test"
            assert delegate.state == DelegateState.PENDING


class TestProjectContext:
    """Test project context system."""

    def test_project_context_import(self):
        """Test project context module imports."""
        from tehuti_cli.core.project_context import ProjectContext

        assert ProjectContext is not None

    def test_project_context_operations(self):
        """Test project context operations."""
        from tehuti_cli.core.project_context import ProjectContext
        from tehuti_cli.storage.config import load_config
        import tempfile

        config = load_config()
        with tempfile.TemporaryDirectory() as tmpdir:
            ctx = ProjectContext(Path(tmpdir), config)
            assert ctx.exists() is False

            default = ctx.create_default()
            assert "Project Context" in default

            saved = ctx.save(default)
            assert saved is True
            assert ctx.exists() is True


class TestTaskGraph:
    """Test task dependency graph system."""

    def test_task_graph_import(self):
        """Test task graph module imports."""
        from tehuti_cli.core.task_graph import TaskGraph, Task, TaskStatus, TaskPriority

        assert TaskGraph is not None
        assert Task is not None
        assert TaskStatus is not None
        assert TaskPriority is not None

    def test_task_creation(self):
        """Test task creation."""
        from tehuti_cli.core.task_graph import TaskGraph, TaskStatus, TaskPriority
        from tehuti_cli.storage.config import load_config
        import tempfile

        config = load_config()
        with tempfile.TemporaryDirectory() as tmpdir:
            graph = TaskGraph(config, Path(tmpdir))
            task_id = graph.create_task("Test Task", "Description", TaskPriority.HIGH)
            assert task_id is not None

            task = graph.get_task(task_id)
            assert task is not None
            assert task.title == "Test Task"
            assert task.status == TaskStatus.DRAFT


class TestBlueprint:
    """Test blueprint system."""

    def test_blueprint_import(self):
        """Test blueprint module imports."""
        from tehuti_cli.core.blueprint import BlueprintManager, Blueprint, BlueprintSectionType

        assert BlueprintManager is not None
        assert Blueprint is not None
        assert BlueprintSectionType is not None

    def test_blueprint_creation(self):
        """Test blueprint creation."""
        from tehuti_cli.core.blueprint import BlueprintManager, BlueprintStatus
        from tehuti_cli.storage.config import load_config
        import tempfile

        config = load_config()
        with tempfile.TemporaryDirectory() as tmpdir:
            manager = BlueprintManager(config, Path(tmpdir))
            blueprint_id = manager.create_blueprint("Test Blueprint", "Description")
            assert blueprint_id is not None

            blueprint = manager.get_blueprint(blueprint_id)
            assert blueprint is not None
            assert blueprint.name == "Test Blueprint"
            assert blueprint.status == BlueprintStatus.DRAFT


class TestAutomations:
    """Test automation system."""

    def test_automation_import(self):
        """Test automation module imports."""
        from tehuti_cli.core.automations import AutomationManager, Automation, AutomationState

        assert AutomationManager is not None
        assert Automation is not None
        assert AutomationState is not None

    def test_automation_creation(self):
        """Test automation creation."""
        from tehuti_cli.core.automations import AutomationManager, AutomationState
        from tehuti_cli.storage.config import load_config
        import tempfile

        config = load_config()
        with tempfile.TemporaryDirectory() as tmpdir:
            manager = AutomationManager(config, Path(tmpdir))
            automation_id = manager.create_automation("Test Automation", "Description")
            assert automation_id is not None

            automation = manager.get_automation(automation_id)
            assert automation is not None
            assert automation.name == "Test Automation"
            assert automation.state == AutomationState.ACTIVE


class TestConfigModes:
    """Test interaction and approval mode config behavior."""

    def test_config_mode_roundtrip(self, tmp_path):
        from tehuti_cli.storage.config import default_config, save_config, load_config

        path = tmp_path / "config.toml"
        cfg = default_config()
        cfg.interaction_mode = "plan"
        cfg.approval_mode = "smart"
        save_config(cfg, path)
        loaded = load_config(path)
        assert loaded.interaction_mode == "plan"
        assert loaded.approval_mode == "smart"
        assert loaded.session_autoresume is False


class TestSessionLifecycle:
    """Test session startup behavior (new by default, explicit resume)."""

    def test_run_shell_creates_new_session_by_default(self, tmp_path, monkeypatch):
        from tehuti_cli.core import app as app_module
        from tehuti_cli.core.app import TehutiApp
        from tehuti_cli.storage.config import default_config

        class DummySession:
            def __init__(self, sid):
                self.id = sid
                self.work_dir = tmp_path
                self.context_file = tmp_path / f"{sid}.jsonl"
                self.wire_file = tmp_path / f"{sid}.wire.jsonl"

        class DummyShell:
            captured_session = None

            def __init__(self, config, work_dir, session, show_banner=False, session_mode="new"):
                DummyShell.captured_session = session

            def run(self):
                return

        monkeypatch.setattr(app_module, "Shell", DummyShell)
        monkeypatch.setattr("tehuti_cli.storage.workdir_config.apply_workdir_overrides", lambda cfg, wd: cfg)

        # Ensure load_last_session returns None (no previous session)
        def mock_load_last_session(wd):
            return None

        monkeypatch.setattr(app_module, "load_last_session", mock_load_last_session)

        # Capture which session creation function is called
        created_session = []

        def mock_create_session(wd):
            created_session.append("new-session")
            return DummySession("new-session")

        monkeypatch.setattr(app_module, "create_session", mock_create_session)

        # load_session is imported inside run_shell, so we need to patch the module
        from tehuti_cli.storage import session

        def mock_load_session(sid, wd):
            return DummySession(sid)

        monkeypatch.setattr(session, "load_session", mock_load_session)

        app = TehutiApp(default_config())
        app.run_shell(tmp_path, show_banner=False, resume=False)

        assert DummyShell.captured_session is not None

    def test_run_shell_resume_uses_last_session(self, tmp_path, monkeypatch):
        from tehuti_cli.core import app as app_module
        from tehuti_cli.core.app import TehutiApp
        from tehuti_cli.storage.config import default_config

        class DummySession:
            def __init__(self, sid):
                self.id = sid
                self.work_dir = tmp_path
                self.context_file = tmp_path / f"{sid}.jsonl"
                self.wire_file = tmp_path / f"{sid}.wire.jsonl"

        class DummyShell:
            captured_session = None

            def __init__(self, config, work_dir, session, show_banner=False, session_mode="new"):
                DummyShell.captured_session = session

            def run(self):
                return

        monkeypatch.setattr(app_module, "Shell", DummyShell)
        monkeypatch.setattr("tehuti_cli.storage.workdir_config.apply_workdir_overrides", lambda cfg, wd: cfg)

        # Ensure load_last_session returns a valid session
        target_session = DummySession("last-session")

        def mock_load_last_session(wd):
            return target_session

        monkeypatch.setattr(app_module, "load_last_session", mock_load_last_session)

        # Capture which session creation function is called
        created_session = []

        def mock_create_session(wd):
            created_session.append("new-session")
            return DummySession("new-session")

        monkeypatch.setattr(app_module, "create_session", mock_create_session)

        # load_session is imported inside run_shell from tehuti_cli.storage.session
        from tehuti_cli.storage import session

        def mock_load_session(sid, wd):
            return DummySession(sid)

        monkeypatch.setattr(session, "load_session", mock_load_session)

        app = TehutiApp(default_config())
        app.run_shell(tmp_path, show_banner=False, resume=True)

        assert DummyShell.captured_session is not None
        assert DummyShell.captured_session is target_session

    def test_run_shell_session_id_uses_explicit_session(self, tmp_path, monkeypatch):
        from tehuti_cli.core import app as app_module
        from tehuti_cli.core.app import TehutiApp
        from tehuti_cli.storage.config import default_config

        class DummySession:
            def __init__(self, sid):
                self.id = sid
                self.work_dir = tmp_path
                self.context_file = tmp_path / f"{sid}.jsonl"
                self.wire_file = tmp_path / f"{sid}.wire.jsonl"

        class DummyShell:
            captured_session = None

            def __init__(self, config, work_dir, session, show_banner=False, session_mode="new"):
                DummyShell.captured_session = session

            def run(self):
                return None

        monkeypatch.setattr(app_module, "Shell", DummyShell)
        monkeypatch.setattr("tehuti_cli.storage.workdir_config.apply_workdir_overrides", lambda cfg, wd: cfg)
        monkeypatch.setattr("tehuti_cli.storage.session.load_last_session", lambda wd: DummySession("last-session"))
        monkeypatch.setattr("tehuti_cli.storage.session.create_session", lambda wd: DummySession("new-session"))
        from tehuti_cli.storage.session import load_session

        monkeypatch.setattr("tehuti_cli.storage.session.load_session", lambda sid, wd: DummySession(sid))

        app = TehutiApp(default_config())
        app.run_shell(tmp_path, show_banner=False, session_id="explicit-session")
        assert DummyShell.captured_session.id == "explicit-session"


class TestPlannerVerifierContracts:
    """Ensure planner/verifier use supported LLM interface."""

    class _FakeLLM:
        def __init__(self):
            self.calls = []

        def chat_messages(self, messages, stream=False):
            self.calls.append(messages)
            return "ok"

    def test_planner_ask_llm_uses_chat_messages(self, tmp_path):
        from tehuti_cli.core.planner import ProjectPlanner
        from tehuti_cli.storage.planning import PlanningStorage

        llm = self._FakeLLM()
        planner = ProjectPlanner(llm, PlanningStorage(str(tmp_path)))
        out = planner._ask_llm("test prompt")
        assert out == "ok"
        assert llm.calls
        assert llm.calls[-1][0]["role"] == "system"
        assert llm.calls[-1][-1]["content"] == "test prompt"

    def test_verifier_auto_debug_uses_chat_messages(self, tmp_path):
        from tehuti_cli.core.verifier import PhaseVerifier
        from tehuti_cli.storage.planning import PlanningStorage

        llm = self._FakeLLM()
        verifier = PhaseVerifier(llm, PlanningStorage(str(tmp_path)), str(tmp_path))
        out = verifier._auto_debug_task("t1", {"title": "Task", "description": "Desc"})
        assert out["task_id"] == "t1"
        assert "debugging_steps" in out
        assert llm.calls


class TestExecutorBehavior:
    """Test runtime-backed task execution behavior."""

    class _FakeLLM:
        def __init__(self, config, responses):
            self.config = config
            self._responses = list(responses)

        def chat_messages(self, messages, stream=False):
            if not self._responses:
                return '{"type":"final","content":"done"}'
            return self._responses.pop(0)

    def test_task_without_instruction_fails(self, tmp_path):
        from tehuti_cli.core.executor import TaskExecutor
        from tehuti_cli.storage.config import default_config

        llm = self._FakeLLM(default_config(), [])
        ex = TaskExecutor(llm, str(tmp_path))
        result = ex.execute_task({"id": "t1", "title": "Notes", "description": "Discuss ideas"})
        assert result["status"] == "failed"
        assert "no executable instruction" in result["output"].lower()

    def test_task_executes_tool_and_finalizes(self, tmp_path, monkeypatch):
        from tehuti_cli.core.executor import TaskExecutor
        from tehuti_cli.storage.config import default_config

        llm = self._FakeLLM(
            default_config(),
            [
                json.dumps({"type": "tool", "name": "shell", "args": {"command": "echo test"}}),
                json.dumps({"type": "final", "content": "completed"}),
            ],
        )
        ex = TaskExecutor(llm, str(tmp_path))

        class _Result:
            def __init__(self):
                self.ok = True
                self.output = "test"

        monkeypatch.setattr(ex.runtime, "execute", lambda tool, args: _Result())

        result = ex.execute_task({"id": "t2", "title": "Run tests", "description": "run pytest"})
        assert result["status"] == "completed"
        assert result["output"] == "completed"
        assert result["trace"]
        assert result["trace"][0]["tool"] == "shell"
