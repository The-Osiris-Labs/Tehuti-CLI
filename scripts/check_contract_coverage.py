#!/usr/bin/env python3
from __future__ import annotations

import json
import re
from pathlib import Path


SCHEMA_RE = re.compile(r"tehuti\.[a-z_]+\.v\d+")


def _schemas_in_src(root: Path) -> set[str]:
    schemas: set[str] = set()
    for path in root.rglob("*.py"):
        text = path.read_text(encoding="utf-8", errors="replace")
        schemas.update(SCHEMA_RE.findall(text))
    return schemas


def _schemas_in_doc(path: Path) -> set[str]:
    text = path.read_text(encoding="utf-8")
    return set(SCHEMA_RE.findall(text))


def _schemas_in_fixtures(root: Path) -> set[str]:
    schemas: set[str] = set()
    for file in root.glob("*.json"):
        payload = json.loads(file.read_text(encoding="utf-8"))
        schema = payload.get("schema")
        if isinstance(schema, str):
            schemas.add(schema)
    return schemas


def main() -> int:
    src_schemas = _schemas_in_src(Path("src"))
    doc_schemas = _schemas_in_doc(Path("docs/API_CONTRACTS.md"))
    fixture_schemas = _schemas_in_fixtures(Path("tests/fixtures/contracts"))

    # Internal-only records are permitted to be fixture-covered without doc prominence,
    # but runtime-emitted schemas should be both documented and fixture-backed.
    uncovered_in_docs = sorted(s for s in src_schemas if s not in doc_schemas)
    uncovered_in_fixtures = sorted(s for s in src_schemas if s not in fixture_schemas)

    failed = False
    if uncovered_in_docs:
        failed = True
        print("contract coverage: FAILED (missing in docs/API_CONTRACTS.md)")
        for schema in uncovered_in_docs:
            print(f" - {schema}")
    if uncovered_in_fixtures:
        failed = True
        print("contract coverage: FAILED (missing in tests/fixtures/contracts)")
        for schema in uncovered_in_fixtures:
            print(f" - {schema}")

    if failed:
        return 1

    print("contract coverage: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
