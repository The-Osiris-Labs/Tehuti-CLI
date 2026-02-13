from __future__ import annotations

from typing import Iterable

from tehuti_cli.core.tools import ToolRegistry, ToolSpec


VALID_RISK = {"low", "medium", "high", "critical"}
VALID_IDEMPOTENCY = {"safe_read", "idempotent_write", "mutating_write", "system_exec"}
VALID_APPROVAL = {"auto", "manual", "never"}
VALID_RETRY = {"never", "transient", "always"}


def lint_tool_spec(spec: ToolSpec) -> list[str]:
    errors: list[str] = []
    name = spec.name
    if spec.risk_class not in VALID_RISK:
        errors.append(f"{name}: invalid risk_class '{spec.risk_class}'")
    if spec.idempotency not in VALID_IDEMPOTENCY:
        errors.append(f"{name}: invalid idempotency '{spec.idempotency}'")
    if spec.approval_policy not in VALID_APPROVAL:
        errors.append(f"{name}: invalid approval_policy '{spec.approval_policy}'")
    if spec.retry_policy not in VALID_RETRY:
        errors.append(f"{name}: invalid retry_policy '{spec.retry_policy}'")
    if int(spec.latency_budget_ms) <= 0:
        errors.append(f"{name}: latency_budget_ms must be > 0")
    if int(spec.max_retries) < 0:
        errors.append(f"{name}: max_retries must be >= 0")
    if spec.retry_policy == "never" and int(spec.max_retries) != 0:
        errors.append(f"{name}: retry_policy=never requires max_retries=0")
    if spec.risk_class in {"high", "critical"} and spec.approval_policy == "auto":
        errors.append(f"{name}: high/critical risk requires non-auto approval_policy")
    return errors


def lint_tool_registry(registry: ToolRegistry) -> list[str]:
    errors: list[str] = []
    tools: Iterable[ToolSpec] = registry.list_tools()
    for spec in tools:
        errors.extend(lint_tool_spec(spec))
    return errors

