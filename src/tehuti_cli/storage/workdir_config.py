from __future__ import annotations

import hashlib
from dataclasses import asdict
from pathlib import Path
from typing import Any

import tomlkit

from tehuti_cli.storage.config import Config


WORKDIR_DIR = Path.home() / ".tehuti" / "workdirs"


def _workdir_key(work_dir: Path) -> str:
    return hashlib.sha256(str(work_dir.resolve()).encode("utf-8")).hexdigest()[:16]


def get_workdir_config_path(work_dir: Path) -> Path:
    return WORKDIR_DIR / f"{_workdir_key(work_dir)}.toml"


def get_workdir_config(work_dir: Path) -> dict[str, Any] | None:
    path = get_workdir_config_path(work_dir)
    if not path.exists():
        return None
    return tomlkit.parse(path.read_text(encoding="utf-8"))


def save_workdir_config(work_dir: Path, data: dict[str, Any]) -> None:
    path = get_workdir_config_path(work_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(tomlkit.dumps(data), encoding="utf-8")


def clear_workdir_config(work_dir: Path) -> None:
    path = get_workdir_config_path(work_dir)
    if path.exists():
        path.unlink()


def apply_workdir_overrides(config: Config, work_dir: Path) -> Config:
    data = get_workdir_config(work_dir)
    if not data:
        return config
    # Only allow override of a safe subset
    provider = data.get("provider", {})
    if provider.get("type"):
        config.provider.type = provider["type"]
    if provider.get("model"):
        config.provider.model = provider["model"]
    if data.get("default_yolo") is not None:
        config.default_yolo = bool(data.get("default_yolo"))
    return config


def snapshot_config(config: Config) -> dict[str, Any]:
    return {
        "provider": {
            "type": config.provider.type,
            "model": config.provider.model,
        },
        "default_yolo": config.default_yolo,
    }
