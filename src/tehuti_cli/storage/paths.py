from __future__ import annotations

import os
import tempfile
from pathlib import Path

_HOME_CACHE: Path | None = None


def _uid_suffix() -> str:
    try:
        return str(os.getuid())
    except Exception:
        return "user"


def _is_writable_dir(path: Path) -> bool:
    try:
        path.mkdir(parents=True, exist_ok=True)
        probe = path / ".write_probe"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink(missing_ok=True)
        return True
    except Exception:
        return False


def get_tehuti_home() -> Path:
    global _HOME_CACHE
    if _HOME_CACHE is not None:
        return _HOME_CACHE

    candidates: list[Path] = []
    env_home = os.getenv("TEHUTI_HOME", "").strip()
    if env_home:
        candidates.append(Path(env_home).expanduser())
    candidates.append(Path.home() / ".tehuti")
    candidates.append(Path.cwd() / ".tehuti")
    candidates.append(Path(tempfile.gettempdir()) / f"tehuti-{_uid_suffix()}")

    for candidate in candidates:
        if _is_writable_dir(candidate):
            _HOME_CACHE = candidate.resolve()
            return _HOME_CACHE

    # Last resort without further probing.
    _HOME_CACHE = (Path.cwd() / ".tehuti").resolve()
    _HOME_CACHE.mkdir(parents=True, exist_ok=True)
    return _HOME_CACHE


def config_file() -> Path:
    return get_tehuti_home() / "config.toml"


def metadata_file() -> Path:
    return get_tehuti_home() / "metadata.json"


def sessions_dir() -> Path:
    return get_tehuti_home() / "sessions"


def workdirs_dir() -> Path:
    return get_tehuti_home() / "workdirs"


def cache_dir() -> Path:
    return get_tehuti_home() / "cache"
