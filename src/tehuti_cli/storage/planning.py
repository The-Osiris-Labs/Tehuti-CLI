"""Storage module for planning artifacts and project state."""

import json
import os
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any, List


class PlanningStorage:
    """Manages .planning/ directory structure and artifact persistence."""

    def __init__(self, project_root: str = "."):
        """Initialize planning storage.

        Args:
            project_root: Root directory of the project (where .planning/ will be created)
        """
        self.project_root = Path(project_root)
        self.planning_dir = self.project_root / ".planning"
        self.current_dir = self.planning_dir / "current"
        self.phases_dir = self.current_dir / "phases"
        self.completed_dir = self.planning_dir / "completed"

    def init_project(self, project_name: str, description: str = "") -> None:
        """Initialize directory structure for a new project.

        Args:
            project_name: Name of the project
            description: Brief project description
        """
        self.current_dir.mkdir(parents=True, exist_ok=True)
        self.phases_dir.mkdir(parents=True, exist_ok=True)
        self.completed_dir.mkdir(parents=True, exist_ok=True)

        # Create metadata file
        metadata = {
            "project_name": project_name,
            "description": description,
            "created": datetime.now().isoformat(),
            "updated": datetime.now().isoformat(),
            "status": "planning",
            "current_phase": None,
            "completed_phases": [],
            "total_phases": 0,
        }
        self._save_json(".planning/metadata.json", metadata)

        # Create initial STATE.md
        self._create_initial_state()

    def _create_initial_state(self) -> None:
        """Create initial STATE.md file."""
        state_content = """# Project State

## Current Status
- **Phase**: None (project initialization)
- **Status**: Planning

## Completed Phases
None

## Blockers
None

## Decisions Log

## Session Notes

"""
        self.save_artifact("STATE", state_content)

    def save_artifact(
        self,
        artifact_type: str,
        content: str,
        phase_num: Optional[int] = None,
        plan_num: Optional[int] = None,
    ) -> Path:
        """Save a planning artifact.

        Args:
            artifact_type: Type of artifact (PROJECT, REQUIREMENTS, ROADMAP, PHASE_PLAN, STATE, SUMMARY)
            content: Artifact content
            phase_num: Phase number (for PHASE_PLAN/SUMMARY artifacts)
            plan_num: Plan number within phase (for PHASE_PLAN artifacts)

        Returns:
            Path to saved artifact
        """
        if artifact_type == "PHASE_PLAN" and phase_num is not None:
            phase_dir = self.phases_dir / f"phase_{phase_num:02d}"
            phase_dir.mkdir(parents=True, exist_ok=True)
            if plan_num is not None:
                filepath = phase_dir / f"{phase_num:02d}-{plan_num:02d}-PLAN.md"
            else:
                filepath = phase_dir / "PLAN.md"
        elif artifact_type == "SUMMARY" and phase_num is not None:
            phase_dir = self.phases_dir / f"phase_{phase_num:02d}"
            phase_dir.mkdir(parents=True, exist_ok=True)
            if plan_num is not None:
                filepath = phase_dir / f"{phase_num:02d}-{plan_num:02d}-SUMMARY.md"
            else:
                filepath = phase_dir / "SUMMARY.md"
        elif artifact_type == "PROJECT":
            filepath = self.current_dir / "PROJECT.md"
        elif artifact_type == "REQUIREMENTS":
            filepath = self.current_dir / "REQUIREMENTS.md"
        elif artifact_type == "ROADMAP":
            filepath = self.current_dir / "ROADMAP.md"
        elif artifact_type == "STATE":
            filepath = self.current_dir / "STATE.md"
        elif artifact_type == "VERIFICATION":
            filepath = self.current_dir / "VERIFICATION.md"
        else:
            raise ValueError(f"Unknown artifact type: {artifact_type}")

        filepath.write_text(content, encoding="utf-8")
        return filepath

    def load_artifact(
        self,
        artifact_type: str,
        phase_num: Optional[int] = None,
        plan_num: Optional[int] = None,
    ) -> Optional[str]:
        """Load a planning artifact.

        Args:
            artifact_type: Type of artifact
            phase_num: Phase number (for PHASE_PLAN/SUMMARY artifacts)
            plan_num: Plan number within phase (for PHASE_PLAN artifacts)

        Returns:
            Artifact content or None if not found
        """
        if artifact_type == "PHASE_PLAN" and phase_num is not None:
            phase_dir = self.phases_dir / f"phase_{phase_num:02d}"
            if plan_num is not None:
                filepath = phase_dir / f"{phase_num:02d}-{plan_num:02d}-PLAN.md"
            else:
                filepath = phase_dir / "PLAN.md"
        elif artifact_type == "SUMMARY" and phase_num is not None:
            phase_dir = self.phases_dir / f"phase_{phase_num:02d}"
            if plan_num is not None:
                filepath = phase_dir / f"{phase_num:02d}-{plan_num:02d}-SUMMARY.md"
            else:
                filepath = phase_dir / "SUMMARY.md"
        elif artifact_type == "PROJECT":
            filepath = self.current_dir / "PROJECT.md"
        elif artifact_type == "REQUIREMENTS":
            filepath = self.current_dir / "REQUIREMENTS.md"
        elif artifact_type == "ROADMAP":
            filepath = self.current_dir / "ROADMAP.md"
        elif artifact_type == "STATE":
            filepath = self.current_dir / "STATE.md"
        elif artifact_type == "VERIFICATION":
            filepath = self.current_dir / "VERIFICATION.md"
        else:
            raise ValueError(f"Unknown artifact type: {artifact_type}")

        if filepath.exists():
            return filepath.read_text(encoding="utf-8")
        return None

    def save_plan(self, phase_num: int, plan_num: int, content: str) -> Path:
        """Save a phase plan.

        Args:
            phase_num: Phase number
            plan_num: Plan number within phase
            content: Plan content in markdown

        Returns:
            Path to saved plan
        """
        return self.save_artifact("PHASE_PLAN", content, phase_num, plan_num)

    def load_plan(self, phase_num: int, plan_num: int) -> Optional[str]:
        """Load a phase plan.

        Args:
            phase_num: Phase number
            plan_num: Plan number within phase

        Returns:
            Plan content or None if not found
        """
        return self.load_artifact("PHASE_PLAN", phase_num, plan_num)

    def save_summary(self, phase_num: int, plan_num: int, content: str) -> Path:
        """Save a plan execution summary.

        Args:
            phase_num: Phase number
            plan_num: Plan number within phase
            content: Summary content in markdown

        Returns:
            Path to saved summary
        """
        return self.save_artifact("SUMMARY", content, phase_num, plan_num)

    def load_summary(self, phase_num: int, plan_num: int) -> Optional[str]:
        """Load a plan execution summary.

        Args:
            phase_num: Phase number
            plan_num: Plan number within phase

        Returns:
            Summary content or None if not found
        """
        return self.load_artifact("SUMMARY", phase_num, plan_num)

    def save_tasks(
        self,
        tasks: List[Dict[str, Any]],
        phase_num: int,
        plan_num: Optional[int] = None,
    ) -> Path:
        """Save task breakdown for a phase/plan.

        Args:
            tasks: List of task dicts with id, title, description, dependencies, status
            phase_num: Phase number
            plan_num: Optional plan number within phase

        Returns:
            Path to saved tasks file
        """
        phase_dir = self.phases_dir / f"phase_{phase_num:02d}"
        phase_dir.mkdir(parents=True, exist_ok=True)

        if plan_num is not None:
            filepath = phase_dir / f"tasks-{plan_num:02d}.json"
        else:
            filepath = phase_dir / "tasks.json"

        data = {
            "tasks": tasks,
            "phase": phase_num,
            "plan": plan_num,
            "created": datetime.now().isoformat(),
            "updated": datetime.now().isoformat(),
        }

        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)

        return filepath

    def load_tasks(
        self, phase_num: int, plan_num: Optional[int] = None
    ) -> Optional[List[Dict[str, Any]]]:
        """Load task breakdown for a phase/plan.

        Args:
            phase_num: Phase number
            plan_num: Optional plan number within phase

        Returns:
            List of tasks or None if not found
        """
        phase_dir = self.phases_dir / f"phase_{phase_num:02d}"

        if plan_num is not None:
            filepath = phase_dir / f"tasks-{plan_num:02d}.json"
        else:
            filepath = phase_dir / "tasks.json"

        if filepath.exists():
            with open(filepath, "r", encoding="utf-8") as f:
                data = json.load(f)
                return data.get("tasks", [])
        return None

    def update_task_status(
        self, phase_num: int, task_id: str, status: str, plan_num: Optional[int] = None
    ) -> bool:
        """Update the status of a specific task.

        Args:
            phase_num: Phase number
            task_id: Task identifier
            status: New status (pending, in_progress, completed, failed)
            plan_num: Optional plan number within phase

        Returns:
            True if task was found and updated, False otherwise
        """
        tasks = self.load_tasks(phase_num, plan_num)
        if tasks is None:
            return False

        updated = False
        for task in tasks:
            if task.get("id") == task_id:
                task["status"] = status
                task["updated"] = datetime.now().isoformat()
                if status == "completed" and "completed_at" not in task:
                    task["completed_at"] = datetime.now().isoformat()
                updated = True
                break

        if updated:
            self.save_tasks(tasks, phase_num, plan_num)

        return updated

    def load_metadata(self) -> Optional[Dict[str, Any]]:
        """Load project metadata.

        Returns:
            Metadata dict or None if not found
        """
        return self._load_json(".planning/metadata.json")

    def update_metadata(self, **kwargs) -> None:
        """Update project metadata.

        Args:
            **kwargs: Fields to update
        """
        metadata = self.load_metadata() or {}
        metadata.update(kwargs)
        metadata["updated"] = datetime.now().isoformat()
        self._save_json(".planning/metadata.json", metadata)

    def set_current_phase(self, phase_num: int) -> None:
        """Set the current active phase.

        Args:
            phase_num: Phase number
        """
        self.update_metadata(current_phase=phase_num, status="in_progress")

    def mark_phase_completed(self, phase_num: int) -> None:
        """Mark a phase as completed.

        Args:
            phase_num: Phase number
        """
        metadata = self.load_metadata() or {}
        completed = metadata.get("completed_phases", [])
        if phase_num not in completed:
            completed.append(phase_num)
            completed.sort()

        self.update_metadata(
            completed_phases=completed,
            current_phase=None,
            status="planning"
            if len(completed) < metadata.get("total_phases", 0)
            else "completed",
        )

    def list_phases(self) -> List[int]:
        """List all phase directories.

        Returns:
            List of phase numbers in order
        """
        if not self.phases_dir.exists():
            return []

        phases = []
        for item in self.phases_dir.iterdir():
            if item.is_dir() and item.name.startswith("phase_"):
                try:
                    phase_num = int(item.name.split("_")[1])
                    phases.append(phase_num)
                except (ValueError, IndexError):
                    continue

        return sorted(phases)

    def list_plans(self, phase_num: int) -> List[int]:
        """List all plans in a phase.

        Args:
            phase_num: Phase number

        Returns:
            List of plan numbers in order
        """
        phase_dir = self.phases_dir / f"phase_{phase_num:02d}"
        if not phase_dir.exists():
            return []

        plans = []
        for item in phase_dir.iterdir():
            if item.is_file() and item.name.endswith("-PLAN.md"):
                try:
                    # Extract plan number from filename like "01-02-PLAN.md"
                    parts = item.stem.split("-")
                    if len(parts) >= 2:
                        plan_num = int(parts[-2])
                        plans.append(plan_num)
                except (ValueError, IndexError):
                    continue

        return sorted(plans)

    def archive_phase(self, phase_num: int) -> None:
        """Move a phase from current to completed.

        Args:
            phase_num: Phase number to archive
        """
        phase_dir = self.phases_dir / f"phase_{phase_num:02d}"
        completed_phase_dir = self.completed_dir / f"phase_{phase_num:02d}"

        if phase_dir.exists():
            completed_phase_dir.parent.mkdir(parents=True, exist_ok=True)
            phase_dir.rename(completed_phase_dir)
            self.mark_phase_completed(phase_num)

    def project_exists(self) -> bool:
        """Check if a Tehuti project exists in this directory.

        Returns:
            True if .planning directory exists
        """
        return self.planning_dir.exists()

    def get_project_status(self) -> Dict[str, Any]:
        """Get comprehensive project status.

        Returns:
            Dict with project status information
        """
        metadata = self.load_metadata() or {}
        phases = self.list_phases()

        status = {
            "project_name": metadata.get("project_name", "Unknown"),
            "status": metadata.get("status", "unknown"),
            "current_phase": metadata.get("current_phase"),
            "completed_phases": metadata.get("completed_phases", []),
            "total_phases": metadata.get("total_phases", len(phases)),
            "phases": phases,
            "created": metadata.get("created"),
            "updated": metadata.get("updated"),
        }

        return status

    def _save_json(self, filepath: str, data: Dict[str, Any]) -> None:
        """Save JSON data to file."""
        full_path = self.project_root / filepath
        full_path.parent.mkdir(parents=True, exist_ok=True)
        with open(full_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)

    def _load_json(self, filepath: str) -> Optional[Dict[str, Any]]:
        """Load JSON data from file."""
        full_path = self.project_root / filepath
        if full_path.exists():
            with open(full_path, "r", encoding="utf-8") as f:
                return json.load(f)
        return None


# Tehuti workflow templates
PLAN_TEMPLATE = """---
phase: {phase:02d}
plan: {plan:02d}
type: execute
wave: {wave}
depends_on: {depends_on}
files_modified: []
autonomous: {autonomous}
---

# Phase {phase} Plan {plan}: {title}

## Objective
{objective}

**Purpose:** {purpose}
**Output:** {output}

## Context
- Project: @.planning/current/PROJECT.md
- Roadmap: @.planning/current/ROADMAP.md
- State: @.planning/current/STATE.md

## Tasks

{tasks}

## Verification
- [ ] {verification}

## Success Criteria
{success_criteria}

## Output
After completion, create `.planning/current/phases/{phase:02d}/{phase:02d}-{plan:02d}-SUMMARY.md`
"""

SUMMARY_TEMPLATE = """---
phase: {phase:02d}
plan: {plan:02d}
subsystem: {subsystem}
tags: {tags}
---

# Phase {phase} Plan {plan}: {title} - Summary

## Overview
{overview}

## Completed Tasks

{completed_tasks}

## Key Changes

### Files Created
{files_created}

### Files Modified
{files_modified}

## Commits
{commits}

## Decisions Made
{decisions}

## Deviations from Plan
{deviations}

## Metrics
- **Duration:** {duration}
- **Tasks Completed:** {tasks_completed}/{tasks_total}
- **Files Changed:** {files_changed}

## Self-Check
- [ ] All tasks completed
- [ ] Verification passed
- [ ] Files exist as documented
- [ ] Commits recorded

Status: {status}
"""

STATE_TEMPLATE = """# Project State

## Current Status
- **Phase:** {current_phase}
- **Status:** {status}
- **Last Updated:** {updated}

## Progress
{progress_bar}

## Completed Phases
{completed_phases}

## Current Phase
{current_phase_details}

## Blockers
{blockers}

## Decisions Log
{decisions}

## Session Notes
{notes}

## Next Actions
{next_actions}
"""
