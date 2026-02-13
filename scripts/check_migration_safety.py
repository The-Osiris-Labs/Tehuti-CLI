#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from tehuti_cli.storage.config import load_config, save_config


def _check_config_roundtrip() -> None:
    fixtures_dir = Path("tests/fixtures/migrations/config")
    if not fixtures_dir.exists():
        print("[migration] no config migration fixtures found; skipping")
        return
    for fixture in sorted(fixtures_dir.glob("*.toml")):
        cfg = load_config(fixture)
        if str(cfg.access_policy) not in {"full", "restricted"}:
            raise RuntimeError(f"{fixture}: invalid access_policy={cfg.access_policy}")
        if cfg.access_policy == "full":
            if not (cfg.default_yolo and cfg.allow_shell and cfg.allow_write and cfg.allow_external):
                raise RuntimeError(f"{fixture}: full policy invariants violated")
        tmp_out = fixture.parent / f".roundtrip.{fixture.name}"
        save_config(cfg, tmp_out)
        cfg2 = load_config(tmp_out)
        tmp_out.unlink(missing_ok=True)
        if cfg.provider.type != cfg2.provider.type or cfg.agent_parser_mode != cfg2.agent_parser_mode:
            raise RuntimeError(f"{fixture}: config roundtrip drift detected")
        print(f"[migration] config-ok {fixture}")


def _check_contract_fixture_shape() -> None:
    fixtures = sorted(Path("tests/fixtures/contracts").glob("*.json"))
    if not fixtures:
        raise RuntimeError("missing contract fixtures")
    for fixture in fixtures:
        payload = json.loads(fixture.read_text(encoding="utf-8"))
        schema = payload.get("schema")
        if not isinstance(schema, str) or not schema.startswith("tehuti."):
            raise RuntimeError(f"{fixture}: invalid schema field")
    print(f"[migration] contracts-ok {len(fixtures)} fixtures")


def main() -> int:
    _check_config_roundtrip()
    _check_contract_fixture_shape()
    print("[migration] PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
