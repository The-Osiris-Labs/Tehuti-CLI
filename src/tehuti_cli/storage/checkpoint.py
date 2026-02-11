"""Checkpoint management for Tehuti workflow execution.

Provides ability to save and restore execution state for resumable workflows.
"""

import json
import os
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any, List
from dataclasses import dataclass, field, asdict


@dataclass
class TaskState:
    """State of a single task at checkpoint."""

    task_id: str
    title: str
    status: str  # pending, in_progress, completed, failed, skipped
    phase_num: int
    plan_num: int
    wave: int = 1
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    result: Optional[str] = None
    error: Optional[str] = None
    retry_count: int = 0


@dataclass
class PhaseCheckpoint:
    """Checkpoint state for a phase."""

    phase_num: int
    plan_num: int
    wave: int
    tasks: List[TaskState]
    created: str = field(default_factory=lambda: datetime.now().isoformat())
    updated: str = field(default_factory=lambda: datetime.now().isoformat())
    status: str = "in_progress"  # in_progress, completed, failed, paused
    completed_tasks: int = 0
    total_tasks: int = 0
    message: str = ""


class CheckpointManager:
    """Manages checkpoints for resumable workflow execution.

    Checkpoints allow:
    - Saving execution state at any point
    - Resuming from a saved checkpoint
    - Tracking progress across sessions
    - Handling interruptions gracefully
    """

    CHECKPOINT_DIR = ".planning/checkpoints"

    def __init__(self, project_root: str = "."):
        """Initialize checkpoint manager.

        Args:
            project_root: Root directory of the project
        """
        self.project_root = Path(project_root)
        self.checkpoint_dir = self.project_root / self.CHECKPOINT_DIR
        self.checkpoint_dir.mkdir(parents=True, exist_ok=True)

    def _get_checkpoint_path(self, phase_num: int, plan_num: int) -> Path:
        """Get the file path for a checkpoint."""
        return self.checkpoint_dir / f"phase_{phase_num:02d}_{plan_num:02d}.json"

    def save_checkpoint(
        self,
        phase_num: int,
        plan_num: int,
        wave: int,
        tasks: List[Dict[str, Any]],
        message: str = "",
    ) -> Path:
        """Save a checkpoint of current execution state.

        Args:
            phase_num: Phase number
            plan_num: Plan number
            wave: Current wave number
            tasks: List of task dictionaries
            message: Optional message describing checkpoint

        Returns:
            Path to saved checkpoint file
        """
        task_states = []
        completed = 0
        total = len(tasks)

        for task in tasks:
            state = TaskState(
                task_id=task.get("id", ""),
                title=task.get("title", ""),
                status=task.get("status", "pending"),
                phase_num=phase_num,
                plan_num=plan_num,
                wave=task.get("wave", wave),
                started_at=task.get("started_at"),
                completed_at=task.get("completed_at"),
                result=task.get("result"),
                error=task.get("error"),
                retry_count=task.get("retry_count", 0),
            )
            task_states.append(asdict(state))
            if state.status == "completed":
                completed += 1

        checkpoint = PhaseCheckpoint(
            phase_num=phase_num,
            plan_num=plan_num,
            wave=wave,
            tasks=task_states,
            status="paused",
            completed_tasks=completed,
            total_tasks=total,
            message=message,
        )

        filepath = self._get_checkpoint_path(phase_num, plan_num)
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(asdict(checkpoint), f, indent=2)

        return filepath

    def load_checkpoint(
        self, phase_num: int, plan_num: int
    ) -> Optional[PhaseCheckpoint]:
        """Load a checkpoint for a phase/plan.

        Args:
            phase_num: Phase number
            plan_num: Plan number

        Returns:
            PhaseCheckpoint if found, None otherwise
        """
        filepath = self._get_checkpoint_path(phase_num, plan_num)
        if not filepath.exists():
            return None

        try:
            with open(filepath, "r", encoding="utf-8") as f:
                data = json.load(f)
                return PhaseCheckpoint(**data)
        except (json.JSONDecodeError, KeyError, TypeError) as e:
            return None

    def get_resume_tasks(self, phase_num: int, plan_num: int) -> List[Dict[str, Any]]:
        """Get tasks that need to be resumed from a checkpoint.

        Args:
            phase_num: Phase number
            plan_num: Plan number

        Returns:
            List of task dictionaries that are not completed
        """
        checkpoint = self.load_checkpoint(phase_num, plan_num)
        if not checkpoint:
            return []

        resume_tasks = []
        for task_data in checkpoint.tasks:
            if task_data["status"] not in ("completed", "skipped"):
                task_data["status"] = "pending"
                task_data["retry_count"] = task_data.get("retry_count", 0) + 1
                resume_tasks.append(task_data)

        return resume_tasks

    def get_completed_tasks(
        self, phase_num: int, plan_num: int
    ) -> List[Dict[str, Any]]:
        """Get tasks that were already completed in a checkpoint.

        Args:
            phase_num: Phase number
            plan_num: Plan number

        Returns:
            List of completed task dictionaries
        """
        checkpoint = self.load_checkpoint(phase_num, plan_num)
        if not checkpoint:
            return []

        return [task for task in checkpoint.tasks if task["status"] == "completed"]

    def update_task_in_checkpoint(
        self,
        phase_num: int,
        plan_num: int,
        task_id: str,
        status: str,
        result: Optional[str] = None,
        error: Optional[str] = None,
    ) -> bool:
        """Update a task's status in the checkpoint.

        Args:
            phase_num: Phase number
            plan_num: Plan number
            task_id: Task identifier
            status: New status
            result: Optional result output
            error: Optional error message

        Returns:
            True if task was found and updated
        """
        checkpoint = self.load_checkpoint(phase_num, plan_num)
        if not checkpoint:
            return False

        updated = False
        for task in checkpoint.tasks:
            if task["task_id"] == task_id:
                task["status"] = status
                task["updated"] = datetime.now().isoformat()
                if status == "in_progress" and not task.get("started_at"):
                    task["started_at"] = datetime.now().isoformat()
                if status in ("completed", "failed", "skipped"):
                    task["completed_at"] = datetime.now().isoformat()
                if result:
                    task["result"] = result
                if error:
                    task["error"] = error
                if status == "completed":
                    checkpoint.completed_tasks += 1
                updated = True
                break

        if updated:
            checkpoint.updated = datetime.now().isoformat()
            filepath = self._get_checkpoint_path(phase_num, plan_num)
            with open(filepath, "w", encoding="utf-8") as f:
                json.dump(asdict(checkpoint), f, indent=2)

        return updated

    def complete_checkpoint(
        self, phase_num: int, plan_num: int, message: str = "Completed"
    ) -> bool:
        """Mark a checkpoint as fully completed.

        Args:
            phase_num: Phase number
            plan_num: Plan number
            message: Completion message

        Returns:
            True if checkpoint was found and updated
        """
        checkpoint = self.load_checkpoint(phase_num, plan_num)
        if not checkpoint:
            return False

        checkpoint.status = "completed"
        checkpoint.updated = datetime.now().isoformat()
        checkpoint.message = message

        filepath = self._get_checkpoint_path(phase_num, plan_num)
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(asdict(checkpoint), f, indent=2)

        return True

    def delete_checkpoint(self, phase_num: int, plan_num: int) -> bool:
        """Delete a checkpoint file.

        Args:
            phase_num: Phase number
            plan_num: Plan number

        Returns:
            True if file was deleted
        """
        filepath = self._get_checkpoint_path(phase_num, plan_num)
        if filepath.exists():
            filepath.unlink()
            return True
        return False

    def list_checkpoints(self) -> List[Dict[str, Any]]:
        """List all checkpoints in the project.

        Returns:
            List of checkpoint summaries with phase, plan, status, progress
        """
        checkpoints = []

        if not self.checkpoint_dir.exists():
            return checkpoints

        for filepath in self.checkpoint_dir.glob("*.json"):
            try:
                with open(filepath, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    checkpoints.append(
                        {
                            "phase": data.get("phase_num"),
                            "plan": data.get("plan_num"),
                            "status": data.get("status"),
                            "progress": f"{data.get('completed_tasks', 0)}/{data.get('total_tasks', 0)}",
                            "updated": data.get("updated"),
                            "message": data.get("message", ""),
                        }
                    )
            except (json.JSONDecodeError, KeyError):
                continue

        return sorted(checkpoints, key=lambda x: (x["phase"] or 0, x["plan"] or 0))

    def get_checkpoint_progress(
        self, phase_num: int, plan_num: int
    ) -> Optional[Dict[str, Any]]:
        """Get progress information for a checkpoint.

        Args:
            phase_num: Phase number
            plan_num: Plan number

        Returns:
            Dict with progress information or None
        """
        checkpoint = self.load_checkpoint(phase_num, plan_num)
        if not checkpoint:
            return None

        total = checkpoint.total_tasks
        completed = checkpoint.completed_tasks
        percent = int((completed / total) * 100) if total > 0 else 0

        return {
            "phase": phase_num,
            "plan": plan_num,
            "wave": checkpoint.wave,
            "status": checkpoint.status,
            "completed": completed,
            "total": total,
            "percent": percent,
            "pending": total - completed,
            "message": checkpoint.message,
            "created": checkpoint.created,
            "updated": checkpoint.updated,
        }

    def has_checkpoint(self, phase_num: int, plan_num: int) -> bool:
        """Check if a checkpoint exists for a phase/plan.

        Args:
            phase_num: Phase number
            plan_num: Plan number

        Returns:
            True if checkpoint exists
        """
        return self._get_checkpoint_path(phase_num, plan_num).exists()

    def cleanup_old_checkpoints(self, keep_recent: int = 5) -> int:
        """Remove old checkpoint files, keeping the most recent ones.

        Args:
            keep_recent: Number of recent checkpoints to keep

        Returns:
            Number of checkpoints deleted
        """
        checkpoints = self.list_checkpoints()
        if len(checkpoints) <= keep_recent:
            return 0

        deleted = 0
        # Sort by updated timestamp, keep most recent
        sorted_checkpoints = sorted(
            checkpoints, key=lambda x: x.get("updated", ""), reverse=True
        )

        for checkpoint in sorted_checkpoints[keep_recent:]:
            phase = checkpoint.get("phase")
            plan = checkpoint.get("plan")
            if phase is not None and plan is not None:
                if self.delete_checkpoint(phase, plan):
                    deleted += 1

        return deleted


def create_checkpointer(project_root: str = ".") -> CheckpointManager:
    """Factory function to create a CheckpointManager.

    Args:
        project_root: Root directory of the project

    Returns:
        Configured CheckpointManager instance
    """
    return CheckpointManager(project_root)
