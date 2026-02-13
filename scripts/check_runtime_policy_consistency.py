#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from tehuti_cli.core.agent_loop import LOOP_STATE_TRANSITIONS, LoopState
from tehuti_cli.storage.config import default_config


def _check_transition_table_doc() -> list[str]:
    errors: list[str] = []
    path = Path("docs/LOOP_STATE_TABLE.md")
    if not path.exists():
        return ["missing docs/LOOP_STATE_TABLE.md"]
    text = path.read_text(encoding="utf-8")
    for state in LoopState:
        if f"`{state.value}`" not in text:
            errors.append(f"loop state missing in docs table: {state.value}")
    return errors


def _check_retry_policy_docs() -> list[str]:
    errors: list[str] = []
    cfg_doc = Path("docs/CONFIGURATION.md")
    retry_doc = Path("docs/RETRY_BACKOFF_POLICY.md")
    if not cfg_doc.exists():
        errors.append("missing docs/CONFIGURATION.md")
        return errors
    if not retry_doc.exists():
        errors.append("missing docs/RETRY_BACKOFF_POLICY.md")
        return errors
    cfg_text = cfg_doc.read_text(encoding="utf-8")
    retry_text = retry_doc.read_text(encoding="utf-8")
    required = [
        "retry_backoff_base_seconds",
        "retry_backoff_cap_seconds",
        "loop_stuck_backoff_base_seconds",
        "loop_stuck_backoff_cap_seconds",
    ]
    for key in required:
        if key not in cfg_text:
            errors.append(f"config docs missing key: {key}")
        if key not in retry_text:
            errors.append(f"retry policy docs missing key: {key}")
    return errors


def _check_runtime_policy_defaults() -> list[str]:
    errors: list[str] = []
    cfg = default_config()
    keys = [
        "retry_backoff_base_seconds",
        "retry_backoff_cap_seconds",
        "loop_stuck_backoff_base_seconds",
        "loop_stuck_backoff_cap_seconds",
    ]
    for key in keys:
        value = float(getattr(cfg, key))
        if value <= 0:
            errors.append(f"config default must be > 0: {key}={value}")
    if float(cfg.retry_backoff_cap_seconds) < float(cfg.retry_backoff_base_seconds):
        errors.append("retry backoff cap must be >= base")
    if float(cfg.loop_stuck_backoff_cap_seconds) < float(cfg.loop_stuck_backoff_base_seconds):
        errors.append("loop stuck backoff cap must be >= base")
    if set(LOOP_STATE_TRANSITIONS.keys()) != set(LoopState):
        errors.append("LOOP_STATE_TRANSITIONS keys do not cover all LoopState values")
    return errors


def main() -> int:
    errors: list[str] = []
    errors.extend(_check_transition_table_doc())
    errors.extend(_check_retry_policy_docs())
    errors.extend(_check_runtime_policy_defaults())
    if errors:
        print("runtime policy consistency: FAILED")
        for err in errors:
            print(f" - {err}")
        return 1
    print("runtime policy consistency: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
