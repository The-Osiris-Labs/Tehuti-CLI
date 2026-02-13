#!/usr/bin/env python3
from __future__ import annotations

import json
import shutil
from pathlib import Path


def _write(path: Path, payload: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _restore_all(*, backup_dir: Path, target_dir: Path) -> None:
    for name in ("binary_manifest.json", "config_manifest.json", "schema_manifest.json"):
        shutil.copy2(backup_dir / name, target_dir / name)


def main() -> int:
    root = Path(".")
    drill_dir = root / ".tehuti_ci_probe" / "rollback_one_command"
    current_dir = drill_dir / "current"
    backup_dir = drill_dir / "backup"

    _write(current_dir / "binary_manifest.json", {"binary": "tehuti", "version": "1.2.0-beta"})
    _write(current_dir / "config_manifest.json", {"access_policy": "full", "approval_mode": "auto"})
    _write(current_dir / "schema_manifest.json", {"tool_contract": "tehuti.tool_result.v1"})

    backup_dir.mkdir(parents=True, exist_ok=True)
    for name in ("binary_manifest.json", "config_manifest.json", "schema_manifest.json"):
        shutil.copy2(current_dir / name, backup_dir / name)

    # Simulate promotion changes to all three domains.
    _write(current_dir / "binary_manifest.json", {"binary": "tehuti", "version": "1.2.0-ga"})
    _write(current_dir / "config_manifest.json", {"access_policy": "restricted", "approval_mode": "manual"})
    _write(current_dir / "schema_manifest.json", {"tool_contract": "tehuti.tool_result.v2"})

    # One-command rollback path.
    _restore_all(backup_dir=backup_dir, target_dir=current_dir)

    for name in ("binary_manifest.json", "config_manifest.json", "schema_manifest.json"):
        before = json.loads((backup_dir / name).read_text(encoding="utf-8"))
        after = json.loads((current_dir / name).read_text(encoding="utf-8"))
        if before != after:
            raise RuntimeError(f"rollback one-command failed for {name}")

    print("[rollback-one-command] PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
