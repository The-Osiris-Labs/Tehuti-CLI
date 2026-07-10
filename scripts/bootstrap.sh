#!/usr/bin/env bash
# scripts/bootstrap.sh — one-shot dev environment setup + verify.
#
# This script:
#   1. Approves pnpm build scripts for native deps (better-sqlite3, sharp,
#      tree-sitter, esbuild, etc.) that need post-install compilation.
#   2. Runs pnpm install to materialize native bindings.
#   3. Runs typecheck.
#   4. Runs the full test suite.
#
# Use this on a fresh checkout or after pulling changes that touch native
# dependencies. Re-run is safe — pnpm is idempotent.
#
# Exit codes:
#   0  all stages passed
#   1  pnpm install failed
#   2  typecheck failed
#   3  tests failed

set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> [1/4] Approving pnpm build scripts"
# Approve all known native deps. pnpm approve-builds is interactive; this
# writes the approval directly into pnpm-workspace.yaml (or package.json)
# so the next install proceeds non-interactively.
APPROVED_DEPS=(
  "better-sqlite3"
  "sharp"
  "esbuild"
  "tree-sitter"
  "tree-sitter-javascript"
  "tree-sitter-typescript"
  "@lvce-editor/ripgrep"
  "ffmpeg-static"
)

# Use pnpm config to set the approved list non-interactively.
for dep in "${APPROVED_DEPS[@]}"; do
  pnpm config set --location=project onlyBuiltDependencies[]="$dep" 2>/dev/null || \
    pnpm config set --location=project onlyBuiltDependencies "$dep"
done

echo "==> [2/4] pnpm install (compiles native bindings)"
pnpm install --frozen-lockfile=false

echo "==> [3/4] typecheck"
pnpm typecheck || { echo "typecheck failed"; exit 2; }

echo "==> [4/4] test"
pnpm test || { echo "tests failed"; exit 3; }

echo
echo "Bootstrap complete. Run 'pnpm dev' to start the harness."
