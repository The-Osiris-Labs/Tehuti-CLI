"""Enhanced streaming response display for Tehuti.

Provides:
- Character-by-character streaming for natural feel
- Smart pacing (faster for code, slower for explanations)
- Cancel capability
- Buffer management for smooth rendering
"""

from __future__ import annotations

import time
import threading
from typing import Optional, Callable
from dataclasses import dataclass
from enum import Enum, auto

from rich.console import Console
from rich.text import Text
from rich.live import Live
from rich.panel import Panel
from rich.markdown import Markdown


class StreamSpeed(Enum):
    """Pacing for different content types."""

    FAST = 0.01  # Code, lists - quick
    NORMAL = 0.03  # Regular text
    SLOW = 0.05  # Emphasis, important points
    PAUSE = 0.5  # After paragraphs, sentences


@dataclass
class StreamConfig:
    """Configuration for streaming display."""

    char_delay: float = 0.02
    chunk_size: int = 3  # Characters per update
    pause_after_sentence: bool = True
    pause_after_paragraph: bool = True
    enable_streaming: bool = True
    min_length_to_stream: int = 50  # Don't stream very short responses


class StreamingResponse:
    """Manages streaming response display with intelligent pacing."""

    def __init__(self, console: Optional[Console] = None, config: Optional[StreamConfig] = None):
        self.console = console or Console()
        self.config = config or StreamConfig()
        self._buffer = ""
        self._displayed = ""
        self._is_streaming = False
        self._cancelled = False
        self._live: Optional[Live] = None

    def stream(self, text: str, title: str = "𓅞 Thoth", border_style: str = "gold", subtitle: str = "𓋹 Ma'at 𓋹") -> str:
        """Stream text with intelligent pacing.

        Args:
            text: Full response text to stream
            title: Panel title
            border_style: Border color
            subtitle: Panel subtitle

        Returns:
            The complete text (for chaining)
        """
        # Don't stream very short responses
        if len(text) < self.config.min_length_to_stream or not self.config.enable_streaming:
            self._display_complete(text, title, border_style, subtitle)
            return text

        self._is_streaming = True
        self._cancelled = False
        self._buffer = text
        self._displayed = ""

        # Create live display
        with Live(
            self._get_rendered_content(title, border_style, subtitle),
            console=self.console,
            refresh_per_second=30,
            transient=False,
        ) as live:
            self._live = live

            # Stream character by character with intelligent pacing
            i = 0
            while i < len(text) and not self._cancelled:
                # Determine chunk size based on content
                chunk = self._get_next_chunk(text, i)

                self._displayed += chunk
                i += len(chunk)

                # Update display
                live.update(self._get_rendered_content(title, border_style, subtitle))

                # Calculate delay
                delay = self._get_delay_for_chunk(chunk, text, i)
                time.sleep(delay)

        self._is_streaming = False
        self._live = None
        return text

    def _get_next_chunk(self, text: str, pos: int) -> str:
        """Get the next chunk of text to display."""
        remaining = len(text) - pos

        # For remaining text less than chunk size, take all
        if remaining <= self.config.chunk_size:
            return text[pos:]

        # Look for natural break points
        end = pos + self.config.chunk_size

        # Prefer to break at word boundaries
        while end < len(text) and end > pos:
            if text[end] in " \t\n":
                return text[pos : end + 1]
            end -= 1

        # If no word boundary, just take chunk size
        return text[pos : pos + self.config.chunk_size]

    def _get_delay_for_chunk(self, chunk: str, full_text: str, pos: int) -> float:
        """Calculate appropriate delay for a chunk."""
        # Check for special characters that need pauses
        if chunk.endswith((".", "!", "?", "\n")):
            if self._is_end_of_sentence(full_text, pos):
                return StreamSpeed.PAUSE.value

        # Check for code blocks - stream faster
        if self._in_code_block(full_text, pos):
            return StreamSpeed.FAST.value

        # Check for formatting markers
        if any(marker in chunk for marker in ["**", "*", "`", "#"]):
            return StreamSpeed.SLOW.value

        # Default speed
        return self.config.char_delay

    def _is_end_of_sentence(self, text: str, pos: int) -> bool:
        """Check if current position is end of a sentence."""
        if pos >= len(text):
            return True

        # Check if next non-whitespace is uppercase or end
        remaining = text[pos:].lstrip()
        if not remaining:
            return True

        return remaining[0].isupper() or remaining[0] in "#-•*="

    def _in_code_block(self, text: str, pos: int) -> bool:
        """Check if position is inside a code block."""
        before = text[:pos]
        code_starts = before.count("```")
        return code_starts % 2 == 1  # Odd number means inside code block

    def _get_rendered_content(self, title: str, border_style: str, subtitle: str) -> Panel:
        """Get the current rendered content."""
        # Add cursor indicator if still streaming
        display_text = self._displayed
        if self._is_streaming and not self._cancelled:
            display_text += "▌"  # Cursor

        return Panel(
            Markdown(display_text),
            title=f"[gold]{title}[/gold]",
            border_style=border_style,
            subtitle=f"[dim]{subtitle}[/dim]",
        )

    def _display_complete(self, text: str, title: str, border_style: str, subtitle: str) -> None:
        """Display complete text without streaming."""
        panel = Panel(
            Markdown(text), title=f"[gold]{title}[/gold]", border_style=border_style, subtitle=f"[dim]{subtitle}[/dim]"
        )
        self.console.print(panel)

    def cancel(self) -> None:
        """Cancel the current stream."""
        self._cancelled = True

    def is_streaming(self) -> bool:
        """Check if currently streaming."""
        return self._is_streaming
