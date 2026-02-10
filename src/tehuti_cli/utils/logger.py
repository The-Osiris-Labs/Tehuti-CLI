from __future__ import annotations

import logging
from pathlib import Path

from tehuti_cli.storage.config import Config


_CONFIGURED = False


def get_logger(name: str, config: Config | None = None) -> logging.Logger:
    global _CONFIGURED
    logger = logging.getLogger(name)
    if _CONFIGURED:
        return logger

    level = logging.INFO
    logger.setLevel(level)
    if config is not None:
        log_dir = Path(config.log_dir)
    else:
        log_dir = Path.home() / ".tehuti" / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_file = log_dir / "tehuti.log"
    handler = logging.FileHandler(log_file, encoding="utf-8")
    formatter = logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    handler.setFormatter(formatter)
    root = logging.getLogger()
    root.setLevel(level)
    root.addHandler(handler)
    _CONFIGURED = True
    return logger
