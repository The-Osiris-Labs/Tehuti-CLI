from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any

from tehuti_cli.storage.config import Config


class TaskStatus(Enum):
    DRAFT = "draft"
    PENDING = "pending"
    BLOCKED = "blocked"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    SKIPPED = "skipped"


class TaskPriority(Enum):
    LOW = 1
    MEDIUM = 2
    HIGH = 3
    CRITICAL = 4


@dataclass
class TaskDependency:
    task_id: str
    required_by: str
    satisfied: bool = False
    satisfied_at: datetime | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "task_id": self.task_id,
            "required_by": self.required_by,
            "satisfied": self.satisfied,
            "satisfied_at": self.satisfied_at.isoformat() if self.satisfied_at else None,
        }


@dataclass
class Task:
    id: str
    title: str
    description: str = ""
    status: TaskStatus = TaskStatus.DRAFT
    priority: TaskPriority = TaskPriority.MEDIUM
    assignee: str | None = None
    depends_on: list[str] = field(default_factory=list)
    blocks: list[str] = field(default_factory=list)
    created_at: datetime = field(default_factory=datetime.now)
    updated_at: datetime = field(default_factory=datetime.now)
    started_at: datetime | None = None
    completed_at: datetime | None = None
    due_date: datetime | None = None
    tags: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "description": self.description,
            "status": self.status.value,
            "priority": self.priority.value,
            "assignee": self.assignee,
            "depends_on": self.depends_on,
            "blocks": self.blocks,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "due_date": self.due_date.isoformat() if self.due_date else None,
            "tags": self.tags,
            "metadata": self.metadata,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Task":
        return cls(
            id=data["id"],
            title=data["title"],
            description=data.get("description", ""),
            status=TaskStatus(data.get("status", "draft")),
            priority=TaskPriority(data.get("priority", 2)),
            assignee=data.get("assignee"),
            depends_on=data.get("depends_on", []),
            blocks=data.get("blocks", []),
            created_at=datetime.fromisoformat(data["created_at"]) if "created_at" in data else datetime.now(),
            updated_at=datetime.fromisoformat(data["updated_at"]) if "updated_at" in data else datetime.now(),
            started_at=datetime.fromisoformat(data["started_at"]) if data.get("started_at") else None,
            completed_at=datetime.fromisoformat(data["completed_at"]) if data.get("completed_at") else None,
            due_date=datetime.fromisoformat(data["due_date"]) if data.get("due_date") else None,
            tags=data.get("tags", []),
            metadata=data.get("metadata", {}),
        )


class TaskGraph:
    def __init__(self, config: Config, work_dir: Path):
        self.config = config
        self.work_dir = work_dir
        self.tasks: dict[str, Task] = {}
        self.state_file = work_dir / ".tehuti" / "task_graph.json"
        self.state_file.parent.mkdir(parents=True, exist_ok=True)
        self._load_state()

    def _load_state(self) -> None:
        if self.state_file.exists():
            try:
                data = json.loads(self.state_file.read_text())
                self.tasks = {k: Task.from_dict(v) for k, v in data.items()}
            except Exception:
                self.tasks = {}

    def _save_state(self) -> None:
        data = {k: v.to_dict() for k, v in self.tasks.items()}
        self.state_file.write_text(json.dumps(data, indent=2))

    def create_task(
        self,
        title: str,
        description: str = "",
        priority: TaskPriority = TaskPriority.MEDIUM,
        assignee: str | None = None,
        tags: list[str] | None = None,
        due_date: datetime | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> str:
        task_id = str(uuid.uuid4())[:8]
        task = Task(
            id=task_id,
            title=title,
            description=description,
            priority=priority,
            assignee=assignee,
            due_date=due_date,
            tags=tags or [],
            metadata=metadata or {},
        )
        self.tasks[task_id] = task
        self._update_dependencies()
        self._save_state()
        return task_id

    def get_task(self, task_id: str) -> Task | None:
        return self.tasks.get(task_id)

    def update_task(
        self,
        task_id: str,
        title: str | None = None,
        description: str | None = None,
        status: TaskStatus | None = None,
        priority: TaskPriority | None = None,
        assignee: str | None = None,
        tags: list[str] | None = None,
        due_date: datetime | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> bool:
        task = self.tasks.get(task_id)
        if not task:
            return False

        if title is not None:
            task.title = title
        if description is not None:
            task.description = description
        if status is not None:
            old_status = task.status
            task.status = status
            if status == TaskStatus.IN_PROGRESS and old_status != TaskStatus.IN_PROGRESS:
                task.started_at = datetime.now()
            elif status in (TaskStatus.COMPLETED, TaskStatus.CANCELLED, TaskStatus.SKIPPED):
                task.completed_at = datetime.now()
        if priority is not None:
            task.priority = priority
        if assignee is not None:
            task.assignee = assignee
        if tags is not None:
            task.tags = tags
        if due_date is not None:
            task.due_date = due_date
        if metadata is not None:
            task.metadata.update(metadata)

        task.updated_at = datetime.now()
        self._update_dependencies()
        self._save_state()
        return True

    def add_dependency(self, task_id: str, depends_on_id: str) -> bool:
        task = self.tasks.get(task_id)
        dependent = self.tasks.get(depends_on_id)
        if not task or not dependent:
            return False

        if depends_on_id not in task.depends_on:
            task.depends_on.append(depends_on_id)
        if task_id not in dependent.blocks:
            dependent.blocks.append(task_id)

        self._save_state()
        return True

    def remove_dependency(self, task_id: str, depends_on_id: str) -> bool:
        task = self.tasks.get(task_id)
        if not task:
            return False

        if depends_on_id in task.depends_on:
            task.depends_on.remove(depends_on_id)
            self._save_state()
            return True
        return False

    def _update_dependencies(self) -> None:
        for task in self.tasks.values():
            all_satisfied = True
            for dep_id in task.depends_on:
                dep_task = self.tasks.get(dep_id)
                if not dep_task or dep_task.status not in (
                    TaskStatus.COMPLETED,
                    TaskStatus.SKIPPED,
                ):
                    all_satisfied = False
                    break

            if task.status == TaskStatus.PENDING:
                if not all_satisfied:
                    task.status = TaskStatus.BLOCKED
                elif task.status == TaskStatus.BLOCKED:
                    task.status = TaskStatus.PENDING

    def get_schedulable_tasks(self) -> list[Task]:
        schedulable = []
        for task in self.tasks.values():
            if task.status not in (TaskStatus.COMPLETED, TaskStatus.CANCELLED, TaskStatus.SKIPPED):
                all_deps_done = all(
                    self.tasks.get(dep_id) and self.tasks[dep_id].status in (TaskStatus.COMPLETED, TaskStatus.SKIPPED)
                    for dep_id in task.depends_on
                )
                if all_deps_done:
                    schedulable.append(task)
        return sorted(schedulable, key=lambda t: (t.priority.value, t.created_at))

    def get_blocked_tasks(self) -> list[Task]:
        return [t for t in self.tasks.values() if t.status == TaskStatus.BLOCKED]

    def get_tasks_by_status(self, status: TaskStatus) -> list[Task]:
        return [t for t in self.tasks.values() if t.status == status]

    def get_tasks_by_assignee(self, assignee: str) -> list[Task]:
        return [t for t in self.tasks.values() if t.assignee == assignee]

    def get_tasks_by_tag(self, tag: str) -> list[Task]:
        return [t for t in self.tasks.values() if tag in t.tags]

    def get_critical_path(self, end_task_id: str) -> list[Task]:
        if end_task_id not in self.tasks:
            return []

        path = []
        current = self.tasks[end_task_id]
        path.append(current)

        while current.depends_on:
            max_delay = 0
            next_task = None
            for dep_id in current.depends_on:
                dep = self.tasks.get(dep_id)
                if dep and dep.priority.value > max_delay:
                    max_delay = dep.priority.value
                    next_task = dep
            if next_task:
                path.append(next_task)
                current = next_task
            else:
                break

        return list(reversed(path))

    def validate_graph(self) -> tuple[bool, list[str]]:
        errors = []

        for task_id, task in self.tasks.items():
            for dep_id in task.depends_on:
                if dep_id not in self.tasks:
                    errors.append(f"Task {task_id} depends on non-existent task {dep_id}")
            for block_id in task.blocks:
                if block_id not in self.tasks:
                    errors.append(f"Task {task_id} blocks non-existent task {block_id}")

        cycle_errors = self._find_cycles()
        errors.extend(cycle_errors)

        return len(errors) == 0, errors

    def _find_cycles(self) -> list[str]:
        cycles = []
        visited = set()
        recursion_stack = set()

        def dfs(task_id: str, path: list[str]) -> None:
            if task_id in recursion_stack:
                cycle_start = path.index(task_id)
                cycles.append(" -> ".join(path[cycle_start:] + [task_id]))
                return
            if task_id in visited:
                return

            visited.add(task_id)
            recursion_stack.add(task_id)
            path.append(task_id)

            task = self.tasks.get(task_id)
            if task:
                for dep_id in task.depends_on:
                    dfs(dep_id, path)

            recursion_stack.remove(task_id)
            path.pop()

        for task_id in self.tasks:
            if task_id not in visited:
                dfs(task_id, [])

        return [f"Cycle detected: {c}" for c in cycles]

    def get_statistics(self) -> dict[str, Any]:
        total = len(self.tasks)
        by_status = {s.value: 0 for s in TaskStatus}
        by_priority = {p.value: 0 for p in TaskPriority}

        for task in self.tasks.values():
            by_status[task.status.value] += 1
            by_priority[task.priority.value] += 1

        completion_rate = 0
        if total > 0:
            completed = by_status.get("completed", 0)
            completion_rate = (completed / total) * 100

        return {
            "total_tasks": total,
            "by_status": by_status,
            "by_priority": by_priority,
            "completion_rate": completion_rate,
            "blocked_count": len(self.get_blocked_tasks()),
            "schedulable_count": len(self.get_schedulable_tasks()),
        }

    def clear_all(self) -> None:
        self.tasks.clear()
        self._save_state()
