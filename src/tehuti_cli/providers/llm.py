from __future__ import annotations

import json
import os
import time
from pathlib import Path
from dataclasses import dataclass
from typing import Any

from tehuti_cli.providers.openrouter import OpenRouterClient
from tehuti_cli.providers.openai import OpenAIClient
from tehuti_cli.providers.gemini import GeminiClient
from tehuti_cli.storage.config import Config, save_config
from tehuti_cli.utils.env import load_env_file


@dataclass
class TehutiLLM:
    config: Config
    last_notice: str | None = None

    def _openrouter_client(self) -> OpenRouterClient:
        api_key = self._resolve_api_key(self.config.providers.openrouter.api_key_env)
        if not api_key:
            raise RuntimeError(
                f"Missing API key. Set {self.config.providers.openrouter.api_key_env} "
                "in your environment or keys file."
            )
        return OpenRouterClient(
            base_url=self.config.providers.openrouter.base_url,
            api_key=api_key,
            app_name="Project Tehuti",
        )

    def _openai_client(self) -> OpenAIClient:
        api_key = self._resolve_api_key(self.config.providers.openai.api_key_env)
        if not api_key:
            raise RuntimeError(
                f"Missing API key. Set {self.config.providers.openai.api_key_env} "
                "in your environment or keys file."
            )
        return OpenAIClient(
            base_url=self.config.providers.openai.base_url,
            api_key=api_key,
        )

    def _gemini_client(self) -> GeminiClient:
        api_key = self._resolve_api_key(self.config.providers.gemini.api_key_env)
        if not api_key:
            raise RuntimeError(
                f"Missing API key. Set {self.config.providers.gemini.api_key_env} "
                "in your environment or keys file."
            )
        return GeminiClient(
            base_url=self.config.providers.gemini.base_url,
            api_key=api_key,
        )

    def _resolve_api_key(self, env_name: str) -> str:
        env_value = os.getenv(env_name, "").strip()
        if env_value:
            return env_value
        keys = load_env_file(self.config.keys_file)
        if env_name in keys and keys[env_name].strip():
            return keys[env_name].strip()
        # Fallbacks for local project keys file
        fallback_paths = [
            Path.cwd() / "keys.env",
            Path.home() / "project-tehuti" / "keys.env",
            Path("/root/project-tehuti/keys.env"),
        ]
        for path in fallback_paths:
            keys = load_env_file(path)
            value = keys.get(env_name, "").strip()
            if value:
                return value
        return ""

    def list_models(self, refresh: bool = False) -> list[dict[str, Any]]:
        provider = self.config.provider.type
        cache_path = Path.home() / ".tehuti" / "cache" / f"models_{provider}.json"
        if not refresh:
            cached = self._load_cache(cache_path, max_age_seconds=6 * 3600)
            if cached is not None:
                return cached
        if provider == "openrouter":
            client = self._openrouter_client()
            models = client.get_models()
        elif provider == "openai":
            client = self._openai_client()
            models = client.list_models()
        elif provider == "gemini":
            client = self._gemini_client()
            models = client.list_models()
        else:
            models = []
        self._save_cache(cache_path, models)
        return models

    def list_providers(self, refresh: bool = False) -> list[dict[str, Any]]:
        cache_path = Path.home() / ".tehuti" / "cache" / "providers.json"
        if not refresh:
            cached = self._load_cache(cache_path, max_age_seconds=6 * 3600)
            if cached is not None:
                return cached
        client = self._openrouter_client()
        providers = client.get_providers()
        self._save_cache(cache_path, providers)
        return providers

    def chat(self, prompt: str) -> str:
        if not self.config.provider.model:
            raise RuntimeError("No model set. Use /models to select one.")
        return self.chat_messages([{"role": "user", "content": prompt}])

    def chat_messages(self, messages: list[dict[str, Any]]) -> str:
        if not self.config.provider.model:
            raise RuntimeError("No model set. Use /models to select one.")
        provider = self.config.provider.type
        if provider == "openrouter":
            client = self._openrouter_client()
            try:
                self.last_notice = None
                return client.chat(
                    model=self.config.provider.model,
                    messages=messages,
                    provider_order=self.config.openrouter.provider_order,
                )
            except Exception as exc:
                text = str(exc)
                if (
                    "free" in text.lower()
                    and self.config.provider.model.endswith(":free")
                ):
                    original = self.config.provider.model
                    fallback = original.replace(":free", "")
                    result = client.chat(
                        model=fallback,
                        messages=messages,
                        provider_order=self.config.openrouter.provider_order,
                    )
                    self.config.provider.model = fallback
                    self.config.providers.openrouter.model = fallback
                    save_config(self.config)
                    self.last_notice = (
                        f"Model {original} unavailable. "
                        f"Switched to {fallback}."
                    )
                    return result
                raise
        if provider == "openai":
            client = self._openai_client()
            return client.chat(self.config.provider.model, messages)
        if provider == "gemini":
            client = self._gemini_client()
            return client.chat(self.config.provider.model, messages)
        return ""

    def _load_cache(self, path: Path, max_age_seconds: int) -> list[dict[str, Any]] | None:
        try:
            if not path.exists():
                return None
            data = json.loads(path.read_text(encoding="utf-8"))
            ts = data.get("_ts")
            if not ts or (time.time() - float(ts) > max_age_seconds):
                return None
            items = data.get("items")
            if isinstance(items, list):
                return items
        except Exception:
            return None
        return None

    def _save_cache(self, path: Path, items: list[dict[str, Any]]) -> None:
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            payload = {"_ts": time.time(), "items": items}
            path.write_text(json.dumps(payload), encoding="utf-8")
        except Exception:
            pass
