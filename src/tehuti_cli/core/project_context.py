from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from tehuti_cli.storage.config import Config


class ProjectContext:
    PROJECT_FILE = "PROJECT.md"

    def __init__(self, work_dir: Path, config: Config):
        self.work_dir = work_dir
        self.config = config
        self._cached_context: str | None = None
        self._cached_mtime: float | None = None

    @property
    def project_file_path(self) -> Path:
        return self.work_dir / self.PROJECT_FILE

    def exists(self) -> bool:
        return self.project_file_path.exists()

    def load(self, force: bool = False) -> str | None:
        if not self.exists():
            return None

        current_mtime = self.project_file_path.stat().st_mtime
        if not force and self._cached_context and self._cached_mtime == current_mtime:
            return self._cached_context

        try:
            content = self.project_file_path.read_text(encoding="utf-8")
            self._cached_context = content
            self._cached_mtime = current_mtime
            return content
        except Exception:
            return None

    def save(self, content: str) -> bool:
        try:
            self.project_file_path.write_text(content, encoding="utf-8")
            self._cached_context = content
            self._cached_mtime = self.project_file_path.stat().st_mtime
            return True
        except Exception:
            return False

    def extract_sections(self) -> dict[str, str]:
        content = self.load() or ""
        sections: dict[str, str] = {}
        current_header = ""
        current_content = []

        for line in content.split("\n"):
            header_match = re.match(r"^(#{1,3})\s+(.+)$", line)
            if header_match:
                if current_header:
                    sections[current_header] = "\n".join(current_content).strip()
                current_header = header_match.group(2).strip()
                current_content = []
            else:
                current_content.append(line)

        if current_header:
            sections[current_header] = "\n".join(current_content).strip()

        return sections

    def get_personas(self) -> list[dict[str, str]]:
        content = self.load() or ""
        personas: list[dict[str, str]] = []

        persona_pattern = re.compile(
            r"<!--\s*TEHUTI_PERSONA\s*-->\s*\n(.*?)<!--\s*END_PERSONA\s*-->",
            re.DOTALL,
        )

        for match in persona_pattern.finditer(content):
            block = match.group(1).strip()
            name_match = re.search(r"^##\s+(.+)$", block, re.MULTILINE)
            if name_match:
                personas.append(
                    {
                        "name": name_match.group(1).strip(),
                        "content": block,
                    }
                )

        return personas

    def get_global_rules(self) -> list[str]:
        sections = self.extract_sections()
        rules_section = sections.get("Global Rules", "") or sections.get("Rules", "") or ""
        rules = []
        for line in rules_section.split("\n"):
            line = line.strip()
            if line.startswith("- ") or line.startswith("* "):
                rules.append(line[2:].strip())
            elif line and not line.startswith("#"):
                rules.append(line)
        return rules

    def get_code_patterns(self) -> dict[str, list[str]]:
        sections = self.extract_sections()
        patterns: dict[str, list[str]] = {}

        for section_name, content in sections.items():
            if "code" in section_name.lower() or "pattern" in section_name.lower():
                patterns[section_name] = []
                for line in content.split("\n"):
                    if "```" in line:
                        continue
                    line = line.strip()
                    if line and not line.startswith("#"):
                        patterns[section_name].append(line)

        return patterns

    def get_context_for_prompt(self, category: str | None = None) -> str:
        content = self.load()
        if not content:
            return ""

        if category:
            sections = self.extract_sections()
            relevant = []
            for header, section_content in sections.items():
                if category.lower() in header.lower():
                    relevant.append(f"## {header}\n{section_content}")
            return "\n\n".join(relevant) if relevant else ""

        return content

    def validate(self) -> tuple[bool, list[str]]:
        content = self.load()
        if not content:
            return True, []

        errors: list[str] = []
        lines = content.split("\n")

        in_code_block = False
        for i, line in enumerate(lines, 1):
            if line.strip().startswith("```"):
                in_code_block = not in_code_block
                continue

            if not in_code_block:
                if len(line) > 200:
                    errors.append(f"Line {i}: Line too long (>200 characters)")

        return len(errors) == 0, errors

    def create_default(self) -> str:
        default_content = '''# Project Context

## Overview
Brief description of this project and its purpose.

## Architecture
High-level architecture and technology stack.

## Coding Conventions
- Language: 
- Style guide:
- Key patterns to follow:

## Global Rules
- Always prefer existing code patterns over creating new ones
- Write tests before implementing new features
- Document complex logic with comments

## Personas

<!-- TEHUTI_PERSONA -->
## Backend Developer
Focus on API design, database schema, and server-side logic.
<!-- END_PERSONA -->

<!-- TEHUTI_PERSONA -->
## Frontend Developer
Focus on UI/UX, component design, and user experience.
<!-- END_PERSONA -->

## Code Patterns

### Python
```python
def example_function(param: type) -> return_type:
    """Brief description."""
    # Implementation
    pass
```

### TypeScript
```typescript
interface ExampleInterface {
    property: Type;
    method(): ReturnType;
}
```

## Commands

### Development
```bash
# Start dev server
npm run dev

# Run tests
npm test

# Build for production
npm run build
```

## Environment Variables
| Variable | Description | Default |
|----------|-------------|---------|
| `API_URL` | Backend API URL | `http://localhost:3000` |
| `NODE_ENV` | Environment | `development` |
'''
        return default_content

    def get_summary(self) -> dict[str, Any]:
        content = self.load() or ""
        lines = content.split("\n")
        header_lines = [l for l in lines if l.startswith("#")]
        sections = self.extract_sections()

        return {
            "exists": self.exists(),
            "file_path": str(self.project_file_path),
            "line_count": len(lines),
            "header_count": len(header_lines),
            "section_count": len(sections),
            "sections": list(sections.keys()),
            "persona_count": len(self.get_personas()),
            "rule_count": len(self.get_global_rules()),
        }
