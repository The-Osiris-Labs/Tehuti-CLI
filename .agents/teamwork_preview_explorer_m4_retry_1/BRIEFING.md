# BRIEFING — 2026-06-29T11:13:30Z

## Mission
Analyze viewport, scroll lock/snapping, and layout jumping/bouncing bugs in Tehuti CLI's chat TUI, and propose robust fix strategies.

## 🔒 My Identity
- Archetype: Explorer
- Roles: Read-only investigator, analyzer
- Working directory: /Users/youssefsala7/Projects/Tehuti-CLI-Revival/.agents/teamwork_preview_explorer_m4_retry_1
- Original parent: 49ff51e0-e358-4bc0-9f42-073e23a84f50
- Milestone: Milestone 4 (Visual Polish & TUI)

## 🔒 Key Constraints
- Read-only investigation — do NOT implement or edit any code files.
- Document analysis in handoff.md and update progress.md.

## Current Parent
- Conversation ID: 49ff51e0-e358-4bc0-9f42-073e23a84f50
- Updated: 2026-06-29T11:13:30Z

## Investigation State
- **Explored paths**:
  - `src/cli/commands/chat.ts` (Viewport calculations, scroll clamping, layout rendering logic)
  - `src/cli/ui/hooks/useChatInput.ts` (Keyboard navigation/selection hooks, scroll wheel events)
  - `src/cli/ui/components/CommandPalette.tsx` (Command palette height, menu stacks, selectedIndex updates)
- **Key findings**:
  - Viewport calculation omits dynamic height offsets for `loading` progress bar and `showThinking` logs.
  - Scroll lock/snapping is caused by dynamically toggling `headerScrollHeight` subtraction on `scrollOffset > 0`.
  - Layout bouncing is caused by dynamic viewport size alterations, coupled with scroll leakage on mouse wheel events.
  - Ignored keys globally reset text selection; Shift shortcuts are intercepted by scrolling/history.
- **Unexplored areas**:
  - None; investigated all requested issues.

## Key Decisions Made
- Confirmed existing bugs empirically via `npx vitest run src/cli/commands/tui-viewport.test.ts`.
- Formulated robust mathematical and structural mitigation strategies to isolate layout calculations from scroll changes.

## Artifact Index
- /Users/youssefsala7/Projects/Tehuti-CLI-Revival/.agents/teamwork_preview_explorer_m4_retry_1/handoff.md — Final analysis report and proposed fix strategies.
- /Users/youssefsala7/Projects/Tehuti-CLI-Revival/.agents/teamwork_preview_explorer_m4_retry_1/progress.md — Liveness heartbeat.
- /Users/youssefsala7/Projects/Tehuti-CLI-Revival/.agents/teamwork_preview_explorer_m4_retry_1/ORIGINAL_REQUEST.md — Copy of the original request.
