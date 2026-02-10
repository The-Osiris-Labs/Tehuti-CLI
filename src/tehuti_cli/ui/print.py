from __future__ import annotations

from dataclasses import dataclass

from rich.console import Console

from tehuti_cli.storage.config import Config
from tehuti_cli.providers.llm import TehutiLLM
from tehuti_cli.ui.theme import THEME


@dataclass
class PrintUI:
    config: Config

    def run(self, prompt: str) -> int:
        console = Console(theme=THEME)
        llm = TehutiLLM(self.config)
        try:
            response = llm.chat(prompt)
        except Exception as exc:
            console.print(f"[warning]{exc}[/warning]")
            return 1
        console.print(response)
        return 0
