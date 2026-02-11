from __future__ import annotations

from dataclasses import dataclass
import json
import os
from typing import Any

import httpx


@dataclass
class OpenRouterClient:
    base_url: str
    api_key: str
    app_name: str | None = None

    def _base(self) -> str:
        base = (self.base_url or "").rstrip("/")
        if base.endswith("/api/v1") or base.endswith("/v1"):
            return base
        return base + "/api/v1"

    def _candidate_bases(self) -> list[str]:
        base = (self.base_url or "").rstrip("/")
        candidates: list[str] = []
        if base.endswith("/api/v1") or base.endswith("/v1"):
            candidates.append(base)
        else:
            candidates.append(base + "/api/v1")
            candidates.append(base + "/v1")
            candidates.append(base)
        seen: set[str] = set()
        ordered: list[str] = []
        for item in candidates:
            if not item or item in seen:
                continue
            seen.add(item)
            ordered.append(item)
        return ordered

    def _headers(self) -> dict[str, str]:
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "User-Agent": "Project-Tehuti/0.1.0",
        }
        if self.app_name:
            headers["X-Title"] = self.app_name
        if referer := os.getenv("TEHUTI_HTTP_REFERER", "").strip():
            headers["HTTP-Referer"] = referer
        return headers

    def get_models(self) -> list[dict[str, Any]]:
        last_error: Exception | None = None
        for base in self._candidate_bases():
            url = f"{base}/models"
            with httpx.Client(timeout=30.0) as client:
                resp = client.get(url, headers=self._headers())
                if resp.status_code == 404:
                    last_error = RuntimeError(resp.text)
                    continue
                resp.raise_for_status()
                data = resp.json()
                return list(data.get("data", []))
        if last_error:
            raise last_error
        return []

    def get_providers(self) -> list[dict[str, Any]]:
        last_error: Exception | None = None
        for base in self._candidate_bases():
            url = f"{base}/providers"
            with httpx.Client(timeout=30.0) as client:
                resp = client.get(url, headers=self._headers())
                if resp.status_code == 404:
                    last_error = RuntimeError(resp.text)
                    continue
                resp.raise_for_status()
                data = resp.json()
                return list(data.get("data", []))
        if last_error:
            raise last_error
        return []

    def chat(
        self,
        model: str,
        messages: list[dict[str, Any]],
        provider_order: list[str] | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        stream: bool = False,
    ) -> str:
        payload: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "stream": stream,
        }
        if provider_order:
            payload["providers"] = {"order": provider_order}
        if temperature is not None:
            payload["temperature"] = temperature
        if max_tokens is not None:
            payload["max_tokens"] = max_tokens

        if stream:
            return self._chat_stream(model, messages, provider_order)

        last_error: Exception | None = None
        data: dict[str, Any] = {}
        for base in self._candidate_bases():
            url = f"{base}/chat/completions"
            with httpx.Client(timeout=60.0) as client:
                resp = client.post(url, headers=self._headers(), json=payload)
                if resp.status_code == 404:
                    last_error = RuntimeError(resp.text)
                    continue
                if resp.status_code >= 400:
                    raise RuntimeError(resp.text)
                data = resp.json()
                break
        else:
            if last_error:
                raise last_error
            return ""

        choices = data.get("choices", [])
        if not choices:
            return ""
        message = choices[0].get("message", {})
        return str(message.get("content", ""))

    def _chat_stream(
        self,
        model: str,
        messages: list[dict[str, Any]],
        provider_order: list[str] | None = None,
    ) -> str:
        """Stream chat response for real-time token display."""
        payload: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "stream": True,
        }
        if provider_order:
            payload["providers"] = {"order": provider_order}

        last_error: Exception | None = None
        for base in self._candidate_bases():
            url = f"{base}/chat/completions"
            try:
                with httpx.Client(timeout=120.0) as client:
                    with client.stream(
                        "POST", url, headers=self._headers(), json=payload
                    ) as resp:
                        if resp.status_code >= 400:
                            raise RuntimeError(resp.text)
                        content = ""
                        for line in resp.iter_lines():
                            if line.startswith("data: "):
                                data_str = line[6:]
                                if data_str == "[DONE]":
                                    break
                                try:
                                    data = json.loads(data_str)
                                    delta = (
                                        data.get("choices", [{}])[0]
                                        .get("delta", {})
                                        .get("content", "")
                                    )
                                    if delta:
                                        content += delta
                                except json.JSONDecodeError:
                                    pass
                        return content
            except Exception as exc:
                last_error = exc
                continue

        if last_error:
            raise last_error
        return ""
