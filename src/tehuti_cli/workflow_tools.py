#!/usr/bin/env python3
"""
Tehuti Workflow Tools - Artifact verification and workflow management CLI
Part of Project Tehuti - Architect of Truth

Provides command-line utilities for:
- Project initialization and status
- Phase and plan management
- Artifact verification
- State tracking
- Git integration
"""

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

import yaml


def get_planning_dir() -> Path:
    """Get the planning directory, searching up the tree if needed."""
    cwd = Path.cwd()
    current = cwd

    while current != current.parent:
        planning = current / ".planning"
        if planning.exists():
            return planning
        current = current.parent

    # Default to current directory if not found
    return cwd / ".planning"


def load_frontmatter(filepath: Path) -> dict:
    """Load YAML frontmatter from markdown file."""
    content = filepath.read_text(encoding="utf-8")

    if content.startswith("---"):
        parts = content.split("---", 2)
        if len(parts) >= 3:
            try:
                return yaml.safe_load(parts[1]) or {}
            except yaml.YAMLError:
                return {}
    return {}


def cmd_init(args):
    """Initialize workflow context."""
    planning_dir = get_planning_dir()

    result = {
        "project_exists": planning_dir.exists(),
        "planning_dir": str(planning_dir),
        "current_dir": str(planning_dir / "current"),
        "phases_dir": str(planning_dir / "current" / "phases"),
        "timestamp": datetime.now().isoformat(),
    }

    # Load config if exists
    config_path = planning_dir / "config.json"
    if config_path.exists():
        with open(config_path) as f:
            config = json.load(f)
            result.update(
                {
                    "mode": config.get("mode", "yolo"),
                    "depth": config.get("depth", "standard"),
                    "parallelization": config.get("parallelization", True),
                    "commit_docs": config.get("commit_docs", True),
                    "research_enabled": config.get("workflow", {}).get(
                        "research", True
                    ),
                    "plan_checker_enabled": config.get("workflow", {}).get(
                        "plan_check", True
                    ),
                    "verifier_enabled": config.get("workflow", {}).get(
                        "verifier", True
                    ),
                }
            )

    # Check for existing files
    result["has_project"] = (planning_dir / "current" / "PROJECT.md").exists()
    result["has_roadmap"] = (planning_dir / "current" / "ROADMAP.md").exists()
    result["has_requirements"] = (planning_dir / "current" / "REQUIREMENTS.md").exists()
    result["has_state"] = (planning_dir / "current" / "STATE.md").exists()

    # Count phases
    phases_dir = planning_dir / "current" / "phases"
    if phases_dir.exists():
        phases = [d for d in phases_dir.iterdir() if d.is_dir()]
        result["phase_count"] = len(phases)
    else:
        result["phase_count"] = 0

    print(json.dumps(result, indent=2))
    return 0


def cmd_init_workflow(args):
    """Initialize specific workflow (new-project, plan-phase, execute-phase)."""
    workflow = args.workflow
    planning_dir = get_planning_dir()

    result = {
        "workflow": workflow,
        "planning_dir": str(planning_dir),
        "timestamp": datetime.now().isoformat(),
    }

    if workflow == "new-project":
        result.update(
            {
                "project_exists": planning_dir.exists(),
                "has_git": (planning_dir.parent / ".git").exists(),
            }
        )

    elif workflow == "plan-phase":
        phase = args.phase if hasattr(args, "phase") else None
        result.update(
            {
                "planning_exists": planning_dir.exists(),
                "phase": phase,
            }
        )

        if phase:
            phase_dir = planning_dir / "current" / "phases" / f"phase_{phase:02d}"
            result["phase_exists"] = phase_dir.exists()
            if phase_dir.exists():
                plans = list(phase_dir.glob("*-PLAN.md"))
                result["plan_count"] = len(plans)

    elif workflow == "execute-phase":
        phase = args.phase if hasattr(args, "phase") else None
        result.update(
            {
                "phase": phase,
            }
        )

        if phase:
            phase_dir = planning_dir / "current" / "phases" / f"phase_{phase:02d}"
            if phase_dir.exists():
                plans = list(phase_dir.glob("*-PLAN.md"))
                summaries = list(phase_dir.glob("*-SUMMARY.md"))
                result.update(
                    {
                        "phase_found": True,
                        "phase_dir": str(phase_dir),
                        "plan_count": len(plans),
                        "completed_count": len(summaries),
                        "incomplete_count": len(plans) - len(summaries),
                    }
                )

    print(json.dumps(result, indent=2))
    return 0


def cmd_phase_plan_index(args):
    """Get plan inventory with wave grouping."""
    planning_dir = get_planning_dir()
    phase = args.phase

    phase_dir = planning_dir / "current" / "phases" / f"phase_{phase:02d}"

    if not phase_dir.exists():
        print(json.dumps({"error": "Phase not found", "phase": phase}))
        return 1

    plans = []
    waves = {}

    for plan_file in sorted(phase_dir.glob("*-PLAN.md")):
        frontmatter = load_frontmatter(plan_file)

        plan_info = {
            "id": plan_file.stem,
            "file": str(plan_file),
            "phase": frontmatter.get("phase", phase),
            "plan": frontmatter.get("plan", 0),
            "wave": frontmatter.get("wave", 1),
            "autonomous": frontmatter.get("autonomous", True),
            "objective": frontmatter.get("objective", ""),
            "has_summary": (
                plan_file.parent / f"{plan_file.stem.replace('-PLAN', '-SUMMARY')}.md"
            ).exists(),
        }

        plans.append(plan_info)

        wave_num = plan_info["wave"]
        if wave_num not in waves:
            waves[wave_num] = []
        waves[wave_num].append(plan_info["id"])

    incomplete = [p for p in plans if not p["has_summary"]]
    has_checkpoints = any(not p["autonomous"] for p in plans)

    result = {
        "phase": phase,
        "plans": plans,
        "waves": waves,
        "incomplete": [p["id"] for p in incomplete],
        "has_checkpoints": has_checkpoints,
        "total_plans": len(plans),
        "incomplete_count": len(incomplete),
    }

    print(json.dumps(result, indent=2))
    return 0


def cmd_roadmap_get_phase(args):
    """Get phase info from ROADMAP.md."""
    planning_dir = get_planning_dir()
    roadmap_path = planning_dir / "current" / "ROADMAP.md"

    if not roadmap_path.exists():
        print(json.dumps({"found": False, "error": "ROADMAP.md not found"}))
        return 1

    content = roadmap_path.read_text()
    phase_num = args.phase

    # Parse phase from markdown
    # Look for "### Phase {N}:" or similar patterns
    pattern = rf"###\s*Phase\s*{phase_num}[:\.]\s*(.+?)\n"
    match = re.search(pattern, content, re.IGNORECASE)

    if match:
        phase_name = match.group(1).strip()

        # Extract goal (usually after "Goal:" or in next paragraph)
        goal_pattern = (
            rf"###\s*Phase\s*{phase_num}[:\.]\s*.+?\n.*?Goal[:\s]+(.+?)(?:\n\n|\n###|$)"
        )
        goal_match = re.search(goal_pattern, content, re.IGNORECASE | re.DOTALL)
        goal = goal_match.group(1).strip() if goal_match else ""

        result = {
            "found": True,
            "phase_number": phase_num,
            "phase_name": phase_name,
            "goal": goal,
        }
    else:
        result = {"found": False, "phase": phase_num}

    print(json.dumps(result, indent=2))
    return 0


def cmd_state_snapshot(args):
    """Get current state snapshot."""
    planning_dir = get_planning_dir()
    state_path = planning_dir / "current" / "STATE.md"

    result = {
        "timestamp": datetime.now().isoformat(),
        "has_state": state_path.exists(),
    }

    if state_path.exists():
        content = state_path.read_text()

        # Parse current position
        phase_match = re.search(r"Phase:\s*(\d+)\s+of\s+(\d+)", content)
        if phase_match:
            result["current_phase"] = int(phase_match.group(1))
            result["total_phases"] = int(phase_match.group(2))

        # Parse progress
        progress_match = re.search(r"Progress:\s*\[.+?\]\s*(\d+)%", content)
        if progress_match:
            result["progress_percent"] = int(progress_match.group(1))

        # Parse status
        status_match = re.search(r"Status:\s*(.+?)\n", content)
        if status_match:
            result["status"] = status_match.group(1).strip()

        # Extract decisions
        decisions = []
        in_decisions = False
        for line in content.split("\n"):
            if "### Decisions" in line or "## Decisions" in line:
                in_decisions = True
                continue
            if in_decisions and line.startswith("##"):
                in_decisions = False
            if in_decisions and line.strip().startswith("-"):
                decisions.append(line.strip()[2:])

        result["decisions"] = decisions[:5]  # Last 5 decisions

    print(json.dumps(result, indent=2))
    return 0


def cmd_verify_artifacts(args):
    """Verify artifacts against must_haves in PLAN.md."""
    plan_path = Path(args.plan)

    if not plan_path.exists():
        print(json.dumps({"error": "Plan not found", "path": str(plan_path)}))
        return 1

    frontmatter = load_frontmatter(plan_path)
    must_haves = frontmatter.get("must_haves", {})
    artifacts = must_haves.get("artifacts", [])

    results = []
    passed = 0

    for artifact in artifacts:
        path = artifact.get("path", "")
        full_path = plan_path.parent / path

        artifact_result = {
            "path": path,
            "exists": full_path.exists(),
            "issues": [],
            "passed": False,
        }

        if not full_path.exists():
            artifact_result["issues"].append("File does not exist")
        else:
            # Check if it's a stub (too small)
            content = full_path.read_text()
            lines = len(content.split("\n"))
            min_lines = artifact.get("min_lines", 10)

            if lines < min_lines:
                artifact_result["issues"].append(
                    f"Only {lines} lines (min: {min_lines})"
                )

            # Check for required patterns
            required_patterns = artifact.get("contains", [])
            if isinstance(required_patterns, str):
                required_patterns = [required_patterns]

            for pattern in required_patterns:
                if pattern not in content:
                    artifact_result["issues"].append(f"Missing pattern: {pattern}")

            # Check exports
            required_exports = artifact.get("exports", [])
            for export in required_exports:
                if (
                    f"export {export}" not in content
                    and f"export {{ {export} }}" not in content
                ):
                    artifact_result["issues"].append(f"Missing export: {export}")

            if not artifact_result["issues"]:
                artifact_result["passed"] = True
                passed += 1

        results.append(artifact_result)

    output = {
        "all_passed": passed == len(results) if results else True,
        "passed": passed,
        "total": len(results),
        "artifacts": results,
    }

    print(json.dumps(output, indent=2))
    return 0 if output["all_passed"] else 1


def cmd_commit(args):
    """Commit files with atomic commit."""
    message = args.message
    files = args.files if hasattr(args, "files") else []

    if not files:
        print(json.dumps({"error": "No files specified"}))
        return 1

    # Stage files
    for file in files:
        subprocess.run(["git", "add", file], check=False)

    # Commit
    result = subprocess.run(
        ["git", "commit", "-m", message], capture_output=True, text=True
    )

    if result.returncode == 0:
        # Get commit hash
        hash_result = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True
        )
        commit_hash = hash_result.stdout.strip()

        output = {
            "success": True,
            "commit_hash": commit_hash,
            "message": message,
            "files": files,
        }
    else:
        output = {
            "success": False,
            "error": result.stderr,
        }

    print(json.dumps(output, indent=2))
    return 0 if output["success"] else 1


def cmd_project_status(args):
    """Get comprehensive project status."""
    planning_dir = get_planning_dir()

    result = {
        "project_exists": planning_dir.exists(),
        "timestamp": datetime.now().isoformat(),
    }

    if not planning_dir.exists():
        print(json.dumps(result))
        return 0

    # Load metadata
    metadata_path = planning_dir / "metadata.json"
    if metadata_path.exists():
        with open(metadata_path) as f:
            metadata = json.load(f)
            result["project_name"] = metadata.get("project_name", "Unknown")
            result["status"] = metadata.get("status", "unknown")
            result["current_phase"] = metadata.get("current_phase")
            result["completed_phases"] = metadata.get("completed_phases", [])

    # Count phases and plans
    phases_dir = planning_dir / "current" / "phases"
    if phases_dir.exists():
        phases = [d for d in phases_dir.iterdir() if d.is_dir()]
        result["total_phases"] = len(phases)

        total_plans = 0
        completed_plans = 0

        for phase_dir in phases:
            plans = list(phase_dir.glob("*-PLAN.md"))
            summaries = list(phase_dir.glob("*-SUMMARY.md"))
            total_plans += len(plans)
            completed_plans += len(summaries)

        result["total_plans"] = total_plans
        result["completed_plans"] = completed_plans

        if total_plans > 0:
            result["progress_percent"] = int((completed_plans / total_plans) * 100)

    # Check for artifacts
    current_dir = planning_dir / "current"
    result["has_project"] = (current_dir / "PROJECT.md").exists()
    result["has_requirements"] = (current_dir / "REQUIREMENTS.md").exists()
    result["has_roadmap"] = (current_dir / "ROADMAP.md").exists()
    result["has_state"] = (current_dir / "STATE.md").exists()

    print(json.dumps(result, indent=2))
    return 0


def main():
    parser = argparse.ArgumentParser(
        description="Tehuti Workflow Tools - Project management CLI"
    )
    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    # init command
    init_parser = subparsers.add_parser("init", help="Initialize workflow context")
    init_parser.add_argument("workflow", nargs="?", help="Workflow type")
    init_parser.add_argument("--phase", type=int, help="Phase number")
    init_parser.set_defaults(
        func=cmd_init_workflow if "workflow" in sys.argv else cmd_init
    )

    # phase-plan-index command
    index_parser = subparsers.add_parser("phase-plan-index", help="Get plan inventory")
    index_parser.add_argument("phase", type=int, help="Phase number")
    index_parser.set_defaults(func=cmd_phase_plan_index)

    # roadmap get-phase command
    roadmap_parser = subparsers.add_parser("roadmap", help="Roadmap operations")
    roadmap_sub = roadmap_parser.add_subparsers(dest="roadmap_cmd")
    get_phase = roadmap_sub.add_parser("get-phase", help="Get phase info")
    get_phase.add_argument("phase", type=int, help="Phase number")
    get_phase.set_defaults(func=cmd_roadmap_get_phase)

    # state-snapshot command
    snapshot_parser = subparsers.add_parser("state-snapshot", help="Get state snapshot")
    snapshot_parser.set_defaults(func=cmd_state_snapshot)

    # verify artifacts command
    verify_parser = subparsers.add_parser("verify", help="Verification operations")
    verify_sub = verify_parser.add_subparsers(dest="verify_cmd")
    verify_art = verify_sub.add_parser("artifacts", help="Verify artifacts")
    verify_art.add_argument("plan", help="Path to PLAN.md")
    verify_art.set_defaults(func=cmd_verify_artifacts)

    # commit command
    commit_parser = subparsers.add_parser("commit", help="Commit changes")
    commit_parser.add_argument("message", help="Commit message")
    commit_parser.add_argument("--files", nargs="+", help="Files to commit")
    commit_parser.set_defaults(func=cmd_commit)

    # project-status command
    status_parser = subparsers.add_parser("project-status", help="Get project status")
    status_parser.set_defaults(func=cmd_project_status)

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        return 1

    # Handle nested commands
    if hasattr(args, "func"):
        return args.func(args)
    elif args.command == "init":
        return cmd_init(args)
    elif args.command == "roadmap" and args.roadmap_cmd == "get-phase":
        return cmd_roadmap_get_phase(args)
    elif args.command == "verify" and args.verify_cmd == "artifacts":
        return cmd_verify_artifacts(args)

    return 0


if __name__ == "__main__":
    sys.exit(main())
