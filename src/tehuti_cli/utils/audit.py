"""Audit logging for Tehuti.

Provides comprehensive logging of all operations for security and debugging.
"""

import json
import os
import socket
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Optional, Any, Dict, List
from dataclasses import dataclass, asdict, field


class AuditEventType(str, Enum):
    """Types of audit events."""

    TOOL_EXECUTION = "tool_execution"
    TOOL_DENIED = "tool_denied"
    TOOL_ERROR = "tool_error"
    PROJECT_CREATE = "project_create"
    PROJECT_UPDATE = "project_update"
    PHASE_START = "phase_start"
    PHASE_COMPLETE = "phase_complete"
    PHASE_FAIL = "phase_fail"
    PLAN_CREATE = "plan_create"
    CHECKPOINT_SAVE = "checkpoint_save"
    CHECKPOINT_LOAD = "checkpoint_load"
    CACHE_HIT = "cache_hit"
    CACHE_MISS = "cache_miss"
    CACHE_SET = "cache_set"
    CONFIG_CHANGE = "config_change"
    API_CALL = "api_call"
    ERROR = "error"
    SESSION_START = "session_start"
    SESSION_END = "session_end"
    PERMISSION_CHANGE = "permission_change"


@dataclass
class AuditEvent:
    """A single audit event."""

    timestamp: str
    event_type: str
    session_id: str
    user_id: Optional[str]
    hostname: str
    tool_name: Optional[str]
    args: Dict[str, Any]
    result: Optional[Dict[str, Any]]
    success: bool
    error_message: Optional[str]
    duration_ms: int
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "AuditEvent":
        """Create from dictionary."""
        return cls(**data)


class AuditLogger:
    """Comprehensive audit logger for Tehuti.

    Features:
    - Structured JSON logging
    - Configurable log levels
    - Session tracking
    - Event filtering
    - Log rotation
    - Query capabilities
    """

    def __init__(
        self,
        log_dir: str = "~/.tehuti/logs",
        log_level: str = "INFO",
        max_file_size_mb: int = 10,
        max_files: int = 5,
    ):
        """Initialize the audit logger.

        Args:
            log_dir: Directory for log files
            log_level: Minimum log level (DEBUG, INFO, WARNING, ERROR)
            max_file_size_mb: Maximum size of each log file
            max_files: Number of rotated log files to keep
        """
        self.log_dir = Path(log_dir).expanduser()
        self.log_dir.mkdir(parents=True, exist_ok=True)
        self.log_level = log_level
        self.max_file_size = max_file_size_mb * 1024 * 1024
        self.max_files = max_files
        self._session_id: Optional[str] = None
        self._user_id: Optional[str] = None

        # Get hostname once
        self._hostname = socket.gethostname()

    def _get_log_path(self) -> Path:
        """Get the current log file path."""
        today = datetime.now().strftime("%Y-%m-%d")
        return self.log_dir / f"tehuti-audit-{today}.log"

    def _should_log(self, level: str) -> bool:
        """Check if a log level should be logged."""
        levels = ["DEBUG", "INFO", "WARNING", "ERROR"]
        return levels.index(level) >= levels.index(self.log_level)

    def _rotate_logs_if_needed(self) -> None:
        """Rotate log files if current file is too large."""
        log_path = self._get_log_path()
        if log_path.exists() and log_path.stat().st_size > self.max_file_size:
            # Rotate existing files
            for i in range(self.max_files - 1, 0, -1):
                src = log_path.with_suffix(f".{i}.log")
                dst = log_path.with_suffix(f".{i + 1}.log")
                if src.exists():
                    src.rename(dst)

            # Move current log
            log_path.rename(log_path.with_suffix(".1.log"))

    def _write_event(self, event: AuditEvent) -> None:
        """Write an event to the log file."""
        self._rotate_logs_if_needed()

        log_path = self._get_log_path()
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(event.to_dict()) + "\n")

    def set_session(self, session_id: str, user_id: Optional[str] = None) -> None:
        """Set the current session context.

        Args:
            session_id: Unique session identifier
            user_id: Optional user identifier
        """
        self._session_id = session_id
        self._user_id = user_id

        # Log session start
        self.log_event(
            event_type=AuditEventType.SESSION_START,
            tool_name=None,
            args={"session_id": session_id, "user_id": user_id},
            result=None,
            success=True,
            error_message=None,
            duration_ms=0,
        )

    def log_event(
        self,
        event_type: AuditEventType | str,
        tool_name: Optional[str],
        args: Dict[str, Any],
        result: Optional[Dict[str, Any]],
        success: bool,
        error_message: Optional[str],
        duration_ms: int,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> AuditEvent:
        """Log an audit event.

        Args:
            event_type: Type of event
            tool_name: Name of the tool (if applicable)
            args: Tool arguments (sanitized)
            result: Result of the operation
            success: Whether the operation succeeded
            error_message: Error message (if any)
            duration_ms: Duration in milliseconds
            metadata: Additional metadata

        Returns:
            The created AuditEvent
        """
        # Sanitize sensitive args
        sanitized_args = self._sanitize_args(args)

        event = AuditEvent(
            timestamp=datetime.now().isoformat(),
            event_type=event_type.value
            if isinstance(event_type, AuditEventType)
            else event_type,
            session_id=self._session_id or "unknown",
            user_id=self._user_id,
            hostname=self._hostname,
            tool_name=tool_name,
            args=sanitized_args,
            result=result,
            success=success,
            error_message=error_message,
            duration_ms=duration_ms,
            metadata=metadata or {},
        )

        self._write_event(event)
        return event

    def _sanitize_args(self, args: Dict[str, Any]) -> Dict[str, Any]:
        """Remove sensitive information from arguments.

        Args:
            args: Original arguments

        Returns:
            Sanitized arguments
        """
        sensitive_keys = {
            "api_key",
            "password",
            "token",
            "secret",
            "key",
            "credential",
            "private_key",
            "cert",
            "auth",
            "authorization",
        }

        sanitized = {}
        for key, value in args.items():
            if key.lower() in sensitive_keys:
                sanitized[key] = "***REDACTED***"
            elif isinstance(value, dict):
                sanitized[key] = self._sanitize_args(value)
            elif isinstance(value, list):
                sanitized[key] = [
                    self._sanitize_args(item) if isinstance(item, dict) else item
                    for item in value
                ]
            else:
                sanitized[key] = value

        return sanitized

    def log_tool_execution(
        self,
        tool_name: str,
        args: Dict[str, Any],
        result: Dict[str, Any],
        success: bool,
        error_message: Optional[str],
        duration_ms: int,
    ) -> AuditEvent:
        """Log a tool execution event.

        Args:
            tool_name: Name of the tool
            args: Tool arguments
            result: Tool result
            success: Whether execution succeeded
            error_message: Error message if failed
            duration_ms: Execution time

        Returns:
            The created AuditEvent
        """
        event_type = AuditEventType.TOOL_EXECUTION
        return self.log_event(
            event_type=event_type,
            tool_name=tool_name,
            args=args,
            result=result,
            success=success,
            error_message=error_message,
            duration_ms=duration_ms,
        )

    def log_tool_denied(
        self,
        tool_name: str,
        args: Dict[str, Any],
        reason: str,
        duration_ms: int,
    ) -> AuditEvent:
        """Log when a tool execution is denied.

        Args:
            tool_name: Name of the denied tool
            args: Tool arguments
            reason: Reason for denial
            duration_ms: Time until denial

        Returns:
            The created AuditEvent
        """
        return self.log_event(
            event_type=AuditEventType.TOOL_DENIED,
            tool_name=tool_name,
            args=args,
            result={"reason": reason},
            success=False,
            error_message=f"Tool denied: {reason}",
            duration_ms=duration_ms,
        )

    def log_error(
        self,
        error_type: str,
        error_message: str,
        context: Optional[Dict[str, Any]] = None,
        duration_ms: int = 0,
    ) -> AuditEvent:
        """Log an error event.

        Args:
            error_type: Type of error
            error_message: Error description
            context: Error context
            duration_ms: Time until error

        Returns:
            The created AuditEvent
        """
        return self.log_event(
            event_type=AuditEventType.ERROR,
            tool_name=None,
            args={"error_type": error_type},
            result={"context": context},
            success=False,
            error_message=error_message,
            duration_ms=duration_ms,
        )

    def log_project_event(
        self,
        event_type: AuditEventType,
        project_name: str,
        details: Dict[str, Any],
        success: bool = True,
    ) -> AuditEvent:
        """Log a project-related event.

        Args:
            event_type: Type of project event
            project_name: Name of the project
            details: Event details
            success: Whether successful

        Returns:
            The created AuditEvent
        """
        return self.log_event(
            event_type=event_type,
            tool_name=None,
            args={"project_name": project_name},
            result=details,
            success=success,
            error_message=None,
            duration_ms=0,
        )

    def log_cache_event(
        self,
        event_type: AuditEventType,
        tool_name: str,
        args: Dict[str, Any],
        hit: bool = False,
    ) -> AuditEvent:
        """Log a cache-related event.

        Args:
            event_type: Type of cache event
            tool_name: Tool name
            args: Tool arguments
            hit: Whether cache hit occurred

        Returns:
            The created AuditEvent
        """
        return self.log_event(
            event_type=event_type,
            tool_name=tool_name,
            args=args,
            result={"cache_hit": hit},
            success=True,
            error_message=None,
            duration_ms=0,
        )

    def query_events(
        self,
        start_time: Optional[str] = None,
        end_time: Optional[str] = None,
        event_types: Optional[List[str]] = None,
        tool_name: Optional[str] = None,
        session_id: Optional[str] = None,
        success: Optional[bool] = None,
        limit: int = 1000,
    ) -> List[AuditEvent]:
        """Query audit events from log files.

        Args:
            start_time: ISO format start time
            end_time: ISO format end time
            event_types: Filter by event types
            tool_name: Filter by tool name
            session_id: Filter by session
            success: Filter by success status
            limit: Maximum events to return

        Returns:
            List of matching AuditEvents
        """
        events = []
        seen_events = set()

        # Read from log files (newest first)
        for log_file in sorted(self.log_dir.glob("tehuti-audit-*.log"), reverse=True):
            if len(events) >= limit:
                break

            try:
                with open(log_file, "r", encoding="utf-8") as f:
                    for line in f:
                        if len(events) >= limit:
                            break

                        try:
                            data = json.loads(line.strip())
                            event = AuditEvent.from_dict(data)

                            # Create unique key to avoid duplicates
                            event_key = f"{event.timestamp}_{event.event_type}_{event.session_id}"
                            if event_key in seen_events:
                                continue
                            seen_events.add(event_key)

                            # Apply filters
                            if start_time and event.timestamp < start_time:
                                continue
                            if end_time and event.timestamp > end_time:
                                continue
                            if event_types and event.event_type not in event_types:
                                continue
                            if tool_name and event.tool_name != tool_name:
                                continue
                            if session_id and event.session_id != session_id:
                                continue
                            if success is not None and event.success != success:
                                continue

                            events.append(event)

                        except (json.JSONDecodeError, KeyError, TypeError):
                            continue

            except Exception:
                continue

        return events[-limit:]

    def get_session_summary(self, session_id: str) -> Dict[str, Any]:
        """Get a summary of a session's activity.

        Args:
            session_id: Session to summarize

        Returns:
            Summary dictionary
        """
        events = self.query_events(session_id=session_id, limit=10000)

        tool_counts: Dict[str, int] = {}
        total_duration = 0
        success_count = 0
        fail_count = 0

        for event in events:
            if event.tool_name:
                tool_counts[event.tool_name] = tool_counts.get(event.tool_name, 0) + +1
            total_duration += event.duration_ms
            if event.success:
                success_count += 1
            else:
                fail_count += 1

        return {
            "session_id": session_id,
            "event_count": len(events),
            "tool_count": len(tool_counts),
            "tool_breakdown": tool_counts,
            "total_duration_ms": total_duration,
            "success_count": success_count,
            "fail_count": fail_count,
            "first_event": events[0].timestamp if events else None,
            "last_event": events[-1].timestamp if events else None,
        }

    def get_recent_errors(self, limit: int = 50) -> List[AuditEvent]:
        """Get recent error events.

        Args:
            limit: Maximum events to return

        Returns:
            List of error events
        """
        return self.query_events(
            event_types=["tool_execution", "tool_error", "error"],
            success=False,
            limit=limit,
        )

    def get_tool_usage(self, tool_name: str, limit: int = 100) -> List[AuditEvent]:
        """Get recent usage of a specific tool.

        Args:
            tool_name: Tool to query
            limit: Maximum events

        Returns:
            List of tool execution events
        """
        return self.query_events(
            event_types=["tool_execution"],
            tool_name=tool_name,
            limit=limit,
        )

    def clear_old_logs(self, days: int = 30) -> int:
        """Remove log files older than specified days.

        Args:
            days: Number of days to keep

        Returns:
            Number of files deleted
        """
        cutoff = datetime.now().timestamp() - (days * 24 * 60 * 60)
        deleted = 0

        for log_file in self.log_dir.glob("tehuti-audit-*.log"):
            if log_file.stat().st_mtime < cutoff:
                try:
                    log_file.unlink()
                    deleted += 1
                except Exception:
                    pass

        return deleted

    def export_logs(
        self,
        output_path: str,
        start_time: Optional[str] = None,
        end_time: Optional[str] = None,
        format: str = "json",
    ) -> int:
        """Export audit logs to a file.

        Args:
            output_path: Output file path
            start_time: Filter start time
            end_time: Filter end time
            format: Export format (json or jsonl)

        Returns:
            Number of events exported
        """
        events = self.query_events(
            start_time=start_time,
            end_time=end_time,
            limit=100000,
        )

        if format == "json":
            export_data = [e.to_dict() for e in events]
            with open(output_path, "w", encoding="utf-8") as f:
                json.dump(export_data, f, indent=2)
        else:
            with open(output_path, "w", encoding="utf-8") as f:
                for event in events:
                    f.write(json.dumps(event.to_dict()) + "\n")

        return len(events)


def get_audit_logger() -> AuditLogger:
    """Get the global audit logger instance.

    Returns:
        Configured AuditLogger instance
    """
    return AuditLogger()


class AuditContext:
    """Context manager for auditing a block of code."""

    def __init__(
        self,
        logger: AuditLogger,
        event_type: AuditEventType,
        tool_name: Optional[str] = None,
        args: Optional[Dict[str, Any]] = None,
    ):
        """Initialize audit context.

        Args:
            logger: Audit logger to use
            event_type: Type of event
            tool_name: Tool name (if applicable)
            args: Arguments to log
        """
        self.logger = logger
        self.event_type = event_type
        self.tool_name = tool_name
        self.args = args or {}
        self.start_time: int = 0
        self.result: Optional[Dict[str, Any]] = None
        self.success: bool = False
        self.error_message: Optional[str] = None

    def __enter__(self) -> "AuditContext":
        """Enter context and record start time."""
        import time

        self.start_time = int(time.time() * 1000)
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        """Exit context and log the event."""
        import time

        end_time = int(time.time() * 1000)
        duration_ms = end_time - self.start_time

        if exc_type is not None:
            self.success = False
            self.error_message = f"{exc_type.__name__}: {str(exc_val)}"
        else:
            self.success = True
            self.error_message = None

        self.logger.log_event(
            event_type=self.event_type,
            tool_name=self.tool_name,
            args=self.args,
            result=self.result,
            success=self.success,
            error_message=self.error_message,
            duration_ms=duration_ms,
        )

    def set_result(self, result: Dict[str, Any]) -> None:
        """Set the result of the operation."""
        self.result = result


def create_audit_logger(
    log_dir: str = "~/.tehuti/logs",
    log_level: str = "INFO",
) -> AuditLogger:
    """Factory function to create an AuditLogger.

    Args:
        log_dir: Directory for log files
        log_level: Minimum log level

    Returns:
        Configured AuditLogger instance
    """
    return AuditLogger(log_dir, log_level)
