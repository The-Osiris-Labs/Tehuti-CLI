#!/usr/bin/env python3
from __future__ import annotations

import json
import shutil
from pathlib import Path


def _write_json(path: Path, payload: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def main() -> int:
    root = Path(".")
    drill_dir = root / ".tehuti_ci_probe" / "rollback_drill"
    current_manifest = drill_dir / "release_manifest.current.json"
    backup_manifest = drill_dir / "release_manifest.backup.json"
    restored_manifest = drill_dir / "release_manifest.restored.json"

    _write_json(
        current_manifest,
        {
            "schema": "tehuti.release_manifest.v1",
            "channel": "beta",
            "contract_baseline": "docs/contract_baseline.json",
            "migration_check": "scripts/check_migration_safety.py",
        },
    )
    shutil.copy2(current_manifest, backup_manifest)

    _write_json(
        current_manifest,
        {
            "schema": "tehuti.release_manifest.v1",
            "channel": "ga",
            "contract_baseline": "docs/contract_baseline.json",
            "migration_check": "scripts/check_migration_safety.py",
        },
    )
    shutil.copy2(backup_manifest, restored_manifest)

    before = json.loads(backup_manifest.read_text(encoding="utf-8"))
    after = json.loads(restored_manifest.read_text(encoding="utf-8"))
    if before != after:
        raise RuntimeError("rollback drill failed: restored manifest mismatch")

    print("[rollback] PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
