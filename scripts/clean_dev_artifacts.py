#!/usr/bin/env python3
from __future__ import annotations

import argparse
import shutil
from pathlib import Path


def _targets(root: Path) -> list[Path]:
    paths: list[Path] = []
    for path in root.rglob("__pycache__"):
        paths.append(path)
    probe = root / ".tehuti_ci_probe"
    if probe.exists():
        paths.append(probe)
    return sorted(set(paths))


def main() -> int:
    parser = argparse.ArgumentParser(description="Clean local Tehuti development artifacts.")
    parser.add_argument("--apply", action="store_true", help="Actually remove artifacts.")
    args = parser.parse_args()

    root = Path.cwd()
    paths = _targets(root)
    if not paths:
        print("clean-dev-artifacts: no artifacts found")
        return 0

    print("clean-dev-artifacts: found")
    for path in paths:
        print(f" - {path}")

    if not args.apply:
        print("clean-dev-artifacts: dry-run (use --apply to remove)")
        return 0

    for path in paths:
        if path.is_dir():
            shutil.rmtree(path, ignore_errors=True)
        else:
            path.unlink(missing_ok=True)
    print("clean-dev-artifacts: removed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
