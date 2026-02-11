from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Iterator

import httpx


@dataclass
class OpenAIClient:
    base_url: str
    api_key: str

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "User-Agent": "Project-Tehuti/0.1.0",
        }

    def list_models(self) -> list[dict[str, Any]]:
        url = f"{self.base_url}/models"
        with httpx.Client(timeout=30.0) as client:
            resp = client.get(url, headers=self._headers())
            resp.raise_for_status()
            data = resp.json()
        return list(data.get("data", []))

    def chat(
        self, model: str, messages: list[dict[str, Any]], stream: bool = False
    ) -> str:
        url = f"{self.base_url}/chat/completions"
        payload = {"model": model, "messages": messages, "stream": stream}

        if stream:
            return self._chat_stream(url, payload)

        with httpx.Client(timeout=60.0) as client:
            resp = client.post(url, headers=self._headers(), json=payload)
            resp.raise_for_status()
            data = resp.json()
        choices = data.get("choices", [])
        if not choices:
            return ""
        message = choices[0].get("message", {})
        return str(message.get("content", ""))

    def _chat_stream(self, url: str, payload: dict[str, Any]) -> str:
        """Stream chat response for real-time token display."""
        content = ""
        with httpx.Client(timeout=120.0) as client:
            with client.stream(
                "POST", url, headers=self._headers(), json=payload
            ) as resp:
                resp.raise_for_status()
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
