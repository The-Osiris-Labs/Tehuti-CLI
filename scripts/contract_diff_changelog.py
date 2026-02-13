#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


def _normalized_json(path: Path) -> str:
    payload = json.loads(path.read_text(encoding="utf-8"))
    return json.dumps(payload, sort_keys=True, separators=(",", ":"))


def _contract_snapshot(fixtures_dir: Path) -> dict[str, str]:
    snapshot: dict[str, str] = {}
    for file in sorted(fixtures_dir.glob("*.json")):
        data = json.loads(file.read_text(encoding="utf-8"))
        schema = str(data.get("schema", "")).strip() or file.stem
        digest = hashlib.sha256(_normalized_json(file).encode("utf-8")).hexdigest()
        snapshot[f"{schema}:{file.name}"] = digest
    return snapshot


def _diff(before: dict[str, str], after: dict[str, str]) -> tuple[list[str], list[str], list[str]]:
    before_keys = set(before)
    after_keys = set(after)
    added = sorted(after_keys - before_keys)
    removed = sorted(before_keys - after_keys)
    changed = sorted(k for k in before_keys & after_keys if before[k] != after[k])
    return added, removed, changed


def _render_report(added: list[str], removed: list[str], changed: list[str]) -> str:
    lines = ["# Contract Diff Changelog", ""]
    if not (added or removed or changed):
        lines.append("No contract fixture changes detected.")
        return "\n".join(lines) + "\n"

    lines.append("## Summary")
    lines.append(f"- Added: {len(added)}")
    lines.append(f"- Removed: {len(removed)}")
    lines.append(f"- Changed: {len(changed)}")
    lines.append("")
    if added:
        lines.append("## Added")
        lines.extend(f"- {item}" for item in added)
        lines.append("")
    if removed:
        lines.append("## Removed")
        lines.extend(f"- {item}" for item in removed)
        lines.append("")
    if changed:
        lines.append("## Changed")
        lines.extend(f"- {item}" for item in changed)
        lines.append("")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate contract diff changelog from fixtures.")
    parser.add_argument("--fixtures", default="tests/fixtures/contracts", help="Contract fixtures directory")
    parser.add_argument("--baseline", default="docs/contract_baseline.json", help="Baseline snapshot path")
    parser.add_argument("--report", default="docs/CONTRACT_DIFF_CHANGELOG.md", help="Markdown report output")
    parser.add_argument("--update-baseline", action="store_true", help="Update baseline to current snapshot")
    parser.add_argument("--check", action="store_true", help="Fail when changes exist")
    args = parser.parse_args()

    fixtures_dir = Path(args.fixtures)
    baseline_path = Path(args.baseline)
    report_path = Path(args.report)

    current = _contract_snapshot(fixtures_dir)
    before = {}
    if baseline_path.exists():
        before = json.loads(baseline_path.read_text(encoding="utf-8"))
        if not isinstance(before, dict):
            raise RuntimeError(f"Invalid baseline JSON object: {baseline_path}")

    added, removed, changed = _diff(before, current)
    report = _render_report(added, removed, changed)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(report, encoding="utf-8")

    if args.update_baseline:
        baseline_path.parent.mkdir(parents=True, exist_ok=True)
        baseline_path.write_text(json.dumps(current, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    print(f"[contract-diff] added={len(added)} removed={len(removed)} changed={len(changed)}")
    print(f"[contract-diff] report={report_path}")
    if args.check and (added or removed or changed):
        print("[contract-diff] FAIL: fixture changes detected against baseline")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
