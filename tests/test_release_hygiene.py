from __future__ import annotations

import importlib.util
from pathlib import Path
import sys


def _load_module():
    module_path = Path("scripts/check_release_hygiene.py")
    spec = importlib.util.spec_from_file_location("check_release_hygiene", module_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_deletion_status_detection() -> None:
    mod = _load_module()
    assert mod._is_deletion_status("D ") is True
    assert mod._is_deletion_status(" D") is True
    assert mod._is_deletion_status("M ") is False
    assert mod._is_deletion_status("??") is False


def test_parse_status_output_extracts_xy_and_path() -> None:
    mod = _load_module()
    parsed = mod._parse_status_output("D  .venv/bin/python\n M src/tehuti_cli/ui/shell.py\n?? docs/new.md\n")
    assert parsed == [
        ("D ", ".venv/bin/python"),
        (" M", "src/tehuti_cli/ui/shell.py"),
        ("??", "docs/new.md"),
    ]
