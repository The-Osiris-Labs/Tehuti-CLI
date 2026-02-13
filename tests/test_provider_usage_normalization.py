from __future__ import annotations

from tehuti_cli.providers.llm import TehutiLLM
from tehuti_cli.storage.config import default_config


def test_provider_usage_normalizes_actuals_from_openai(monkeypatch) -> None:
    cfg = default_config()
    cfg.provider.type = "openai"
    cfg.provider.model = "gpt-4o-mini"
    llm = TehutiLLM(cfg)

    class _Client:
        last_usage = {"prompt_tokens": 11, "completion_tokens": 7, "total_tokens": 18}

        def chat(self, model, messages, stream=False):
            return "ok"

    monkeypatch.setattr(llm, "_openai_client", lambda: _Client())

    result = llm.chat_messages([{"role": "user", "content": "hello"}])
    usage = llm.token_usage.to_dict()

    assert result == "ok"
    assert usage["actual_prompt_tokens"] == 11
    assert usage["actual_completion_tokens"] == 7
    assert usage["actual_total_tokens"] == 18
    assert usage["actual_usage_reports"] == 1


def test_provider_usage_falls_back_to_estimates_when_no_actuals(monkeypatch) -> None:
    cfg = default_config()
    cfg.provider.type = "openai"
    cfg.provider.model = "gpt-4o-mini"
    llm = TehutiLLM(cfg)

    class _Client:
        last_usage = None

        def chat(self, model, messages, stream=False):
            return "fallback"

    monkeypatch.setattr(llm, "_openai_client", lambda: _Client())

    llm.chat_messages([{"role": "user", "content": "hello world"}])
    usage = llm.token_usage.to_dict()

    assert usage["requests"] == 1
    assert usage["total_tokens"] > 0
    assert usage["actual_total_tokens"] == 0
    assert usage["actual_usage_reports"] == 0


def test_provider_errors_are_humanized_for_spend_limit(monkeypatch) -> None:
    cfg = default_config()
    cfg.provider.type = "openai"
    cfg.provider.model = "gpt-4o-mini"
    llm = TehutiLLM(cfg)

    class _Client:
        last_usage = None

        def chat(self, model, messages, stream=False):
            raise RuntimeError('{"error":"API key USD spend limit exceeded."}')

    monkeypatch.setattr(llm, "_openai_client", lambda: _Client())

    try:
        llm.chat_messages([{"role": "user", "content": "hello"}])
        assert False, "expected RuntimeError"
    except RuntimeError as exc:
        assert "spend limit" in str(exc).lower()
