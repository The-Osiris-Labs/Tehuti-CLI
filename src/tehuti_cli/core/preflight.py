from __future__ import annotations

import importlib.util
import platform
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from tehuti_cli.core.errors import BootstrapError, ConfigError
from tehuti_cli.core.tools import ToolRegistry
from tehuti_cli.storage.config import Config


@dataclass
class PreflightCheck:
    name: str
    ok: bool
    severity: str = "error"
    detail: str = ""
    code: str = ""
    data: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "ok": self.ok,
            "severity": self.severity,
            "detail": self.detail,
            "code": self.code,
            "data": self.data,
        }


@dataclass
class PreflightReport:
    checks: list[PreflightCheck]

    @property
    def ok(self) -> bool:
        return all(check.ok or check.severity != "error" for check in self.checks)

    @property
    def failed(self) -> list[PreflightCheck]:
        return [check for check in self.checks if not check.ok and check.severity == "error"]

    def to_dict(self) -> dict[str, Any]:
        checks = sorted((check.to_dict() for check in self.checks), key=lambda item: str(item.get("name", "")))
        errors = sum(1 for check in checks if check.get("ok") is False and check.get("severity") == "error")
        warnings = sum(1 for check in checks if check.get("ok") is False and check.get("severity") == "warning")
        return {
            "schema": "tehuti.preflight.v1",
            "ok": self.ok,
            "summary": {
                "total_checks": len(checks),
                "failed_errors": errors,
                "failed_warnings": warnings,
            },
            "checks": checks,
        }

    def ensure_ok(self) -> None:
        if self.ok:
            return
        failures = [f"{check.name}: {check.detail}" for check in self.failed]
        raise BootstrapError(
            "Runtime preflight failed.",
            code="preflight_failed",
            details={"failures": failures},
        )


def _check_python_runtime() -> PreflightCheck:
    version = platform.python_version()
    if sys.version_info < (3, 11):
        return PreflightCheck(
            name="python_runtime",
            ok=False,
            severity="error",
            detail=f"Python {version} is unsupported. Requires 3.11+.",
            code="python_version_unsupported",
            data={"python_version": version},
        )
    return PreflightCheck(
        name="python_runtime",
        ok=True,
        detail=f"Python {version}",
        code="python_runtime_ok",
        data={"python_version": version},
    )


def _check_virtualenv() -> PreflightCheck:
    in_venv = sys.prefix != getattr(sys, "base_prefix", sys.prefix)
    if not in_venv:
        return PreflightCheck(
            name="virtualenv",
            ok=False,
            severity="warning",
            detail="Not running in a virtual environment.",
            code="venv_missing",
        )
    return PreflightCheck(
        name="virtualenv",
        ok=True,
        detail=f"Virtual environment active at {sys.prefix}",
        code="venv_ok",
    )


def _check_dependency(name: str) -> PreflightCheck:
    found = importlib.util.find_spec(name) is not None
    return PreflightCheck(
        name=f"dependency:{name}",
        ok=found,
        severity="error",
        detail="available" if found else "missing",
        code="dependency_ok" if found else "dependency_missing",
    )


def _check_writable_path(name: str, path: Path, *, is_dir: bool = False) -> PreflightCheck:
    target = path if is_dir else path.parent
    try:
        target.mkdir(parents=True, exist_ok=True)
        probe = target / ".tehuti_preflight_probe"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink(missing_ok=True)
    except Exception as exc:
        return PreflightCheck(
            name=name,
            ok=False,
            severity="error",
            detail=str(exc),
            code="path_unwritable",
            data={"path": str(path)},
        )
    return PreflightCheck(
        name=name,
        ok=True,
        detail=f"{path}",
        code="path_writable",
        data={"path": str(path)},
    )


def _check_provider_config(config: Config) -> PreflightCheck:
    provider = str(config.provider.type or "").strip().lower()
    if provider not in {"openrouter", "openai", "gemini"}:
        return PreflightCheck(
            name="provider_config",
            ok=False,
            severity="error",
            detail=f"Unsupported provider type: {config.provider.type}",
            code="provider_invalid",
        )
    if provider != "openrouter" and not str(config.provider.model or "").strip():
        return PreflightCheck(
            name="provider_config",
            ok=False,
            severity="warning",
            detail=f"Provider {provider} has no model configured.",
            code="provider_model_missing",
        )
    return PreflightCheck(
        name="provider_config",
        ok=True,
        detail=f"provider={provider}",
        code="provider_ok",
    )


def run_preflight(config: Config, work_dir: Path, *, include_tool_registry: bool = True) -> PreflightReport:
    checks = [
        _check_python_runtime(),
        _check_virtualenv(),
        _check_provider_config(config),
        _check_writable_path("work_dir_writable", work_dir, is_dir=True),
        _check_writable_path("log_dir_writable", config.log_dir, is_dir=True),
        _check_dependency("pydantic"),
        _check_dependency("httpx"),
        _check_dependency("typer"),
    ]

    if include_tool_registry:
        try:
            tool_count = len(ToolRegistry(config).list_tools())
            checks.append(
                PreflightCheck(
                    name="tool_registry",
                    ok=True,
                    detail=f"{tool_count} tools loaded",
                    code="tool_registry_ok",
                    data={"tool_count": tool_count},
                )
            )
        except Exception as exc:
            checks.append(
                PreflightCheck(
                    name="tool_registry",
                    ok=False,
                    severity="error",
                    detail=str(exc),
                    code="tool_registry_load_failed",
                )
            )

    return PreflightReport(checks=checks)


def validate_config_contract(config: Config) -> None:
    provider = str(config.provider.type or "").strip().lower()
    if provider not in {"openrouter", "openai", "gemini"}:
        raise ConfigError(
            f"Unsupported provider type: {config.provider.type}",
            code="provider_invalid",
            details={"provider": config.provider.type},
        )
