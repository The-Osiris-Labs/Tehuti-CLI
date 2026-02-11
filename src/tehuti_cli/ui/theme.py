from __future__ import annotations

from rich.theme import Theme
from rich.style import Style

OBSIDIAN = "#0b0b0d"
GOLD = "#d4af37"
SOFT_GOLD = "#c8b27b"
SAND = "#f4e7c5"
CRIMSON = "#b24a3b"
CYAN = "#00bcd4"
GREEN = "#4caf50"
DIM = "#6f6a5f"

THEME = Theme(
    {
        "title": f"bold {GOLD}",
        "gold": GOLD,
        "gold.soft": SOFT_GOLD,
        "sand": SAND,
        "warning": f"bold {CRIMSON}",
        "success": f"bold {GREEN}",
        "info": f"bold {CYAN}",
        "dim": DIM,
    }
)

PROGRESS_THEME = {
    "progress.full": GOLD,
    "progress.bar": GOLD,
    "progress.percentage": GOLD,
    "spinner.text": GOLD,
    "status.spinner": GOLD,
}

STREAMING_STYLE = Style(color=CYAN, italic=True)
SUCCESS_STYLE = Style(color=GREEN, bold=True)
ERROR_STYLE = Style(color=CRIMSON, bold=True)
INFO_STYLE = Style(color=CYAN, bold=True)

# Prompt glyphs. Unicode is intentional to evoke hieroglyphic style.
PROMPT_AGENT = "𓅞"
PROMPT_SHELL = "$"
PROMPT_THINKING = "𓇼"
PROMPT_STREAMING = "𓊃"
PROMPT_SUCCESS = "𓆣"
PROMPT_ERROR = "𓅱"
