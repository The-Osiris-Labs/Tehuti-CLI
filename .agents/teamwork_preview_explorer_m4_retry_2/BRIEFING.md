# BRIEFING — 2026-06-29T11:12:00+03:00

## Mission
Explore and analyze TUI input clash, text selection overrides/resets, and scroll leakage issues in Tehuti CLI and propose robust fixes.

## 🔒 My Identity
- Archetype: explorer
- Roles: Read-only investigator
- Working directory: /Users/youssefsala7/Projects/Tehuti-CLI-Revival/.agents/teamwork_preview_explorer_m4_retry_2
- Original parent: 49ff51e0-e358-4bc0-9f42-073e23a84f50
- Milestone: Milestone 4 Retry

## 🔒 Key Constraints
- Read-only investigation — do NOT implement (no code modifications to project files)
- Focus on: Config Editor input leak, text selection keys (!key.shift), selection reset on unhandled keys, scroll wheel leakage
- Save analysis to /Users/youssefsala7/Projects/Tehuti-CLI-Revival/.agents/teamwork_preview_explorer_m4_retry_2/handoff.md
- Update /Users/youssefsala7/Projects/Tehuti-CLI-Revival/.agents/teamwork_preview_explorer_m4_retry_2/progress.md after each step

## Current Parent
- Conversation ID: 49ff51e0-e358-4bc0-9f42-073e23a84f50
- Updated: 2026-06-29T11:13:00+03:00

## Investigation State
- **Explored paths**: `src/cli/commands/chat.ts`, `src/cli/ui/hooks/useChatInput.ts`, `src/cli/ui/components/ConfigEditor.tsx`, `src/cli/ui/hooks/useChatInput.test.ts`, and `src/cli/commands/tui-viewport.test.ts`
- **Key findings**: Identified that `showConfigEditor` is missing in `useChatInput` props; scroll wheel checks occur before panel check; history navigation and scroll-to-top/bottom hooks bypass `!key.shift`; selection clears unconditionally on unhandled inputs due to a global keycheck.
- **Unexplored areas**: None. All 4 target bugs have been investigated and root causes identified.

## Key Decisions Made
- Confirmed that updating refs synchronously in the render cycle prevents 1-frame race conditions.
- Proposed moving selection-clearing logic from global check into specific input/cursor-modifying event handlers.
- Proposed moving scroll wheel handlers below panel visibility check to resolve leakage.


## Artifact Index
- /Users/youssefsala7/Projects/Tehuti-CLI-Revival/.agents/teamwork_preview_explorer_m4_retry_2/handoff.md — Main findings and analysis report
- /Users/youssefsala7/Projects/Tehuti-CLI-Revival/.agents/teamwork_preview_explorer_m4_retry_2/progress.md — Liveness and step progress tracker
- /Users/youssefsala7/Projects/Tehuti-CLI-Revival/.agents/teamwork_preview_explorer_m4_retry_2/ORIGINAL_REQUEST.md — Archive of user instruction
