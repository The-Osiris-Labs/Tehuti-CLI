from __future__ import annotations

import json
from pathlib import Path


def _load_json(path: Path) -> dict[str, object]:
    return json.loads(path.read_text(encoding="utf-8"))


def test_contract_fixtures_are_valid_json_objects() -> None:
    root = Path("tests/fixtures/contracts")
    files = sorted(root.glob("*.json"))
    assert files, "expected fixture files"
    for file in files:
        payload = _load_json(file)
        assert isinstance(payload, dict), f"{file} must contain a JSON object"
        assert "schema" in payload, f"{file} missing schema"


def test_contract_fixture_schema_coverage_for_documented_core_schemas() -> None:
    root = Path("tests/fixtures/contracts")
    schemas = {
        _load_json(file)["schema"]
        for file in sorted(root.glob("*.json"))
        if isinstance(_load_json(file).get("schema"), str)
    }
    required = {
        "tehuti.wire.v1",
        "tehuti.preflight.v1",
        "tehuti.tool_result.v1",
        "tehuti.metrics.v1",
    }
    missing = required - set(schemas)
    assert not missing, f"missing fixture schemas: {sorted(missing)}"
