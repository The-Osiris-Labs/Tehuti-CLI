from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any

from tehuti_cli.storage.config import Config


class BlueprintStatus(Enum):
    DRAFT = "draft"
    ACTIVE = "active"
    COMPLETED = "completed"
    ARCHIVED = "archived"


class BlueprintSectionType(Enum):
    FEATURE = "feature"
    COMPONENT = "component"
    API = "api"
    DATABASE = "database"
    UI = "ui"
    WORKFLOW = "workflow"
    REQUIREMENT = "requirement"
    MILESTONE = "milestone"
    NOTE = "note"


@dataclass
class BlueprintSection:
    id: str
    title: str
    section_type: BlueprintSectionType
    content: str = ""
    priority: int = 0
    parent_id: str | None = None
    children_ids: list[str] = field(default_factory=list)
    status: BlueprintStatus = BlueprintStatus.DRAFT
    created_at: datetime = field(default_factory=datetime.now)
    updated_at: datetime = field(default_factory=datetime.now)
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "section_type": self.section_type.value,
            "content": self.content,
            "priority": self.priority,
            "parent_id": self.parent_id,
            "children_ids": self.children_ids,
            "status": self.status.value,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "metadata": self.metadata,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "BlueprintSection":
        return cls(
            id=data["id"],
            title=data["title"],
            section_type=BlueprintSectionType(data["section_type"]),
            content=data.get("content", ""),
            priority=data.get("priority", 0),
            parent_id=data.get("parent_id"),
            children_ids=data.get("children_ids", []),
            status=BlueprintStatus(data.get("status", "draft")),
            created_at=datetime.fromisoformat(data["created_at"]) if "created_at" in data else datetime.now(),
            updated_at=datetime.fromisoformat(data["updated_at"]) if "updated_at" in data else datetime.now(),
            metadata=data.get("metadata", {}),
        )


@dataclass
class Blueprint:
    id: str
    name: str
    description: str = ""
    version: str = "1.0.0"
    status: BlueprintStatus = BlueprintStatus.DRAFT
    sections: dict[str, BlueprintSection] = field(default_factory=dict)
    root_section_ids: list[str] = field(default_factory=list)
    created_at: datetime = field(default_factory=datetime.now)
    updated_at: datetime = field(default_factory=datetime.now)
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "version": self.version,
            "status": self.status.value,
            "sections": {k: v.to_dict() for k, v in self.sections.items()},
            "root_section_ids": self.root_section_ids,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "metadata": self.metadata,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Blueprint":
        blueprint = cls(
            id=data["id"],
            name=data["name"],
            description=data.get("description", ""),
            version=data.get("version", "1.0.0"),
            status=BlueprintStatus(data.get("status", "draft")),
            root_section_ids=data.get("root_section_ids", []),
            created_at=datetime.fromisoformat(data["created_at"]) if "created_at" in data else datetime.now(),
            updated_at=datetime.fromisoformat(data["updated_at"]) if "updated_at" in data else datetime.now(),
            metadata=data.get("metadata", {}),
        )
        blueprint.sections = {k: BlueprintSection.from_dict(v) for k, v in data.get("sections", {}).items()}
        return blueprint


class BlueprintManager:
    def __init__(self, config: Config, work_dir: Path):
        self.config = config
        self.work_dir = work_dir
        self.blueprints: dict[str, Blueprint] = {}
        self.state_file = work_dir / ".tehuti" / "blueprints.json"
        self.state_file.parent.mkdir(parents=True, exist_ok=True)
        self._load_state()

    def _load_state(self) -> None:
        if self.state_file.exists():
            try:
                data = json.loads(self.state_file.read_text())
                self.blueprints = {k: Blueprint.from_dict(v) for k, v in data.items()}
            except Exception:
                self.blueprints = {}

    def _save_state(self) -> None:
        data = {k: v.to_dict() for k, v in self.blueprints.items()}
        self.state_file.write_text(json.dumps(data, indent=2))

    def create_blueprint(
        self,
        name: str,
        description: str = "",
        version: str = "1.0.0",
        metadata: dict[str, Any] | None = None,
    ) -> str:
        blueprint_id = str(uuid.uuid4())[:8]
        blueprint = Blueprint(
            id=blueprint_id,
            name=name,
            description=description,
            version=version,
            metadata=metadata or {},
        )
        self.blueprints[blueprint_id] = blueprint
        self._save_state()
        return blueprint_id

    def get_blueprint(self, blueprint_id: str) -> Blueprint | None:
        return self.blueprints.get(blueprint_id)

    def update_blueprint(
        self,
        blueprint_id: str,
        name: str | None = None,
        description: str | None = None,
        version: str | None = None,
        status: BlueprintStatus | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> bool:
        blueprint = self.blueprints.get(blueprint_id)
        if not blueprint:
            return False

        if name is not None:
            blueprint.name = name
        if description is not None:
            blueprint.description = description
        if version is not None:
            blueprint.version = version
        if status is not None:
            blueprint.status = status
        if metadata is not None:
            blueprint.metadata.update(metadata)

        blueprint.updated_at = datetime.now()
        self._save_state()
        return True

    def add_section(
        self,
        blueprint_id: str,
        title: str,
        section_type: BlueprintSectionType,
        content: str = "",
        priority: int = 0,
        parent_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> str | None:
        blueprint = self.blueprints.get(blueprint_id)
        if not blueprint:
            return None

        section_id = str(uuid.uuid4())[:8]
        section = BlueprintSection(
            id=section_id,
            title=title,
            section_type=section_type,
            content=content,
            priority=priority,
            parent_id=parent_id,
            metadata=metadata or {},
        )

        if parent_id and parent_id in blueprint.sections:
            blueprint.sections[parent_id].children_ids.append(section_id)
        else:
            blueprint.root_section_ids.append(section_id)

        blueprint.sections[section_id] = section
        blueprint.updated_at = datetime.now()
        self._save_state()
        return section_id

    def update_section(
        self,
        blueprint_id: str,
        section_id: str,
        title: str | None = None,
        content: str | None = None,
        priority: int | None = None,
        status: BlueprintStatus | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> bool:
        blueprint = self.blueprints.get(blueprint_id)
        if not blueprint:
            return False

        section = blueprint.sections.get(section_id)
        if not section:
            return False

        if title is not None:
            section.title = title
        if content is not None:
            section.content = content
        if priority is not None:
            section.priority = priority
        if status is not None:
            section.status = status
        if metadata is not None:
            section.metadata.update(metadata)

        section.updated_at = datetime.now()
        blueprint.updated_at = datetime.now()
        self._save_state()
        return True

    def get_section_tree(self, blueprint_id: str, section_id: str | None = None) -> list[BlueprintSection]:
        blueprint = self.blueprints.get(blueprint_id)
        if not blueprint:
            return []

        if section_id:
            root_ids = [section_id]
        else:
            root_ids = blueprint.root_section_ids

        tree = []
        for root_id in root_ids:
            section = blueprint.sections.get(root_id)
            if section:
                tree.append(section)
                stack = list(section.children_ids)
                while stack:
                    child_id = stack.pop()
                    child = blueprint.sections.get(child_id)
                    if child:
                        tree.append(child)
                        stack.extend(child.children_ids)

        return tree

    def get_sections_by_type(
        self,
        blueprint_id: str,
        section_type: BlueprintSectionType,
    ) -> list[BlueprintSection]:
        blueprint = self.blueprints.get(blueprint_id)
        if not blueprint:
            return []

        return [s for s in blueprint.sections.values() if s.section_type == section_type]

    def generate_markdown(self, blueprint_id: str) -> str:
        blueprint = self.blueprints.get(blueprint_id)
        if not blueprint:
            return ""

        lines = [
            f"# {blueprint.name}",
            "",
            f"**Version:** {blueprint.version}",
            f"**Status:** {blueprint.status.value}",
            "",
            f"_{blueprint.description}_" if blueprint.description else "",
            "",
            "---",
            "",
        ]

        def render_section(section_id: str, indent: int = 0) -> list[str]:
            section = blueprint.sections.get(section_id)
            if not section:
                return []

            prefix = "  " * indent
            lines_out = [
                f"{prefix}## {section.title}",
                "",
                f"{section.content}",
                "",
            ]

            for child_id in section.children_ids:
                lines_out.extend(render_section(child_id, indent + 1))

            return lines_out

        for root_id in blueprint.root_section_ids:
            lines.extend(render_section(root_id))

        return "\n".join(lines)

    def export_to_file(self, blueprint_id: str, output_path: Path | None = None) -> str:
        markdown = self.generate_markdown(blueprint_id)
        if output_path:
            output_path.parent.mkdir(parents=True, exist_ok=True)
            output_path.write_text(markdown, encoding="utf-8")
        return markdown

    def list_blueprints(self, status: BlueprintStatus | None = None) -> list[Blueprint]:
        results = list(self.blueprints.values())
        if status:
            results = [b for b in results if b.status == status]
        return sorted(results, key=lambda b: b.updated_at, reverse=True)

    def get_statistics(self, blueprint_id: str) -> dict[str, Any]:
        blueprint = self.blueprints.get(blueprint_id)
        if not blueprint:
            return {}

        sections = list(blueprint.sections.values())
        by_type: dict[str, int] = {}
        by_status: dict[str, int] = {}

        for section in sections:
            type_key = section.section_type.value
            status_key = section.status.value
            by_type[type_key] = by_type.get(type_key, 0) + 1
            by_status[status_key] = by_status.get(status_key, 0) + 1

        return {
            "total_sections": len(sections),
            "by_type": by_type,
            "by_status": by_status,
            "completion_percentage": ((by_status.get("completed", 0) / len(sections) * 100) if sections else 0),
        }

    def clear_all(self) -> None:
        self.blueprints.clear()
        self._save_state()
