from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from tehuti_cli.storage.config import Config, load_config, save_config
from tehuti_cli.storage.workdir_config import apply_workdir_overrides, get_workdir_config
from tehuti_cli.storage.session import create_session, load_last_session
from tehuti_cli.ui.print import PrintUI
from tehuti_cli.ui.shell import Shell


@dataclass
class TehutiApp:
    config: Config

    @classmethod
    def create(cls, config_file: Path | None = None, model: str | None = None) -> "TehutiApp":
        config = load_config(config_file)
        if model:
            config.provider.model = model
            save_config(config, config_file)
        return cls(config)

    def run_shell(self, work_dir: Path, show_banner: bool = False) -> int:
        session = load_last_session(work_dir) or create_session(work_dir)
        cfg = apply_workdir_overrides(self.config, work_dir)
        shell = Shell(cfg, work_dir, session=session, show_banner=show_banner)
        shell.run()
        return 0

    def run_print(self, prompt: str) -> int:
        return PrintUI(self.config).run(prompt)
