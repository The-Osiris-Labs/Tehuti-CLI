#!/usr/bin/env python3
from __future__ import annotations

import argparse
import subprocess
from pathlib import Path


NOISE_PREFIXES = (
    ".venv/",
    "__pycache__/",
    ".pytest_cache/",
    ".mypy_cache/",
    ".tehuti/",
    ".tehuti_ci_probe/",
    ".tehuti_test_home/",
    ".tehuti_local_sessions/",
    ".tehuti_test_sessions/",
)
NOISE_SUFFIXES = (".pyc", ".pyo")


def _is_noise(path: str) -> bool:
    normalized = path.strip()
    if not normalized:
        return False
    if "/__pycache__/" in normalized:
        return True
    for prefix in NOISE_PREFIXES:
        if normalized.startswith(prefix):
            return True
    return normalized.endswith(NOISE_SUFFIXES)


def _parse_status_output(output: str) -> list[tuple[str, str]]:
    files: list[tuple[str, str]] = []
    for line in output.splitlines():
        if not line:
            continue
        # porcelain format: XY<space>path
        if len(line) > 3:
            files.append((line[:2], line[3:].strip()))
    return files


def _is_deletion_status(xy: str) -> bool:
    if len(xy) != 2:
        return False
    return "D" in xy


def main() -> int:
    parser = argparse.ArgumentParser(description="Enforce release hygiene by flagging environment churn in git diff.")
    parser.add_argument("--strict", action="store_true", help="Fail if hygiene issues are detected.")
    args = parser.parse_args()

    proc = subprocess.run(
        ["git", "status", "--porcelain"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"git status failed: {proc.stdout}")

    entries = _parse_status_output(proc.stdout)
    noisy = sorted({path for xy, path in entries if _is_noise(path) and not _is_deletion_status(xy)})
    staged_noisy = sorted(
        {
            path
            for xy, path in entries
            if _is_noise(path) and not _is_deletion_status(xy) and len(xy) == 2 and xy[0] not in {" ", "?"}
        }
    )
    if noisy:
        print("[hygiene] noisy artifact changes detected:")
        for path in noisy:
            print(f"- {path}")
        if args.strict and staged_noisy:
            raise RuntimeError("release hygiene failed due to environment artifact churn")
        if args.strict and not staged_noisy:
            print("[hygiene] strict mode: no staged noisy artifacts detected")
    else:
        print("[hygiene] clean")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
