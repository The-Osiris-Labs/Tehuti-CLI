from __future__ import annotations

from pathlib import Path

from tehuti_cli.core.runtime import ToolRuntime
from tehuti_cli.storage.config import default_config


def test_mcp_not_connected_is_typed_as_protocol_error(tmp_path: Path) -> None:
    cfg = default_config()
    cfg.log_dir = tmp_path / "logs"
    runtime = ToolRuntime(cfg, tmp_path)

    result = runtime.execute_contract("mcp_call_tool", {"server_name": "unknown", "tool_name": "x"})
    assert result["status"] == "failed"
    assert result["error"] is not None
    assert result["error"]["category"] == "protocol"
    assert result["error"]["code"] == "mcp_not_connected"
    assert result["error"]["retryable"] is False


def test_protocol_timeout_error_mapping(tmp_path: Path) -> None:
    runtime = ToolRuntime(default_config(), tmp_path)
    category, code, retryable = runtime._classify_tool_error("mcp_call_tool", "timeout after 30s")
    assert category == "protocol"
    assert code == "protocol_timeout"
    assert retryable is True
