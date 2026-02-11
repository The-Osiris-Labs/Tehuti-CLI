"""PhaseExecutor for Tehuti phase execution with task orchestration."""

from datetime import datetime
from typing import Optional, Dict, Any, List, Set
from pathlib import Path
import json
import re
import subprocess
from tehuti_cli.providers.llm import TehutiLLM
from tehuti_cli.storage.planning import PlanningStorage
from tehuti_cli.core.runtime import ToolRuntime


class TaskExecutor:
    """Executes a single task and handles git operations."""

    def __init__(self, llm: TehutiLLM, work_dir: str):
        """Initialize task executor.

        Args:
            llm: TehutiLLM instance
            work_dir: Working directory
        """
        self.llm = llm
        self.work_dir = Path(work_dir)
        self.runtime = ToolRuntime(llm.config, self.work_dir)

    def execute_task(self, task: Dict[str, Any]) -> Dict[str, Any]:
        """Execute a single task.

        Args:
            task: Task dict with id, title, description, dependencies

        Returns:
            Execution result with status and output
        """
        task_id = task.get("id", "unknown")
        title = task.get("title", "Unknown task")
        description = task.get("description", "")

        print(f"\n🎯 Executing Task: {title}")
        if description:
            print(f"   Description: {description[:80]}...")
        if not self._has_executable_instruction(task):
            return {
                "task_id": task_id,
                "title": title,
                "status": "failed",
                "output": "Task has no executable instruction (no command/tool hints found).",
                "commit": None,
                "timestamp": datetime.now().isoformat(),
            }

        response, trace = self._execute_task_with_llm(task)
        status = "completed" if response else "failed"
        return {
            "task_id": task_id,
            "title": title,
            "status": status,
            "output": response or "Execution finished without a final response.",
            "trace": trace,
            "commit": None,
            "timestamp": datetime.now().isoformat(),
        }

    def _has_executable_instruction(self, task: Dict[str, Any]) -> bool:
        if task.get("tool") or task.get("command"):
            return True
        if isinstance(task.get("commands"), list) and task.get("commands"):
            return True
        title = str(task.get("title", ""))
        description = str(task.get("description", ""))
        text = f"{title}\n{description}"
        if re.search(r"\b(run|execute|create|update|fix|edit|write|install|test|build|deploy)\b", text, re.IGNORECASE):
            return True
        if "$ " in text:
            return True
        return False

    def _execute_task_with_llm(self, task: Dict[str, Any], max_turns: int = 8) -> tuple[str, list[dict[str, Any]]]:
        messages = [
            {
                "role": "user",
                "content": (
                    "Return only JSON objects in one of these shapes: "
                    '{"type":"tool","name":"<tool>","args":{...}}, '
                    '{"type":"tools","calls":[{"type":"tool","name":"<tool>","args":{...}}]}, '
                    '{"type":"final","content":"<result>"}\n\n'
                    "Execute this task using available tools.\n"
                    f"Task ID: {task.get('id')}\n"
                    f"Title: {task.get('title')}\n"
                    f"Description: {task.get('description', '')}\n"
                    f"Dependencies: {task.get('dependencies', [])}"
                ),
            },
        ]

        seen: set[str] = set()
        trace: list[dict[str, Any]] = []

        for _ in range(max_turns):
            raw = self.llm.chat_messages(messages)
            payload = self._extract_payload(raw)
            if not payload:
                messages.append({"role": "assistant", "content": raw})
                messages.append(
                    {
                        "role": "user",
                        "content": "Invalid response. Output valid JSON only with type=tool|tools|final.",
                    }
                )
                continue

            ptype = payload.get("type")
            if ptype == "final":
                return str(payload.get("content", "")).strip(), trace

            calls: list[dict[str, Any]] = []
            if ptype == "tool":
                calls = [payload]
            elif ptype == "tools":
                raw_calls = payload.get("calls", [])
                if isinstance(raw_calls, list):
                    calls = [c for c in raw_calls if isinstance(c, dict)]

            if not calls:
                return "", trace

            results: list[str] = []
            for call in calls:
                name = str(call.get("name", "")).strip()
                args = call.get("args", {})
                if not isinstance(args, dict):
                    args = {}
                sig = f"{name}:{json.dumps(args, sort_keys=True)}"
                if sig in seen:
                    continue
                seen.add(sig)
                result = self.runtime.execute(name, args)
                out = str(result.output)
                trace.append(
                    {
                        "tool": name,
                        "args": args,
                        "ok": bool(result.ok),
                        "output": out[:2000],
                    }
                )
                results.append(f"{name} => ok={result.ok}\n{out[:4000]}")

            if not results:
                return "", trace

            messages.append({"role": "assistant", "content": json.dumps(payload)})
            messages.append(
                {
                    "role": "user",
                    "content": "Tool results:\n" + "\n\n".join(results) + "\nProvide final JSON response now.",
                }
            )

        return "", trace

    def _extract_payload(self, raw: str) -> dict[str, Any] | None:
        text = (raw or "").strip()
        if not text:
            return None
        try:
            data = json.loads(text)
            return data if isinstance(data, dict) else None
        except Exception:
            pass
        start = text.find("{")
        if start < 0:
            return None
        depth = 0
        for idx in range(start, len(text)):
            ch = text[idx]
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    snippet = text[start : idx + 1]
                    try:
                        parsed = json.loads(snippet)
                        return parsed if isinstance(parsed, dict) else None
                    except Exception:
                        return None
        return None

    def create_atomic_commit(self, task_id: str, title: str) -> Optional[str]:
        """Create an atomic git commit for a task.

        Args:
            task_id: Task identifier
            title: Task title

        Returns:
            Commit SHA or None if no changes
        """
        try:
            # Check if there are changes
            result = subprocess.run(
                ["git", "status", "--porcelain"],
                cwd=self.work_dir,
                capture_output=True,
                text=True,
            )

            if not result.stdout.strip():
                return None  # No changes

            # Stage all changes
            subprocess.run(["git", "add", "-A"], cwd=self.work_dir, check=True)

            # Create commit message following Tehuti format
            commit_msg = f"[{task_id}] {title}\n\nGenerated by Tehuti executor"

            result = subprocess.run(
                ["git", "commit", "-m", commit_msg],
                cwd=self.work_dir,
                capture_output=True,
                text=True,
            )

            if result.returncode == 0:
                # Get commit SHA
                sha_result = subprocess.run(
                    ["git", "rev-parse", "HEAD"],
                    cwd=self.work_dir,
                    capture_output=True,
                    text=True,
                )
                return sha_result.stdout.strip()[:7]  # Short SHA

            return None
        except Exception as e:
            print(f"⚠️  Could not create commit: {str(e)}")
            return None


class DependencyResolver:
    """Resolves task dependencies for execution ordering."""

    @staticmethod
    def topological_sort(tasks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Sort tasks in dependency order using topological sort.

        Args:
            tasks: List of tasks with dependencies

        Returns:
            Tasks sorted for execution
        """
        # Build dependency graph
        task_map = {task["id"]: task for task in tasks}
        in_degree = {task["id"]: 0 for task in tasks}
        graph = {task["id"]: [] for task in tasks}

        for task in tasks:
            deps = task.get("dependencies", [])
            for dep in deps:
                if dep in graph:
                    graph[dep].append(task["id"])
                    in_degree[task["id"]] += 1

        # Kahn's algorithm for topological sort
        queue = [task_id for task_id, degree in in_degree.items() if degree == 0]
        sorted_tasks = []

        while queue:
            task_id = queue.pop(0)
            sorted_tasks.append(task_map[task_id])

            for neighbor in graph[task_id]:
                in_degree[neighbor] -= 1
                if in_degree[neighbor] == 0:
                    queue.append(neighbor)

        # Check for cycles
        if len(sorted_tasks) != len(tasks):
            raise ValueError("Circular dependency detected in tasks")

        return sorted_tasks

    @staticmethod
    def identify_parallel_tasks(tasks: List[Dict[str, Any]]) -> List[Set[str]]:
        """Identify groups of tasks that can run in parallel.

        Args:
            tasks: Sorted list of tasks

        Returns:
            List of task ID sets that can run in parallel
        """
        parallel_groups = []
        current_level_deps = set()

        for task in tasks:
            task_id = task["id"]
            deps = set(task.get("dependencies", []))

            # If task depends on something in current level, move to next level
            if deps & current_level_deps:
                parallel_groups.append(current_level_deps)
                current_level_deps = {task_id}
            else:
                current_level_deps.add(task_id)

        if current_level_deps:
            parallel_groups.append(current_level_deps)

        return parallel_groups


class PhaseExecutor:
    """Orchestrates execution of a phase with task management."""

    def __init__(self, llm: TehutiLLM, storage: PlanningStorage, work_dir: str = "."):
        """Initialize phase executor.

        Args:
            llm: TehutiLLM instance
            storage: PlanningStorage instance
            work_dir: Working directory
        """
        self.llm = llm
        self.storage = storage
        self.work_dir = work_dir
        self.task_executor = TaskExecutor(llm, work_dir)
        self.resolver = DependencyResolver()
        self.execution_log: List[Dict[str, Any]] = []

    def execute_phase(self, phase_num: int, sequential: bool = True) -> Dict[str, Any]:
        """Execute all tasks in a phase.

        Args:
            phase_num: Phase number to execute
            sequential: If True, execute tasks sequentially. If False, parallelize independent tasks.

        Returns:
            Execution summary with task results
        """
        # Load tasks for phase
        tasks = self.storage.load_tasks(phase_num)
        if not tasks:
            raise ValueError(f"No tasks found for phase {phase_num}")

        print(f"\n{'=' * 60}")
        print(f"⚙️  EXECUTING PHASE {phase_num}")
        print(f"{'=' * 60}")
        print(
            f"Tasks: {len(tasks)} | Mode: {'Sequential' if sequential else 'Parallel'}"
        )
        print()

        # Sort tasks by dependency
        sorted_tasks = self.resolver.topological_sort(tasks)

        # Determine execution groups
        if sequential:
            execution_groups = [[task["id"] for task in sorted_tasks]]
        else:
            # Group by parallel execution levels
            parallel_groups = self.resolver.identify_parallel_tasks(sorted_tasks)
            execution_groups = [list(group) for group in parallel_groups]

        # Execute tasks
        results = []
        task_map = {task["id"]: task for task in sorted_tasks}

        for group_num, group in enumerate(execution_groups, 1):
            if len(execution_groups) > 1:
                print(f"\n📦 Execution Level {group_num} ({len(group)} tasks)")
                if len(group) > 1:
                    print(
                        f"   Can execute in parallel: {', '.join(group[:3])}{'...' if len(group) > 3 else ''}"
                    )

            group_results = []
            for task_id in group:
                task = task_map[task_id]
                result = self.task_executor.execute_task(task)
                group_results.append(result)

                # Create atomic commit
                commit_sha = self.task_executor.create_atomic_commit(
                    task_id, task["title"]
                )
                if commit_sha:
                    result["commit"] = commit_sha
                    print(f"   ✓ Committed as {commit_sha}")

            results.extend(group_results)

        # Update phase state
        self._save_execution_log(phase_num, results)

        # Summary
        completed = sum(1 for r in results if r["status"] == "completed")
        print(f"\n{'=' * 60}")
        print(f"✅ Phase {phase_num} Execution Complete")
        print(f"{'=' * 60}")
        print(f"Completed: {completed}/{len(results)} tasks")

        return {
            "phase_num": phase_num,
            "status": "completed",
            "tasks_executed": len(results),
            "tasks_successful": completed,
            "execution_log": results,
            "timestamp": datetime.now().isoformat(),
        }

    def execute_task_by_id(self, phase_num: int, task_id: str) -> Dict[str, Any]:
        """Execute a single task by ID.

        Args:
            phase_num: Phase number
            task_id: Task ID to execute

        Returns:
            Task execution result
        """
        tasks = self.storage.load_tasks(phase_num)
        task = next((t for t in tasks if t["id"] == task_id), None)

        if not task:
            raise ValueError(f"Task {task_id} not found in phase {phase_num}")

        # Check dependencies
        deps = task.get("dependencies", [])
        if deps:
            print(f"⚠️  Task has dependencies: {deps}")
            print("   Ensure dependencies are completed first.")

        result = self.task_executor.execute_task(task)

        # Create atomic commit
        commit_sha = self.task_executor.create_atomic_commit(task_id, task["title"])
        if commit_sha:
            result["commit"] = commit_sha

        return result

    def get_phase_progress(self, phase_num: int) -> Dict[str, Any]:
        """Get current progress of a phase.

        Args:
            phase_num: Phase number

        Returns:
            Progress summary
        """
        execution_log = self._load_execution_log(phase_num)
        tasks = self.storage.load_tasks(phase_num)

        if not execution_log:
            return {
                "phase_num": phase_num,
                "status": "not_started",
                "tasks_total": len(tasks) if tasks else 0,
                "tasks_completed": 0,
                "progress_percent": 0,
            }

        completed = sum(1 for log in execution_log if log.get("status") == "completed")
        total = len(tasks) if tasks else len(execution_log)

        return {
            "phase_num": phase_num,
            "status": "in_progress" if completed < total else "completed",
            "tasks_total": total,
            "tasks_completed": completed,
            "progress_percent": int((completed / total * 100) if total > 0 else 0),
            "execution_log": execution_log,
        }

    def _save_execution_log(
        self, phase_num: int, results: List[Dict[str, Any]]
    ) -> None:
        """Save execution log for a phase.

        Args:
            phase_num: Phase number
            results: Execution results
        """
        phase_dir = self.storage.phases_dir / f"phase_{phase_num:02d}"
        phase_dir.mkdir(parents=True, exist_ok=True)
        log_file = phase_dir / "execution.json"

        with open(log_file, "w", encoding="utf-8") as f:
            json.dump(
                {
                    "phase": phase_num,
                    "execution_time": datetime.now().isoformat(),
                    "tasks": results,
                },
                f,
                indent=2,
            )

    def _load_execution_log(self, phase_num: int) -> List[Dict[str, Any]]:
        """Load execution log for a phase.

        Args:
            phase_num: Phase number

        Returns:
            Execution log entries
        """
        phase_dir = self.storage.phases_dir / f"phase_{phase_num:02d}"
        log_file = phase_dir / "execution.json"

        if not log_file.exists():
            return []

        with open(log_file, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data.get("tasks", [])
