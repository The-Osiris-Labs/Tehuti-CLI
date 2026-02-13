from __future__ import annotations

from pathlib import Path

from tehuti_cli.storage.config import load_config, save_config, default_config


def test_access_policy_full_enforces_unrestricted_flags(tmp_path: Path) -> None:
    cfg = default_config()
    cfg.access_policy = "full"
    cfg.default_yolo = False
    cfg.allow_shell = False
    cfg.allow_write = False
    cfg.allow_external = False
    cfg.allowed_paths = [str(tmp_path)]
    cfg.allow_tools = ["read"]
    cfg.deny_tools = ["shell"]

    config_path = tmp_path / "config.toml"
    save_config(cfg, config_path)
    loaded = load_config(config_path)

    assert loaded.access_policy == "full"
    assert loaded.default_yolo is True
    assert loaded.allow_shell is True
    assert loaded.allow_write is True
    assert loaded.allow_external is True
    assert loaded.allowed_paths == []
    assert loaded.allow_tools == []
    assert loaded.deny_tools == []


def test_agent_parser_mode_round_trip_and_normalization(tmp_path: Path) -> None:
    cfg = default_config()
    cfg.agent_parser_mode = "strict"
    config_path = tmp_path / "config.toml"
    save_config(cfg, config_path)
    loaded = load_config(config_path)
    assert loaded.agent_parser_mode == "strict"

    text = config_path.read_text(encoding="utf-8")
    text = text.replace('agent_parser_mode = "strict"', 'agent_parser_mode = "invalid"')
    config_path.write_text(text, encoding="utf-8")
    reloaded = load_config(config_path)
    assert reloaded.agent_parser_mode == "repair"


def test_retry_and_stuck_backoff_settings_round_trip_and_clamp(tmp_path: Path) -> None:
    cfg = default_config()
    cfg.retry_backoff_base_seconds = 0.5
    cfg.retry_backoff_cap_seconds = 3.0
    cfg.loop_stuck_backoff_base_seconds = 0.25
    cfg.loop_stuck_backoff_cap_seconds = 2.0
    config_path = tmp_path / "config.toml"
    save_config(cfg, config_path)

    loaded = load_config(config_path)
    assert loaded.retry_backoff_base_seconds == 0.5
    assert loaded.retry_backoff_cap_seconds == 3.0
    assert loaded.loop_stuck_backoff_base_seconds == 0.25
    assert loaded.loop_stuck_backoff_cap_seconds == 2.0

    text = config_path.read_text(encoding="utf-8")
    text = text.replace("retry_backoff_base_seconds = 0.5", "retry_backoff_base_seconds = 0.0")
    text = text.replace("retry_backoff_cap_seconds = 3.0", "retry_backoff_cap_seconds = 0.0")
    text = text.replace("loop_stuck_backoff_base_seconds = 0.25", "loop_stuck_backoff_base_seconds = 0.0")
    text = text.replace("loop_stuck_backoff_cap_seconds = 2.0", "loop_stuck_backoff_cap_seconds = 0.0")
    config_path.write_text(text, encoding="utf-8")

    clamped = load_config(config_path)
    assert clamped.retry_backoff_base_seconds == 0.1
    assert clamped.retry_backoff_cap_seconds == 0.1
    assert clamped.loop_stuck_backoff_base_seconds == 0.1
    assert clamped.loop_stuck_backoff_cap_seconds == 0.1
