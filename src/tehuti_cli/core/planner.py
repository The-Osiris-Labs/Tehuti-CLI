"""ProjectPlanner for Tehuti planning workflow."""

from datetime import datetime
from typing import Optional, Dict, Any, List
from tehuti_cli.providers.llm import TehutiLLM
from tehuti_cli.storage.planning import PlanningStorage
from tehuti_cli.planning import TEMPLATES


class ProjectPlanner:
    """Orchestrates project planning using multi-turn LLM conversations."""

    def __init__(self, llm: TehutiLLM, storage: PlanningStorage):
        """Initialize project planner.

        Args:
            llm: TehutiLLM instance for multi-turn conversations
            storage: PlanningStorage instance for artifact persistence
        """
        self.llm = llm
        self.storage = storage
        self.project_name: Optional[str] = None
        self.conversation_history: List[Dict[str, str]] = []

    def architect_project(self) -> Dict[str, Any]:
        """Run full project architecture workflow with interactive questions.

        This multi-turn conversation gathers:
        1. Project vision and goals
        2. Success criteria and constraints
        3. Tech stack and dependencies
        4. Known risks and edge cases

        Returns:
            Dict with generated artifacts (PROJECT, REQUIREMENTS, ROADMAP metadata)
        """
        # Phase 1: Gather project basics
        self._print_section("🏛️ PROJECT ARCHITECTURE")

        self.project_name = self._ask("What is the name of your project?")
        vision = self._ask(
            "Describe the vision/purpose of this project in 2-3 sentences:"
        )
        goals = self._ask("What are the main goals? (list 3-5 key objectives)")

        # Phase 2: Understand constraints
        tech_stack = self._ask(
            "What is your tech stack? (languages, frameworks, platforms)"
        )
        constraints = self._ask(
            "What are the main constraints? (time, budget, resources, scope)"
        )

        # Phase 3: Risk assessment
        success_criteria = self._ask(
            "How will you measure success? (define 3-5 measurable criteria)"
        )
        risks = self._ask("What are the top risks and how will you mitigate them?")
        edge_cases = self._ask(
            "What edge cases or corner scenarios need to be handled?"
        )

        # Generate PROJECT artifact
        project_md = TEMPLATES["PROJECT"].format(
            title=self.project_name,
            created=datetime.now().isoformat(),
            status="planning",
            vision=vision,
            goals=goals,
            success_criteria=success_criteria,
            tech_stack=tech_stack,
            constraints=constraints,
            risks=risks,
        )
        self.storage.save_artifact("PROJECT", project_md)

        # Phase 4: Generate requirements with LLM
        self._print_section("📋 REQUIREMENTS")

        requirements_prompt = f"""Based on this project information, generate functional and non-functional requirements:

Project: {self.project_name}
Vision: {vision}
Goals: {goals}
Tech Stack: {tech_stack}
Constraints: {constraints}
Edge Cases: {edge_cases}

Provide:
1. Functional requirements (what the system must do)
2. Non-functional requirements (performance, security, scalability)
3. Key dependencies and integrations
4. Critical assumptions

Format as clear, numbered lists."""

        requirements_text = self._ask_llm(requirements_prompt)

        requirements_md = TEMPLATES["REQUIREMENTS"].format(
            project_title=self.project_name,
            created=datetime.now().isoformat(),
            phase_count=3,
            functional_requirements=requirements_text,
            non_functional_requirements="(See above)",
            dependencies="(See above)",
            edge_cases=edge_cases,
        )
        self.storage.save_artifact("REQUIREMENTS", requirements_md)

        # Phase 5: Generate roadmap with LLM
        self._print_section("🗺️ ROADMAP")

        roadmap_prompt = f"""Create a phased execution roadmap for this project:

Project: {self.project_name}
Goals: {goals}
Constraints: {constraints}

Generate:
1. Phase breakdown (typically 2-4 phases)
2. What gets delivered in each phase (minimum viable increments)
3. Phase dependencies and sequencing
4. Estimated scope per phase (rough)
5. Risk mitigation strategy per phase

Format as clear phases with delivery goals."""

        roadmap_text = self._ask_llm(roadmap_prompt)

        roadmap_md = TEMPLATES["ROADMAP"].format(
            project_title=self.project_name,
            created=datetime.now().isoformat(),
            phase_count=3,
            phase_overview=roadmap_text,
            phases=roadmap_text,
            milestones="(See phase breakdown)",
            resources="(See constraints)",
            risk_mitigation="(See risk mitigation strategy)",
        )
        self.storage.save_artifact("ROADMAP", roadmap_md)

        # Initialize storage and metadata
        self.storage.init_project(self.project_name)
        self.storage.update_metadata(
            status="planning_complete", vision=vision, goals=goals
        )

        self._print_section("✅ Architecture Complete")
        self._print_message(
            f"Project '{self.project_name}' artifacts created in .planning/current/"
        )

        return {
            "project_name": self.project_name,
            "artifacts": ["PROJECT.md", "REQUIREMENTS.md", "ROADMAP.md"],
            "status": "ready_for_planning",
        }

    def plan_phase(self, phase_num: int) -> Dict[str, Any]:
        """Plan a specific phase with task breakdown.

        Args:
            phase_num: Phase number to plan

        Returns:
            Dict with phase plan and tasks
        """
        # Load project context
        metadata = self.storage.load_metadata()
        if not metadata:
            raise ValueError("No project initialized. Run /thoth:architect first.")

        project_name = metadata.get("project_name")
        roadmap = self.storage.load_artifact("ROADMAP")
        requirements = self.storage.load_artifact("REQUIREMENTS")

        self._print_section(f"📋 PLANNING PHASE {phase_num}")

        # Get phase description from user or roadmap
        phase_goal = self._ask(f"What is the goal for Phase {phase_num}?")

        # Generate task breakdown with LLM
        task_prompt = f"""Based on this project and phase, generate an atomic task breakdown:

Project: {project_name}
Phase: {phase_num}
Goal: {phase_goal}

Project Requirements:
{requirements}

Context:
{roadmap}

Generate:
1. 5-10 atomic tasks that achieve the phase goal
2. For each task: title, description, estimated scope
3. Task dependencies (which tasks must complete before others)
4. Verification steps for this phase

Format as structured list with dependencies clearly marked."""

        tasks_text = self._ask_llm(task_prompt)

        # Parse tasks from LLM response (basic parsing)
        tasks = self._parse_tasks_from_llm(tasks_text)

        # Generate phase plan artifact
        phase_plan = TEMPLATES["PHASE_PLAN"].format(
            phase_name=f"Phase {phase_num}",
            project_title=project_name,
            phase_number=phase_num,
            created=datetime.now().isoformat(),
            status="planned",
            goal=phase_goal,
            research=requirements,
            tasks=tasks_text,
            dependencies="(See task list above)",
            verification=f"Complete all tasks in Phase {phase_num} and verify with project goals.",
            rollback="Use git to revert to previous checkpoint if needed.",
        )

        self.storage.save_artifact("PHASE_PLAN", phase_plan, phase_num)
        self.storage.save_tasks(tasks, phase_num)

        self._print_section(f"✅ Phase {phase_num} Plan Complete")
        self._print_message(
            f"Tasks: {len(tasks)} | Location: .planning/current/phases/phase_{phase_num}/"
        )

        return {
            "phase_num": phase_num,
            "goal": phase_goal,
            "task_count": len(tasks),
            "tasks": tasks,
            "status": "ready_for_execution",
        }

    def reflect_project(self) -> Dict[str, Any]:
        """Reflect on and review a loaded project.

        Returns:
            Dict with project summary and status
        """
        metadata = self.storage.load_metadata()
        if not metadata:
            raise ValueError("No project initialized. Run /thoth:architect first.")

        project_name = metadata.get("project_name")

        self._print_section(f"🪞 REFLECTING ON {project_name}")

        # Load all artifacts
        project = self.storage.load_artifact("PROJECT")
        requirements = self.storage.load_artifact("REQUIREMENTS")
        roadmap = self.storage.load_artifact("ROADMAP")
        state = self.storage.load_artifact("STATE")

        self._print_message(f"Project: {project_name}")
        self._print_message(f"Status: {metadata.get('status')}")
        self._print_message(f"Created: {metadata.get('created')}")

        phases = self.storage.list_phases()
        self._print_message(f"Planned Phases: {len(phases)}")

        return {
            "project_name": project_name,
            "status": metadata.get("status"),
            "phases_count": len(phases),
            "artifacts_loaded": bool(project and requirements and roadmap),
        }

    def _ask(self, question: str) -> str:
        """Ask user a question and get response.

        Args:
            question: Question to ask

        Returns:
            User response
        """
        self._print_message(f"\n❓ {question}")
        response = input("→ ").strip()
        return response

    def _ask_llm(self, prompt: str) -> str:
        """Ask LLM a question and get response.

        Args:
            prompt: Prompt for LLM

        Returns:
            LLM response
        """
        self._print_message(f"\n🤖 Generating...")

        # Add to conversation history
        self.conversation_history.append({"role": "user", "content": prompt})

        response = self.llm.chat_messages([{"role": "user", "content": prompt}])

        self.conversation_history.append({"role": "assistant", "content": response})

        return response

    def _parse_tasks_from_llm(self, text: str) -> List[Dict[str, Any]]:
        """Parse tasks from LLM response.

        Args:
            text: LLM response containing task breakdown

        Returns:
            List of task dicts
        """
        # Basic parsing: split by numbered lines
        tasks = []
        lines = text.split("\n")
        current_task = None

        for line in lines:
            line = line.strip()
            if not line:
                continue

            # Check if line starts with number (task title)
            if line and line[0].isdigit() and "." in line:
                if current_task:
                    tasks.append(current_task)

                # Extract task title (remove numbering)
                title = line.split(".", 1)[1].strip() if "." in line else line
                current_task = {
                    "id": f"task_{len(tasks) + 1}",
                    "title": title,
                    "description": "",
                    "dependencies": [],
                }
            elif current_task and (
                "depends on" in line.lower() or "requires" in line.lower()
            ):
                current_task["dependencies"] = [d.strip() for d in line.split(",")]
            elif current_task:
                current_task["description"] += line + " "

        if current_task:
            tasks.append(current_task)

        return tasks

    def _print_section(self, title: str) -> None:
        """Print a section header."""
        self._print_message(f"\n{'=' * 60}")
        self._print_message(f"{title}")
        self._print_message(f"{'=' * 60}")

    def _print_message(self, msg: str) -> None:
        """Print a message."""
        print(msg)
