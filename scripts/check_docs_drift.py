#!/usr/bin/env python3
from __future__ import annotations

import re
import sys
from pathlib import Path


def _schemas_in_api_contracts(path: Path) -> set[str]:
    text = path.read_text(encoding="utf-8")
    schemas = set(re.findall(r"`(tehuti\.[a-z_]+\.v\d+)`", text))
    schemas.update(re.findall(r'"schema"\s*:\s*"(tehuti\.[a-z_]+\.v\d+)"', text))
    return schemas


def _schemas_in_fixtures(root: Path) -> set[str]:
    schemas: set[str] = set()
    for file in root.glob("*.json"):
        text = file.read_text(encoding="utf-8")
        for match in re.findall(r'"schema"\s*:\s*"([^"]+)"', text):
            if match.startswith("tehuti.") and ".v" in match:
                schemas.add(match)
    return schemas


def main() -> int:
    api_contracts = Path("docs/API_CONTRACTS.md")
    fixtures_root = Path("tests/fixtures/contracts")
    if not api_contracts.exists():
        print("docs drift: missing docs/API_CONTRACTS.md")
        return 1
    if not fixtures_root.exists():
        print("docs drift: missing tests/fixtures/contracts")
        return 1

    documented = _schemas_in_api_contracts(api_contracts)
    fixture_schemas = _schemas_in_fixtures(fixtures_root)

    missing = sorted(documented - fixture_schemas)
    if missing:
        print("docs drift: FAILED")
        print("Schemas documented but missing fixture coverage:")
        for schema in missing:
            print(f" - {schema}")
        return 1

    print("docs drift: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
