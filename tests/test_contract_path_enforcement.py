from __future__ import annotations

from pathlib import Path


def test_no_runtime_execute_bypass_in_production_code() -> None:
    root = Path(__file__).resolve().parents[1] / "src" / "tehuti_cli"
    offenders: list[str] = []

    for path in sorted(root.rglob("*.py")):
        text = path.read_text(encoding="utf-8", errors="replace")
        if "runtime.execute(" in text:
            rel = path.relative_to(root.parent)
            offenders.append(str(rel))

    assert offenders == [], (
        "Detected direct runtime.execute(...) usage in production code; "
        "use runtime.execute_contract(...) or runtime.execute_with_tracing(...) instead. "
        f"Offenders: {offenders}"
    )
