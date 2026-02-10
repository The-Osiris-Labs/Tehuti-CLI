from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx


@dataclass
class GeminiClient:
    base_url: str
    api_key: str

    def list_models(self) -> list[dict[str, Any]]:
        url = f"{self.base_url}/models?key={self.api_key}"
        with httpx.Client(timeout=30.0) as client:
            resp = client.get(url)
            resp.raise_for_status()
            data = resp.json()
        return list(data.get("models", []))

    def chat(self, model: str, messages: list[dict[str, Any]]) -> str:
        url = f"{self.base_url}/models/{model}:generateContent?key={self.api_key}"
        contents = []
        for msg in messages:
            role = msg.get("role", "user")
            if role == "assistant":
                role = "model"
            if role == "system":
                role = "user"
            contents.append({"role": role, "parts": [{"text": msg.get("content", "")}]})
        payload = {"contents": contents}
        with httpx.Client(timeout=60.0) as client:
            resp = client.post(url, json=payload)
            resp.raise_for_status()
            data = resp.json()
        candidates = data.get("candidates", [])
        if not candidates:
            return ""
        parts = candidates[0].get("content", {}).get("parts", [])
        if not parts:
            return ""
        return str(parts[0].get("text", ""))
