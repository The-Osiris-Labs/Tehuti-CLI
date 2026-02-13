from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from tehuti_cli.core.runtime import ToolRuntime
from tehuti_cli.storage.config import load_config


def check(name: str, ok: bool, details: str = "") -> int:
    status = "PASS" if ok else "FAIL"
    print(f"[{status}] {name}")
    if details:
        print(f"  {details}")
    return 0 if ok else 1


def main() -> int:
    cfg = load_config()
    runtime = ToolRuntime(cfg, ROOT)
    failures = 0

    # Core file operations
    temp_file = ROOT / ".tehuti" / "smoke_runtime.txt"
    r = runtime.execute("write", {"path": str(temp_file), "content": "hello smoke"})
    failures += check("write", r.ok, r.output if not r.ok else "")

    r = runtime.execute("read", {"path": str(temp_file)})
    failures += check("read", r.ok and "hello smoke" in (r.output or ""), r.output[:120] if r.output else "")

    r = runtime.execute("edit", {"path": str(temp_file), "old_string": "smoke", "new_string": "agent"})
    failures += check("edit", r.ok, r.output if not r.ok else "")

    r = runtime.execute("read", {"path": str(temp_file)})
    failures += check("read-after-edit", r.ok and "hello agent" in (r.output or ""), r.output[:120] if r.output else "")

    # Core shell and repo-aware tooling
    r = runtime.execute("shell", {"command": "echo tehuti_shell_ok"})
    failures += check("shell", r.ok and "tehuti_shell_ok" in (r.output or ""), r.output[:120] if r.output else "")

    r = runtime.execute("git_status", {})
    failures += check("git_status", r.ok and "On branch" in (r.output or ""), (r.output or "")[:120])

    # Built-in file search coverage
    r = runtime.execute("glob", {"pattern": "src/**/*.py"})
    failures += check("glob", r.ok and "Found" in (r.output or ""), (r.output or "")[:120])

    # Host discovery checks broad shell integration
    r = runtime.execute("host_discovery", {"profile": "basic"})
    failures += check("host_discovery", r.ok and "Discovery report:" in (r.output or ""), (r.output or "")[:120])

    if temp_file.exists():
        temp_file.unlink()

    print()
    if failures:
        print(f"Smoke result: {failures} check(s) failed")
        return 1
    print("Smoke result: all checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
