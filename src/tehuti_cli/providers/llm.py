from __future__ import annotations

import json
import os
import time
from pathlib import Path
from dataclasses import dataclass, field
from typing import Any

from tehuti_cli.providers.openrouter import OpenRouterClient
from tehuti_cli.providers.openai import OpenAIClient
from tehuti_cli.providers.gemini import GeminiClient
from tehuti_cli.core.telemetry import get_telemetry
from tehuti_cli.storage.config import Config
from tehuti_cli.storage.paths import cache_dir
from tehuti_cli.utils.env import load_env_file


@dataclass
class TokenUsage:
    """Track estimated and provider-reported token usage."""

    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    estimated_cost: float = 0.0
    actual_prompt_tokens: int = 0
    actual_completion_tokens: int = 0
    actual_total_tokens: int = 0
    actual_cost: float = 0.0
    requests: int = 0
    actual_usage_reports: int = 0
    last_update: str = ""

    def add(self, prompt: int, completion: int, cost: float = 0.0) -> None:
        """Add estimated token usage from a request."""
        self.prompt_tokens += prompt
        self.completion_tokens += completion
        self.total_tokens = self.prompt_tokens + self.completion_tokens
        self.estimated_cost += cost
        self.requests += 1
        from datetime import datetime

        self.last_update = datetime.now().isoformat()

    def add_actual(self, prompt: int, completion: int, cost: float = 0.0) -> None:
        """Add provider-reported token usage."""
        self.actual_prompt_tokens += max(0, int(prompt))
        self.actual_completion_tokens += max(0, int(completion))
        self.actual_total_tokens = self.actual_prompt_tokens + self.actual_completion_tokens
        self.actual_cost += max(0.0, float(cost))
        self.actual_usage_reports += 1
        from datetime import datetime

        self.last_update = datetime.now().isoformat()

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {
            "prompt_tokens": self.prompt_tokens,
            "completion_tokens": self.completion_tokens,
            "total_tokens": self.total_tokens,
            "estimated_cost": round(self.estimated_cost, 6),
            "actual_prompt_tokens": self.actual_prompt_tokens,
            "actual_completion_tokens": self.actual_completion_tokens,
            "actual_total_tokens": self.actual_total_tokens,
            "actual_cost": round(self.actual_cost, 6),
            "requests": self.requests,
            "actual_usage_reports": self.actual_usage_reports,
            "last_update": self.last_update,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "TokenUsage":
        """Create from dictionary."""
        return cls(
            prompt_tokens=data.get("prompt_tokens", 0),
            completion_tokens=data.get("completion_tokens", 0),
            total_tokens=data.get("total_tokens", 0),
            estimated_cost=data.get("estimated_cost", 0.0),
            actual_prompt_tokens=data.get("actual_prompt_tokens", 0),
            actual_completion_tokens=data.get("actual_completion_tokens", 0),
            actual_total_tokens=data.get("actual_total_tokens", 0),
            actual_cost=data.get("actual_cost", 0.0),
            requests=data.get("requests", 0),
            actual_usage_reports=data.get("actual_usage_reports", 0),
            last_update=data.get("last_update", ""),
        )


# Token estimation costs per 1M tokens (approximate)
TOKEN_COSTS = {
    "openrouter": {
        # Default estimates - actual costs vary by model
        "gpt-4": {"prompt": 30.0, "completion": 60.0},
        "gpt-4-turbo": {"prompt": 10.0, "completion": 30.0},
        "gpt-3.5-turbo": {"prompt": 0.5, "completion": 1.5},
        "claude-3-opus": {"prompt": 15.0, "completion": 75.0},
        "claude-3-sonnet": {"prompt": 3.0, "completion": 15.0},
        "claude-3-haiku": {"prompt": 0.25, "completion": 1.25},
        "default": {"prompt": 1.0, "completion": 3.0},
    },
    "openai": {
        "gpt-4": {"prompt": 30.0, "completion": 60.0},
        "gpt-4-turbo": {"prompt": 10.0, "completion": 30.0},
        "gpt-3.5-turbo": {"prompt": 0.5, "completion": 1.5},
        "default": {"prompt": 1.0, "completion": 3.0},
    },
    "gemini": {
        "gemini-pro": {"prompt": 0.125, "completion": 0.5},
        "gemini-ultra": {"prompt": 7.0, "completion": 21.0},
        "default": {"prompt": 0.5, "completion": 1.0},
    },
}


@dataclass
class TehutiLLM:
    config: Config
    last_notice: str | None = None
    token_usage: TokenUsage = field(default_factory=TokenUsage)

    def _humanize_provider_error(self, exc: Exception) -> str:
        text = str(exc or "").strip()
        lower = text.lower()
        if "usd spend limit exceeded" in lower or ("spend limit" in lower and "api key" in lower):
            return (
                "Provider key spend limit exceeded. Switch model/provider with `/m` or `/provider`, "
                "or increase key spend limit."
            )
        if '"code":402' in lower or "payment required" in lower:
            return "Provider rejected the request due to account/billing limits."
        if "rate limit" in lower or "429" in lower:
            return "Provider rate limit hit. Retry shortly or switch provider."
        return text or "Model request failed."

    def _estimate_tokens(self, text: str) -> int:
        """Estimate token count for text (rough approximation)."""
        # Average of 4 characters per token for English
        return max(1, len(text) // 4)

    def _record_usage(
        self,
        *,
        provider: str,
        model: str,
        prompt_tokens_estimate: int,
        completion_tokens_estimate: int,
        provider_usage: dict[str, Any] | None = None,
    ) -> None:
        estimate_cost = self._estimate_cost(provider, model, prompt_tokens_estimate, completion_tokens_estimate)
        self.token_usage.add(prompt_tokens_estimate, completion_tokens_estimate, estimate_cost)

        if not provider_usage:
            return

        prompt_actual = int(provider_usage.get("prompt_tokens", 0) or 0)
        completion_actual = int(provider_usage.get("completion_tokens", 0) or 0)
        if prompt_actual <= 0 and completion_actual <= 0:
            return
        actual_cost = self._estimate_cost(provider, model, prompt_actual, completion_actual)
        self.token_usage.add_actual(prompt_actual, completion_actual, actual_cost)

    def _estimate_cost(self, provider: str, model: str, prompt_tokens: int, completion_tokens: int) -> float:
        """Estimate cost for a request based on model."""
        model_lower = model.lower() if model else ""
        costs = TOKEN_COSTS.get(provider, TOKEN_COSTS.get("openrouter", TOKEN_COSTS["openrouter"]["default"]))

        # Try to match model-specific cost
        prompt_cost = costs.get("default", {}).get("prompt", 1.0)
        completion_cost = costs.get("default", {}).get("completion", 3.0)

        for model_key, model_costs in costs.items():
            if model_key != "default" and model_key in model_lower:
                prompt_cost = model_costs.get("prompt", prompt_cost)
                completion_cost = model_costs.get("completion", completion_cost)
                break

        # Calculate cost per million tokens
        prompt_cost_per_m = prompt_cost
        completion_cost_per_m = completion_cost

        # Calculate actual cost
        prompt_cost = (prompt_tokens / 1_000_000) * prompt_cost_per_m
        completion_cost = (completion_tokens / 1_000_000) * completion_cost_per_m

        return prompt_cost + completion_cost

    def _openrouter_client(self) -> OpenRouterClient:
        api_key = self._resolve_api_key(self.config.providers.openrouter.api_key_env)
        if not api_key:
            raise RuntimeError(
                f"Missing API key. Set {self.config.providers.openrouter.api_key_env} in your environment or keys file."
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
                f"Missing API key. Set {self.config.providers.openai.api_key_env} in your environment or keys file."
            )
        return OpenAIClient(
            base_url=self.config.providers.openai.base_url,
            api_key=api_key,
        )

    def _gemini_client(self) -> GeminiClient:
        api_key = self._resolve_api_key(self.config.providers.gemini.api_key_env)
        if not api_key:
            raise RuntimeError(
                f"Missing API key. Set {self.config.providers.gemini.api_key_env} in your environment or keys file."
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
        cache_path = cache_dir() / f"models_{provider}.json"
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
        cache_path = cache_dir() / "providers.json"
        if not refresh:
            cached = self._load_cache(cache_path, max_age_seconds=6 * 3600)
            if cached is not None:
                return cached
        client = self._openrouter_client()
        providers = client.get_providers()
        self._save_cache(cache_path, providers)
        return providers

    def chat(self, prompt: str, stream: bool = False) -> str:
        if not self.config.provider.model:
            raise RuntimeError("No model set. Use /models to select one.")
        return self.chat_messages([{"role": "user", "content": prompt}], stream=stream)

    def chat_messages(self, messages: list[dict[str, Any]], stream: bool = False) -> str:
        if not self.config.provider.model:
            raise RuntimeError("No model set. Use /models to select one.")
        provider = self.config.provider.type
        model = self.config.provider.model
        started = time.perf_counter()

        def _record_provider(success: bool, error_code: str | None = None) -> None:
            get_telemetry().record_provider_result(
                provider=provider,
                success=success,
                latency_ms=int((time.perf_counter() - started) * 1000),
                error_code=error_code,
            )

        # Estimate prompt tokens before request
        prompt_text = "\n".join(m.get("content", "") for m in messages)
        prompt_tokens = self._estimate_tokens(prompt_text)
        try:
            if provider == "openrouter":
                client = self._openrouter_client()
                try:
                    self.last_notice = None
                    response = client.chat(
                        model=model,
                        messages=messages,
                        provider_order=self.config.openrouter.provider_order,
                        stream=stream,
                    )
                    # Estimate completion tokens from response
                    completion_tokens = self._estimate_tokens(response)
                    self._record_usage(
                        provider=provider,
                        model=model,
                        prompt_tokens_estimate=prompt_tokens,
                        completion_tokens_estimate=completion_tokens,
                        provider_usage=client.last_usage,
                    )
                    _record_provider(True)
                    return response
                except Exception as exc:
                    text = str(exc)
                    if "free" in text.lower() and model.endswith(":free"):
                        original = model
                        fallback = original.replace(":free", "")
                        response = client.chat(
                            model=fallback,
                            messages=messages,
                            provider_order=self.config.openrouter.provider_order,
                            stream=stream,
                        )
                        self.last_notice = (
                            f"Model {original} unavailable for this request. "
                            f"Used temporary fallback {fallback}."
                        )
                        completion_tokens = self._estimate_tokens(response)
                        self._record_usage(
                            provider=provider,
                            model=fallback,
                            prompt_tokens_estimate=prompt_tokens,
                            completion_tokens_estimate=completion_tokens,
                            provider_usage=client.last_usage,
                        )
                        _record_provider(True)
                        return response
                    raise
            if provider == "openai":
                client = self._openai_client()
                response = client.chat(model, messages, stream=stream)
                completion_tokens = self._estimate_tokens(response)
                self._record_usage(
                    provider=provider,
                    model=model,
                    prompt_tokens_estimate=prompt_tokens,
                    completion_tokens_estimate=completion_tokens,
                    provider_usage=client.last_usage,
                )
                _record_provider(True)
                return response
            if provider == "gemini":
                client = self._gemini_client()
                response = client.chat(model, messages, stream=stream)
                completion_tokens = self._estimate_tokens(response)
                self._record_usage(
                    provider=provider,
                    model=model,
                    prompt_tokens_estimate=prompt_tokens,
                    completion_tokens_estimate=completion_tokens,
                    provider_usage=client.last_usage,
                )
                _record_provider(True)
                return response
            _record_provider(False, "unsupported_provider")
            return ""
        except Exception as exc:
            _record_provider(False, "llm_request_failed")
            raise RuntimeError(self._humanize_provider_error(exc)) from exc

    def chat_stream(self, messages: list[dict[str, Any]]) -> tuple[str, Any]:
        """Stream chat with progress callback.

        Returns:
            Tuple of (content, iterator) for custom handling
        """
        if not self.config.provider.model:
            raise RuntimeError("No model set. Use /models to select one.")

        provider = self.config.provider.type
        if provider == "openrouter":
            client = self._openrouter_client()
            content = client.chat(
                model=self.config.provider.model,
                messages=messages,
                provider_order=self.config.openrouter.provider_order,
                stream=True,
            )
            return content, None
        elif provider == "openai":
            client = self._openai_client()
            content = client.chat(self.config.provider.model, messages, stream=True)
            return content, None
        elif provider == "gemini":
            client = self._gemini_client()
            content = client.chat(self.config.provider.model, messages, stream=True)
            return content, None
        return "", None

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
