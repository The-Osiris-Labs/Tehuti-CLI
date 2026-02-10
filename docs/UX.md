# UX

Tehuti’s terminal UX is evidence‑first and minimal. It shows what happened as it happens, without clutter.

## Action Log
- Each tool call is shown twice: a start marker (`◆`) and a completion marker (`✓`).
- Failures show a `✗` marker with captured output.
- Small outputs are shown inline after completion.
- Larger outputs move to the Evidence panel.
- Action lines are printed as each tool finishes, not after the whole batch.

## Evidence Panel
- Appears only for large outputs.
- Long outputs are collapsed to head/tail with an omitted‑lines marker.
- Each evidence block includes a line count.

## Responses
- No auto‑generated summaries. Responses should be grounded in displayed evidence.

## Pickers
- `/models` and `/providers` open a fast, search‑first picker.
- `/m` and `/p` are quick aliases.
- `/` shows a short command index; `/help` shows the full list.
- Unknown slash commands fall back to normal prompts (no hard errors).

## Status
- `/status` shows current provider/model/session and permissions.

## Transcript
- `/transcript` opens the full session log.
