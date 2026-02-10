from __future__ import annotations

from rich.theme import Theme

OBSIDIAN = "#0b0b0d"
GOLD = "#d4af37"
SOFT_GOLD = "#c8b27b"
SAND = "#f4e7c5"
CRIMSON = "#b24a3b"

THEME = Theme(
    {
        "title": f"bold {GOLD}",
        "gold": GOLD,
        "gold.soft": SOFT_GOLD,
        "sand": SAND,
        "warning": f"bold {CRIMSON}",
        "dim": "#6f6a5f",
    }
)

# Prompt glyphs. Unicode is intentional to evoke hieroglyphic style.
PROMPT_AGENT = "𓅞"
PROMPT_SHELL = "$"
PROMPT_THINKING = "𓇼"
