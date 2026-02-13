# ADR 0001: Runtime Foundation and Capability Parity

## Status
Accepted

## Context
Tehuti must operate with capability parity expectations: dynamic outputs, deterministic startup, explicit policy controls, and loop behavior that is diagnosable across CLI and web surfaces.

## Decision
1. Add an explicit `access_policy` contract in config.
2. Keep default policy as `full` to preserve maximum-capability behavior.
3. Add deterministic preflight checks and enforce them on startup paths.
4. Introduce typed error categories for consistent diagnostics.
5. Harden agent loop lifecycle with explicit termination reasons and parser modes.

## Consequences
1. Behavior becomes auditable and less implicit.
2. Failures carry machine-readable categories and codes.
3. Loop exits are explicit (`final_response`, `max_iterations`, `parser_error`, etc.).
4. Existing unrestricted default behavior is preserved for compatibility.

## Follow-up
1. Expand typed errors across all tool/protocol adapters.
2. Add contract tests for all preflight checks.
3. Extend observability to export metrics based on termination reasons and error categories.
