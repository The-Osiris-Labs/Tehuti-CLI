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

    def _server_params(self, server_name: str) -> tuple[str, list[str], dict[str, str]]:
        server = self._servers.get(server_name) or {}
        command = str(server.get("command", ""))
        args = list(server.get("args", []))
        env = dict(server.get("env", {}))
        return command, args, env

    def _ok(self, output: str) -> ToolResult:
        return ToolResult(True, output)

    def _protocol_error(
        self,
        code: str,
        message: str,
        *,
        retryable: bool = False,
    ) -> ToolResult:
        return ToolResult(
            False,
            message,
            error_code=code,
            error_category="protocol",
            retryable=retryable,
        )

    def _operation_error(self, code: str, message: str) -> ToolResult:
        return ToolResult(
            False,
            message,
            error_code=code,
            error_category="tool",
            retryable=False,
        )

    def _classify_protocol_exception(
        self,
        exc: Exception,
        *,
        default_code: str,
        default_retryable: bool,
    ) -> tuple[str, bool]:
        """Map transport/protocol exceptions to stable MCP protocol codes."""
        name = exc.__class__.__name__.lower()
        message = str(exc).lower()
        signal = f"{name} {message}"

        if "timeout" in signal:
            return "mcp_timeout", True
        if "unauthorized" in signal or "forbidden" in signal or "permission" in signal or "auth" in signal:
            return "mcp_auth_failed", False
        if "not found" in signal or "notfound" in signal:
            return "mcp_not_found", False
        if "json" in signal or "schema" in signal or "parse" in signal or "invalid" in signal:
            return "mcp_invalid_payload", False
        if "connection" in signal or "connect" in signal or "broken pipe" in signal:
            return "mcp_transport_error", True
        return default_code, default_retryable

    def _load_configured_servers(self) -> dict[str, dict[str, Any]]:
        mcp_file = self.config.mcp_file
        if not mcp_file.exists():
            return {}
        data = json.loads(mcp_file.read_text(encoding="utf-8"))
        servers = data.get("servers")
        if isinstance(servers, dict):
            return servers
        # Backward/interop compatibility with MCP ecosystem naming.
        mcp_servers = data.get("mcpServers")
        if isinstance(mcp_servers, dict):
            return mcp_servers
        return {}

    def _run_with_server_session(self, server_name: str, operation):
        import asyncio
        from mcp import ClientSession, StdioServerParameters
        from mcp.client.stdio import stdio_client

        command, args, env = self._server_params(server_name)
        if not command:
            raise RuntimeError(f"Server '{server_name}' is missing command configuration")
        server_params = StdioServerParameters(command=command, args=args, env=env)

        async def _run():
            stdio_transport = stdio_client(server_params)
            async with stdio_transport as (read, write):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    return await operation(session)

        return asyncio.run(_run())

    def mcp_list_servers(self) -> ToolResult:
        """List configured MCP servers."""
        mcp_file = self.config.mcp_file

        if not mcp_file.exists():
            return self._ok("No MCP servers configured. Create ~/.tehuti/mcp.json")

        try:
            servers = self._load_configured_servers()

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

            return self._ok(output)

        except Exception as exc:
            return self._protocol_error("mcp_invalid_config", f"Failed to read MCP config: {exc}")

    def mcp_connect(
        self,
        server_name: str,
        command: str,
        args: list[str] | None = None,
        env_vars: dict[str, str] | None = None,
    ) -> ToolResult:
        """Connect to an MCP server."""
        try:
            if server_name in self._servers:
                return self._protocol_error("mcp_already_connected", f"Server '{server_name}' already connected")

            self._servers[server_name] = {
                "command": command,
                "args": args or [],
                "env": env_vars or {},
                "tools": [],
            }
            tools = self._run_with_server_session(server_name, lambda session: session.list_tools())
            self._servers[server_name]["tools"] = [t.name for t in tools]

            output = f"## MCP Server Connected\n\n"
            output += f"**Server:** {server_name}\n"
            output += f"**Command:** {command}\n"
            output += f"**Tools available:** {len(tools)}\n\n"

            for tool in tools:
                output += f"- {tool.name}: {tool.description}\n"

            return self._ok(output)

        except ImportError:
            return self._operation_error("mcp_dependency_missing", "MCP not installed. Install with: pip install mcp")
        except Exception as exc:
            code, retryable = self._classify_protocol_exception(
                exc,
                default_code="mcp_connect_failed",
                default_retryable=True,
            )
            return self._protocol_error(code, f"Failed to connect to MCP server: {exc}", retryable=retryable)

    def mcp_disconnect(self, server_name: str) -> ToolResult:
        """Disconnect from an MCP server."""
        if server_name not in self._servers:
            return self._protocol_error("mcp_not_connected", f"Server '{server_name}' not connected")

        try:
            del self._servers[server_name]

            return self._ok(f"Disconnected from '{server_name}'")

        except Exception as exc:
            return self._protocol_error("mcp_disconnect_failed", f"Failed to disconnect: {exc}", retryable=True)

    def mcp_list_tools(self, server_name: str | None = None) -> ToolResult:
        """List available tools from MCP servers."""
        if server_name:
            if server_name not in self._servers:
                return self._protocol_error("mcp_not_connected", f"Server '{server_name}' not connected")

            tools = self._servers[server_name].get("tools", [])

            output = f"## MCP Tools: {server_name}\n\n"
            output += f"**Total:** {len(tools)}\n\n"

            for tool in tools:
                output += f"- {tool}\n"

            return self._ok(output)

        all_tools = {}
        for name, server in self._servers.items():
            all_tools[name] = server.get("tools", [])

        if not all_tools:
            return self._ok("No MCP servers connected")

        output = f"## All MCP Tools\n\n"
        total = 0
        for name, tools in all_tools.items():
            output += f"### {name}\n\n"
            for tool in tools:
                output += f"- {tool}\n"
            total += len(tools)
            output += "\n"

        output += f"**Total across all servers:** {total}\n"

        return self._ok(output)

    def mcp_call_tool(
        self,
        server_name: str,
        tool_name: str,
        arguments: dict[str, Any] | None = None,
    ) -> ToolResult:
        """Call a tool on an MCP server."""
        if server_name not in self._servers:
            return self._protocol_error("mcp_not_connected", f"Server '{server_name}' not connected")

        if tool_name not in self._servers[server_name].get("tools", []):
            return self._protocol_error("mcp_tool_not_found", f"Tool '{tool_name}' not found on server '{server_name}'")

        try:
            result = self._run_with_server_session(
                server_name,
                lambda session: session.call_tool(tool_name, arguments or {}),
            )

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

            return self._ok(output)

        except Exception as exc:
            code, retryable = self._classify_protocol_exception(
                exc,
                default_code="mcp_call_failed",
                default_retryable=True,
            )
            return self._protocol_error(code, f"Failed to call tool: {exc}", retryable=retryable)

    def mcp_read_resource(
        self,
        server_name: str,
        uri: str,
    ) -> ToolResult:
        """Read a resource from an MCP server."""
        if server_name not in self._servers:
            return self._protocol_error("mcp_not_connected", f"Server '{server_name}' not connected")

        try:
            result = self._run_with_server_session(server_name, lambda session: session.read_resource(uri))

            output = f"## MCP Resource\n\n"
            output += f"**Server:** {server_name}\n"
            output += f"**URI:** {uri}\n\n"

            if result.contents:
                for content in result.contents:
                    if hasattr(content, "text"):
                        output += content.text
                    else:
                        output += str(content)

            return self._ok(output)

        except Exception as exc:
            code, retryable = self._classify_protocol_exception(
                exc,
                default_code="mcp_read_resource_failed",
                default_retryable=True,
            )
            return self._protocol_error(code, f"Failed to read resource: {exc}", retryable=retryable)

    def mcp_list_resources(self, server_name: str | None = None) -> ToolResult:
        """List available resources from MCP servers."""
        if server_name:
            if server_name not in self._servers:
                return self._protocol_error("mcp_not_connected", f"Server '{server_name}' not connected")

            try:
                resources = self._run_with_server_session(server_name, lambda session: session.list_resources())

                output = f"## MCP Resources: {server_name}\n\n"
                output += f"**Total:** {len(resources)}\n\n"

                for resource in resources:
                    output += f"- {resource.uri}\n"
                    if resource.description:
                        output += f"  - {resource.description}\n"

                return self._ok(output)

            except Exception as exc:
                code, retryable = self._classify_protocol_exception(
                    exc,
                    default_code="mcp_list_resources_failed",
                    default_retryable=True,
                )
                return self._protocol_error(code, f"Failed to list resources: {exc}", retryable=retryable)

        all_resources = {}
        for name, server in self._servers.items():
            try:
                resources = self._run_with_server_session(name, lambda session: session.list_resources())
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

        return self._ok(output)

    def mcp_list_prompts(self, server_name: str | None = None) -> ToolResult:
        """List available prompts from MCP servers."""
        if server_name:
            if server_name not in self._servers:
                return self._protocol_error("mcp_not_connected", f"Server '{server_name}' not connected")

            try:
                prompts = self._run_with_server_session(server_name, lambda session: session.list_prompts())

                output = f"## MCP Prompts: {server_name}\n\n"
                output += f"**Total:** {len(prompts)}\n\n"

                for prompt in prompts:
                    output += f"### {prompt.name}\n\n"
                    if prompt.description:
                        output += f"{prompt.description}\n\n"

                return self._ok(output)

            except Exception as exc:
                code, retryable = self._classify_protocol_exception(
                    exc,
                    default_code="mcp_list_prompts_failed",
                    default_retryable=True,
                )
                return self._protocol_error(code, f"Failed to list prompts: {exc}", retryable=retryable)

        all_prompts = {}
        for name, server in self._servers.items():
            try:
                prompts = self._run_with_server_session(name, lambda session: session.list_prompts())
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

        return self._ok(output)

    def mcp_get_prompt(
        self,
        server_name: str,
        prompt_name: str,
        arguments: dict[str, str] | None = None,
    ) -> ToolResult:
        """Get a prompt template from an MCP server."""
        if server_name not in self._servers:
            return self._protocol_error("mcp_not_connected", f"Server '{server_name}' not connected")

        try:
            result = self._run_with_server_session(
                server_name,
                lambda session: session.get_prompt(prompt_name, arguments or {}),
            )

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

            return self._ok(output)

        except Exception as exc:
            code, retryable = self._classify_protocol_exception(
                exc,
                default_code="mcp_get_prompt_failed",
                default_retryable=True,
            )
            return self._protocol_error(code, f"Failed to get prompt: {exc}", retryable=retryable)

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

            return self._ok(output)

        except Exception as exc:
            return self._operation_error("mcp_config_write_failed", f"Failed to save config: {exc}")


async def mcp_call_tool_async(
    self,
    server_name: str,
    tool_name: str,
    arguments: dict[str, Any] | None = None,
) -> ToolResult:
    """Async wrapper for mcp_call_tool."""
    return self.mcp_call_tool(server_name=server_name, tool_name=tool_name, arguments=arguments)
