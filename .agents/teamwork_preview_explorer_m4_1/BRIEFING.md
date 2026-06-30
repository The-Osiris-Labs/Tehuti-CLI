# BRIEFING — 2026-06-29T11:00:00Z

## Mission
Explore and analyze the sliding viewport implementation, overflow, and scrolling mechanics in Tehuti CLI's chat TUI commands and related files, identifying bugs, edge cases, and improvements.

## 🔒 My Identity
- Archetype: Teamwork explorer
- Roles: read-only investigator, analyzer
- Working directory: /Users/youssefsala7/Projects/Tehuti-CLI-Revival/ .agents/teamwork_preview_explorer_m4_1
- Original parent: 49ff51e0-e358-4bc0-9f42-073e23a84f50
- Milestone: Virtual Sliding Viewport Exploration (M4)

## 🔒 Key Constraints
- Read-only investigation — do NOT implement / modify source files.
- Follow virtual sliding viewport rules in HANDOFF.md.
- Follow Teamwork rules, updating progress.md and writing handoff.md.

## Current Parent
- Conversation ID: 49ff51e0-e358-4bc0-9f42-073e23a84f50
- Updated: 2026-06-29T11:00:00Z

## Investigation State
- **Explored paths**:
  - `src/cli/commands/chat.ts`
  - `src/cli/ui/hooks/useChatInput.ts`
  - `src/cli/ui/hooks/useChatState.ts`
  - `src/cli/ui/components/CommandPalette.tsx`
  - `src/cli/ui/components/ExpandableToolOutput.tsx`
  - `src/terminal/output.ts`
  - `src/utils/mouse.ts`
- **Key findings**:
  - **Compact Header Height Bug**: Hiding compact header (`headerScrollHeight` = 14 instead of 4) causes snap glitches.
  - **Dynamic Elements Clipping**: Ignored dynamic rendering heights (errors, progress, multiline inputs) push bottom inputs off-screen.
  - **computeMessageLines Discrepancies**: Dead code in array content check, hardcoded collapsed tool output heights, and missing code block/table borders cause scroll-capping bugs.
  - **Vim/Mouse Wheel Support Lack**: Mouse scrolls are ignored, and standard keys clash with macOS Mission Control.
  - **Command Palette Submenu Clipping**: Navigating past index 8 hides the cursor highlight.
- **Unexplored areas**: None. Exploration of the scrolling system is complete.

## Key Decisions Made
- Confirmed virtual sliding viewport paradigm behaves as intended (using negative margin bottom) but is constrained by flawed vertical layout math and dead logic branches.

## Artifact Index
- /Users/youssefsala7/Projects/Tehuti-CLI-Revival/.agents/teamwork_preview_explorer_m4_1/ORIGINAL_REQUEST.md — Original user request.
- /Users/youssefsala7/Projects/Tehuti-CLI-Revival/.agents/teamwork_preview_explorer_m4_1/progress.md — Liveness heartbeat and progress tracker.
- /Users/youssefsala7/Projects/Tehuti-CLI-Revival/.agents/teamwork_preview_explorer_m4_1/handoff.md — Detailed final analysis.
