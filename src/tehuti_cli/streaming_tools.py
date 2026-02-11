"""
Tehuti Streaming Tools - Stream LLM Output to Files

Provides tools for:
- Streaming LLM responses to files
- Chunked file writing
- Real-time file updates
- Streaming from MCP and other sources
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

from tehuti_cli.storage.config import Config
from tehuti_cli.providers.llm import TehutiLLM
from tehuti_cli.advanced_tools import ToolResult


@dataclass
class StreamConfig:
    """Streaming configuration."""

    chunk_size: int = 1024
    flush_interval: float = 0.5
    append: bool = False


class StreamingTools:
    """Tools for streaming content to files."""

    def __init__(self, config: Config, work_dir: Path):
        self.config = config
        self.work_dir = work_dir.resolve()
        self._stream_config = StreamConfig()

    def stream_chat(
        self,
        prompt: str,
        output_path: str,
        model: str | None = None,
        context_prompt: str | None = None,
        append: bool = False,
    ) -> ToolResult:
        """Stream LLM chat response directly to a file."""
        try:
            llm = TehutiLLM(self.config)
            output_file = Path(output_path)
            output_file.parent.mkdir(parents=True, exist_ok=True)

            mode = "a" if append else "w"
            with open(output_file, mode, encoding="utf-8") as f:
                f.write(f"## Prompt: {prompt}\n\n")

                messages = [{"role": "user", "content": prompt}]
                if context_prompt:
                    messages.append({"role": "user", "content": context_prompt})

                content = ""

                for chunk in llm.chat_stream(messages):
                    if chunk:
                        f.write(chunk)
                        f.flush()
                        content += chunk

                f.write("\n\n---\n\n")

            output = f"## Streaming Complete\n\n"
            output += f"**Prompt:** {prompt}\n"
            output += f"**Output:** {output_path}\n"
            output += f"**Length:** {len(content)} chars\n"

            return ToolResult(True, output)

        except Exception as exc:
            return ToolResult(False, f"Streaming failed: {str(exc)}")

    def stream_append(
        self,
        content: str,
        output_path: str,
    ) -> ToolResult:
        """Append content to a file."""
        try:
            output_file = Path(output_path)
            output_file.parent.mkdir(parents=True, exist_ok=True)

            with open(output_file, "a", encoding="utf-8") as f:
                f.write(content)

            return ToolResult(
                True,
                f"Appended {len(content)} chars to {output_path}",
            )

        except Exception as exc:
            return ToolResult(False, f"Append failed: {str(exc)}")

    def stream_lines(
        self,
        lines: list[str],
        output_path: str,
    ) -> ToolResult:
        """Write multiple lines to a file."""
        try:
            output_file = Path(output_path)
            output_file.parent.mkdir(parents=True, exist_ok=True)

            with open(output_file, "w", encoding="utf-8") as f:
                for line in lines:
                    f.write(line + "\n")

            return ToolResult(
                True,
                f"Wrote {len(lines)} lines to {output_path}",
            )

        except Exception as exc:
            return ToolResult(False, f"Line write failed: {str(exc)}")

    def stream_json(
        self,
        data: dict | list,
        output_path: str,
        indent: int = 2,
    ) -> ToolResult:
        """Write JSON data to a file."""
        try:
            output_file = Path(output_path)
            output_file.parent.mkdir(parents=True, exist_ok=True)

            with open(output_file, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=indent)

            return ToolResult(
                True,
                f"Wrote JSON to {output_path}",
            )

        except Exception as exc:
            return ToolResult(False, f"JSON write failed: {str(exc)}")

    def stream_jsonl(
        self,
        records: list[dict],
        output_path: str,
    ) -> ToolResult:
        """Write JSONL (JSON Lines) to a file."""
        try:
            output_file = Path(output_path)
            output_file.parent.mkdir(parents=True, exist_ok=True)

            with open(output_file, "w", encoding="utf-8") as f:
                for record in records:
                    f.write(json.dumps(record) + "\n")

            return ToolResult(
                True,
                f"Wrote {len(records)} records to {output_path}",
            )

        except Exception as exc:
            return ToolResult(False, f"JSONL write failed: {str(exc)}")

    def stream_csv(
        self,
        headers: list[str],
        rows: list[list[str]],
        output_path: str,
    ) -> ToolResult:
        """Write CSV data to a file."""
        try:
            import csv

            output_file = Path(output_path)
            output_file.parent.mkdir(parents=True, exist_ok=True)

            with open(output_file, "w", newline="", encoding="utf-8") as f:
                writer = csv.writer(f)
                writer.writerow(headers)
                writer.writerows(rows)

            return ToolResult(
                True,
                f"Wrote {len(rows)} rows to {output_path}",
            )

        except Exception as exc:
            return ToolResult(False, f"CSV write failed: {str(exc)}")

    def stream_xml(
        self,
        root_element: str,
        records: list[dict],
        output_path: str,
        root_attributes: dict | None = None,
    ) -> ToolResult:
        """Write XML data to a file."""
        try:
            output_file = Path(output_path)
            output_file.parent.mkdir(parents=True, exist_ok=True)

            with open(output_file, "w", encoding="utf-8") as f:
                f.write('<?xml version="1.0" encoding="UTF-8"?>\n')

                attrs = ""
                if root_attributes:
                    for k, v in root_attributes.items():
                        attrs += f' {k}="{v}"'

                f.write(f"<{root_element}{attrs}>\n")

                for record in records:
                    f.write("  <item>\n")
                    for k, v in record.items():
                        f.write(f"    <{k}>{v}</{k}>\n")
                    f.write("  </item>\n")

                f.write(f"</{root_element}>\n")

            return ToolResult(
                True,
                f"Wrote {len(records)} records to {output_path}",
            )

        except Exception as exc:
            return ToolResult(False, f"XML write failed: {str(exc)}")

    def stream_yaml(
        self,
        data: dict | list,
        output_path: str,
        indent: int = 2,
    ) -> ToolResult:
        """Write YAML data to a file."""
        try:
            import yaml

            output_file = Path(output_path)
            output_file.parent.mkdir(parents=True, exist_ok=True)

            with open(output_file, "w", encoding="utf-8") as f:
                yaml.dump(data, f, indent=indent, default_flow_style=False)

            return ToolResult(
                True,
                f"Wrote YAML to {output_path}",
            )

        except ImportError:
            return ToolResult(
                False,
                "PyYAML not installed. Install with: pip install PyYAML",
            )
        except Exception as exc:
            return ToolResult(False, f"YAML write failed: {str(exc)}")

    def stream_markdown(
        self,
        title: str,
        sections: list[dict],
        output_path: str,
    ) -> ToolResult:
        """Write structured markdown to a file."""
        try:
            output_file = Path(output_path)
            output_file.parent.mkdir(parents=True, exist_ok=True)

            with open(output_file, "w", encoding="utf-8") as f:
                f.write(f"# {title}\n\n")

                for section in sections:
                    level = section.get("level", 2)
                    heading = "#" * level
                    f.write(f"{heading} {section.get('title', '')}\n\n")

                    if section.get("content"):
                        f.write(f"{section['content']}\n\n")

                    if section.get("code"):
                        f.write(f"```{section.get('language', '')}\n")
                        f.write(f"{section['code']}\n")
                        f.write("```\n\n")

                    if section.get("list"):
                        for item in section["list"]:
                            f.write(f"- {item}\n")
                        f.write("\n")

            return ToolResult(
                True,
                f"Wrote markdown to {output_path}",
            )

        except Exception as exc:
            return ToolResult(False, f"Markdown write failed: {str(exc)}")

    def stream_table(
        self,
        headers: list[str],
        rows: list[list[str]],
        output_path: str,
        format: str = "markdown",
    ) -> ToolResult:
        """Write table data to file in specified format."""
        try:
            output_file = Path(output_path)
            output_file.parent.mkdir(parents=True, exist_ok=True)

            if format == "markdown":
                with open(output_file, "w", encoding="utf-8") as f:
                    f.write("| " + " | ".join(headers) + " |\n")
                    f.write("|" + "---|" * len(headers) + "\n")
                    for row in rows:
                        f.write("| " + " | ".join(row) + " |\n")

            elif format == "csv":
                import csv

                with open(output_file, "w", newline="", encoding="utf-8") as f:
                    writer = csv.writer(f)
                    writer.writerow(headers)
                    writer.writerows(rows)

            elif format == "json":
                data = [dict(zip(headers, row)) for row in rows]
                with open(output_file, "w", encoding="utf-8") as f:
                    json.dump(data, f, indent=2)

            else:
                return ToolResult(False, f"Unknown format: {format}. Use: markdown, csv, json")

            return ToolResult(
                True,
                f"Wrote {len(rows)} rows to {output_path} ({format})",
            )

        except Exception as exc:
            return ToolResult(False, f"Table write failed: {str(exc)}")

    def stream_diff(
        self,
        before: str,
        after: str,
        output_path: str,
    ) -> ToolResult:
        """Write diff output to a file."""
        try:
            import difflib

            output_file = Path(output_path)
            output_file.parent.mkdir(parents=True, exist_ok=True)

            before_lines = before.splitlines(keepends=True)
            after_lines = after.splitlines(keepends=True)

            diff = difflib.unified_diff(
                before_lines,
                after_lines,
                fromfile="before",
                tofile="after",
                lineterm="",
            )

            with open(output_file, "w", encoding="utf-8") as f:
                for line in diff:
                    f.write(line)

            return ToolResult(
                True,
                f"Wrote diff to {output_path}",
            )

        except Exception as exc:
            return ToolResult(False, f"Diff write failed: {str(exc)}")

    def stream_log(
        self,
        level: str,
        message: str,
        output_path: str,
        extras: dict | None = None,
    ) -> ToolResult:
        """Append a log entry to a file."""
        try:
            from datetime import datetime

            output_file = Path(output_path)
            output_file.parent.mkdir(parents=True, exist_ok=True)

            entry = {
                "timestamp": datetime.utcnow().isoformat() + "Z",
                "level": level.upper(),
                "message": message,
            }
            if extras:
                entry.update(extras)

            with open(output_file, "a", encoding="utf-8") as f:
                f.write(json.dumps(entry) + "\n")

            return ToolResult(
                True,
                f"Logged to {output_path}",
            )

        except Exception as exc:
            return ToolResult(False, f"Log write failed: {str(exc)}")

    def file_tail(
        self,
        output_path: str,
        lines: int = 10,
    ) -> ToolResult:
        """Get the last N lines of a file."""
        try:
            output_file = Path(output_path)

            if not output_file.exists():
                return ToolResult(False, f"File not found: {output_path}")

            with open(output_file, "r", encoding="utf-8") as f:
                content = f.read()
                last_lines = "\n".join(content.splitlines()[-lines:])

            return ToolResult(
                True,
                f"## Last {lines} lines of {output_path}\n\n{last_lines}",
            )

        except Exception as exc:
            return ToolResult(False, f"Tail failed: {str(exc)}")

    def file_watch(
        self,
        output_path: str,
        poll_interval: float = 1.0,
        max_lines: int = 100,
    ) -> ToolResult:
        """Watch a file for new content (returns current content)."""
        try:
            output_file = Path(output_path)

            if not output_file.exists():
                return ToolResult(False, f"File not found: {output_path}")

            with open(output_file, "r", encoding="utf-8") as f:
                lines = f.readlines()

            content = "".join(lines[-max_lines:])

            output = f"## File Content: {output_path}\n\n"
            output += f"**Total lines:** {len(lines)}\n"
            output += f"**Showing last:** {min(len(lines), max_lines)} lines\n\n"
            output += "---\n\n"
            output += content

            return ToolResult(True, output)

        except Exception as exc:
            return ToolResult(False, f"Watch failed: {str(exc)}")
