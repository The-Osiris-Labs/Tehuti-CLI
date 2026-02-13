"""Response formatting and structuring for Tehuti.

This module provides intelligent response formatting that adapts to content type,
ensuring outputs are:
- Well-structured with appropriate line breaks
- Human-friendly and scannable
- Contextually aware (concise vs comprehensive)
- Easy to digest
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import Enum, auto
from typing import Any

from rich.console import Console
from rich.text import Text
from rich.panel import Panel
from rich.syntax import Syntax
from rich.table import Table
from rich.tree import Tree
from rich.markdown import Markdown


class ContentType(Enum):
    """Types of content that need different formatting."""

    CODE = auto()
    LIST = auto()
    EXPLANATION = auto()
    ANALYSIS = auto()
    STEPS = auto()
    COMPARISON = auto()
    SUMMARY = auto()
    ERROR = auto()
    MIXED = auto()


class LengthPreference(Enum):
    """User preference for response length."""

    CONCISE = auto()  # Brief, to the point
    BALANCED = auto()  # Medium detail (default)
    COMPREHENSIVE = auto()  # Full detail


@dataclass
class FormatConfig:
    """Configuration for response formatting."""

    max_line_length: int = 80
    paragraph_spacing: int = 1
    list_spacing: int = 0
    code_block_style: str = "monokai"
    use_panels: bool = True
    use_tables: bool = True
    use_trees: bool = True
    indent_size: int = 2


class ContentScanner:
    """Scans content to determine its type and optimal formatting."""

    def scan(self, text: str) -> ContentType:
        """Determine the content type of a response."""
        text = text.strip()

        # Check for code blocks
        if "```" in text or text.count("def ") > 2 or text.count("class ") > 1:
            return ContentType.CODE

        # Check for numbered steps
        if re.search(r"\n\d+\.", text) and text.count("\n") > 5:
            return ContentType.STEPS

        # Check for comparison (vs, versus, compared to, difference between)
        if re.search(r"\b(vs\.?|versus|compared to|difference between|pros?[:\s]|cons?[:\s])", text, re.IGNORECASE):
            return ContentType.COMPARISON

        # Check for lists
        if text.count("\n-") > 2 or text.count("\n*") > 2:
            return ContentType.LIST

        # Check for analysis/explanation patterns
        if re.search(r"\b(analysis|explain|because|therefore|conclusion|summary)\b", text, re.IGNORECASE):
            return ContentType.ANALYSIS

        # Check for error patterns
        if re.search(r"\b(error|exception|failed|traceback|syntaxerror)\b", text, re.IGNORECASE):
            return ContentType.ERROR

        return ContentType.EXPLANATION


class ResponseFormatter:
    """Formats responses for optimal readability."""

    def __init__(self, config: FormatConfig | None = None):
        self.config = config or FormatConfig()
        self.scanner = ContentScanner()

    def format_response(
        self,
        text: str,
        content_type: ContentType | None = None,
        preference: LengthPreference = LengthPreference.BALANCED,
    ) -> str:
        """Format a response based on its content type and user preference."""
        if not text:
            return text

        # Detect content type if not provided
        if content_type is None:
            content_type = self.scanner.scan(text)

        # Apply appropriate formatting
        formatters = {
            ContentType.CODE: self._format_code,
            ContentType.LIST: self._format_list,
            ContentType.EXPLANATION: self._format_explanation,
            ContentType.ANALYSIS: self._format_analysis,
            ContentType.STEPS: self._format_steps,
            ContentType.COMPARISON: self._format_comparison,
            ContentType.SUMMARY: self._format_summary,
            ContentType.ERROR: self._format_error,
            ContentType.MIXED: self._format_mixed,
        }

        formatter = formatters.get(content_type, self._format_explanation)
        return formatter(text, preference)

    def _format_code(self, text: str, preference: LengthPreference) -> str:
        """Format code-related responses."""
        # Extract code blocks
        parts = []
        current_pos = 0

        for match in re.finditer(r"```(\w+)?\n(.*?)```", text, re.DOTALL):
            # Add text before code block
            if match.start() > current_pos:
                before = text[current_pos : match.start()].strip()
                if before:
                    parts.append(self._format_explanation(before, preference))

            # Format code block
            lang = match.group(1) or "python"
            code = match.group(2).strip()
            parts.append(f"\n```{lang}\n{code}\n```\n")

            current_pos = match.end()

        # Add remaining text
        if current_pos < len(text):
            remaining = text[current_pos:].strip()
            if remaining:
                parts.append(self._format_explanation(remaining, preference))

        return "\n".join(parts) if parts else text

    def _format_list(self, text: str, preference: LengthPreference) -> str:
        """Format list-based responses."""
        lines = text.split("\n")
        formatted = []
        current_list = []

        for line in lines:
            stripped = line.strip()

            # Check if it's a list item
            if re.match(r"^[\-\*\•]\s", stripped):
                if current_list and len(formatted) > 0:
                    formatted.append("")  # Add spacing before new list
                current_list.append(stripped)
                formatted.append(line)
            elif re.match(r"^\d+[\.\)]\s", stripped):
                if current_list and len(formatted) > 0:
                    formatted.append("")
                current_list.append(stripped)
                formatted.append(line)
            else:
                if current_list:
                    formatted.append("")  # Add spacing after list
                    current_list = []
                if stripped:
                    formatted.append(line)

        return "\n".join(formatted)

    def _format_explanation(self, text: str, preference: LengthPreference) -> str:
        """Format explanatory text."""
        # Split into paragraphs
        paragraphs = re.split(r"\n\s*\n", text.strip())
        formatted = []

        for i, para in enumerate(paragraphs):
            para = para.strip()
            if not para:
                continue

            # Check if it's a heading
            if para.startswith("#") or para.isupper():
                if formatted:
                    formatted.append("")  # Space before heading
                formatted.append(para)
                formatted.append("")
                continue

            # Format based on preference
            if preference == LengthPreference.CONCISE:
                # Keep it brief - one idea per paragraph
                sentences = re.split(r"(?<=[.!?])\s+", para)
                if len(sentences) > 3:
                    para = " ".join(sentences[:2]) + " ..."

            formatted.append(para)

            # Add spacing between paragraphs
            if i < len(paragraphs) - 1:
                formatted.append("")

        return "\n".join(formatted)

    def _format_analysis(self, text: str, preference: LengthPreference) -> str:
        """Format analytical content with clear sections."""
        # Look for section headers
        sections = re.split(r"\n(?=[A-Z][A-Za-z\s]{2,30}:)", text)

        if len(sections) > 1:
            formatted = []
            for section in sections:
                section = section.strip()
                if not section:
                    continue

                # Check if section has a header
                if ":" in section[:50]:
                    header, content = section.split(":", 1)
                    formatted.append(f"\n**{header.strip()}:**")
                    formatted.append(content.strip())
                else:
                    formatted.append(section)

                formatted.append("")

            return "\n".join(formatted).strip()

        return self._format_explanation(text, preference)

    def _format_steps(self, text: str, preference: LengthPreference) -> str:
        """Format step-by-step instructions."""
        lines = text.split("\n")
        formatted = []
        in_steps = False

        for line in lines:
            stripped = line.strip()

            # Check for step pattern
            step_match = re.match(r"^(\d+)[\.\)\s]+(.+)", stripped)
            if step_match:
                if not in_steps and formatted:
                    formatted.append("")  # Space before steps start
                in_steps = True
                num, content = step_match.groups()
                formatted.append(f"{num}. {content}")

                # Add brief spacing after step based on preference
                if preference == LengthPreference.COMPREHENSIVE:
                    formatted.append("")
            else:
                if in_steps and stripped:
                    formatted.append(f"   {stripped}")  # Indent continuation
                elif stripped:
                    formatted.append(stripped)

        return "\n".join(formatted)

    def _format_comparison(self, text: str, preference: LengthPreference) -> str:
        """Format comparison content."""
        # Try to identify what's being compared
        lines = text.split("\n")
        formatted = []

        for line in lines:
            stripped = line.strip()

            # Format pros/cons sections
            if re.match(r"^(pros?|advantages|benefits):", stripped, re.IGNORECASE):
                if formatted:
                    formatted.append("")
                formatted.append(f"**{stripped}**")
            elif re.match(r"^(cons?|disadvantages|drawbacks):", stripped, re.IGNORECASE):
                if formatted:
                    formatted.append("")
                formatted.append(f"**{stripped}**")
            elif re.match(r"^(vs\.?|versus)$", stripped, re.IGNORECASE):
                formatted.append(f"\n**{stripped}**\n")
            else:
                formatted.append(line)

        return "\n".join(formatted)

    def _format_summary(self, text: str, preference: LengthPreference) -> str:
        """Format summary content - brief and scannable."""
        # Keep it concise
        sentences = re.split(r"(?<=[.!?])\s+", text.strip())

        if len(sentences) > 5:
            # Take first sentence and any with key words
            key_sentences = [sentences[0]]
            for sent in sentences[1:]:
                if re.search(r"\b(summary|conclusion|result|outcome|key|important|note)\b", sent, re.IGNORECASE):
                    key_sentences.append(sent)

            text = " ".join(key_sentences[:3])

        return self._format_explanation(text, LengthPreference.CONCISE)

    def _format_error(self, text: str, preference: LengthPreference) -> str:
        """Format error messages for clarity."""
        # Extract key error information
        lines = text.split("\n")
        formatted = []

        for line in lines:
            stripped = line.strip()

            # Highlight important parts
            if re.search(r"\b(error|exception|failed|traceback)\b", stripped, re.IGNORECASE):
                formatted.append(f"**{stripped}**")
            elif re.search(r'^File\s+"', stripped):
                formatted.append(f"`{stripped}`")
            else:
                formatted.append(stripped)

        return "\n".join(formatted)

    def _format_mixed(self, text: str, preference: LengthPreference) -> str:
        """Format mixed content by applying multiple formatters."""
        # First handle code blocks
        text = self._format_code(text, preference)

        # Then handle lists within the text
        text = self._format_list(text, preference)

        # Finally format paragraphs
        return self._format_explanation(text, preference)

    def detect_length_need(self, text: str, query: str = "") -> LengthPreference:
        """Detect whether user needs concise or comprehensive response."""
        query_lower = query.lower()

        # Signals for concise response
        concise_signals = [
            "brief",
            "quick",
            "short",
            "summarize",
            "summary",
            "tl;dr",
            "concise",
            "briefly",
            "quickly",
            "just",
            "only",
        ]

        # Signals for comprehensive response
        comprehensive_signals = [
            "explain",
            "detailed",
            "thorough",
            "comprehensive",
            "in depth",
            "elaborate",
            "describe",
            "walk through",
            "step by step",
            "how does",
            "why is",
            "what is",
        ]

        if any(sig in query_lower for sig in concise_signals):
            return LengthPreference.CONCISE
        elif any(sig in query_lower for sig in comprehensive_signals):
            return LengthPreference.COMPREHENSIVE

        return LengthPreference.BALANCED

    def add_visual_structure(self, text: str, content_type: ContentType | None = None) -> str:
        """Add visual structure markers to text."""
        if content_type is None:
            content_type = self.scanner.scan(text)

        # Add appropriate headers/structure based on type
        if content_type == ContentType.ANALYSIS:
            if not text.startswith("#") and not text.startswith("**"):
                text = f"**Analysis:**\n\n{text}"

        elif content_type == ContentType.SUMMARY:
            if not text.startswith("Summary"):
                text = f"**Summary:** {text}"

        elif content_type == ContentType.STEPS:
            if not re.search(r"^\d+\.", text.strip()):
                text = f"**Steps:**\n\n{text}"

        return text


class RichResponseRenderer:
    """Renders formatted responses using Rich library."""

    def __init__(self, console: Console | None = None):
        self.console = console or Console()
        self.formatter = ResponseFormatter()

    def render(
        self,
        text: str,
        content_type: ContentType | None = None,
        preference: LengthPreference = LengthPreference.BALANCED,
        use_panels: bool = True,
    ) -> None:
        """Render a response with Rich formatting."""
        # Format the text
        formatted = self.formatter.format_response(text, content_type, preference)

        if not content_type:
            content_type = self.formatter.scanner.scan(formatted)

        # Render based on content type
        if content_type == ContentType.CODE:
            self._render_code(formatted)
        elif content_type == ContentType.ERROR:
            self._render_error(formatted)
        elif content_type == ContentType.ANALYSIS and use_panels:
            self._render_analysis(formatted)
        else:
            self.console.print(formatted)

    def _render_code(self, text: str) -> None:
        """Render code with syntax highlighting."""
        # Extract and render code blocks
        current_pos = 0

        for match in re.finditer(r"```(\w+)?\n(.*?)```", text, re.DOTALL):
            # Print text before code
            if match.start() > current_pos:
                before = text[current_pos : match.start()].strip()
                if before:
                    self.console.print(before)

            # Render code block
            lang = match.group(1) or "python"
            code = match.group(2).strip()

            try:
                syntax = Syntax(code, lang, theme="monokai", line_numbers=True)
                self.console.print(syntax)
            except Exception:
                # Fallback if language not recognized
                self.console.print(f"```{lang}\n{code}\n```")

            current_pos = match.end()

        # Print remaining text
        if current_pos < len(text):
            remaining = text[current_pos:].strip()
            if remaining:
                self.console.print(remaining)

    def _render_error(self, text: str) -> None:
        """Render error messages in a panel."""
        panel = Panel(
            text,
            title="Error",
            border_style="red",
            expand=False,
        )
        self.console.print(panel)

    def _render_analysis(self, text: str) -> None:
        """Render analysis in a structured panel."""
        panel = Panel(
            text,
            title="Analysis",
            border_style="blue",
            expand=False,
        )
        self.console.print(panel)


# Convenience functions
def format_response(
    text: str,
    query: str = "",
    preference: LengthPreference | None = None,
) -> str:
    """Format a response optimally."""
    formatter = ResponseFormatter()

    if preference is None:
        preference = formatter.detect_length_need(text, query)

    return formatter.format_response(text, preference=preference)


def render_response(
    text: str,
    console: Console | None = None,
    query: str = "",
) -> None:
    """Render a response with optimal formatting."""
    renderer = RichResponseRenderer(console)
    formatter = ResponseFormatter()

    preference = formatter.detect_length_need(text, query)
    renderer.render(text, preference=preference)
