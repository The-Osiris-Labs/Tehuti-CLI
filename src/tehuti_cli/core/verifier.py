"""PhaseVerifier for Tehuti-style verification and validation workflow."""

from datetime import datetime
from typing import Optional, Dict, Any, List
from pathlib import Path
import json
from tehuti_cli.providers.llm import TehutiLLM
from tehuti_cli.storage.planning import PlanningStorage


class PhaseVerifier:
    """Manages phase verification, UAT, and auto-debugging."""

    def __init__(self, llm: TehutiLLM, storage: PlanningStorage, work_dir: str = "."):
        """Initialize phase verifier.

        Args:
            llm: TehutiLLM instance
            storage: PlanningStorage instance
            work_dir: Working directory
        """
        self.llm = llm
        self.storage = storage
        self.work_dir = Path(work_dir)
        self.verification_log: List[Dict[str, Any]] = []

    def verify_phase(self, phase_num: int) -> Dict[str, Any]:
        """Run UAT verification workflow for a phase.

        This involves:
        1. Running automated tests/checks
        2. Manual walkthrough and human approval
        3. Auto-debug any failures
        4. Generate fix plans if needed

        Args:
            phase_num: Phase number to verify

        Returns:
            Verification result
        """
        print(f"\n{'=' * 60}")
        print(f"✔️  VERIFYING PHASE {phase_num}")
        print(f"{'=' * 60}\n")

        # Load phase information
        phase_plan = self.storage.load_artifact("PHASE_PLAN", phase_num)
        tasks = self.storage.load_tasks(phase_num)

        if not phase_plan or not tasks:
            raise ValueError(f"Phase {phase_num} not found or incomplete")

        # Step 1: Automated checks
        print("📋 Step 1: Running Automated Checks")
        checks = self._run_automated_checks(phase_num)

        # Step 2: Manual walkthrough
        print("\n👤 Step 2: Manual Walkthrough")
        print("   Review the completed work:")
        print(f"   - Tasks completed: {len(tasks)}")
        print(
            f"   - Automated checks: {len([c for c in checks if c['passed']])}/{len(checks)}"
        )

        walkthrough_approved = (
            input("\n   Approve phase completion? (yes/no): ").strip().lower() == "yes"
        )

        # Step 3: Handle failures if any
        if not walkthrough_approved:
            print("\n⚠️  Phase not approved. Running auto-debug...")
            fix_plan = self._generate_fix_plan(phase_num, checks)

            return {
                "phase_num": phase_num,
                "status": "failed",
                "approved": False,
                "checks_passed": len([c for c in checks if c["passed"]]),
                "checks_total": len(checks),
                "fix_plan": fix_plan,
                "timestamp": datetime.now().isoformat(),
            }

        # Step 4: Finalize
        self._save_verification_log(phase_num, checks, walkthrough_approved)

        print(f"\n{'=' * 60}")
        print(f"✅ Phase {phase_num} Verification Complete!")
        print(f"{'=' * 60}")

        return {
            "phase_num": phase_num,
            "status": "verified",
            "approved": True,
            "checks_passed": len([c for c in checks if c["passed"]]),
            "checks_total": len(checks),
            "timestamp": datetime.now().isoformat(),
        }

    def verify_task(self, phase_num: int, task_id: str) -> Dict[str, Any]:
        """Verify a single task.

        Args:
            phase_num: Phase number
            task_id: Task ID

        Returns:
            Task verification result
        """
        print(f"\n✔️  VERIFYING TASK {task_id}")

        tasks = self.storage.load_tasks(phase_num)
        task = next((t for t in tasks if t["id"] == task_id), None)

        if not task:
            raise ValueError(f"Task {task_id} not found")

        print(f"   Task: {task['title']}")
        print(f"   Description: {task.get('description', 'N/A')[:80]}")

        # Run automated check for this task
        check_result = {
            "task_id": task_id,
            "title": task["title"],
            "passed": False,
            "details": "Manual verification required",
        }

        # Ask for user approval
        approved = (
            input("\n   Verify task completion? (yes/no): ").strip().lower() == "yes"
        )
        check_result["passed"] = approved

        if not approved:
            # Auto-debug
            debug_result = self._auto_debug_task(task_id, task)
            return {
                "task_id": task_id,
                "status": "failed",
                "approved": False,
                "debug_result": debug_result,
                "timestamp": datetime.now().isoformat(),
            }

        return {
            "task_id": task_id,
            "status": "verified",
            "approved": True,
            "timestamp": datetime.now().isoformat(),
        }

    def _run_automated_checks(self, phase_num: int) -> List[Dict[str, Any]]:
        """Run automated tests/checks for a phase.

        Args:
            phase_num: Phase number

        Returns:
            List of check results
        """
        checks = []

        # Check 1: Artifacts exist
        artifacts = ["PROJECT.md", "REQUIREMENTS.md", "ROADMAP.md", "PHASE_PLAN"]
        for artifact in artifacts:
            if artifact == "PHASE_PLAN":
                content = self.storage.load_artifact("PHASE_PLAN", phase_num)
            else:
                content = self.storage.load_artifact(artifact.replace(".md", ""))

            checks.append(
                {
                    "name": f"Artifact: {artifact}",
                    "passed": content is not None,
                    "details": "Artifact exists" if content else "Missing artifact",
                }
            )

        # Check 2: Tasks defined
        tasks = self.storage.load_tasks(phase_num)
        checks.append(
            {
                "name": "Tasks defined",
                "passed": len(tasks) > 0,
                "details": f"{len(tasks)} tasks defined",
            }
        )

        # Check 3: Execution log exists
        execution_log = self._load_execution_log(phase_num)
        checks.append(
            {
                "name": "Execution completed",
                "passed": len(execution_log) > 0,
                "details": f"{len(execution_log)} task executions recorded",
            }
        )

        # Print results
        for check in checks:
            status = "✓" if check["passed"] else "✗"
            print(f"   {status} {check['name']}: {check['details']}")

        return checks

    def _auto_debug_task(self, task_id: str, task: Dict[str, Any]) -> Dict[str, Any]:
        """Auto-debug a failed task.

        Args:
            task_id: Task ID
            task: Task information

        Returns:
            Debug result with suggestions
        """
        print(f"\n   🐛 Auto-debugging task {task_id}...")

        prompt = f"""A task failed verification. Suggest debugging steps:

Task: {task["title"]}
Description: {task.get("description", "N/A")}
ID: {task_id}

Provide 3-5 specific debugging steps to identify and fix the issue."""

        suggestion = self.llm.chat_messages([{"role": "user", "content": prompt}])

        return {
            "task_id": task_id,
            "debugging_steps": suggestion,
            "timestamp": datetime.now().isoformat(),
        }

    def _generate_fix_plan(
        self, phase_num: int, checks: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """Generate a fix plan based on failed checks.

        Args:
            phase_num: Phase number
            checks: Check results

        Returns:
            Fix plan
        """
        failed_checks = [c for c in checks if not c["passed"]]

        prompt = f"""Create a fix plan to address these verification failures:

Phase: {phase_num}
Failed checks: {len(failed_checks)}

{json.dumps(failed_checks, indent=2)}

Provide a structured fix plan with:
1. Root cause analysis
2. Specific fix steps
3. Prevention measures for future"""

        fix_plan_text = self.llm.chat_messages([{"role": "user", "content": prompt}])

        return {
            "phase_num": phase_num,
            "failed_checks_count": len(failed_checks),
            "fix_plan": fix_plan_text,
            "timestamp": datetime.now().isoformat(),
        }

    def _save_verification_log(
        self, phase_num: int, checks: List[Dict[str, Any]], approved: bool
    ) -> None:
        """Save verification log.

        Args:
            phase_num: Phase number
            checks: Check results
            approved: Whether phase was approved
        """
        phase_dir = self.storage.phases_dir / f"phase_{phase_num}"
        phase_dir.mkdir(parents=True, exist_ok=True)

        log_file = phase_dir / "verification.json"

        with open(log_file, "w", encoding="utf-8") as f:
            json.dump(
                {
                    "phase": phase_num,
                    "verification_time": datetime.now().isoformat(),
                    "approved": approved,
                    "checks": checks,
                },
                f,
                indent=2,
            )

    def _load_verification_log(self, phase_num: int) -> Optional[Dict[str, Any]]:
        """Load verification log.

        Args:
            phase_num: Phase number

        Returns:
            Verification log or None
        """
        phase_dir = self.storage.phases_dir / f"phase_{phase_num}"
        log_file = phase_dir / "verification.json"

        if not log_file.exists():
            return None

        with open(log_file, "r", encoding="utf-8") as f:
            return json.load(f)

    def _load_execution_log(self, phase_num: int) -> List[Dict[str, Any]]:
        """Load execution log.

        Args:
            phase_num: Phase number

        Returns:
            Execution log entries
        """
        phase_dir = self.storage.phases_dir / f"phase_{phase_num}"
        log_file = phase_dir / "execution.json"

        if not log_file.exists():
            return []

        with open(log_file, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data.get("tasks", [])
