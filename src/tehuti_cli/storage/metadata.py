from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path


METADATA_FILE = Path.home() / ".tehuti" / "metadata.json"


@dataclass
class WorkDirMeta:
    work_dir: str
    last_session_id: str | None


@dataclass
class Metadata:
    work_dirs: dict[str, WorkDirMeta]


def load_metadata() -> Metadata:
    if not METADATA_FILE.exists():
        return Metadata(work_dirs={})
    data = json.loads(METADATA_FILE.read_text(encoding="utf-8"))
    work_dirs: dict[str, WorkDirMeta] = {}
    for key, value in (data.get("work_dirs") or {}).items():
        work_dirs[key] = WorkDirMeta(
            work_dir=key,
            last_session_id=value.get("last_session_id"),
        )
    return Metadata(work_dirs=work_dirs)


def save_metadata(metadata: Metadata) -> None:
    METADATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    data = {
        "work_dirs": {
            key: {"last_session_id": meta.last_session_id}
            for key, meta in metadata.work_dirs.items()
        }
    }
    METADATA_FILE.write_text(json.dumps(data), encoding="utf-8")
