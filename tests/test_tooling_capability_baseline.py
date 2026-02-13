from __future__ import annotations

from tehuti_cli.core.tools import ToolRegistry
from tehuti_cli.storage.config import default_config


def test_tool_registry_exposes_broad_capability_surface() -> None:
    registry = ToolRegistry(default_config())
    names = {tool.name for tool in registry.list_tools()}

    # Capability breadth baseline: this should stay high and must not regress
    # toward a reduced MVP tool set.
    assert len(names) >= 200

    required_families = {
        "read",
        "write",
        "edit",
        "shell",
        "web_search",
        "docker_ps",
        "git_status",
        "pytest",
        "browser_navigate",
        "web_fetch_render",
        "mcp_list_servers",
        "mcp_call_tool",
        "delegate_create",
        "task_create",
        "blueprint_create",
        "automation_create",
        "stream_chat",
        "tool_create_shell",
        "image_analyze",
    }
    missing = sorted(required_families - names)
    assert not missing, f"missing required capability families: {missing}"
