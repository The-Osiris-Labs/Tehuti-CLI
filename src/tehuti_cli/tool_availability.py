"""
Tool availability checker for Tehuti

Checks if external tools (docker, kubectl, etc.) are available on the system
"""

import shutil
import subprocess
from typing import Optional


class ToolAvailability:
    """Check availability of external tools."""

    # Tools that might not be available
    OPTIONAL_TOOLS = {
        "docker": ["docker", "--version"],
        "docker_compose": ["docker-compose", "--version"],
        "kubectl": ["kubectl", "version", "--client"],
        "terraform": ["terraform", "version"],
        "ansible": ["ansible-playbook", "--version"],
        "nmap": ["nmap", "--version"],
        "tcpdump": ["tcpdump", "--version"],
        "gh": ["gh", "--version"],
        "glab": ["glab", "--version"],
        "cargo": ["cargo", "--version"],
        "go": ["go", "version"],
        "node": ["node", "--version"],
        "npm": ["npm", "--version"],
        "ruby": ["ruby", "--version"],
        "perl": ["perl", "--version"],
        "psql": ["psql", "--version"],
        "mysql": ["mysql", "--version"],
        "redis_cli": ["redis-cli", "--version"],
        "gradle": ["./gradlew", "--version"],
        "maven": ["mvn", "--version"],
        "helm": ["helm", "version"],
        "aws": ["aws", "--version"],
        "gcloud": ["gcloud", "--version"],
        "azure": ["az", "--version"],
    }

    @classmethod
    def check_tool(cls, tool_name: str) -> tuple[bool, Optional[str]]:
        """Check if a specific tool is available.

        Returns:
            (available: bool, version: Optional[str])
        """
        if tool_name not in cls.OPTIONAL_TOOLS:
            # Assume built-in tools are always available
            return True, None

        cmd = cls.OPTIONAL_TOOLS[tool_name]

        # First check if command exists in PATH
        if not shutil.which(cmd[0]):
            return False, None

        # Try to get version
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
            if result.returncode == 0:
                version = result.stdout.strip().split("\n")[0][:100]
                return True, version
        except (subprocess.TimeoutExpired, FileNotFoundError, PermissionError):
            pass

        return True, None  # Available but couldn't get version

    @classmethod
    def check_all(cls) -> dict[str, dict]:
        """Check availability of all optional tools.

        Returns:
            Dict mapping tool name to {'available': bool, 'version': str}
        """
        results = {}
        for tool in cls.OPTIONAL_TOOLS:
            available, version = cls.check_tool(tool)
            results[tool] = {"available": available, "version": version}
        return results

    @classmethod
    def get_available_tools(cls) -> list[str]:
        """Get list of available optional tools."""
        available = []
        for tool in cls.OPTIONAL_TOOLS:
            is_available, _ = cls.check_tool(tool)
            if is_available:
                available.append(tool)
        return available

    @classmethod
    def format_status(cls) -> str:
        """Format tool availability as a string."""
        results = cls.check_all()
        lines = []
        lines.append("Tool Availability:")
        lines.append("")

        available = []
        unavailable = []

        for tool, info in results.items():
            if info["available"]:
                available.append(tool)
            else:
                unavailable.append(tool)

        if available:
            lines.append(f"✓ Available ({len(available)}):")
            for tool in sorted(available):
                version = results[tool]["version"]
                if version:
                    lines.append(f"  • {tool}: {version[:50]}")
                else:
                    lines.append(f"  • {tool}")

        if unavailable:
            lines.append("")
            lines.append(f"✗ Not Available ({len(unavailable)}):")
            for tool in sorted(unavailable):
                lines.append(f"  • {tool}")

        return "\n".join(lines)
