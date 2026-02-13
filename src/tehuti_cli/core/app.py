from __future__ import annotations

import uuid
from dataclasses import dataclass
from pathlib import Path

from tehuti_cli.core.preflight import run_preflight, validate_config_contract
from tehuti_cli.storage.config import Config, load_config, save_config
from tehuti_cli.storage.workdir_config import apply_workdir_overrides
from tehuti_cli.storage.session import Session, create_session, load_last_session
from tehuti_cli.ui.shell import Shell


@dataclass
class TehutiApp:
    config: Config

    @classmethod
    def create(cls, config_file: Path | None = None, model: str | None = None) -> "TehutiApp":
        config = load_config(config_file)
        validate_config_contract(config)
        if model:
            config.provider.model = model
            if config.provider.type == "openrouter":
                config.providers.openrouter.model = model
            save_config(config, config_file)
        return cls(config)

    def run_shell(
        self,
        work_dir: Path,
        show_banner: bool = False,
        resume: bool = False,
        session_id: str | None = None,
    ) -> int:
        if session_id:
            from tehuti_cli.storage.session import load_session

            session = load_session(session_id, work_dir)
            if session is None:
                session = create_session(work_dir, session_id=session_id)
        elif resume:
            session = load_last_session(work_dir) or create_session(work_dir)
        else:
            session = create_session(work_dir)

        cfg = apply_workdir_overrides(self.config, work_dir)
        run_preflight(cfg, work_dir, include_tool_registry=False).ensure_ok()
        shell = Shell(cfg, work_dir, session=session, show_banner=show_banner)
        shell.run()
        return 0

    def run_print(self, prompt: str) -> int:
        work_dir = Path.cwd()
        cfg = apply_workdir_overrides(self.config, work_dir)
        run_preflight(cfg, work_dir, include_tool_registry=False).ensure_ok()
        try:
            session = create_session(work_dir)
        except PermissionError:
            from tehuti_cli.storage import session as session_store

            local_session_id = f"print-{uuid.uuid4()}"
            local_session_dir = work_dir / ".tehuti_local_sessions" / local_session_id
            local_session_dir.mkdir(parents=True, exist_ok=True)
            session_store.SESSIONS_DIR = work_dir / ".tehuti_local_sessions"
            context_file = local_session_dir / "context.jsonl"
            wire_file = local_session_dir / "wire.jsonl"
            context_file.touch(exist_ok=True)
            wire_file.touch(exist_ok=True)
            session = Session(
                id=local_session_id,
                work_dir=work_dir,
                context_file=context_file,
                wire_file=wire_file,
            )
        shell = Shell(cfg, work_dir, session=session, show_banner=False, interactive=False)
        shell.run_once(prompt)
        return 0
