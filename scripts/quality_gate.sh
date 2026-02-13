#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
export PYTHONPYCACHEPREFIX=".tehuti_ci_probe/pycache"

echo "[gate] compile"
python3 -m compileall -q src/tehuti_cli tests scripts

echo "[gate] adr governance"
python3 scripts/check_adr_required.py

echo "[gate] docs drift"
python3 scripts/check_docs_drift.py

echo "[gate] version consistency"
python3 scripts/check_version_consistency.py

echo "[gate] runtime policy consistency"
python3 scripts/check_runtime_policy_consistency.py

echo "[gate] contract coverage"
python3 scripts/check_contract_coverage.py

echo "[gate] migration safety"
python3 scripts/check_migration_safety.py

echo "[gate] contract diff changelog"
python3 scripts/contract_diff_changelog.py --check

echo "[gate] tool metadata lint"
python3 scripts/lint_tool_metadata.py

echo "[gate] surface conformance fixture"
python3 scripts/surface_conformance_runner.py

echo "[gate] ux session transcript"
python3 scripts/ux_session_test.py

echo "[gate] perf smoke"
python3 scripts/perf_smoke.py

echo "[gate] perf sustained"
python3 scripts/perf_sustained.py

echo "[gate] perf long session"
python3 scripts/perf_long_session.py

echo "[gate] perf memory relevance"
python3 scripts/perf_memory_relevance.py

echo "[gate] rollback drill"
python3 scripts/rollback_drill.py

echo "[gate] rollback one-command"
python3 scripts/rollback_one_command.py

echo "[gate] canary gate"
python3 scripts/canary_gate.py \
  --channel-from alpha \
  --channel-to beta \
  --metrics-file scripts/fixtures/canary_metrics_ok.json

echo "[gate] release hygiene"
python3 scripts/check_release_hygiene.py --strict

echo "[gate] sensitive exposure"
python3 scripts/check_sensitive_exposure.py --strict

echo "[gate] contract and runtime tests"
python3 -m pytest -q \
  tests/test_contract_fixtures.py \
  tests/test_contract_path_enforcement.py \
  tests/test_tool_contract.py \
  tests/test_tool_metadata_contract.py \
  tests/test_tooling_capability_baseline.py \
  tests/test_runtime_contract_regressions.py \
  tests/test_task_graph_dependencies.py \
  tests/test_memory_determinism.py \
  tests/test_memory_policy_controls.py \
  tests/test_a2a_protocol_errors.py \
  tests/test_protocol_tool_contract_classification.py \
  tests/test_provider_usage_normalization.py \
  tests/test_metrics_contract.py \
  tests/test_preflight.py \
  tests/test_agent_loop.py \
  tests/test_config_access_policy.py \
  tests/test_shell_progress.py \
  tests/test_cli_interactive_envelope_contract.py \
  tests/test_interactive_session_persistence.py \
  tests/test_wire_contract.py \
  tests/test_wire_agent_task_contract.py \
  tests/test_wire_progress_stream.py \
  tests/test_wire_session_persistence.py \
  tests/test_cli_envelope_contract.py \
  tests/test_web_api_contract.py \
  tests/test_web_error_envelope_contract.py \
  tests/test_surface_conformance_runner.py \
  tests/test_retry_semantics_parity.py \
  tests/test_protocol_lifecycle_conformance.py \
  tests/test_mcp_contract_errors.py \
  tests/test_sensitive_exposure_guard.py

echo "[gate] PASS"
