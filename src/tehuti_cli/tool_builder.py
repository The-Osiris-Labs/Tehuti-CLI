"""
Tehuti Tool Builder - Create Custom Tools at Runtime

Provides tools for:
- Creating custom shell-based tools
- Creating custom Python-based tools
- Tool registration and management
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

from tehuti_cli.storage.config import Config
from tehuti_cli.advanced_tools import ToolResult


class ToolBuilder:
    """Build and manage custom tools."""

    def __init__(self, config: Config, work_dir: Path):
        self.config = config
        self.work_dir = work_dir.resolve()
        self._custom_tools: dict[str, dict] = {}

    def tool_create_shell(
        self,
        name: str,
        command: str,
        description: str,
        arguments: list[dict] | None = None,
        output_file: str | None = None,
    ) -> ToolResult:
        """Create a custom shell-based tool."""
        tools_file = output_file or str(self.config.external_tools_file)

        try:
            existing = {}
            if Path(tools_file).exists():
                existing = json.loads(Path(tools_file).read_text())

            if "tools" not in existing:
                existing["tools"] = []

            tool_entry = {
                "name": name,
                "description": description,
                "command": command,
                "type": "shell",
                "arguments": arguments or [],
            }

            existing["tools"].append(tool_entry)

            Path(tools_file).parent.mkdir(parents=True, exist_ok=True)
            Path(tools_file).write_text(json.dumps(existing, indent=2))

            output = f"## Custom Tool Created\n\n"
            output += f"**Name:** {name}\n"
            output += f"**Type:** Shell\n"
            output += f"**Command:** {command}\n"
            output += f"**Description:** {description}\n"
            output += f"**Saved to:** {tools_file}\n"

            return ToolResult(True, output)

        except Exception as exc:
            return ToolResult(False, f"Failed to create tool: {exc}")

    def tool_create_python(
        self,
        name: str,
        code: str,
        description: str,
        function_name: str = "run",
        output_file: str | None = None,
    ) -> ToolResult:
        """Create a custom Python-based tool."""
        import tempfile

        tool_code = f'''"""Custom tool: {name}"""

def {function_name}(args: dict) -> dict:
    """{description}"""
    try:
        # Your code here
        return {{"ok": True, "output": "Success"}}
    except Exception as e:
        return {{"ok": False, "output": str(e)}}
'''

        try:
            tools_dir = self.work_dir / ".tehuti_tools"
            tools_dir.mkdir(exist_ok=True)

            tool_file = tools_dir / f"{name.replace('-', '_')}.py"
            tool_file.write_text(tool_code)

            exec_globals = {}
            exec(tool_code, exec_globals)

            output = f"## Python Tool Created\n\n"
            output += f"**Name:** {name}\n"
            output += f"**File:** {tool_file}\n"
            output += f"**Function:** {function_name}\n"
            output += f"**Description:** {description}\n\n"
            output += "```python\n"
            output += tool_code
            output += "\n```\n"

            return ToolResult(True, output)

        except Exception as exc:
            return ToolResult(False, f"Failed to create Python tool: {exc}")

    def tool_create_api(
        self,
        name: str,
        base_url: str,
        endpoints: list[dict],
        description: str,
        output_file: str | None = None,
    ) -> ToolResult:
        """Create a custom API-based tool."""
        tools_file = output_file or str(self.config.external_tools_file)

        try:
            existing = {}
            if Path(tools_file).exists():
                existing = json.loads(Path(tools_file).read_text())

            if "tools" not in existing:
                existing["tools"] = []

            tool_entry = {
                "name": name,
                "description": description,
                "type": "api",
                "base_url": base_url,
                "endpoints": endpoints,
            }

            existing["tools"].append(tool_entry)

            Path(tools_file).parent.mkdir(parents=True, exist_ok=True)
            Path(tools_file).write_text(json.dumps(existing, indent=2))

            output = f"## API Tool Created\n\n"
            output += f"**Name:** {name}\n"
            output += f"**Base URL:** {base_url}\n"
            output += f"**Description:** {description}\n"
            output += f"**Endpoints:** {len(endpoints)}\n"

            return ToolResult(True, output)

        except Exception as exc:
            return ToolResult(False, f"Failed to create API tool: {exc}")

    def tool_list(self) -> ToolResult:
        """List all custom tools."""
        tools_file = str(self.config.external_tools_file)

        if not Path(tools_file).exists():
            return ToolResult(True, "No custom tools configured")

        try:
            data = json.loads(Path(tools_file).read_text())
            tools = data.get("tools", [])

            output = f"## Custom Tools\n\n"
            output += f"**File:** {tools_file}\n"
            output += f"**Total:** {len(tools)}\n\n"

            for tool in tools:
                output += f"### {tool['name']}\n\n"
                output += f"**Type:** {tool.get('type', 'shell')}\n"
                output += f"**Description:** {tool.get('description', 'N/A')}\n"
                output += f"**Command:** {tool.get('command', tool.get('base_url', 'N/A'))}\n\n"

            return ToolResult(True, output)

        except Exception as exc:
            return ToolResult(False, f"Failed to list tools: {exc}")

    def tool_delete(self, name: str) -> ToolResult:
        """Delete a custom tool."""
        tools_file = str(self.config.external_tools_file)

        if not Path(tools_file).exists():
            return ToolResult(False, "No custom tools configured")

        try:
            data = json.loads(Path(tools_file).read_text())
            tools = data.get("tools", [])

            original_count = len(tools)
            tools = [t for t in tools if t.get("name") != name]

            if len(tools) == original_count:
                return ToolResult(False, f"Tool '{name}' not found")

            data["tools"] = tools
            Path(tools_file).write_text(json.dumps(data, indent=2))

            return ToolResult(True, f"Tool '{name}' deleted")

        except Exception as exc:
            return ToolResult(False, f"Failed to delete tool: {exc}")

    def tool_edit(
        self,
        name: str,
        command: str | None = None,
        description: str | None = None,
    ) -> ToolResult:
        """Edit a custom tool."""
        tools_file = str(self.config.external_tools_file)

        if not Path(tools_file).exists():
            return ToolResult(False, "No custom tools configured")

        try:
            data = json.loads(Path(tools_file).read_text())
            tools = data.get("tools", [])

            for tool in tools:
                if tool.get("name") == name:
                    if command is not None:
                        tool["command"] = command
                    if description is not None:
                        tool["description"] = description

                    Path(tools_file).write_text(json.dumps(data, indent=2))

                    return ToolResult(True, f"Tool '{name}' updated")

            return ToolResult(False, f"Tool '{name}' not found")

        except Exception as exc:
            return ToolResult(False, f"Failed to edit tool: {exc}")

    def tool_export(self, name: str, output_path: str) -> ToolResult:
        """Export a custom tool to a file."""
        tools_file = str(self.config.external_tools_file)

        if not Path(tools_file).exists():
            return ToolResult(False, "No custom tools configured")

        try:
            data = json.loads(Path(tools_file).read_text())
            tools = data.get("tools", [])

            for tool in tools:
                if tool.get("name") == name:
                    Path(output_path).write_text(json.dumps(tool, indent=2))

                    return ToolResult(True, f"Tool '{name}' exported to {output_path}")

            return ToolResult(False, f"Tool '{name}' not found")

        except Exception as exc:
            return ToolResult(False, f"Failed to export tool: {exc}")

    def tool_import(self, source_path: str) -> ToolResult:
        """Import a custom tool from a file."""
        tools_file = str(self.config.external_tools_file)

        try:
            tool = json.loads(Path(source_path).read_text())

            if "name" not in tool:
                return ToolResult(False, "Invalid tool format: missing 'name'")

            existing = {}
            if Path(tools_file).exists():
                existing = json.loads(Path(tools_file).read_text())

            if "tools" not in existing:
                existing["tools"] = []

            existing["tools"].append(tool)

            Path(tools_file).parent.mkdir(parents=True, exist_ok=True)
            Path(tools_file).write_text(json.dumps(existing, indent=2))

            return ToolResult(True, f"Tool '{tool['name']}' imported")

        except Exception as exc:
            return ToolResult(False, f"Failed to import tool: {exc}")

    def tool_template(self, tool_type: str) -> ToolResult:
        """Get a template for creating a new tool."""
        templates = {
            "shell": {
                "name": "my-tool",
                "description": "Description of what the tool does",
                "command": "echo {{arg1}}",
                "type": "shell",
                "arguments": [{"name": "arg1", "description": "First argument", "required": True}],
            },
            "python": {
                "template": '''"""My custom tool."""

def run(args: dict) -> dict:
    """Execute the custom tool."""
    try:
        # Your code here
        arg1 = args.get("arg1", "")
        return {"ok": True, "output": f"Processed: {arg1}"}
    except Exception as e:
        return {"ok": False, "output": str(e)}
''',
            },
            "api": {
                "name": "my-api-tool",
                "description": "Tool for interacting with an API",
                "type": "api",
                "base_url": "https://api.example.com",
                "endpoints": [
                    {
                        "name": "get_data",
                        "method": "GET",
                        "path": "/data",
                        "description": "Get data from API",
                    }
                ],
            },
        }

        if tool_type not in templates:
            available = ", ".join(templates.keys())
            return ToolResult(False, f"Unknown template type: {tool_type}. Available: {available}")

        output = f"## Tool Template: {tool_type}\n\n"
        output += "```json\n"
        output += json.dumps(templates[tool_type], indent=2)
        output += "\n```\n"

        return ToolResult(True, output)

    def tool_clone(
        self,
        source_name: str,
        new_name: str,
        new_description: str | None = None,
    ) -> ToolResult:
        """Clone an existing custom tool."""
        tools_file = str(self.config.external_tools_file)

        if not Path(tools_file).exists():
            return ToolResult(False, "No custom tools configured")

        try:
            data = json.loads(Path(tools_file).read_text())
            tools = data.get("tools", [])

            for tool in tools:
                if tool.get("name") == source_name:
                    new_tool = tool.copy()
                    new_tool["name"] = new_name
                    new_tool["description"] = new_description or tool.get("description", "")

                    tools.append(new_tool)

                    Path(tools_file).write_text(json.dumps(data, indent=2))

                    return ToolResult(True, f"Tool '{source_name}' cloned as '{new_name}'")

            return ToolResult(False, f"Tool '{source_name}' not found")

        except Exception as exc:
            return ToolResult(False, f"Failed to clone tool: {exc}")

    def tool_validate(self, name: str) -> ToolResult:
        """Validate a custom tool configuration."""
        tools_file = str(self.config.external_tools_file)

        if not Path(tools_file).exists():
            return ToolResult(False, "No custom tools configured")

        try:
            data = json.loads(Path(tools_file).read_text())
            tools = data.get("tools", [])

            for tool in tools:
                if tool.get("name") == name:
                    issues = []

                    if "name" not in tool:
                        issues.append("Missing 'name'")
                    if "command" not in tool:
                        issues.append("Missing 'command'")

                    if issues:
                        return ToolResult(False, f"Validation failed: {', '.join(issues)}")

                    return ToolResult(True, f"Tool '{name}' is valid")

            return ToolResult(False, f"Tool '{name}' not found")

        except Exception as exc:
            return ToolResult(False, f"Validation failed: {exc}")
