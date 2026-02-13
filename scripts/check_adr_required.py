#!/usr/bin/env python3
from __future__ import annotations

import subprocess
import re


SCHEMA_RE = re.compile(r"tehuti\.[a-z_]+\.v\d+")


def _git_changed_files() -> list[str]:
    files: list[str] = []
    candidates = [
        ["git", "diff", "--name-only", "origin/main...HEAD"],
        ["git", "diff", "--name-only", "HEAD~1...HEAD"],
        ["git", "diff", "--name-only"],
    ]
    for cmd in candidates:
        proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
        if proc.returncode == 0:
            files.extend(line.strip() for line in proc.stdout.splitlines() if line.strip())
    # Include untracked/unstaged files in local workflows.
    status = subprocess.run(["git", "status", "--porcelain"], capture_output=True, text=True, check=False)
    if status.returncode == 0 and status.stdout.strip():
        for line in status.stdout.splitlines():
            raw = line.rstrip("\n")
            if not raw.strip():
                continue
            # porcelain format: XY <path>
            if len(raw) >= 4 and raw[2] == " ":
                files.append(raw[3:].strip())
                continue
            # Fallback for unexpected formats.
            files.append(raw.strip())
    deduped = [path for path in dict.fromkeys(files) if path]
    return deduped


def _git_diff_text() -> str:
    candidates = [
        ["git", "diff", "origin/main...HEAD"],
        ["git", "diff", "HEAD~1...HEAD"],
        ["git", "diff"],
    ]
    for cmd in candidates:
        proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
        if proc.returncode == 0 and proc.stdout.strip():
            return proc.stdout
    return ""


def main() -> int:
    changed = _git_changed_files()
    if not changed:
        print("adr check: no changed files detected; skipping")
        return 0

    if any(path.startswith("docs/adr/") for path in changed):
        print("adr check: OK")
        return 0

    diff_text = _git_diff_text()
    schema_changed = bool(SCHEMA_RE.search(diff_text))
    contract_docs_changed = any(path == "docs/API_CONTRACTS.md" for path in changed)
    fixtures_changed = any(path.startswith("tests/fixtures/contracts/") for path in changed)
    envelope_paths_changed = any(
        path in {"src/tehuti_cli/cli.py", "src/tehuti_cli/web/app.py", "src/tehuti_cli/core/runtime.py"}
        for path in changed
    )

    contract_touched = schema_changed or contract_docs_changed or fixtures_changed or envelope_paths_changed
    if not contract_touched:
        print("adr check: no contract-sensitive files changed")
        return 0

    print("adr check: FAILED")
    print("Contract-sensitive files changed but no ADR update found under docs/adr/.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
