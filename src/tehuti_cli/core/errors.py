from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class ErrorCategory(str, Enum):
    CONFIG = "config"
    BOOTSTRAP = "bootstrap"
    TOOL = "tool"
    AGENT_LOOP = "agent_loop"
    PROTOCOL = "protocol"
    INTERNAL = "internal"


@dataclass
class TehutiError(Exception):
    message: str
    code: str
    category: ErrorCategory
    retryable: bool = False
    details: dict[str, Any] = field(default_factory=dict)

    def __str__(self) -> str:
        return self.message

    def to_dict(self) -> dict[str, Any]:
        return {
            "error": self.message,
            "code": self.code,
            "category": self.category.value,
            "retryable": bool(self.retryable),
            "details": self.details,
        }


class ConfigError(TehutiError):
    def __init__(
        self,
        message: str,
        code: str = "config_error",
        details: dict[str, Any] | None = None,
        retryable: bool = False,
    ):
        super().__init__(
            message=message,
            code=code,
            category=ErrorCategory.CONFIG,
            retryable=retryable,
            details=details or {},
        )


class BootstrapError(TehutiError):
    def __init__(
        self,
        message: str,
        code: str = "bootstrap_error",
        details: dict[str, Any] | None = None,
        retryable: bool = False,
    ):
        super().__init__(
            message=message,
            code=code,
            category=ErrorCategory.BOOTSTRAP,
            retryable=retryable,
            details=details or {},
        )


class ToolExecutionError(TehutiError):
    def __init__(
        self,
        message: str,
        code: str = "tool_execution_error",
        details: dict[str, Any] | None = None,
        retryable: bool = False,
    ):
        super().__init__(
            message=message,
            code=code,
            category=ErrorCategory.TOOL,
            retryable=retryable,
            details=details or {},
        )


class AgentLoopError(TehutiError):
    def __init__(
        self,
        message: str,
        code: str = "agent_loop_error",
        details: dict[str, Any] | None = None,
        retryable: bool = False,
    ):
        super().__init__(
            message=message,
            code=code,
            category=ErrorCategory.AGENT_LOOP,
            retryable=retryable,
            details=details or {},
        )


class ProtocolError(TehutiError):
    def __init__(
        self,
        message: str,
        code: str = "protocol_error",
        details: dict[str, Any] | None = None,
        retryable: bool = False,
    ):
        super().__init__(
            message=message,
            code=code,
            category=ErrorCategory.PROTOCOL,
            retryable=retryable,
            details=details or {},
        )


def to_error_payload(exc: Exception) -> dict[str, Any]:
    if isinstance(exc, TehutiError):
        return exc.to_dict()
    return {
        "error": str(exc),
        "code": "unclassified_error",
        "category": ErrorCategory.INTERNAL.value,
        "retryable": False,
        "details": {},
    }
