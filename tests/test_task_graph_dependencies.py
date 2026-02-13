from __future__ import annotations

from pathlib import Path

from tehuti_cli.core.task_graph import TaskGraph, TaskStatus
from tehuti_cli.storage.config import default_config


def test_blocked_task_becomes_pending_when_dependency_completes(tmp_path: Path) -> None:
    graph = TaskGraph(default_config(), tmp_path)

    dep_id = graph.create_task("Dependency")
    task_id = graph.create_task("Main task")
    assert graph.add_dependency(task_id, dep_id) is True

    # Mark as pending, then recompute dependencies -> should become blocked.
    assert graph.update_task(task_id, status=TaskStatus.PENDING) is True
    task = graph.get_task(task_id)
    assert task is not None
    assert task.status == TaskStatus.BLOCKED

    # Complete dependency, recompute -> blocked task should return to pending.
    assert graph.update_task(dep_id, status=TaskStatus.COMPLETED) is True
    assert graph.update_task(task_id, status=TaskStatus.BLOCKED) is True
    task = graph.get_task(task_id)
    assert task is not None
    assert task.status == TaskStatus.PENDING
