# Loop State Transition Table

Canonical transition table for `src/tehuti_cli/core/agent_loop.py` (`LOOP_STATE_TRANSITIONS`).

| From | Allowed To |
|---|---|
| `initialized` | `building_context`, `error` |
| `building_context` | `llm_request`, `error` |
| `llm_request` | `parsing_response`, `error` |
| `parsing_response` | `executing_tools`, `finalizing`, `error` |
| `executing_tools` | `updating_context`, `error` |
| `updating_context` | `llm_request`, `finalizing`, `error` |
| `finalizing` | `terminated`, `error` |
| `terminated` | _(none)_ |
| `error` | _(none)_ |

Verification:
- Runtime enforcement raises `invalid_loop_state_transition` on illegal edges.
- Coverage test: `tests/test_agent_loop.py`.
