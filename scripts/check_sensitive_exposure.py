#!/usr/bin/env python3
from __future__ import annotations

import argparse
import re
import subprocess
from dataclasses import dataclass


FORBIDDEN_PATH_PREFIXES = (
    ".venv/",
    "__pycache__/",
    ".pytest_cache/",
    ".mypy_cache/",
    ".tehuti/",
    ".tehuti_ci_probe/",
    ".tehuti_test_home/",
    ".tehuti_test_sessions/",
)

FORBIDDEN_PATH_EXACT = {
    ".env",
    "keys.env",
}

FORBIDDEN_PATH_SUFFIXES = (
    ".pem",
    ".p12",
    ".pfx",
    ".key",
)

TOKEN_PATTERNS = (
    re.compile(r"sk-[A-Za-z0-9]{20,}"),
    re.compile(r"ghp_[A-Za-z0-9]{20,}"),
    re.compile(r"AKIA[0-9A-Z]{16}"),
    re.compile(r"xox[baprs]-[A-Za-z0-9-]{10,}"),
    re.compile(r"AIza[0-9A-Za-z\-_]{20,}"),
    re.compile(r"-----BEGIN (?:RSA|OPENSSH|EC|DSA|PRIVATE) KEY-----"),
)

ASSIGNMENT_PATTERNS = (
    re.compile(r"(?im)^\s*OPENAI_API_KEY\s*=\s*['\"]?[^'\"\s]{8,}"),
    re.compile(r"(?im)^\s*OPENROUTER_API_KEY\s*=\s*['\"]?[^'\"\s]{8,}"),
    re.compile(r"(?im)^\s*GEMINI_API_KEY\s*=\s*['\"]?[^'\"\s]{8,}"),
    re.compile(r"(?im)^\s*(?:api[_-]?key|access[_-]?token)\s*[:=]\s*['\"]?[A-Za-z0-9_\-]{12,}"),
)

ALLOWLIST_HINTS = (
    "your_api_key_here",
    "replace_me",
    "example",
    "dummy",
    "placeholder",
    "changeme",
    "test_key",
)


@dataclass(frozen=True)
class Violation:
    kind: str
    path: str
    detail: str


def _run_git(args: list[str]) -> str:
    proc = subprocess.run(
        ["git", *args],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed: {proc.stdout.strip()}")
    return proc.stdout


def _staged_paths() -> list[str]:
    output = _run_git(["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"])
    if not output:
        return []
    return [path for path in output.split("\0") if path]


def _is_forbidden_path(path: str) -> bool:
    normalized = path.strip()
    if not normalized:
        return False
    if normalized in FORBIDDEN_PATH_EXACT:
        return True
    base = normalized.rsplit("/", 1)[-1]
    if base in FORBIDDEN_PATH_EXACT:
        return True
    if base.startswith(".env.") and not base.endswith(".example"):
        return True
    for prefix in FORBIDDEN_PATH_PREFIXES:
        if normalized.startswith(prefix):
            return True
    for suffix in FORBIDDEN_PATH_SUFFIXES:
        if normalized.endswith(suffix):
            return True
    return False


def _is_probably_binary(text: str) -> bool:
    return "\x00" in text


def _allowed_placeholder_line(line: str) -> bool:
    lowered = line.lower()
    return any(hint in lowered for hint in ALLOWLIST_HINTS)


def _content_violations(path: str, text: str) -> list[Violation]:
    violations: list[Violation] = []
    if _is_probably_binary(text):
        return violations

    for pattern in TOKEN_PATTERNS:
        match = pattern.search(text)
        if match:
            violations.append(Violation("secret_pattern", path, f"matched `{pattern.pattern}`"))

    lines = text.splitlines()
    for idx, line in enumerate(lines, start=1):
        if _allowed_placeholder_line(line):
            continue
        for pattern in ASSIGNMENT_PATTERNS:
            if pattern.search(line):
                violations.append(Violation("secret_assignment", path, f"line {idx}"))
                break
    return violations


def _staged_file_text(path: str) -> str:
    proc = subprocess.run(
        ["git", "show", f":{path}"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        return ""
    return proc.stdout


def _scan_staged() -> list[Violation]:
    violations: list[Violation] = []
    for path in _staged_paths():
        if _is_forbidden_path(path):
            violations.append(Violation("forbidden_path", path, "path is blocked for commits"))
            continue
        text = _staged_file_text(path)
        violations.extend(_content_violations(path, text))
    return violations


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Block staged commits that contain secrets or local runtime activity artifacts."
    )
    parser.add_argument("--strict", action="store_true", help="Exit non-zero when violations are found.")
    args = parser.parse_args()

    violations = _scan_staged()
    if not violations:
        print("sensitive exposure: OK")
        return 0

    print("sensitive exposure: FAILED")
    for violation in violations:
        print(f"- [{violation.kind}] {violation.path}: {violation.detail}")
    if args.strict:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
