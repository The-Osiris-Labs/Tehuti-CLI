from __future__ import annotations

from pathlib import Path

from tehuti_cli.core.runtime import ToolRuntime
from tehuti_cli.storage.config import default_config


def test_execute_contract_success_shape(tmp_path: Path) -> None:
    cfg = default_config()
    cfg.log_dir = tmp_path / "logs"
    runtime = ToolRuntime(cfg, tmp_path)

    result = runtime.execute_contract("write", {"path": "contract.txt", "content": "abc"})

    assert result["schema"] == "tehuti.tool_result.v1"
    assert result["status"] == "success"
    assert result["tool"]["name"] == "write"
    assert result["tool"]["idempotency_class"] == "mutating_write"
    assert result["tool"]["risk_class"] in {"high", "critical"}
    assert result["tool"]["approval_policy"] == "manual"
    assert result["tool"]["latency_budget_ms"] > 0
    assert result["tool"]["retry_policy"] == "never"
    assert result["tool"]["max_retries"] == 0
    assert result["trace"]["trace_id"]
    assert result["trace"]["latency_ms"] >= 0
    assert result["result"]["ok"] is True
    assert "Wrote" in result["result"]["output"]
    assert result["error"] is None
    assert result["audit"] is not None
    assert result["audit"]["schema"] == "tehuti.mutation_audit.v1"
    assert result["audit"]["audit_id"]
    audit_file = cfg.log_dir / "mutation_audit.jsonl"
    assert audit_file.exists()


def test_execute_contract_failure_error_classification(tmp_path: Path) -> None:
    cfg = default_config()
    cfg.log_dir = tmp_path / "logs"
    runtime = ToolRuntime(cfg, tmp_path)

    result = runtime.execute_contract("missing_tool", {})

    assert result["schema"] == "tehuti.tool_result.v1"
    assert result["status"] == "failed"
    assert result["result"]["ok"] is False
    assert result["error"] is not None
    assert result["error"]["category"] == "contract"
    assert result["error"]["code"] == "unknown_tool"
    assert result["error"]["retryable"] is False
