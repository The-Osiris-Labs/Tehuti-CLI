from __future__ import annotations

from pathlib import Path

from tehuti_cli.core.preflight import run_preflight
from tehuti_cli.storage.config import default_config


def test_preflight_report_contains_required_checks(tmp_path: Path) -> None:
    cfg = default_config()
    report = run_preflight(cfg, tmp_path, include_tool_registry=False)
    payload = report.to_dict()

    check_names = {check.name for check in report.checks}
    assert "python_runtime" in check_names
    assert "provider_config" in check_names
    assert "work_dir_writable" in check_names
    assert "log_dir_writable" in check_names
    assert isinstance(report.ok, bool)
    assert payload["schema"] == "tehuti.preflight.v1"
    assert payload["summary"]["total_checks"] >= 1
