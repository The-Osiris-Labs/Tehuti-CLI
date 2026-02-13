from __future__ import annotations

import importlib.util
from pathlib import Path
import sys


def _load_module():
    module_path = Path("scripts/check_sensitive_exposure.py")
    spec = importlib.util.spec_from_file_location("check_sensitive_exposure", module_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_forbidden_path_detection() -> None:
    mod = _load_module()
    assert mod._is_forbidden_path(".tehuti/sessions/abc/context.jsonl") is True
    assert mod._is_forbidden_path(".tehuti_test_sessions/run/log.txt") is True
    assert mod._is_forbidden_path(".venv/lib/python3.12/site-packages/pkg.py") is True
    assert mod._is_forbidden_path("__pycache__/module.cpython-312.pyc") is True
    assert mod._is_forbidden_path(".env") is True
    assert mod._is_forbidden_path("config/.env.local") is True
    assert mod._is_forbidden_path("docs/GETTING_STARTED.md") is False
    assert mod._is_forbidden_path(".env.example") is False


def test_secret_pattern_detection_skips_placeholders() -> None:
    mod = _load_module()
    placeholder = "OPENAI_API_KEY=your_api_key_here\n"
    assert mod._content_violations("README.md", placeholder) == []

    real_key = "OPENAI_API_KEY=" + "sk-" + "abcdefghijklmnopqrstuvwxyz123456" + "\n"
    violations = mod._content_violations("notes.txt", real_key)
    assert violations
    kinds = {item.kind for item in violations}
    assert "secret_assignment" in kinds or "secret_pattern" in kinds


def test_private_key_header_detection() -> None:
    mod = _load_module()
    data = "-----BEGIN " + "PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n"
    violations = mod._content_violations("id.key", data)
    assert any(item.kind == "secret_pattern" for item in violations)


def test_staged_paths_ignores_deleted_entries(monkeypatch) -> None:
    mod = _load_module()

    captured: list[list[str]] = []

    def fake_run_git(args: list[str]) -> str:
        captured.append(args)
        return "docs/README.md\0"

    monkeypatch.setattr(mod, "_run_git", fake_run_git)
    paths = mod._staged_paths()
    assert paths == ["docs/README.md"]
    assert captured[0] == ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"]
