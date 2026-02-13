from __future__ import annotations

import json
from pathlib import Path

from tehuti_cli.mcp_tools import MCPTools
from tehuti_cli.storage.config import default_config


def test_mcp_list_servers_reads_mcpservers_key(tmp_path: Path) -> None:
    cfg = default_config()
    cfg.mcp_file = tmp_path / "mcp.json"
    cfg.mcp_file.write_text(
        json.dumps(
            {
                "mcpServers": {
                    "local": {"command": "python3", "args": ["server.py"]},
                }
            }
        ),
        encoding="utf-8",
    )
    tools = MCPTools(cfg, tmp_path)

    result = tools.mcp_list_servers()
    assert result.ok is True
    assert "local" in result.output


def test_mcp_call_tool_not_connected_has_typed_protocol_error(tmp_path: Path) -> None:
    cfg = default_config()
    tools = MCPTools(cfg, tmp_path)

    result = tools.mcp_call_tool("missing", "x", {})
    assert result.ok is False
    assert result.error_category == "protocol"
    assert result.error_code == "mcp_not_connected"
    assert result.retryable is False


def test_mcp_list_servers_invalid_json_is_typed_protocol_error(tmp_path: Path) -> None:
    cfg = default_config()
    cfg.mcp_file = tmp_path / "mcp.json"
    cfg.mcp_file.write_text("{ invalid json", encoding="utf-8")
    tools = MCPTools(cfg, tmp_path)

    result = tools.mcp_list_servers()
    assert result.ok is False
    assert result.error_category == "protocol"
    assert result.error_code == "mcp_invalid_config"


def test_mcp_call_tool_missing_tool_is_typed_protocol_error(tmp_path: Path) -> None:
    cfg = default_config()
    tools = MCPTools(cfg, tmp_path)
    tools._servers["local"] = {"command": "python3", "args": [], "env": {}, "tools": ["read_file"]}

    result = tools.mcp_call_tool("local", "write_file", {})
    assert result.ok is False
    assert result.error_category == "protocol"
    assert result.error_code == "mcp_tool_not_found"


def test_mcp_call_tool_timeout_maps_to_timeout_code(tmp_path: Path, monkeypatch) -> None:
    cfg = default_config()
    tools = MCPTools(cfg, tmp_path)
    tools._servers["local"] = {"command": "python3", "args": [], "env": {}, "tools": ["read_file"]}

    def _boom(*_args, **_kwargs):
        raise TimeoutError("request timeout")

    monkeypatch.setattr(tools, "_run_with_server_session", _boom)

    result = tools.mcp_call_tool("local", "read_file", {})
    assert result.ok is False
    assert result.error_category == "protocol"
    assert result.error_code == "mcp_timeout"
    assert result.retryable is True


def test_mcp_read_resource_auth_error_maps_to_auth_failed(tmp_path: Path, monkeypatch) -> None:
    cfg = default_config()
    tools = MCPTools(cfg, tmp_path)
    tools._servers["local"] = {"command": "python3", "args": [], "env": {}, "tools": []}

    def _boom(*_args, **_kwargs):
        raise PermissionError("forbidden")

    monkeypatch.setattr(tools, "_run_with_server_session", _boom)

    result = tools.mcp_read_resource("local", "file://secret")
    assert result.ok is False
    assert result.error_category == "protocol"
    assert result.error_code == "mcp_auth_failed"
    assert result.retryable is False


def test_mcp_list_prompts_transport_error_maps_to_transport_code(tmp_path: Path, monkeypatch) -> None:
    cfg = default_config()
    tools = MCPTools(cfg, tmp_path)
    tools._servers["local"] = {"command": "python3", "args": [], "env": {}, "tools": []}

    def _boom(*_args, **_kwargs):
        raise ConnectionError("connection reset by peer")

    monkeypatch.setattr(tools, "_run_with_server_session", _boom)

    result = tools.mcp_list_prompts("local")
    assert result.ok is False
    assert result.error_category == "protocol"
    assert result.error_code == "mcp_transport_error"
    assert result.retryable is True


def test_mcp_get_prompt_invalid_payload_maps_to_invalid_payload(tmp_path: Path, monkeypatch) -> None:
    cfg = default_config()
    tools = MCPTools(cfg, tmp_path)
    tools._servers["local"] = {"command": "python3", "args": [], "env": {}, "tools": []}

    def _boom(*_args, **_kwargs):
        raise ValueError("invalid json payload")

    monkeypatch.setattr(tools, "_run_with_server_session", _boom)

    result = tools.mcp_get_prompt("local", "template", {})
    assert result.ok is False
    assert result.error_category == "protocol"
    assert result.error_code == "mcp_invalid_payload"
    assert result.retryable is False


def test_runtime_mcp_configure_dispatch_passes_servers_mapping(tmp_path: Path, monkeypatch) -> None:
    cfg = default_config()
    tools = MCPTools(cfg, tmp_path)

    captured: dict[str, object] = {}

    def _capture(servers, output_path=None):
        captured["servers"] = servers
        captured["output_path"] = output_path
        return tools._ok("ok")

    monkeypatch.setattr(tools, "mcp_configure", _capture)

    from tehuti_cli.core.runtime import ToolRuntime

    runtime = ToolRuntime(cfg, tmp_path)
    runtime.mcp = tools
    payload = {
        "servers": {"local": {"command": "python3", "args": ["server.py"]}},
        "output_path": str(tmp_path / "mcp.json"),
    }
    result = runtime.execute("mcp_configure", payload)
    assert result.ok is True
    assert isinstance(captured.get("servers"), dict)
    assert "local" in captured["servers"]
    assert captured["output_path"] == payload["output_path"]
