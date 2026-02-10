from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from tehuti_cli.storage.metadata import WorkDirMeta, load_metadata, save_metadata


SESSIONS_DIR = Path.home() / ".tehuti" / "sessions"


@dataclass
class Session:
    id: str
    work_dir: Path
    context_file: Path
    wire_file: Path

    @property
    def dir(self) -> Path:
        path = SESSIONS_DIR / self.id
        path.mkdir(parents=True, exist_ok=True)
        return path

    def append_context(self, role: str, content: str) -> None:
        payload = {"role": role, "content": content}
        self.context_file.parent.mkdir(parents=True, exist_ok=True)
        with self.context_file.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(payload) + "\n")

    def iter_context(self) -> Iterable[dict[str, str]]:
        if not self.context_file.exists():
            return []
        with self.context_file.open("r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    yield json.loads(line)
                except json.JSONDecodeError:
                    continue


def _work_dir_meta(work_dir: Path) -> WorkDirMeta:
    metadata = load_metadata()
    key = str(work_dir)
    meta = metadata.work_dirs.get(key)
    if meta is None:
        meta = WorkDirMeta(work_dir=key, last_session_id=None)
        metadata.work_dirs[key] = meta
        save_metadata(metadata)
    return meta


def create_session(work_dir: Path, session_id: str | None = None) -> Session:
    session_id = session_id or str(uuid.uuid4())
    meta = _work_dir_meta(work_dir)
    meta.last_session_id = session_id
    metadata = load_metadata()
    metadata.work_dirs[str(work_dir)] = meta
    save_metadata(metadata)
    session_dir = SESSIONS_DIR / session_id
    session_dir.mkdir(parents=True, exist_ok=True)
    context_file = session_dir / "context.jsonl"
    wire_file = session_dir / "wire.jsonl"
    if not context_file.exists():
        context_file.touch()
    if not wire_file.exists():
        wire_file.touch()
    return Session(id=session_id, work_dir=work_dir, context_file=context_file, wire_file=wire_file)


def load_last_session(work_dir: Path) -> Session | None:
    meta = _work_dir_meta(work_dir)
    if not meta.last_session_id:
        return None
    session_id = meta.last_session_id
    session_dir = SESSIONS_DIR / session_id
    context_file = session_dir / "context.jsonl"
    wire_file = session_dir / "wire.jsonl"
    if not session_dir.exists():
        return None
    return Session(id=session_id, work_dir=work_dir, context_file=context_file, wire_file=wire_file)
