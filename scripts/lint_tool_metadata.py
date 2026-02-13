#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from tehuti_cli.core.tool_contract_linter import lint_tool_registry
from tehuti_cli.core.tools import ToolRegistry
from tehuti_cli.storage.config import default_config


def main() -> int:
    registry = ToolRegistry(default_config())
    errors = lint_tool_registry(registry)
    if not errors:
        print("tool metadata lint: OK")
        return 0
    print("tool metadata lint: FAILED")
    for err in errors:
        print(f"- {err}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
