from __future__ import annotations

from pathlib import Path

from tehuti_cli.core.runtime import ToolRuntime
from tehuti_cli.core.tool_contract_linter import lint_tool_registry
from tehuti_cli.core.tools import ToolRegistry
from tehuti_cli.storage.config import default_config


def test_tool_registry_metadata_lint_passes() -> None:
    registry = ToolRegistry(default_config())
    errors = lint_tool_registry(registry)
    assert errors == []


def test_execute_contract_uses_registry_idempotency(tmp_path: Path) -> None:
    cfg = default_config()
    cfg.log_dir = tmp_path / "logs"
    runtime = ToolRuntime(cfg, tmp_path)
    result = runtime.execute_contract("read", {"path": "missing.txt"})
    assert result["tool"]["idempotency_class"] == "safe_read"
    assert result["audit"] is None


def test_retry_budget_follows_tool_metadata(tmp_path: Path) -> None:
    runtime = ToolRuntime(default_config(), tmp_path)
    spec = runtime.registry.get("write")
    assert spec is not None
    assert spec.retry_policy == "never"
    assert spec.max_retries == 0
    assert runtime._tool_retry_budget("write", requested_max_retries=5) == 0


def test_retry_backoff_uses_config_and_tool_metadata(tmp_path: Path) -> None:
    cfg = default_config()
    cfg.retry_backoff_base_seconds = 0.5
    cfg.retry_backoff_cap_seconds = 2.0
    runtime = ToolRuntime(cfg, tmp_path)

    # safe_read grows faster
    assert runtime._tool_retry_backoff_seconds("read", retry_count=0) == 0.5
    assert runtime._tool_retry_backoff_seconds("read", retry_count=1) == 1.0
    assert runtime._tool_retry_backoff_seconds("read", retry_count=3) == 2.0
    # mutating/system tools still back off but with gentler growth
    assert runtime._tool_retry_backoff_seconds("shell", retry_count=1) == 0.625


def test_smart_approval_uses_metadata_policy_for_high_risk_tools(tmp_path: Path) -> None:
    cfg = default_config()
    cfg.default_yolo = False
    cfg.allow_shell = True
    cfg.allow_write = True
    cfg.allow_external = True
    cfg.approval_mode = "smart"
    runtime = ToolRuntime(cfg, tmp_path)

    # write has manual approval policy from registry metadata.
    assert runtime.approve("write", {"path": "a.txt", "content": "x"}) is False
    # read is safe and auto-approved.
    assert runtime.approve("read", {"path": "a.txt"}) is True


def test_execute_with_validation_smart_mode_denies_manual_policy_tool(tmp_path: Path) -> None:
    cfg = default_config()
    cfg.default_yolo = False
    cfg.allow_shell = True
    cfg.allow_write = True
    cfg.allow_external = True
    cfg.approval_mode = "smart"
    runtime = ToolRuntime(cfg, tmp_path)

    result = runtime.execute_with_validation("write", {"path": "a.txt", "content": "x"})
    assert result.ok is False
    assert "Denied by" in result.output
