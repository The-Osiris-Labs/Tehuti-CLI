from __future__ import annotations

import asyncio
import concurrent.futures
import json
from pathlib import Path

import httpx
import pytest

from tehuti_cli.core.a2a_client import A2AClient, A2ATask, A2ATaskState
from tehuti_cli.core.errors import ProtocolError
from tehuti_cli.mcp_tools import MCPTools
from tehuti_cli.storage.config import default_config


@pytest.mark.asyncio
async def test_a2a_lifecycle_discovery_invoke_stream_cancel_resume(monkeypatch) -> None:
    client = A2AClient("http://example.local")
    state_calls = {"main": 0}

    class _GetResp:
        def __init__(self, payload):
            self._payload = payload

        def raise_for_status(self):
            return None

        def json(self):
            return self._payload

    class _PostResp:
        def __init__(self, status_code: int = 200, payload: dict | None = None):
            self.status_code = status_code
            self._payload = payload or {}

        def raise_for_status(self):
            return None

        def json(self):
            return self._payload

    async def _get(url: str, **_kwargs):
        if url.endswith("/.well-known/agent.json"):
            return _GetResp(
                {
                    "name": "fixture-agent",
                    "description": "fixture",
                    "url": "http://example.local",
                    "version": "1.0.0",
                    "capabilities": {"streaming": True},
                }
            )
        if url.endswith("/tasks/main/status"):
            state_calls["main"] += 1
            state = "working" if state_calls["main"] == 1 else "completed"
            return _GetResp({"status": {"state": state}})
        raise AssertionError(f"Unexpected GET url: {url}")

    async def _post(url: str, **_kwargs):
        if url.endswith("/tasks/send"):
            return _PostResp(payload={"status": {"state": "running"}})
        if url.endswith("/tasks/cancel-me/cancel"):
            return _PostResp(status_code=204)
        raise AssertionError(f"Unexpected POST url: {url}")

    class _StreamResp:
        def raise_for_status(self):
            return None

        async def aiter_lines(self):
            yield 'data: {"event":"chunk","delta":"hel"}'
            yield 'data: {"event":"chunk","delta":"lo"}'
            yield 'data: {"event":"done"}'

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

    def _stream(method: str, url: str, **_kwargs):
        assert method == "GET"
        assert url.endswith("/tasks/main/stream")
        return _StreamResp()

    monkeypatch.setattr(client.http_client, "get", _get)
    monkeypatch.setattr(client.http_client, "post", _post)
    monkeypatch.setattr(client.http_client, "stream", _stream)

    card = await client.get_agent_card()
    assert card.name == "fixture-agent"

    task = await client.send_task(A2ATask(task_id="main"))
    assert task.result is None

    first_state = await client.get_task_state("main")
    second_state = await client.get_task_state("main")
    assert first_state == A2ATaskState.WORKING
    assert second_state == A2ATaskState.COMPLETED

    streamed = []
    async for event in client.stream_task_result("main"):
        streamed.append(event)
    assert [evt.get("event") for evt in streamed] == ["chunk", "chunk", "done"]

    cancelled = await client.cancel_task("cancel-me")
    assert cancelled is True
    await client.close()


@pytest.mark.asyncio
async def test_a2a_concurrent_cancel_partial_failure(monkeypatch) -> None:
    client = A2AClient("http://example.local")

    async def _post(url: str, **_kwargs):
        if url.endswith("/tasks/t-ok/cancel"):
            class _OK:
                status_code = 204

                def raise_for_status(self):
                    return None

            return _OK()

        request = httpx.Request("POST", url)
        response = httpx.Response(404, request=request)
        raise httpx.HTTPStatusError("not found", request=request, response=response)

    monkeypatch.setattr(client.http_client, "post", _post)

    ok_result, bad_result = await asyncio.gather(
        client.cancel_task("t-ok"),
        client.cancel_task("t-missing"),
        return_exceptions=True,
    )

    assert ok_result is True
    assert isinstance(bad_result, ProtocolError)
    assert bad_result.code == "a2a_not_found"
    await client.close()


def test_mcp_lifecycle_discovery_invoke_disconnect_and_resume(tmp_path: Path, monkeypatch) -> None:
    cfg = default_config()
    tools = MCPTools(cfg, tmp_path)
    tools._servers["local"] = {
        "command": "python3",
        "args": [],
        "env": {},
        "tools": ["read_file", "slow_tool"],
    }

    state = {"slow_failures": 0}

    def _run_with_server_session(_server_name: str, operation):
        class _Content:
            def __init__(self, text: str):
                self.text = text

        class _Result:
            def __init__(self, text: str):
                self.content = [_Content(text)]

        class _Session:
            async def call_tool(self, tool_name: str, args: dict):
                if tool_name == "slow_tool" and state["slow_failures"] == 0:
                    state["slow_failures"] += 1
                    raise TimeoutError("timeout")
                return _Result(json.dumps({"tool": tool_name, "args": args, "ok": True}))

        return asyncio.run(operation(_Session()))

    monkeypatch.setattr(tools, "_run_with_server_session", _run_with_server_session)

    listed = tools.mcp_list_tools("local")
    assert listed.ok is True
    assert "read_file" in listed.output

    first = tools.mcp_call_tool("local", "slow_tool", {"attempt": 1})
    assert first.ok is False
    assert first.error_code == "mcp_timeout"
    assert first.retryable is True

    resumed = tools.mcp_call_tool("local", "slow_tool", {"attempt": 2})
    assert resumed.ok is True
    assert '"attempt": 2' in resumed.output

    disconnected = tools.mcp_disconnect("local")
    assert disconnected.ok is True

    after_disconnect = tools.mcp_call_tool("local", "read_file", {})
    assert after_disconnect.ok is False
    assert after_disconnect.error_code == "mcp_not_connected"


def test_mcp_concurrent_partial_failure_invoke(tmp_path: Path, monkeypatch) -> None:
    cfg = default_config()
    tools = MCPTools(cfg, tmp_path)
    tools._servers["local"] = {
        "command": "python3",
        "args": [],
        "env": {},
        "tools": ["read_file", "maybe_timeout"],
    }

    def _run_with_server_session(_server_name: str, operation):
        class _Content:
            def __init__(self, text: str):
                self.text = text

        class _Result:
            def __init__(self, text: str):
                self.content = [_Content(text)]

        class _Session:
            async def call_tool(self, tool_name: str, args: dict):
                if tool_name == "maybe_timeout" and args.get("mode") == "timeout":
                    raise TimeoutError("timeout")
                return _Result(json.dumps({"tool": tool_name, "args": args, "ok": True}))

        return asyncio.run(operation(_Session()))

    monkeypatch.setattr(tools, "_run_with_server_session", _run_with_server_session)

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        ok_future = pool.submit(tools.mcp_call_tool, "local", "read_file", {"path": "README.md"})
        fail_future = pool.submit(tools.mcp_call_tool, "local", "maybe_timeout", {"mode": "timeout"})
        ok_result = ok_future.result(timeout=5)
        fail_result = fail_future.result(timeout=5)

    assert ok_result.ok is True
    assert fail_result.ok is False
    assert fail_result.error_code == "mcp_timeout"
    assert fail_result.retryable is True
