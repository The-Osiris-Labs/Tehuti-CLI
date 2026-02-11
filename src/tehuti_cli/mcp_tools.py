"""
Tehuti MCP Tools - Model Context Protocol Integration

Provides tools for:
- MCP server connections and management
- Tool discovery and invocation
- Resource handling
- Prompt templates
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

from tehuti_cli.storage.config import Config
from tehuti_cli.advanced_tools import ToolResult


@dataclass
class MCPServerConfig:
    """MCP server configuration."""

    name: str
    command: str
    args: list[str] = field(default_factory=list)
    env: dict[str, str] = field(default_factory=dict)


class MCPTools:
    """MCP (Model Context Protocol) client tools."""

    def __init__(self, config: Config, work_dir: Path):
        self.config = config
        self.work_dir = work_dir.resolve()
        self._servers: dict[str, Any] = {}
        self._clients: dict[str, Any] = {}

    def mcp_list_servers(self) -> ToolResult:
        """List configured MCP servers."""
        mcp_file = self.config.mcp_file

        if not mcp_file.exists():
            return ToolResult(True, "No MCP servers configured. Create ~/.tehuti/mcp.json")

        try:
            data = json.loads(mcp_file.read_text())
            servers = data.get("servers", {})

            output = f"## MCP Servers\n\n"
            output += f"**Config file:** {mcp_file}\n"
            output += f"**Total servers:** {len(servers)}\n\n"

            for name, config in servers.items():
                cmd = config.get("command", "")
                args = config.get("args", [])
                output += f"### {name}\n\n"
                output += f"**Command:** {cmd}\n"
                output += f"**Args:** {args}\n"
                output += f"**Status:** {'Connected' if name in self._servers else 'Not connected'}\n\n"

            return ToolResult(True, output)

        except Exception as exc:
            return ToolResult(False, f"Failed to read MCP config: {exc}")

    def mcp_connect(
        self,
        server_name: str,
        command: str,
        args: list[str] | None = None,
        env_vars: dict[str, str] | None = None,
    ) -> ToolResult:
        """Connect to an MCP server."""
        try:
            import asyncio
            from mcp import ClientSession, StdioServerParameters
            from mcp.client.stdio import stdio_client

            if server_name in self._servers:
                return ToolResult(False, f"Server '{server_name}' already connected")

            server_params = StdioServerParameters(
                command=command,
                args=args or [],
                env=env_vars or {},
            )

            async def connect():
                stdio_transport = stdio_client(server_params)
                async with stdio_transport as (read, write):
                    async with ClientSession(read, write) as session:
                        await session.initialize()
                        tools = await session.list_tools()
                        self._servers[server_name] = {
                            "session": session,
                            "tools": [t.name for t in tools],
                        }
                        return tools

            tools = asyncio.run(connect())

            output = f"## MCP Server Connected\n\n"
            output += f"**Server:** {server_name}\n"
            output += f"**Command:** {command}\n"
            output += f"**Tools available:** {len(tools)}\n\n"

            for tool in tools:
                output += f"- {tool.name}: {tool.description}\n"

            return ToolResult(True, output)

        except ImportError:
            return ToolResult(
                False,
                "MCP not installed. Install with: pip install mcp",
            )
        except Exception as exc:
            return ToolResult(False, f"Failed to connect to MCP server: {exc}")

    def mcp_disconnect(self, server_name: str) -> ToolResult:
        """Disconnect from an MCP server."""
        if server_name not in self._servers:
            return ToolResult(False, f"Server '{server_name}' not connected")

        try:
            del self._servers[server_name]

            return ToolResult(True, f"Disconnected from '{server_name}'")

        except Exception as exc:
            return ToolResult(False, f"Failed to disconnect: {exc}")

    def mcp_list_tools(self, server_name: str | None = None) -> ToolResult:
        """List available tools from MCP servers."""
        if server_name:
            if server_name not in self._servers:
                return ToolResult(False, f"Server '{server_name}' not connected")

            tools = self._servers[server_name].get("tools", [])

            output = f"## MCP Tools: {server_name}\n\n"
            output += f"**Total:** {len(tools)}\n\n"

            for tool in tools:
                output += f"- {tool}\n"

            return ToolResult(True, output)

        all_tools = {}
        for name, server in self._servers.items():
            all_tools[name] = server.get("tools", [])

        if not all_tools:
            return ToolResult(True, "No MCP servers connected")

        output = f"## All MCP Tools\n\n"
        total = 0
        for name, tools in all_tools.items():
            output += f"### {name}\n\n"
            for tool in tools:
                output += f"- {tool}\n"
            total += len(tools)
            output += "\n"

        output += f"**Total across all servers:** {total}\n"

        return ToolResult(True, output)

    def mcp_call_tool(
        self,
        server_name: str,
        tool_name: str,
        arguments: dict[str, Any] | None = None,
    ) -> ToolResult:
        """Call a tool on an MCP server."""
        if server_name not in self._servers:
            return ToolResult(False, f"Server '{server_name}' not connected")

        if tool_name not in self._servers[server_name].get("tools", []):
            return ToolResult(False, f"Tool '{tool_name}' not found on server '{server_name}'")

        try:
            import asyncio
            from mcp import ClientSession

            session = self._servers[server_name]["session"]

            async def call():
                return await session.call_tool(tool_name, arguments or {})

            result = asyncio.run(call())

            output = f"## MCP Tool Result\n\n"
            output += f"**Server:** {server_name}\n"
            output += f"**Tool:** {tool_name}\n"
            output += f"**Arguments:** {json.dumps(arguments, indent=2)}\n\n"

            if result.content:
                for content in result.content:
                    if hasattr(content, "text"):
                        output += f"{content.text}\n"
                    else:
                        output += f"{content}\n"
            else:
                output += "(No output)"

            return ToolResult(True, output)

        except Exception as exc:
            return ToolResult(False, f"Failed to call tool: {exc}")

    def mcp_read_resource(
        self,
        server_name: str,
        uri: str,
    ) -> ToolResult:
        """Read a resource from an MCP server."""
        if server_name not in self._servers:
            return ToolResult(False, f"Server '{server_name}' not connected")

        try:
            import asyncio
            from mcp import ClientSession

            session = self._servers[server_name]["session"]

            async def read():
                return await session.read_resource(uri)

            result = asyncio.run(read())

            output = f"## MCP Resource\n\n"
            output += f"**Server:** {server_name}\n"
            output += f"**URI:** {uri}\n\n"

            if result.contents:
                for content in result.contents:
                    if hasattr(content, "text"):
                        output += content.text
                    else:
                        output += str(content)

            return ToolResult(True, output)

        except Exception as exc:
            return ToolResult(False, f"Failed to read resource: {exc}")

    def mcp_list_resources(self, server_name: str | None = None) -> ToolResult:
        """List available resources from MCP servers."""
        if server_name:
            if server_name not in self._servers:
                return ToolResult(False, f"Server '{server_name}' not connected")

            try:
                import asyncio
                from mcp import ClientSession

                session = self._servers[server_name]["session"]

                async def list():
                    return await session.list_resources()

                resources = asyncio.run(list())

                output = f"## MCP Resources: {server_name}\n\n"
                output += f"**Total:** {len(resources)}\n\n"

                for resource in resources:
                    output += f"- {resource.uri}\n"
                    if resource.description:
                        output += f"  - {resource.description}\n"

                return ToolResult(True, output)

            except Exception as exc:
                return ToolResult(False, f"Failed to list resources: {exc}")

        all_resources = {}
        for name, server in self._servers.items():
            try:
                import asyncio
                from mcp import ClientSession

                session = server["session"]

                async def list_res():
                    return await session.list_resources()

                resources = asyncio.run(list_res())
                all_resources[name] = [(r.uri, r.description) for r in resources]
            except Exception:
                all_resources[name] = []

        output = f"## All MCP Resources\n\n"
        total = 0
        for name, resources in all_resources.items():
            output += f"### {name}\n\n"
            for uri, desc in resources:
                output += f"- {uri}"
                if desc:
                    output += f" - {desc}"
                output += "\n"
            total += len(resources)
            output += "\n"

        output += f"**Total:** {total}\n"

        return ToolResult(True, output)

    def mcp_list_prompts(self, server_name: str | None = None) -> ToolResult:
        """List available prompts from MCP servers."""
        if server_name:
            if server_name not in self._servers:
                return ToolResult(False, f"Server '{server_name}' not connected")

            try:
                import asyncio
                from mcp import ClientSession

                session = self._servers[server_name]["session"]

                async def list_prompts():
                    return await session.list_prompts()

                prompts = asyncio.run(list_prompts())

                output = f"## MCP Prompts: {server_name}\n\n"
                output += f"**Total:** {len(prompts)}\n\n"

                for prompt in prompts:
                    output += f"### {prompt.name}\n\n"
                    if prompt.description:
                        output += f"{prompt.description}\n\n"

                return ToolResult(True, output)

            except Exception as exc:
                return ToolResult(False, f"Failed to list prompts: {exc}")

        all_prompts = {}
        for name, server in self._servers.items():
            try:
                import asyncio
                from mcp import ClientSession

                session = server["session"]

                async def list_prompts():
                    return await session.list_prompts()

                prompts = asyncio.run(list_prompts())
                all_prompts[name] = [p.name for p in prompts]
            except Exception:
                all_prompts[name] = []

        output = f"## All MCP Prompts\n\n"
        total = 0
        for name, prompts in all_prompts.items():
            output += f"### {name}\n\n"
            for prompt in prompts:
                output += f"- {prompt}\n"
            total += len(prompts)
            output += "\n"

        output += f"**Total:** {total}\n"

        return ToolResult(True, output)

    def mcp_get_prompt(
        self,
        server_name: str,
        prompt_name: str,
        arguments: dict[str, str] | None = None,
    ) -> ToolResult:
        """Get a prompt template from an MCP server."""
        if server_name not in self._servers:
            return ToolResult(False, f"Server '{server_name}' not connected")

        try:
            import asyncio
            from mcp import ClientSession

            session = self._servers[server_name]["session"]

            async def get_prompt():
                return await session.get_prompt(prompt_name, arguments or {})

            result = asyncio.run(get_prompt())

            output = f"## MCP Prompt: {prompt_name}\n\n"
            output += f"**Server:** {server_name}\n\n"

            if result.messages:
                for message in result.messages:
                    if hasattr(message, "content"):
                        if hasattr(message.content, "text"):
                            output += message.content.text
                        else:
                            output += str(message.content)
                    output += "\n\n"

            return ToolResult(True, output)

        except Exception as exc:
            return ToolResult(False, f"Failed to get prompt: {exc}")

    def mcp_configure(
        self,
        servers: dict[str, dict],
        output_path: str | None = None,
    ) -> ToolResult:
        """Configure MCP servers in JSON format."""
        config_path = output_path or str(self.config.mcp_file)

        try:
            Path(config_path).parent.mkdir(parents=True, exist_ok=True)

            config = {"mcpServers": servers}

            with open(config_path, "w") as f:
                json.dump(config, f, indent=2)

            output = f"## MCP Configuration Saved\n\n"
            output += f"**File:** {config_path}\n"
            output += f"**Servers:** {len(servers)}\n\n"

            for name, cfg in servers.items():
                output += f"### {name}\n\n"
                output += f"**Command:** {cfg.get('command', 'N/A')}\n"
                output += f"**Args:** {cfg.get('args', [])}\n"

            return ToolResult(True, output)

        except Exception as exc:
            return ToolResult(False, f"Failed to save config: {exc}")


async def mcp_call_tool_async(
    self,
    server_name: str,
    tool_name: str,
    arguments: dict[str, Any] | None = None,
) -> ToolResult:
    """Async wrapper for mcp_call_tool."""
    if server_name not in self._servers:
        return ToolResult(False, f"Server '{server_name}' not connected")

    if tool_name not in self._servers[server_name].get("tools", []):
        return ToolResult(False, f"Tool '{tool_name}' not found on server '{server_name}'")

    try:
        from mcp import ClientSession

        session = self._servers[server_name]["session"]

        result = await session.call_tool(tool_name, arguments or {})

        output = f"## MCP Tool Result\n\n"
        output += f"**Server:** {server_name}\n"
        output += f"**Tool:** {tool_name}\n"
        output += f"**Arguments:** {json.dumps(arguments, indent=2)}\n\n"

        if result.content:
            for content in result.content:
                if hasattr(content, "text"):
                    output += f"{content.text}\n"
                else:
                    output += f"{content}\n"
        else:
            output += "(No output)"

        return ToolResult(True, output)

    except Exception as exc:
        return ToolResult(False, f"Failed to call tool: {exc}")
