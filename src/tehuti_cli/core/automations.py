from __future__ import annotations

import json
import re
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any

from tehuti_cli.storage.config import Config


class TriggerType(Enum):
    COMMAND = "command"
    FILE_CHANGE = "file_change"
    TOOL_CALLED = "tool_called"
    TIME = "time"
    CONTEXT_LOADED = "context_loaded"


class ActionType(Enum):
    RUN_COMMAND = "run_command"
    CALL_TOOL = "call_tool"
    NOTIFY = "notify"
    LOG = "log"
    SET_CONTEXT = "set_context"


class AutomationState(Enum):
    ACTIVE = "active"
    PAUSED = "paused"
    DISABLED = "disabled"


@dataclass
class Trigger:
    trigger_type: TriggerType
    condition: str
    params: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "trigger_type": self.trigger_type.value,
            "condition": self.condition,
            "params": self.params,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Trigger":
        return cls(
            trigger_type=TriggerType(data["trigger_type"]),
            condition=data["condition"],
            params=data.get("params", {}),
        )

    def matches(self, context: dict[str, Any]) -> bool:
        try:
            return bool(self._evaluate_condition(context))
        except Exception:
            return False

    def _evaluate_condition(self, context: dict[str, Any]) -> Any:
        condition = self.condition
        for key, value in context.items():
            if isinstance(value, str):
                placeholder = f"{{{{{key}}}}}"
                condition = condition.replace(placeholder, repr(value))
        result = eval(condition, {"re": re}, {})
        return result


@dataclass
class Action:
    action_type: ActionType
    params: dict[str, Any] = field(default_factory=dict)
    continue_on_failure: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "action_type": self.action_type.value,
            "params": self.params,
            "continue_on_failure": self.continue_on_failure,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Action":
        return cls(
            action_type=ActionType(data["action_type"]),
            params=data.get("params", {}),
            continue_on_failure=data.get("continue_on_failure", False),
        )


@dataclass
class Automation:
    id: str
    name: str
    description: str = ""
    triggers: list[Trigger] = field(default_factory=list)
    actions: list[Action] = field(default_factory=list)
    state: AutomationState = AutomationState.ACTIVE
    run_count: int = 0
    last_run: datetime | None = None
    created_at: datetime = field(default_factory=datetime.now)
    updated_at: datetime = field(default_factory=datetime.now)
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "triggers": [t.to_dict() for t in self.triggers],
            "actions": [a.to_dict() for a in self.actions],
            "state": self.state.value,
            "run_count": self.run_count,
            "last_run": self.last_run.isoformat() if self.last_run else None,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "metadata": self.metadata,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Automation":
        return cls(
            id=data["id"],
            name=data["name"],
            description=data.get("description", ""),
            triggers=[Trigger.from_dict(t) for t in data.get("triggers", [])],
            actions=[Action.from_dict(a) for a in data.get("actions", [])],
            state=AutomationState(data.get("state", "active")),
            run_count=data.get("run_count", 0),
            last_run=datetime.fromisoformat(data["last_run"]) if data.get("last_run") else None,
            created_at=datetime.fromisoformat(data["created_at"]) if "created_at" in data else datetime.now(),
            updated_at=datetime.fromisoformat(data["updated_at"]) if "updated_at" in data else datetime.now(),
            metadata=data.get("metadata", {}),
        )


class AutomationManager:
    def __init__(self, config: Config, work_dir: Path):
        self.config = config
        self.work_dir = work_dir
        self.automations: dict[str, Automation] = {}
        self.state_file = work_dir / ".tehuti" / "automations.json"
        self.state_file.parent.mkdir(parents=True, exist_ok=True)
        self._load_state()

    def _load_state(self) -> None:
        if self.state_file.exists():
            try:
                data = json.loads(self.state_file.read_text())
                self.automations = {k: Automation.from_dict(v) for k, v in data.items()}
            except Exception:
                self.automations = {}

    def _save_state(self) -> None:
        data = {k: v.to_dict() for k, v in self.automations.items()}
        self.state_file.write_text(json.dumps(data, indent=2))

    def create_automation(
        self,
        name: str,
        description: str = "",
        triggers: list[Trigger] | None = None,
        actions: list[Action] | None = None,
        state: AutomationState = AutomationState.ACTIVE,
        metadata: dict[str, Any] | None = None,
    ) -> str:
        automation_id = str(uuid.uuid4())[:8]
        automation = Automation(
            id=automation_id,
            name=name,
            description=description,
            triggers=triggers or [],
            actions=actions or [],
            state=state,
            metadata=metadata or {},
        )
        self.automations[automation_id] = automation
        self._save_state()
        return automation_id

    def get_automation(self, automation_id: str) -> Automation | None:
        return self.automations.get(automation_id)

    def update_automation(
        self,
        automation_id: str,
        name: str | None = None,
        description: str | None = None,
        state: AutomationState | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> bool:
        automation = self.automations.get(automation_id)
        if not automation:
            return False

        if name is not None:
            automation.name = name
        if description is not None:
            automation.description = description
        if state is not None:
            automation.state = state
        if metadata is not None:
            automation.metadata.update(metadata)

        automation.updated_at = datetime.now()
        self._save_state()
        return True

    def add_trigger(self, automation_id: str, trigger: Trigger) -> bool:
        automation = self.automations.get(automation_id)
        if not automation:
            return False
        automation.triggers.append(trigger)
        automation.updated_at = datetime.now()
        self._save_state()
        return True

    def add_action(self, automation_id: str, action: Action) -> bool:
        automation = self.automations.get(automation_id)
        if not automation:
            return False
        automation.actions.append(action)
        automation.updated_at = datetime.now()
        self._save_state()
        return True

    def check_triggers(self, context: dict[str, Any]) -> list[Automation]:
        triggered = []
        for automation in self.automations.values():
            if automation.state != AutomationState.ACTIVE:
                continue
            all_match = True
            for trigger in automation.triggers:
                if not trigger.matches(context):
                    all_match = False
                    break
            if all_match:
                triggered.append(automation)
        return triggered

    def execute_automation(self, automation: Automation, context: dict[str, Any]) -> dict[str, Any]:
        results: list[dict[str, Any]] = []
        success = True

        for action in automation.actions:
            try:
                result = self._execute_action(action, context)
                results.append({"action": action.action_type.value, "success": True, "result": result})
            except Exception as e:
                results.append({"action": action.action_type.value, "success": False, "error": str(e)})
                if not action.continue_on_failure:
                    success = False
                    break

        automation.run_count += 1
        automation.last_run = datetime.now()
        automation.updated_at = datetime.now()
        self._save_state()

        return {
            "automation_id": automation.id,
            "automation_name": automation.name,
            "success": success,
            "results": results,
            "executed_at": datetime.now().isoformat(),
        }

    def _execute_action(self, action: Action, context: dict[str, Any]) -> Any:
        action_type = action.action_type
        params = action.params.copy()

        for key, value in params.items():
            if isinstance(value, str):
                for ctx_key, ctx_value in context.items():
                    placeholder = f"{{{{{ctx_key}}}}}"
                    if isinstance(ctx_value, str):
                        value = value.replace(placeholder, ctx_value)
                params[key] = value

        match action_type:
            case ActionType.RUN_COMMAND:
                command = params.get("command", "")
                return {"type": "command", "command": command}
            case ActionType.CALL_TOOL:
                tool_name = params.get("tool", "")
                args = params.get("args", {})
                return {"type": "tool_call", "tool": tool_name, "args": args}
            case ActionType.NOTIFY:
                message = params.get("message", "")
                return {"type": "notification", "message": message}
            case ActionType.LOG:
                message = params.get("message", "")
                level = params.get("level", "info")
                return {"type": "log", "message": message, "level": level}
            case ActionType.SET_CONTEXT:
                key = params.get("key", "")
                value = params.get("value", "")
                return {"type": "context_set", "key": key, "value": value}

        return None

    def list_automations(self, state: AutomationState | None = None) -> list[Automation]:
        results = list(self.automations.values())
        if state:
            results = [a for a in results if a.state == state]
        return sorted(results, key=lambda a: a.created_at, reverse=True)

    def delete_automation(self, automation_id: str) -> bool:
        if automation_id in self.automations:
            del self.automations[automation_id]
            self._save_state()
            return True
        return False

    def get_statistics(self) -> dict[str, Any]:
        total = len(self.automations)
        by_state = {s.value: 0 for s in AutomationState}
        total_runs = 0

        for automation in self.automations:
            by_state[automation.state.value] += 1
            total_runs += automation.run_count

        return {
            "total_automations": total,
            "by_state": by_state,
            "total_runs": total_runs,
            "active_count": by_state.get("active", 0),
        }

    def create_default_automations(self) -> None:
        self.create_automation(
            name="Welcome Message",
            description="Shows a welcome message when Tehuti starts",
            triggers=[
                Trigger(
                    trigger_type=TriggerType.COMMAND,
                    condition="True",
                    params={"command": "start"},
                )
            ],
            actions=[
                Action(
                    action_type=ActionType.NOTIFY,
                    params={"message": "Welcome to Tehuti! Use /help to see available commands."},
                )
            ],
            state=AutomationState.PAUSED,
        )

        self.create_automation(
            name="Log Command Usage",
            description="Logs every command execution",
            triggers=[
                Trigger(
                    trigger_type=TriggerType.COMMAND,
                    condition="True",
                    params={},
                )
            ],
            actions=[
                Action(
                    action_type=ActionType.LOG,
                    params={"message": "Command executed: {command}", "level": "debug"},
                )
            ],
            state=AutomationState.PAUSED,
        )

    def clear_all(self) -> None:
        self.automations.clear()
        self._save_state()
