"""A2A (Agent-to-Agent) Protocol client for multi-agent communication.

This module implements Google's Agent-to-Agent Protocol for inter-agent
communication, enabling Tehuti to delegate tasks to and collaborate with
other agents that support the A2A protocol.

A2A Protocol Features:
- HTTP/SSE/JSON-RPC based communication
- Agent Cards for capability discovery
- Task delegation and result retrieval
- Streaming responses via SSE
- Multi-agent collaboration patterns
"""

from __future__ import annotations

import asyncio
import json
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum, auto
from pathlib import Path
from typing import Any, AsyncIterator
from urllib.parse import urljoin

import httpx

from tehuti_cli.core.errors import ProtocolError


class A2AConnectionMode(Enum):
    """Connection mode for A2A communication."""

    HTTP = "http"
    SSE = "sse"
    WEBSOCKET = "websocket"


class A2ATaskState(Enum):
    """State of an A2A task."""

    SUBMITTED = "submitted"
    WORKING = "working"
    INPUT_REQUIRED = "input_required"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELED = "canceled"


@dataclass
class AgentSkill:
    """Represents a capability an agent can perform."""

    id: str
    name: str
    description: str
    tags: list[str] = field(default_factory=list)


@dataclass
class AgentCard:
    """Agent capability declaration following A2A spec.

    Contains metadata about an agent including:
    - Name, version, capabilities
    - Supported input/output modalities
    - Authentication requirements
    - Streaming support
    """

    name: str
    version: str
    description: str
    skills: list[AgentSkill]
    url: str  # URL for A2A endpoint

    # Capabilities
    streaming_modes: list[str] = field(default_factory=lambda: ["none", "server-sent-events"])

    # Authentication
    auth_type: str | None = None
    auth_url: str | None = None

    # Metadata
    provider: str | None = None
    model: str | None = None

    # Capabilities
    memory_support: bool = False
    context_window: int = 0

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "name": self.name,
            "version": self.version,
            "description": self.description,
            "url": self.url,
            "skills": [{"id": s.id, "name": s.name, "description": s.description, "tags": s.tags} for s in self.skills],
            "streamingModes": self.streaming_modes,
            "capabilities": {
                "streaming": "server-sent-events" in self.streaming_modes,
                "memory": self.memory_support,
                "contextWindow": self.context_window,
            },
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> AgentCard:
        """Create from dictionary."""
        skills = [
            AgentSkill(
                id=s.get("id", ""),
                name=s.get("name", ""),
                description=s.get("description", ""),
                tags=s.get("tags", []),
            )
            for s in data.get("skills", [])
        ]
        return cls(
            name=data.get("name", "unknown"),
            version=data.get("version", "1.0.0"),
            description=data.get("description", ""),
            skills=skills,
            url=data.get("url", ""),
            streaming_modes=data.get("streamingModes", ["none"]),
            auth_type=data.get("auth", {}).get("type") if data.get("auth") else None,
            provider=data.get("capabilities", {}).get("provider"),
            model=data.get("capabilities", {}).get("model"),
            memory_support=data.get("capabilities", {}).get("memory", False),
            context_window=data.get("capabilities", {}).get("contextWindow", 0),
        )


@dataclass
class A2AMessage:
    """A message in A2A protocol."""

    role: str  # "user" or "agent"
    content: str
    timestamp: str = field(default_factory=lambda: datetime.now().isoformat())
    message_id: str = field(default_factory=lambda: str(uuid.uuid4()))

    def to_dict(self) -> dict[str, Any]:
        return {
            "role": self.role,
            "content": self.content,
            "timestamp": self.timestamp,
            "messageId": self.message_id,
        }


@dataclass
class A2ATask:
    """Represents a task in A2A protocol."""

    task_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    session_id: str | None = None
    messages: list[A2AMessage] = field(default_factory=list)
    state: A2ATaskState = A2ATaskState.SUBMITTED
    result: Any = None
    error: str | None = None
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())

    def to_dict(self, include_messages: bool = True) -> dict[str, Any]:
        data = {
            "id": self.task_id,
            "sessionId": self.session_id,
            "status": {
                "state": self.state.value,
                "timestamp": self.created_at,
            },
        }

        if include_messages and self.messages:
            data["messages"] = [m.to_dict() for m in self.messages]

        if self.result is not None:
            data["result"] = self.result

        if self.error:
            data["status"]["error"] = self.error

        return data


class A2AClient:
    """Client for A2A (Agent-to-Agent) Protocol.

    Enables Tehuti to:
    - Discover agents via Agent Cards
    - Delegate tasks to other A2A-compatible agents
    - Stream results via SSE
    - Handle authentication requirements
    """

    def __init__(
        self,
        endpoint: str,
        api_key: str | None = None,
        timeout: float = 30.0,
    ):
        """Initialize A2A client.

        Args:
            endpoint: Base URL for A2A endpoint
            api_key: Optional API key for authentication
            timeout: Request timeout in seconds
        """
        self.endpoint = endpoint.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout
        self.http_client = httpx.AsyncClient(timeout=timeout)

        self._agent_card: AgentCard | None = None

    def _auth_headers(self, *, content_type_json: bool = False, sse: bool = False) -> dict[str, str]:
        headers: dict[str, str] = {}
        if content_type_json:
            headers["Content-Type"] = "application/json"
        if sse:
            headers["Accept"] = "text/event-stream"
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    def _classify_http_error(self, exc: Exception, operation: str) -> ProtocolError:
        if isinstance(exc, httpx.TimeoutException):
            return ProtocolError(
                f"A2A {operation} timed out",
                code="a2a_timeout",
                retryable=True,
                details={"operation": operation, "endpoint": self.endpoint},
            )
        if isinstance(exc, httpx.HTTPStatusError):
            status_code = int(exc.response.status_code)
            if status_code in {401, 403}:
                code = "a2a_auth_failed"
                retryable = False
            elif status_code == 404:
                code = "a2a_not_found"
                retryable = False
            elif status_code == 429:
                code = "a2a_rate_limited"
                retryable = True
            elif status_code >= 500:
                code = "a2a_service_unavailable"
                retryable = True
            else:
                code = "a2a_http_error"
                retryable = False
            return ProtocolError(
                f"A2A {operation} failed with HTTP {status_code}",
                code=code,
                retryable=retryable,
                details={
                    "operation": operation,
                    "endpoint": self.endpoint,
                    "status_code": status_code,
                },
            )
        if isinstance(exc, httpx.RequestError):
            return ProtocolError(
                f"A2A {operation} request failed",
                code="a2a_request_failed",
                retryable=True,
                details={"operation": operation, "endpoint": self.endpoint, "error": str(exc)},
            )
        return ProtocolError(
            f"A2A {operation} failed",
            code="a2a_protocol_error",
            retryable=False,
            details={"operation": operation, "endpoint": self.endpoint, "error": str(exc)},
        )

    async def close(self) -> None:
        """Close the HTTP client."""
        await self.http_client.aclose()

    async def get_agent_card(self) -> AgentCard:
        """Fetch and parse agent card from endpoint.

        Returns:
            AgentCard with agent capabilities
        """
        url = urljoin(self.endpoint, "/.well-known/agent.json")

        try:
            response = await self.http_client.get(url, headers=self._auth_headers())
            response.raise_for_status()
            data = response.json()
            if not isinstance(data, dict):
                raise ProtocolError(
                    "A2A agent card payload invalid",
                    code="a2a_invalid_payload",
                    details={"operation": "get_agent_card", "endpoint": self.endpoint},
                )
            self._agent_card = AgentCard.from_dict(data)
            return self._agent_card
        except ProtocolError:
            raise
        except Exception as exc:
            raise self._classify_http_error(exc, "get_agent_card") from exc

    async def send_task(
        self,
        task: A2ATask,
        stream: bool = False,
    ) -> A2ATask:
        """Send a task to the agent.

        Args:
            task: Task to send
            stream: Whether to use streaming response

        Returns:
            Updated task with result or state
        """
        url = urljoin(self.endpoint, "/tasks/send")

        payload = {
            "id": task.task_id,
            "sessionId": task.session_id,
            "messages": [m.to_dict() for m in task.messages],
            "acceptedOutputModes": ["text"] if not stream else ["text", "stream"],
        }
        try:
            response = await self.http_client.post(url, json=payload, headers=self._auth_headers(content_type_json=True))
            response.raise_for_status()
            data = response.json()
            if not isinstance(data, dict):
                raise ProtocolError(
                    "A2A send task payload invalid",
                    code="a2a_invalid_payload",
                    details={"operation": "send_task", "endpoint": self.endpoint},
                )
            if "result" not in data and "status" not in data:
                raise ProtocolError(
                    "A2A send task payload invalid",
                    code="a2a_invalid_payload",
                    details={"operation": "send_task", "endpoint": self.endpoint, "reason": "missing_result_or_status"},
                )
            task.result = data.get("result")
            return task
        except ProtocolError:
            raise
        except Exception as exc:
            raise self._classify_http_error(exc, "send_task") from exc

    async def get_task_state(self, task_id: str) -> A2ATaskState:
        """Get current state of a task.

        Args:
            task_id: ID of the task to check

        Returns:
            Current task state
        """
        url = urljoin(self.endpoint, f"/tasks/{task_id}/status")

        try:
            response = await self.http_client.get(url, headers=self._auth_headers())
            response.raise_for_status()
            data = response.json()
            if not isinstance(data, dict):
                raise ProtocolError(
                    "A2A task state payload invalid",
                    code="a2a_invalid_payload",
                    details={"operation": "get_task_state", "endpoint": self.endpoint},
                )
            status = data.get("status")
            if not isinstance(status, dict):
                raise ProtocolError(
                    "A2A task state payload invalid",
                    code="a2a_invalid_payload",
                    details={"operation": "get_task_state", "endpoint": self.endpoint, "reason": "missing_status"},
                )
            state = status.get("state")
            if not isinstance(state, str):
                raise ProtocolError(
                    "A2A task state payload invalid",
                    code="a2a_invalid_payload",
                    details={"operation": "get_task_state", "endpoint": self.endpoint, "reason": "missing_state"},
                )
            return A2ATaskState(state)
        except ProtocolError:
            raise
        except ValueError as exc:
            raise ProtocolError(
                "A2A task state payload invalid",
                code="a2a_invalid_payload",
                details={"operation": "get_task_state", "endpoint": self.endpoint},
            ) from exc
        except Exception as exc:
            raise self._classify_http_error(exc, "get_task_state") from exc

    async def stream_task_result(self, task_id: str) -> AsyncIterator[dict[str, Any]]:
        """Stream task result via SSE.

        Args:
            task_id: ID of the task to stream

        Yields:
            Streaming events from the agent
        """
        url = urljoin(self.endpoint, f"/tasks/{task_id}/stream")

        try:
            async with self.http_client.stream("GET", url, headers=self._auth_headers(sse=True)) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if line.startswith("data: "):
                        data = json.loads(line[6:])
                        if not isinstance(data, dict):
                            raise ProtocolError(
                                "A2A stream payload invalid",
                                code="a2a_invalid_payload",
                                details={"operation": "stream_task_result", "endpoint": self.endpoint},
                            )
                        yield data
        except json.JSONDecodeError as exc:
            raise ProtocolError(
                "A2A stream payload invalid",
                code="a2a_invalid_payload",
                details={"operation": "stream_task_result", "endpoint": self.endpoint},
            ) from exc
        except ProtocolError:
            raise
        except Exception as exc:
            raise self._classify_http_error(exc, "stream_task_result") from exc

    async def cancel_task(self, task_id: str) -> bool:
        """Cancel a running task.

        Args:
            task_id: ID of the task to cancel

        Returns:
            True if cancellation succeeded
        """
        url = urljoin(self.endpoint, f"/tasks/{task_id}/cancel")

        try:
            response = await self.http_client.post(url, headers=self._auth_headers())
            response.raise_for_status()
            return response.status_code in (200, 204)
        except Exception as exc:
            raise self._classify_http_error(exc, "cancel_task") from exc


class A2AServer:
    """Simple A2A protocol server for exposing Tehuti as an agent.

    This allows Tehuti to be discovered and used by other A2A clients.
    """

    def __init__(
        self,
        agent_card: AgentCard,
        handler: callable,
        host: str = "127.0.0.1",
        port: int = 8080,
    ):
        """Initialize A2A server.

        Args:
            agent_card: Agent capabilities declaration
            handler: Async function to handle tasks (signature: async def handler(task: A2ATask) -> A2ATask)
            host: Host to bind
            port: Port to bind
        """
        self.agent_card = agent_card
        self.handler = handler
        self.host = host
        self.port = port
        self._tasks: dict[str, A2ATask] = {}

    async def start(self) -> None:
        """Start the A2A server."""
        import uvicorn
        from fastapi import FastAPI, HTTPException
        from fastapi.middleware.cors import CORSMiddleware
        from pydantic import BaseModel

        app = FastAPI()

        app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

        class TaskRequest(BaseModel):
            id: str
            sessionId: str | None = None
            messages: list[dict[str, Any]]
            acceptedOutputModes: list[str] | None = None

        @app.get("/.well-known/agent.json")
        async def get_agent_card() -> dict[str, Any]:
            return self.agent_card.to_dict()

        @app.post("/tasks/send")
        async def send_task(request: TaskRequest) -> dict[str, Any]:
            messages = [
                A2AMessage(
                    role=m.get("role", "user"),
                    content=m.get("content", ""),
                    message_id=m.get("messageId", str(uuid.uuid4())),
                )
                for m in request.messages
            ]

            task = A2ATask(
                task_id=request.id,
                session_id=request.sessionId,
                messages=messages,
            )
            self._tasks[task.task_id] = task

            try:
                result_task = await self.handler(task)
                self._tasks[result_task.task_id] = result_task
                return {
                    "id": result_task.task_id,
                    "status": {"state": result_task.state.value},
                    "result": result_task.result,
                }
            except Exception as e:
                task.error = str(e)
                task.state = A2ATaskState.FAILED
                return {
                    "id": task.task_id,
                    "status": {"state": "failed", "error": str(e)},
                }

        @app.get("/tasks/{task_id}/status")
        async def get_task_status(task_id: str) -> dict[str, Any]:
            if task_id not in self._tasks:
                raise HTTPException(status_code=404, detail="Task not found")
            task = self._tasks[task_id]
            return {
                "id": task.task_id,
                "status": {"state": task.state.value, "timestamp": task.created_at},
            }

        @app.post("/tasks/{task_id}/cancel")
        async def cancel_task(task_id: str) -> dict[str, Any]:
            if task_id not in self._tasks:
                raise HTTPException(status_code=404, detail="Task not found")
            self._tasks[task_id].state = A2ATaskState.CANCELED
            return {"id": task_id, "status": {"state": "canceled"}}

        config = uvicorn.Config(app, host=self.host, port=self.port, log_level="info")
        server = uvicorn.Server(config)
        await server.serve()


def create_tehuti_agent_card(work_dir: Path | None = None) -> AgentCard:
    """Create an Agent Card representing Tehuti.

    Args:
        work_dir: Optional working directory for context

    Returns:
        AgentCard with Tehuti capabilities
    """
    skills = [
        AgentSkill(
            id="file-operations",
            name="File Operations",
            description="Read, write, edit, and manage files",
            tags=["filesystem", "files"],
        ),
        AgentSkill(
            id="shell-execution",
            name="Shell Commands",
            description="Execute shell commands and scripts",
            tags=["shell", "terminal", "bash"],
        ),
        AgentSkill(
            id="web-search",
            name="Web Search",
            description="Search the web and fetch URLs",
            tags=["web", "search", "http"],
        ),
        AgentSkill(
            id="code-analysis",
            name="Code Analysis",
            description="Read, understand, and explain code",
            tags=["code", "analysis", "programming"],
        ),
        AgentSkill(
            id="git-operations",
            name="Git Operations",
            description="Version control operations",
            tags=["git", "version-control", "scm"],
        ),
        AgentSkill(
            id="database-queries",
            name="Database Queries",
            description="Execute database queries",
            tags=["database", "sql", "data"],
        ),
        AgentSkill(
            id="docker-management",
            name="Docker Management",
            description="Container operations",
            tags=["docker", "containers", "devops"],
        ),
    ]

    return AgentCard(
        name="Tehuti",
        version="1.0.0",
        description="Project Tehuti: AI assistant with tool access for software engineering tasks",
        skills=skills,
        url="http://localhost:8080",
        streaming_modes=["none", "server-sent-events"],
        auth_type=None,
        provider="openrouter",
        model="qwen/qwen3-coder:free",
        memory_support=True,
        context_window=128000,
    )
