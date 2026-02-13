#!/usr/bin/env python3
from __future__ import annotations

import re
from pathlib import Path


def _read_pyproject_version(path: Path) -> str:
    text = path.read_text(encoding="utf-8")
    match = re.search(r'(?m)^version\s*=\s*"([^"]+)"\s*$', text)
    if not match:
        raise RuntimeError("Could not find project version in pyproject.toml")
    return match.group(1)


def _read_package_version(path: Path) -> str:
    text = path.read_text(encoding="utf-8")
    match = re.search(r'(?m)^__version__\s*=\s*"([^"]+)"\s*$', text)
    if not match:
        raise RuntimeError("Could not find __version__ in src/tehuti_cli/__init__.py")
    return match.group(1)


def main() -> int:
    pyproject = Path("pyproject.toml")
    package_init = Path("src/tehuti_cli/__init__.py")
    if not pyproject.exists():
        print("version consistency: missing pyproject.toml")
        return 1
    if not package_init.exists():
        print("version consistency: missing src/tehuti_cli/__init__.py")
        return 1

    pyproject_version = _read_pyproject_version(pyproject)
    package_version = _read_package_version(package_init)

    if pyproject_version != package_version:
        print("version consistency: FAILED")
        print(f'pyproject.toml version="{pyproject_version}"')
        print(f'src/tehuti_cli/__init__.py __version__="{package_version}"')
        return 1

    print(f'version consistency: OK ({pyproject_version})')
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
