# Output Policy Audit - 2026-02-12

## Policy

Execution paths must present results grounded in real runtime/model/tool data.

## Enforced Rules

- No canned completion-result messages in tool execution flows.
- Fallback responses must come from actual output/evidence.
- Output shaping is allowed (truncate/format), output fabrication is not.

## Scope of Changes

- Shell runtime fallback and evidence rendering.
- Runtime tool result summaries (write/edit).
- Interactive tool result messaging.
- PTY result messages.
- Intent/planning/status scaffolding now uses dynamic runtime-derived wording.

## Residual Fixed Text (Intentional)

Allowed fixed text includes:
- command usage guidance
- empty-state UI labels
- status framing text

These must not imply fabricated execution state or outcomes.
