from __future__ import annotations

from dataclasses import dataclass
from typing import Any

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

    def chat(self, model: str, messages: list[dict[str, Any]]) -> str:
        url = f"{self.base_url}/chat/completions"
        payload = {"model": model, "messages": messages}
        with httpx.Client(timeout=60.0) as client:
            resp = client.post(url, headers=self._headers(), json=payload)
            resp.raise_for_status()
            data = resp.json()
        choices = data.get("choices", [])
        if not choices:
            return ""
        message = choices[0].get("message", {})
        return str(message.get("content", ""))
