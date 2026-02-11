from __future__ import annotations

import asyncio
import json
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any

from tehuti_cli.storage.config import Config


class DelegateState(Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class DelegateTask:
    id: str
    name: str
    prompt: str
    state: DelegateState = DelegateState.PENDING
    result: str = ""
    error: str = ""
    parent_id: str | None = None
    children_ids: list[str] = field(default_factory=list)
    created_at: datetime = field(default_factory=datetime.now)
    started_at: datetime | None = None
    completed_at: datetime | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "prompt": self.prompt,
            "state": self.state.value,
            "result": self.result,
            "error": self.error,
            "parent_id": self.parent_id,
            "children_ids": self.children_ids,
            "created_at": self.created_at.isoformat(),
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "metadata": self.metadata,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "DelegateTask":
        return cls(
            id=data["id"],
            name=data["name"],
            prompt=data["prompt"],
            state=DelegateState(data["state"]),
            result=data.get("result", ""),
            error=data.get("error", ""),
            parent_id=data.get("parent_id"),
            children_ids=data.get("children_ids", []),
            created_at=datetime.fromisoformat(data["created_at"]),
            started_at=datetime.fromisoformat(data["started_at"]) if data.get("started_at") else None,
            completed_at=datetime.fromisoformat(data["completed_at"]) if data.get("completed_at") else None,
            metadata=data.get("metadata", {}),
        )


class DelegateManager:
    def __init__(self, config: Config, work_dir: Path):
        self.config = config
        self.work_dir = work_dir
        self.delegates: dict[str, DelegateTask] = {}
        self.state_file = work_dir / ".tehuti" / "delegates.json"
        self.state_file.parent.mkdir(parents=True, exist_ok=True)
        self._load_state()

    def _load_state(self) -> None:
        if self.state_file.exists():
            try:
                data = json.loads(self.state_file.read_text())
                self.delegates = {k: DelegateTask.from_dict(v) for k, v in data.items()}
            except Exception:
                self.delegates = {}

    def _save_state(self) -> None:
        data = {k: v.to_dict() for k, v in self.delegates.items()}
        self.state_file.write_text(json.dumps(data, indent=2))

    def create_delegate(
        self,
        name: str,
        prompt: str,
        parent_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> str:
        delegate_id = str(uuid.uuid4())[:8]
        task = DelegateTask(
            id=delegate_id,
            name=name,
            prompt=prompt,
            parent_id=parent_id,
            metadata=metadata or {},
        )
        self.delegates[delegate_id] = task
        if parent_id and parent_id in self.delegates:
            self.delegates[parent_id].children_ids.append(delegate_id)
        self._save_state()
        return delegate_id

    def get_delegate(self, delegate_id: str) -> DelegateTask | None:
        return self.delegates.get(delegate_id)

    def list_delegates(
        self,
        state: DelegateState | None = None,
        parent_id: str | None = None,
    ) -> list[DelegateTask]:
        results = list(self.delegates.values())
        if state:
            results = [t for t in results if t.state == state]
        if parent_id:
            results = [t for t in results if t.parent_id == parent_id]
        return sorted(results, key=lambda t: t.created_at)

    def update_delegate(
        self,
        delegate_id: str,
        state: DelegateState | None = None,
        result: str | None = None,
        error: str | None = None,
    ) -> bool:
        task = self.delegates.get(delegate_id)
        if not task:
            return False
        if state:
            task.state = state
            if state == DelegateState.RUNNING:
                task.started_at = datetime.now()
            elif state in (DelegateState.COMPLETED, DelegateState.FAILED, DelegateState.CANCELLED):
                task.completed_at = datetime.now()
        if result is not None:
            task.result = result
        if error is not None:
            task.error = error
        self._save_state()
        return True

    def cancel_delegate(self, delegate_id: str) -> bool:
        return self.update_delegate(delegate_id, state=DelegateState.CANCELLED)

    def cancel_delegate_tree(self, root_id: str) -> list[str]:
        cancelled = []
        stack = [root_id]
        while stack:
            current = stack.pop()
            if self.cancel_delegate(current):
                cancelled.append(current)
                task = self.delegates.get(current)
                if task:
                    stack.extend(task.children_ids)
        return cancelled

    def get_delegate_tree(self, root_id: str) -> list[DelegateTask]:
        if root_id not in self.delegates:
            return []
        tree = [self.delegates[root_id]]
        stack = list(self.delegates[root_id].children_ids)
        while stack:
            child_id = stack.pop()
            if child_id in self.delegates:
                tree.append(self.delegates[child_id])
                stack.extend(self.delegates[child_id].children_ids)
        return tree

    def get_pending_delegates(self) -> list[DelegateTask]:
        return [t for t in self.delegates.values() if t.state == DelegateState.PENDING]

    def get_root_delegates(self) -> list[DelegateTask]:
        return [t for t in self.delegates.values() if t.parent_id is None]

    def cleanup_completed(self, max_age_hours: int = 24) -> int:
        cutoff = datetime.now().timestamp() - (max_age_hours * 3600)
        to_delete = [
            tid
            for tid, task in self.delegates.items()
            if task.completed_at and task.completed_at.timestamp() < cutoff and task.state == DelegateState.COMPLETED
        ]
        for tid in to_delete:
            del self.delegates[tid]
        self._save_state()
        return len(to_delete)

    def clear_all(self) -> None:
        self.delegates.clear()
        self._save_state()
