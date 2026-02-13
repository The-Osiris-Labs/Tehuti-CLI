from __future__ import annotations

import asyncio

import httpx
import pytest

from tehuti_cli.core.a2a_client import A2AClient, A2ATask
from tehuti_cli.core.errors import ProtocolError


@pytest.mark.asyncio
async def test_a2a_get_agent_card_timeout_maps_to_protocol_error(monkeypatch) -> None:
    client = A2AClient("http://example.local")

    async def _boom(*_args, **_kwargs):
        raise httpx.TimeoutException("timeout")

    monkeypatch.setattr(client.http_client, "get", _boom)

    with pytest.raises(ProtocolError) as exc_info:
        await client.get_agent_card()
    assert exc_info.value.code == "a2a_timeout"
    assert exc_info.value.category.value == "protocol"
    await client.close()


@pytest.mark.asyncio
async def test_a2a_get_task_state_invalid_payload_maps_to_protocol_error(monkeypatch) -> None:
    client = A2AClient("http://example.local")

    class _Resp:
        def raise_for_status(self):
            return None

        def json(self):
            return {"status": {"state": "not_a_real_state"}}

    async def _ok(*_args, **_kwargs):
        return _Resp()

    monkeypatch.setattr(client.http_client, "get", _ok)

    with pytest.raises(ProtocolError) as exc_info:
        await client.get_task_state("t-1")
    assert exc_info.value.code == "a2a_invalid_payload"
    assert exc_info.value.category.value == "protocol"
    await client.close()


@pytest.mark.asyncio
async def test_a2a_http_401_maps_to_auth_failed(monkeypatch) -> None:
    client = A2AClient("http://example.local")

    async def _boom(*_args, **_kwargs):
        request = httpx.Request("GET", "http://example.local/.well-known/agent.json")
        response = httpx.Response(401, request=request)
        raise httpx.HTTPStatusError("unauthorized", request=request, response=response)

    monkeypatch.setattr(client.http_client, "get", _boom)

    with pytest.raises(ProtocolError) as exc_info:
        await client.get_agent_card()
    assert exc_info.value.code == "a2a_auth_failed"
    assert exc_info.value.details.get("status_code") == 401
    await client.close()


@pytest.mark.asyncio
async def test_a2a_http_429_maps_to_rate_limited(monkeypatch) -> None:
    client = A2AClient("http://example.local")

    async def _boom(*_args, **_kwargs):
        request = httpx.Request("POST", "http://example.local/tasks/send")
        response = httpx.Response(429, request=request)
        raise httpx.HTTPStatusError("rate limited", request=request, response=response)

    monkeypatch.setattr(client.http_client, "post", _boom)

    with pytest.raises(ProtocolError) as exc_info:
        await client.send_task(task=A2ATask())
    assert exc_info.value.code == "a2a_rate_limited"
    assert exc_info.value.details.get("status_code") == 429
    await client.close()


@pytest.mark.asyncio
async def test_a2a_get_agent_card_non_object_payload_maps_to_invalid_payload(monkeypatch) -> None:
    client = A2AClient("http://example.local")

    class _Resp:
        def raise_for_status(self):
            return None

        def json(self):
            return ["not", "object"]

    async def _ok(*_args, **_kwargs):
        return _Resp()

    monkeypatch.setattr(client.http_client, "get", _ok)

    with pytest.raises(ProtocolError) as exc_info:
        await client.get_agent_card()
    assert exc_info.value.code == "a2a_invalid_payload"
    await client.close()


@pytest.mark.asyncio
async def test_a2a_send_task_missing_result_or_status_maps_to_invalid_payload(monkeypatch) -> None:
    client = A2AClient("http://example.local")

    class _Resp:
        def raise_for_status(self):
            return None

        def json(self):
            return {"id": "task-1"}

    async def _ok(*_args, **_kwargs):
        return _Resp()

    monkeypatch.setattr(client.http_client, "post", _ok)

    with pytest.raises(ProtocolError) as exc_info:
        await client.send_task(task=A2ATask())
    assert exc_info.value.code == "a2a_invalid_payload"
    await client.close()


@pytest.mark.asyncio
async def test_a2a_get_task_state_missing_status_maps_to_invalid_payload(monkeypatch) -> None:
    client = A2AClient("http://example.local")

    class _Resp:
        def raise_for_status(self):
            return None

        def json(self):
            return {"id": "task-1"}

    async def _ok(*_args, **_kwargs):
        return _Resp()

    monkeypatch.setattr(client.http_client, "get", _ok)

    with pytest.raises(ProtocolError) as exc_info:
        await client.get_task_state("t-1")
    assert exc_info.value.code == "a2a_invalid_payload"
    await client.close()


@pytest.mark.asyncio
async def test_a2a_stream_non_object_event_maps_to_invalid_payload(monkeypatch) -> None:
    client = A2AClient("http://example.local")

    class _StreamResponse:
        def raise_for_status(self):
            return None

        async def aiter_lines(self):
            yield 'data: "bad-event"'

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

    def _stream(*_args, **_kwargs):
        return _StreamResponse()

    monkeypatch.setattr(client.http_client, "stream", _stream)

    with pytest.raises(ProtocolError) as exc_info:
        async for _event in client.stream_task_result("t-1"):
            pass
    assert exc_info.value.code == "a2a_invalid_payload"
    await client.close()


@pytest.mark.asyncio
async def test_a2a_cancel_task_404_maps_to_not_found(monkeypatch) -> None:
    client = A2AClient("http://example.local")

    async def _boom(*_args, **_kwargs):
        request = httpx.Request("POST", "http://example.local/tasks/t-1/cancel")
        response = httpx.Response(404, request=request)
        raise httpx.HTTPStatusError("not found", request=request, response=response)

    monkeypatch.setattr(client.http_client, "post", _boom)

    with pytest.raises(ProtocolError) as exc_info:
        await client.cancel_task("t-1")
    assert exc_info.value.code == "a2a_not_found"
    assert exc_info.value.details.get("status_code") == 404
    await client.close()


@pytest.mark.asyncio
async def test_a2a_cancel_task_204_returns_true(monkeypatch) -> None:
    client = A2AClient("http://example.local")

    class _Resp:
        status_code = 204

        def raise_for_status(self):
            return None

    async def _ok(*_args, **_kwargs):
        return _Resp()

    monkeypatch.setattr(client.http_client, "post", _ok)

    result = await client.cancel_task("t-1")
    assert result is True
    await client.close()


@pytest.mark.asyncio
async def test_a2a_send_task_500_maps_to_service_unavailable(monkeypatch) -> None:
    client = A2AClient("http://example.local")

    async def _boom(*_args, **_kwargs):
        request = httpx.Request("POST", "http://example.local/tasks/send")
        response = httpx.Response(500, request=request)
        raise httpx.HTTPStatusError("server error", request=request, response=response)

    monkeypatch.setattr(client.http_client, "post", _boom)

    with pytest.raises(ProtocolError) as exc_info:
        await client.send_task(task=A2ATask())
    assert exc_info.value.code == "a2a_service_unavailable"
    assert exc_info.value.details.get("status_code") == 500
    await client.close()
